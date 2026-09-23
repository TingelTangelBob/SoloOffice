/**
 * Schlanker Leser für Excel-Arbeitsmappen (.xlsx) ohne Fremdbibliothek.
 *
 * Eine .xlsx-Datei ist ein ZIP-Archiv mit XML-Dateien. Gelesen werden nur
 * Tabellenblätter, gemeinsame Zeichenketten und Zahlenformate. Formeln liefern
 * ihren zuletzt berechneten Wert, Makros und externe Verknüpfungen werden nie
 * ausgeführt. Datumszellen erscheinen als JJJJ-MM-TT, Uhrzeiten als HH:MM,
 * übrige Zahlen als JavaScript-Zahl – unabhängig von der Ländereinstellung
 * des Programms, mit dem die Datei gespeichert wurde.
 */

export type XlsxCell = string | number | null;

export interface XlsxRow {
  /** Zeilennummer wie in Excel angezeigt (1-basiert). */
  rowNumber: number;
  cells: XlsxCell[];
}

export interface XlsxSheet {
  name: string;
  rows: XlsxRow[];
}

const MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024;

interface ZipEntry {
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export function isZipArchive(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error('Die Excel-Datei ist beschädigt (kein ZIP-Verzeichnis).');
  const count = view.getUint16(end + 10, true);
  let pointer = view.getUint32(end + 16, true);
  const decoder = new TextDecoder('utf-8');
  const entries = new Map<string, ZipEntry>();
  for (let index = 0; index < count; index += 1) {
    if (pointer + 46 > bytes.length || view.getUint32(pointer, true) !== 0x02014b50) {
      throw new Error('Die Excel-Datei ist beschädigt (ungültiger Verzeichniseintrag).');
    }
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const uncompressedSize = view.getUint32(pointer + 24, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localHeaderOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    entries.set(name.replace(/^\/+/, ''), { method, compressedSize, uncompressedSize, localHeaderOffset });
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Dieser Browser kann Excel-Dateien nicht entpacken. Bitte die Datei als CSV speichern.');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(bytes: Uint8Array, entries: Map<string, ZipEntry>, name: string): Promise<string | null> {
  const entry = entries.get(name);
  if (!entry) return null;
  if (entry.uncompressedSize > MAX_UNCOMPRESSED_BYTES) throw new Error('Die Excel-Datei ist entpackt zu groß.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (view.getUint32(offset, true) !== 0x04034b50) throw new Error('Die Excel-Datei ist beschädigt (ungültiger Dateikopf).');
  const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  let content: Uint8Array;
  if (entry.method === 0) content = data;
  else if (entry.method === 8) content = await inflateRaw(data);
  else throw new Error('Die Excel-Datei verwendet ein nicht unterstütztes Kompressionsverfahren.');
  if (content.length > MAX_UNCOMPRESSED_BYTES) throw new Error('Die Excel-Datei ist entpackt zu groß.');
  return new TextDecoder('utf-8').decode(content);
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => safeCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => safeCodePoint(parseInt(code, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function safeCodePoint(code: number): string {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

function attribute(source: string, name: string): string | null {
  const match = source.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : null;
}

function textRuns(source: string): string {
  // Phonetische Hilfstexte (rPh) gehören nicht zum Zellinhalt.
  const withoutPhonetic = source.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  const parts: string[] = [];
  for (const match of withoutPhonetic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) parts.push(decodeXml(match[1]));
  return parts.join('');
}

function readSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match => textRuns(match[1]));
}

type NumberKind = 'date' | 'time' | 'number';

const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58]);
const BUILT_IN_TIME_FORMATS = new Set([18, 19, 20, 21, 32, 33, 45, 46, 47, 55, 56]);

function classifyFormatCode(code: string): NumberKind {
  const cleaned = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '')
    .toLowerCase();
  if (/[yd]/.test(cleaned) || /j{2,}|t{2}/.test(cleaned)) return 'date';
  if (/[hs]/.test(cleaned)) return 'time';
  return 'number';
}

function readStyleKinds(xml: string | null): NumberKind[] {
  if (!xml) return [];
  const customFormats = new Map<number, NumberKind>();
  for (const match of xml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const id = Number(attribute(match[1], 'numFmtId'));
    const code = attribute(match[1], 'formatCode') || '';
    customFormats.set(id, classifyFormatCode(code));
  }
  const cellXfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!cellXfs) return [];
  return [...cellXfs[1].matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)].map(match => {
    const id = Number(attribute(match[1], 'numFmtId') || 0);
    if (customFormats.has(id)) return customFormats.get(id) as NumberKind;
    if (BUILT_IN_DATE_FORMATS.has(id)) return 'date';
    if (BUILT_IN_TIME_FORMATS.has(id)) return 'time';
    return 'number';
  });
}

function serialToDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return date.toISOString().slice(0, 10);
}

function serialToTime(serial: number): string {
  const minutes = Math.round((serial - Math.floor(serial)) * 24 * 60);
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function columnIndex(reference: string | null, fallback: number): number {
  const letters = reference?.match(/^([A-Z]+)/)?.[1];
  if (!letters) return fallback;
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function readSheetRows(xml: string, sharedStrings: string[], styles: NumberKind[]): XlsxRow[] {
  const rows: XlsxRow[] = [];
  const sheetData = xml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/)?.[1] || '';
  let fallbackRow = 0;
  for (const rowMatch of sheetData.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    fallbackRow += 1;
    const rowNumber = Number(attribute(rowMatch[1], 'r')) || fallbackRow;
    fallbackRow = rowNumber;
    const cells: XlsxCell[] = [];
    let fallbackColumn = 0;
    for (const cellMatch of (rowMatch[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const inner = cellMatch[2] || '';
      const column = columnIndex(attribute(attrs, 'r'), fallbackColumn);
      fallbackColumn = column + 1;
      const type = attribute(attrs, 't') || 'n';
      const rawValue = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
      let value: XlsxCell = null;
      if (type === 's') value = rawValue === undefined ? null : sharedStrings[Number(rawValue)] ?? null;
      else if (type === 'inlineStr') value = textRuns(inner);
      else if (type === 'str') value = rawValue === undefined ? null : decodeXml(rawValue);
      else if (type === 'b') value = rawValue === '1' ? 'ja' : 'nein';
      else if (type === 'e') value = null;
      else if (rawValue !== undefined && rawValue !== '') {
        const number = Number(rawValue);
        const kind = styles[Number(attribute(attrs, 's') || 0)] || 'number';
        if (!Number.isFinite(number)) value = decodeXml(rawValue);
        else if (kind === 'date' && number >= 1) value = serialToDate(number) ?? number;
        else if ((kind === 'time' || kind === 'date') && number < 1) value = serialToTime(number);
        else value = number;
      }
      if (typeof value === 'string') value = value.trim();
      cells[column] = value === '' ? null : value;
    }
    if (cells.some(cell => cell !== null && cell !== undefined)) {
      rows.push({ rowNumber, cells: Array.from(cells, cell => cell ?? null) });
    }
  }
  return rows;
}

function resolveTarget(target: string): string {
  const cleaned = target.replace(/^\/+/, '');
  if (cleaned.startsWith('xl/')) return cleaned;
  const parts: string[] = [];
  for (const part of `xl/${cleaned}`.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/** Liest alle Tabellenblätter einer .xlsx-Arbeitsmappe. */
export async function readXlsx(buffer: ArrayBuffer | Uint8Array): Promise<XlsxSheet[]> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!isZipArchive(bytes)) throw new Error('Die Datei ist keine Excel-Arbeitsmappe im Format .xlsx.');
  const entries = readZipDirectory(bytes);
  const workbook = await readEntry(bytes, entries, 'xl/workbook.xml');
  if (!workbook) throw new Error('Die Excel-Datei enthält keine Arbeitsmappe.');
  const relations = await readEntry(bytes, entries, 'xl/_rels/workbook.xml.rels');
  const targets = new Map<string, string>();
  for (const match of (relations || '').matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attribute(match[1], 'Id');
    const target = attribute(match[1], 'Target');
    if (id && target) targets.set(id, resolveTarget(target));
  }
  const sharedStrings = readSharedStrings(await readEntry(bytes, entries, 'xl/sharedStrings.xml'));
  const styles = readStyleKinds(await readEntry(bytes, entries, 'xl/styles.xml'));
  const sheets: XlsxSheet[] = [];
  let index = 0;
  for (const match of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    index += 1;
    const name = attribute(match[1], 'name') || `Tabelle ${index}`;
    const relationId = attribute(match[1], 'r:id');
    const path = (relationId && targets.get(relationId)) || `xl/worksheets/sheet${index}.xml`;
    const xml = await readEntry(bytes, entries, path);
    if (xml === null) continue;
    sheets.push({ name, rows: readSheetRows(xml, sharedStrings, styles) });
  }
  if (sheets.length === 0) throw new Error('Die Excel-Datei enthält kein lesbares Tabellenblatt.');
  return sheets;
}
