import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const MAX_OCR_OUTPUT = 8 * 1024 * 1024;
const MAX_PDF_PAGES = 50;

const extensionByMimeType = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

const amountPattern = /(?:\d{1,3}(?:[.\s]\d{3})+|\d+)(?:[,.]\d{2})?/g;
const datePattern = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b|\b(20\d{2})-(\d{2})-(\d{2})\b/g;
const dateHintPattern = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b20\d{2}-\d{2}-\d{2}\b/;

export function decodeBase64Content(content) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Der Beleginhalt fehlt.');
  }

  const base64 = content.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!base64 || base64.length % 4 === 1 || !/^[a-z0-9+/]*={0,2}$/i.test(base64)) {
    throw new Error('Der Beleginhalt ist leer oder ungültig.');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new Error('Der Beleginhalt ist leer oder ungültig.');
  return buffer;
}

function parseNumber(value) {
  const normalized = String(value).replace(/[^\d,.-]/g, '').replace(/\s/g, '');
  if (!normalized) return NaN;

  if (normalized.includes(',')) {
    return Number(normalized.replace(/\./g, '').replace(',', '.'));
  }

  if (/^\d{1,3}\.\d{3}$/.test(normalized)) {
    return Number(normalized.replace('.', ''));
  }

  const dotParts = normalized.split('.');
  if (dotParts.length > 2) {
    return Number(dotParts.slice(0, -1).join('') + '.' + dotParts.at(-1));
  }
  return Number(normalized);
}

function roundAmount(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : undefined;
}

function amountsFromLine(line) {
  return (line.match(amountPattern) || [])
    .map(parseNumber)
    .filter(value => Number.isFinite(value));
}

function parseDateCandidate(match) {
  if (match[4]) {
    return `${match[4]}-${match[5]}-${match[6]}`;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractDocumentDate(lines) {
  const candidates = [];
  lines.forEach((line, lineIndex) => {
    for (const match of line.matchAll(datePattern)) {
      const date = parseDateCandidate(match);
      if (date) {
        const labelScore = /(rechnungsdatum|belegdatum|leistungsdatum|ausstellungsdatum)/i.test(line)
          ? 20
          : /datum/i.test(line) ? 10 : 0;
        candidates.push({ date, score: labelScore, lineIndex });
      }
    }
  });

  candidates.sort((left, right) => right.score - left.score || left.lineIndex - right.lineIndex);
  return candidates[0]?.date;
}

function extractAmount(lines, pattern) {
  const matchingLines = lines.filter(line => pattern.test(line));
  const amounts = matchingLines.flatMap(amountsFromLine);
  return amounts.length ? roundAmount(amounts.at(-1)) : undefined;
}

function extractDocumentNumber(lines) {
  for (const line of lines) {
    const match = line.match(/(?:rechnungsnummer|rechnungs-nr\.?|rechnung\s*nr\.?|belegnummer|beleg\s*nr\.?|invoice\s*(?:no|number))\s*[:#-]?\s*([a-z0-9][a-z0-9./_-]{2,})/i);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function extractVendorName(lines) {
  const ignored = /^(rechnung|invoice|beleg|gutschrift|datum|rechnungsnummer|belegnummer|seite|tel\.?|telefon|e-?mail|www\.)/i;
  for (const line of lines.slice(0, 8)) {
    const candidate = line.replace(/^[|•*]+|[|•*]+$/g, '').trim();
    if (candidate.length < 2 || candidate.length > 120 || ignored.test(candidate)) continue;
    if (/^[-+]?\d[\d\s.,€$]*$/.test(candidate) || dateHintPattern.test(candidate)) continue;
    if (/^(?:netto|brutto|mwst\.?|ust\.?|gesamt|summe|total|betrag)\b/i.test(candidate)) continue;
    return candidate;
  }
  return undefined;
}

function suggestCategory(text) {
  const rules = [
    ['software', /software|cloud|hosting|lizenz|saas/i],
    ['telecommunications', /telefon|internet|mobilfunk|telekommunikation/i],
    ['office', /büro|papier|drucker|schreibwaren|toner/i],
    ['materials', /material|ware|rohstoff|ersatzteil/i],
    ['travel', /bahn|hotel|reise|flug|taxi|übernacht/i],
    ['vehicle', /tank|diesel|benzin|park|fahrzeug|kfz/i],
    ['marketing', /werbung|anzeige|marketing|druck/i],
    ['professional_services', /beratung|steuerberater|anwalt|fremdleistung/i],
    ['insurance', /versicherung|beitrag/i],
    ['bank_fees', /bank|gebühr|konto|transaktion/i],
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] || 'other_expense';
}

function parseExtractedData(text) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const normalizedText = lines.join('\n');

  const netAmount = extractAmount(lines, /\bnetto\b|net amount/i);
  const taxAmount = extractAmount(lines, /\bmwst\.?\b|\bust\.?\b|umsatzsteuer|tax amount/i);
  let grossAmount = extractAmount(lines, /gesamt|summe|total|zu zahlen|endbetrag|\bbrutto\b|betrag/i);

  const allCurrencyAmounts = lines
    .filter(line => /€|eur/i.test(line))
    .flatMap(amountsFromLine);
  if (grossAmount === undefined && allCurrencyAmounts.length) grossAmount = roundAmount(allCurrencyAmounts.at(-1));
  if (grossAmount === undefined && netAmount !== undefined && taxAmount !== undefined) grossAmount = roundAmount(netAmount + taxAmount);

  let normalizedNetAmount = netAmount;
  let normalizedTaxAmount = taxAmount;
  if (normalizedNetAmount === undefined && grossAmount !== undefined && normalizedTaxAmount !== undefined) {
    normalizedNetAmount = roundAmount(grossAmount - normalizedTaxAmount);
  }
  if (normalizedTaxAmount === undefined && grossAmount !== undefined && normalizedNetAmount !== undefined) {
    normalizedTaxAmount = roundAmount(grossAmount - normalizedNetAmount);
  }

  const taxRateMatch = normalizedText.match(/(\d{1,2}(?:[,.]\d{1,2})?)\s*%/);
  const taxRate = taxRateMatch ? roundAmount(parseNumber(taxRateMatch[1])) : undefined;

  return {
    vendorName: extractVendorName(lines),
    documentDate: extractDocumentDate(lines),
    documentNumber: extractDocumentNumber(lines),
    netAmount: normalizedNetAmount,
    taxAmount: normalizedTaxAmount,
    grossAmount,
    taxRate,
    suggestedCategory: suggestCategory(normalizedText),
    currency: /€|\beur\b/i.test(normalizedText) ? 'EUR' : undefined,
  };
}

async function readConfidence(inputPath) {
  try {
    const { stdout } = await execFileAsync('tesseract', [inputPath, 'stdout', '-l', 'deu+eng', '--psm', '6', 'tsv'], {
      maxBuffer: MAX_OCR_OUTPUT,
    });
    const confidences = stdout
      .split(/\r?\n/)
      .slice(1)
      .map(line => line.split('\t')[10])
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value >= 0);
    if (!confidences.length) return undefined;
    return Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 100) / 100;
  } catch {
    return undefined;
  }
}

async function runTesseract(inputPath, name) {
  try {
    const { stdout } = await execFileAsync('tesseract', [inputPath, 'stdout', '-l', 'deu+eng', '--psm', '6'], {
      maxBuffer: MAX_OCR_OUTPUT,
    });
    return String(stdout || '').trim();
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('Lokales OCR ist im Backend nicht installiert. Bitte das Backend-Image neu bauen.');
    }
    throw new Error(`Lokales OCR konnte „${name || 'Beleg'}“ nicht lesen.`);
  }
}

async function extractPdfText(inputPath, name) {
  try {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', inputPath, '-'], {
      maxBuffer: MAX_OCR_OUTPUT,
    });
    return String(stdout || '').trim();
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('Die PDF-Verarbeitung ist im Backend nicht installiert. Bitte das Backend-Image neu bauen.');
    }
    throw new Error(`Die PDF „${name || 'Beleg'}“ konnte nicht gelesen werden.`);
  }
}

async function getPdfPageCount(inputPath, name) {
  try {
    const { stdout } = await execFileAsync('pdfinfo', [inputPath], { maxBuffer: 1024 * 1024 });
    const pageMatch = String(stdout || '').match(/^Pages:\s+(\d+)$/m);
    const pageCount = Number(pageMatch?.[1]);
    if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('Keine PDF-Seiten gefunden.');
    if (pageCount > MAX_PDF_PAGES) throw new Error(`PDF-Belege dürfen höchstens ${MAX_PDF_PAGES} Seiten enthalten.`);
    return pageCount;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('Die PDF-Verarbeitung ist im Backend nicht installiert. Bitte das Backend-Image neu bauen.');
    }
    if (error instanceof Error && error.message.includes('höchstens')) throw error;
    throw new Error(`Die PDF „${name || 'Beleg'}“ konnte nicht gelesen werden.`);
  }
}

async function runScannedPdfOcr(inputPath, tempDirectory, name) {
  await getPdfPageCount(inputPath, name);
  const pagePrefix = path.join(tempDirectory, 'page');
  try {
    await execFileAsync('pdftoppm', ['-png', '-r', '180', inputPath, pagePrefix], {
      maxBuffer: MAX_OCR_OUTPUT,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('Die PDF-Verarbeitung ist im Backend nicht installiert. Bitte das Backend-Image neu bauen.');
    }
    throw new Error(`Die eingescannte PDF „${name || 'Beleg'}“ konnte nicht verarbeitet werden.`);
  }

  const pageFiles = (await fs.readdir(tempDirectory))
    .filter(fileName => /^page-\d+\.png$/i.test(fileName))
    .sort((left, right) => Number(left.match(/-(\d+)\.png$/i)?.[1]) - Number(right.match(/-(\d+)\.png$/i)?.[1]));
  if (!pageFiles.length) throw new Error(`Die eingescannte PDF „${name || 'Beleg'}“ enthält keine lesbaren Seiten.`);

  const pageTexts = [];
  const confidences = [];
  for (const pageFile of pageFiles) {
    const pagePath = path.join(tempDirectory, pageFile);
    const pageText = await runTesseract(pagePath, name);
    if (pageText) pageTexts.push(pageText);
    const confidence = await readConfidence(pagePath);
    if (confidence !== undefined) confidences.push(confidence);
  }

  return {
    text: pageTexts.join('\n\n').trim(),
    confidence: confidences.length
      ? Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 100) / 100
      : undefined,
  };
}

/**
 * Process images and PDFs inside the backend container. Digital PDFs use
 * their embedded text; image-only PDFs are rendered locally and passed to
 * Tesseract. No file is sent to an external service.
 */
export async function runLocalOcr({ content, contentType, name }) {
  const normalizedContentType = String(contentType || '').toLowerCase();
  const extension = extensionByMimeType[normalizedContentType];
  if (!extension) throw new Error('Für die lokale Belegerkennung werden PDF-, JPG-, PNG- oder WEBP-Dateien unterstützt.');

  const buffer = decodeBase64Content(content);
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'solooffice-ocr-'));
  const inputPath = path.join(tempDirectory, `receipt${extension}`);

  try {
    await fs.writeFile(inputPath, buffer);
    let text;
    let confidence;
    if (normalizedContentType === 'application/pdf') {
      text = await extractPdfText(inputPath, name);
      if (!text) ({ text, confidence } = await runScannedPdfOcr(inputPath, tempDirectory, name));
    } else {
      text = await runTesseract(inputPath, name);
      confidence = await readConfidence(inputPath);
    }

    return {
      text,
      confidence,
      extractedData: parseExtractedData(text),
    };
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}
