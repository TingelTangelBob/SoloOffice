/**
 * CSV-Ausgabe für die Weitergabe an Steuerberatung und Tabellenkalkulation.
 *
 * Bewusst auf den deutschen Sprachraum ausgelegt:
 * - Semikolon als Trennzeichen, weil Excel in deutscher Einstellung das Komma
 *   als Dezimaltrenner liest und eine kommagetrennte Datei in eine Spalte legt.
 * - Byte Order Mark, sonst zeigt Excel Umlaute als Buchstabensalat.
 * - CRLF als Zeilenende, wie es RFC 4180 vorsieht.
 */

const SEPARATOR = ';';
const LINE_BREAK = '\r\n';
const BYTE_ORDER_MARK = '﻿';

export interface CsvColumn<T> {
  header: string;
  /** Rohwert. Zahlen und Datumswerte werden unten passend formatiert. */
  value: (row: T) => string | number | Date | null | undefined;
  /** Nachkommastellen erzwingen; nur für Zahlen ausgewertet. */
  decimals?: number;
}

const formatNumberForCsv = (value: number, decimals?: number) => {
  const fixed = typeof decimals === 'number' ? value.toFixed(decimals) : String(value);
  // Dezimalkomma statt Punkt: Ohne das behandelt Excel den Wert als Text.
  return fixed.replace('.', ',');
};

const formatDateForCsv = (value: Date) => {
  const day = String(value.getDate()).padStart(2, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${value.getFullYear()}`;
};

const escapeCell = (raw: string) => {
  // Ein führendes =, +, - oder @ deutet Excel als Formel. Der vorangestellte
  // Apostroph verhindert das, ohne den Wert sichtbar zu verändern. Tabulator
  // und Zeilenumbrüche gehören ebenfalls zu bekannten Umgehungen.
  const guarded = /^[=+\-@\t\r\n]/.test(raw) ? `'${raw}` : raw;
  if (!/[";\r\n]/.test(guarded)) return guarded;
  return `"${guarded.replace(/"/g, '""')}"`;
};

const toCell = <T>(row: T, column: CsvColumn<T>) => {
  const value = column.value(row);
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return escapeCell(formatDateForCsv(value));
  if (typeof value === 'number') {
    // Zahlen stammen nicht aus freiem Text. Sie dürfen insbesondere bei
    // negativen Beträgen kein Formel-Schutzapostroph erhalten, sonst kann die
    // Tabellenkalkulation nicht mehr mit ihnen rechnen.
    return Number.isFinite(value) ? formatNumberForCsv(value, column.decimals) : '';
  }
  return escapeCell(String(value));
};

/** Baut den CSV-Text inklusive Kopfzeile. */
export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map(column => escapeCell(column.header)).join(SEPARATOR);
  const body = rows.map(row => columns.map(column => toCell(row, column)).join(SEPARATOR));
  return [header, ...body].join(LINE_BREAK) + LINE_BREAK;
}

/** Ergänzt den Dateinamen um das aktuelle Datum, damit Exporte unterscheidbar bleiben. */
export function csvFileName(base: string): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return `${base}-${stamp}.csv`;
}

/** Erzeugt die Datei und startet den Download. */
export function downloadCsv<T>(fileName: string, rows: T[], columns: CsvColumn<T>[]): void {
  const blob = new Blob([BYTE_ORDER_MARK + buildCsv(rows, columns)], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
