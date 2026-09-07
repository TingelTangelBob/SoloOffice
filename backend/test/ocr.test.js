import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeBase64Content,
  getOcrConcurrencyLimit,
  getOcrQueueStatus,
  getOcrTimeoutMs,
  parseTesseractTsv,
  runWithOcrConcurrency,
} from '../services/ocrService.js';

test('Beleginhalt akzeptiert Base64 und Data-URLs', () => {
  assert.equal(decodeBase64Content('SGFsbG8=').toString('utf8'), 'Hallo');
  assert.equal(decodeBase64Content('data:text/plain;base64,U29sb09mZmljZQ==').toString('utf8'), 'SoloOffice');
});

test('Leerer und ungültiger Beleginhalt wird abgewiesen', () => {
  assert.throws(() => decodeBase64Content(''), /Beleginhalt fehlt/);
  assert.throws(() => decodeBase64Content('%%%'), /leer oder ungültig/);
});

test('Tesseract-TSV liefert Text und gemittelte Konfidenz aus einem Lauf', () => {
  const tsv = [
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    '1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t',
    '5\t1\t1\t1\t1\t1\t10\t10\t20\t10\t80\tSoloOffice',
    '5\t1\t1\t1\t1\t2\t35\t10\t20\t10\t90\tOCR',
    '5\t1\t1\t1\t2\t1\t10\t30\t20\t10\t70\tBeleg',
  ].join('\n');

  assert.deepEqual(parseTesseractTsv(tsv), {
    text: 'SoloOffice OCR\nBeleg',
    confidence: 80,
  });
});

test('OCR-Warteschlange begrenzt parallele Vorgänge auf den konfigurierten Wert', async () => {
  const previousLimit = process.env.OCR_CONCURRENCY_LIMIT;
  process.env.OCR_CONCURRENCY_LIMIT = '2';
  let active = 0;
  let maximumActive = 0;

  try {
    await Promise.all(Array.from({ length: 6 }, (_, index) => runWithOcrConcurrency(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
    }, `Testbeleg-${index + 1}`)));

    assert.equal(maximumActive, 2);
    assert.deepEqual(getOcrQueueStatus(), { active: 0, pending: 0, limit: 2 });
  } finally {
    if (previousLimit === undefined) delete process.env.OCR_CONCURRENCY_LIMIT;
    else process.env.OCR_CONCURRENCY_LIMIT = previousLimit;
  }
});

test('OCR-Konfiguration fällt auf sichere Standardwerte zurück', () => {
  const previousLimit = process.env.OCR_CONCURRENCY_LIMIT;
  const previousTimeout = process.env.OCR_TIMEOUT_MS;
  delete process.env.OCR_CONCURRENCY_LIMIT;
  delete process.env.OCR_TIMEOUT_MS;

  try {
    assert.equal(getOcrConcurrencyLimit(), 2);
    assert.equal(getOcrTimeoutMs(), 120_000);
  } finally {
    if (previousLimit === undefined) delete process.env.OCR_CONCURRENCY_LIMIT;
    else process.env.OCR_CONCURRENCY_LIMIT = previousLimit;
    if (previousTimeout === undefined) delete process.env.OCR_TIMEOUT_MS;
    else process.env.OCR_TIMEOUT_MS = previousTimeout;
  }
});
