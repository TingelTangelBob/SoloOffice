import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

async function loadDisplay() {
  const temp = await mkdtemp(path.join('/tmp', 'solooffice-vat-card-'));
  const bundle = await rolldown({ input: path.resolve('src/utils/vatCardDisplay.ts'), platform: 'browser' });
  const output = path.join(temp, 'vatCardDisplay.mjs');
  await bundle.write({ file: output, format: 'esm' });
  await bundle.close();
  return { module: await import(pathToFileURL(output).href), temp };
}

const period = (key, overrides = {}) => ({
  key, label: key, state: 'closed', liability: 100, estimatedLiability: 100, complete: true,
  incompleteEntryIds: [], paymentStatus: 'open', overdue: false, ...overrides,
});

test('USt-Kachel wählt nächste Fälligkeit, sonst laufenden, nächsten oder letzten Zeitraum', async () => {
  const { module, temp } = await loadDisplay();
  try {
    const periods = [period('2026-Q1'), period('2026-Q2'), period('2026-Q3', { state: 'running' })];
    assert.equal(module.relevantVatPeriod({ periods, nextDue: { periodKey: '2026-Q1' } }).key, '2026-Q1');
    assert.equal(module.relevantVatPeriod({ periods, nextDue: null }).key, '2026-Q3');
    assert.equal(module.relevantVatPeriod({ periods: [period('2026-Q1', { state: 'running' })], nextDue: null }).key, '2026-Q1');
    assert.equal(module.relevantVatPeriod({ periods: [period('2026-Q4', { state: 'future' })], nextDue: null }).key, '2026-Q4');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('USt-Kachel zeigt berechneten Wert nur bei vollständigen Daten, sonst Schätzung mit Anzahl', async () => {
  const { module, temp } = await loadDisplay();
  try {
    assert.equal(module.vatDisplayedAmount(period('2026-Q2', { liability: 80, estimatedLiability: 95 })), 80);
    assert.equal(module.vatDisplayedAmount(period('2026-Q2', { complete: false, liability: 80, estimatedLiability: 95 })), 95);
    assert.equal(module.vatBasisText(period('2026-Q2')), 'Aus deinen erfassten Belegen berechnet.');
    assert.equal(module.vatBasisText(period('2026-Q2', { complete: false, incompleteEntryIds: ['a'] })), 'Schätzung · 1 Buchung ohne USt-Angaben.');
    assert.equal(module.vatBasisText(period('2026-Q2', { complete: false, incompleteEntryIds: ['a', 'b', 'c'] })), 'Schätzung · 3 Buchungen ohne USt-Angaben.');
    assert.match(module.vatBasisText(period('2026-Q2', { complete: false })), /^Schätzung/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('USt-Kachel kennzeichnet Status und Überfälligkeit ohne verbotene Begriffe', async () => {
  const { module, temp } = await loadDisplay();
  try {
    assert.deepEqual(module.vatPaymentBadge({ paymentStatus: 'open', overdue: true }), { label: 'überfällig', tone: 'negative' });
    assert.deepEqual(module.vatPaymentBadge({ paymentStatus: 'open', overdue: false }), { label: 'offen', tone: 'warning' });
    assert.equal(module.vatPaymentBadge({ paymentStatus: 'refund_open', overdue: false }).label, 'Erstattung erwartet');
    for (const status of ['open', 'partial', 'paid', 'overpaid', 'settled', 'refund_open', 'not_due', 'none']) {
      assert.doesNotMatch(module.vatPaymentBadge({ paymentStatus: status, overdue: false }).label, /exakt|verbindlich|amtlich|garantiert/i);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
