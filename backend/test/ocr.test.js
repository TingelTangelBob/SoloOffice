import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeBase64Content,
  getOcrConcurrencyLimit,
  getOcrMaxPending,
  getOcrQueueStatus,
  getOcrTimeoutMs,
  getOcrWorkspaceLimit,
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
  const previousPending = process.env.OCR_MAX_PENDING;
  const previousWorkspaceLimit = process.env.OCR_WORKSPACE_LIMIT;
  process.env.OCR_CONCURRENCY_LIMIT = '2';
  process.env.OCR_MAX_PENDING = '32';
  process.env.OCR_WORKSPACE_LIMIT = '6';
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
    assert.deepEqual(getOcrQueueStatus(), {
      active: 0,
      pending: 0,
      limit: 2,
      maxPending: 32,
      workspaceLimit: 6,
      workspaceLoads: {},
    });
  } finally {
    if (previousLimit === undefined) delete process.env.OCR_CONCURRENCY_LIMIT;
    else process.env.OCR_CONCURRENCY_LIMIT = previousLimit;
    if (previousPending === undefined) delete process.env.OCR_MAX_PENDING;
    else process.env.OCR_MAX_PENDING = previousPending;
    if (previousWorkspaceLimit === undefined) delete process.env.OCR_WORKSPACE_LIMIT;
    else process.env.OCR_WORKSPACE_LIMIT = previousWorkspaceLimit;
  }
});

test('OCR-Warteschlange begrenzt globale Pending-Aufträge vor dem Einreihen', async () => {
  const previousConcurrency = process.env.OCR_CONCURRENCY_LIMIT;
  const previousPending = process.env.OCR_MAX_PENDING;
  const previousWorkspaceLimit = process.env.OCR_WORKSPACE_LIMIT;
  process.env.OCR_CONCURRENCY_LIMIT = '1';
  process.env.OCR_MAX_PENDING = '2';
  process.env.OCR_WORKSPACE_LIMIT = '10';
  let release;
  const blocker = new Promise(resolve => { release = resolve; });

  try {
    const first = runWithOcrConcurrency(() => blocker, 'Global-1', 'workspace-a');
    const second = runWithOcrConcurrency(async () => {}, 'Global-2', 'workspace-a');
    const third = runWithOcrConcurrency(async () => {}, 'Global-3', 'workspace-b');

    assert.equal(getOcrQueueStatus().pending, 2);
    await assert.rejects(
      () => runWithOcrConcurrency(async () => {}, 'Global-4', 'workspace-c'),
      error => error.code === 'OCR_QUEUE_OVERLOADED'
        && error.scope === 'global'
        && error.statusCode === 429
        && error.retryAfterSeconds > 0,
    );

    release();
    await Promise.all([first, second, third]);
    assert.equal(getOcrQueueStatus().pending, 0);
    assert.equal(getOcrQueueStatus().active, 0);
  } finally {
    if (release) release();
    if (previousConcurrency === undefined) delete process.env.OCR_CONCURRENCY_LIMIT;
    else process.env.OCR_CONCURRENCY_LIMIT = previousConcurrency;
    if (previousPending === undefined) delete process.env.OCR_MAX_PENDING;
    else process.env.OCR_MAX_PENDING = previousPending;
    if (previousWorkspaceLimit === undefined) delete process.env.OCR_WORKSPACE_LIMIT;
    else process.env.OCR_WORKSPACE_LIMIT = previousWorkspaceLimit;
  }
});

test('OCR-Workspace-Grenze isoliert Workspaces und lässt andere weiter einreihen', async () => {
  const previousConcurrency = process.env.OCR_CONCURRENCY_LIMIT;
  const previousPending = process.env.OCR_MAX_PENDING;
  const previousWorkspaceLimit = process.env.OCR_WORKSPACE_LIMIT;
  process.env.OCR_CONCURRENCY_LIMIT = '1';
  process.env.OCR_MAX_PENDING = '10';
  process.env.OCR_WORKSPACE_LIMIT = '2';
  let release;
  const blocker = new Promise(resolve => { release = resolve; });
  let workspaceBRan = false;
  const executionOrder = [];

  try {
    const firstA = runWithOcrConcurrency(() => blocker, 'Workspace-A-1', 'workspace-a');
    const secondA = runWithOcrConcurrency(async () => {
      executionOrder.push('workspace-a');
    }, 'Workspace-A-2', 'workspace-a');

    await assert.rejects(
      () => runWithOcrConcurrency(async () => {}, 'Workspace-A-3', 'workspace-a'),
      error => error.code === 'OCR_QUEUE_OVERLOADED' && error.scope === 'workspace',
    );

    const firstB = runWithOcrConcurrency(async () => {
      workspaceBRan = true;
      executionOrder.push('workspace-b');
    }, 'Workspace-B-1', 'workspace-b');
    assert.equal(getOcrQueueStatus().workspaceLoads['workspace-a'], 2);
    assert.equal(getOcrQueueStatus().workspaceLoads['workspace-b'], 1);

    release();
    await Promise.all([firstA, secondA, firstB]);
    assert.equal(workspaceBRan, true);
    assert.deepEqual(executionOrder, ['workspace-b', 'workspace-a']);
    assert.deepEqual(getOcrQueueStatus().workspaceLoads, {});
  } finally {
    if (release) release();
    if (previousConcurrency === undefined) delete process.env.OCR_CONCURRENCY_LIMIT;
    else process.env.OCR_CONCURRENCY_LIMIT = previousConcurrency;
    if (previousPending === undefined) delete process.env.OCR_MAX_PENDING;
    else process.env.OCR_MAX_PENDING = previousPending;
    if (previousWorkspaceLimit === undefined) delete process.env.OCR_WORKSPACE_LIMIT;
    else process.env.OCR_WORKSPACE_LIMIT = previousWorkspaceLimit;
  }
});

test('OCR-Queue gibt Workspace-Slot nach Fehlern frei und kann danach drainen', async () => {
  const previousConcurrency = process.env.OCR_CONCURRENCY_LIMIT;
  const previousWorkspaceLimit = process.env.OCR_WORKSPACE_LIMIT;
  process.env.OCR_CONCURRENCY_LIMIT = '1';
  process.env.OCR_WORKSPACE_LIMIT = '1';

  try {
    await assert.rejects(
      () => runWithOcrConcurrency(async () => { throw new Error('gezielter Testfehler'); }, 'Fehlerbeleg', 'workspace-error'),
      /gezielter Testfehler/,
    );
    assert.deepEqual(getOcrQueueStatus().workspaceLoads, {});

    await runWithOcrConcurrency(async () => 'ok', 'Nach-Fehler-Beleg', 'workspace-error');
    assert.deepEqual(getOcrQueueStatus().workspaceLoads, {});
  } finally {
    if (previousConcurrency === undefined) delete process.env.OCR_CONCURRENCY_LIMIT;
    else process.env.OCR_CONCURRENCY_LIMIT = previousConcurrency;
    if (previousWorkspaceLimit === undefined) delete process.env.OCR_WORKSPACE_LIMIT;
    else process.env.OCR_WORKSPACE_LIMIT = previousWorkspaceLimit;
  }
});

test('OCR-Konfiguration fällt auf sichere Standardwerte zurück', () => {
  const previousLimit = process.env.OCR_CONCURRENCY_LIMIT;
  const previousPending = process.env.OCR_MAX_PENDING;
  const previousWorkspaceLimit = process.env.OCR_WORKSPACE_LIMIT;
  const previousTimeout = process.env.OCR_TIMEOUT_MS;
  delete process.env.OCR_CONCURRENCY_LIMIT;
  delete process.env.OCR_MAX_PENDING;
  delete process.env.OCR_WORKSPACE_LIMIT;
  delete process.env.OCR_TIMEOUT_MS;

  try {
    assert.equal(getOcrConcurrencyLimit(), 2);
    assert.equal(getOcrMaxPending(), 32);
    assert.equal(getOcrWorkspaceLimit(), 4);
    assert.equal(getOcrTimeoutMs(), 120_000);
  } finally {
    if (previousLimit === undefined) delete process.env.OCR_CONCURRENCY_LIMIT;
    else process.env.OCR_CONCURRENCY_LIMIT = previousLimit;
    if (previousPending === undefined) delete process.env.OCR_MAX_PENDING;
    else process.env.OCR_MAX_PENDING = previousPending;
    if (previousWorkspaceLimit === undefined) delete process.env.OCR_WORKSPACE_LIMIT;
    else process.env.OCR_WORKSPACE_LIMIT = previousWorkspaceLimit;
    if (previousTimeout === undefined) delete process.env.OCR_TIMEOUT_MS;
    else process.env.OCR_TIMEOUT_MS = previousTimeout;
  }
});
