import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

async function loadUtility(relativePath) {
  const temp = await mkdtemp(path.join('/tmp', 'solooffice-vat-ui-'));
  const bundle = await rolldown({ input: path.resolve(relativePath), platform: 'browser' });
  const output = path.join(temp, 'bundle.mjs');
  await bundle.write({ file: output, format: 'esm' });
  await bundle.close();
  return { module: await import(pathToFileURL(output).href), temp };
}

test('USt-Formularhelfer berechnen Netto, USt, Reverse Charge und Altbestandsvorschläge', async t => {
  const { module, temp } = await loadUtility('src/utils/vatEntryForm.ts');
  t.after(() => rm(temp, { recursive: true, force: true }));
  const rates = module.vatRateOptions(2026);
  assert.deepEqual(rates, [19, 7, 0]);
  assert.equal(module.defaultVatRate(rates[0], 2026), rates[0]);
  assert.equal(module.defaultVatRate(5, 2026), 'other');
  assert.deepEqual(module.splitGrossAmount(119, 19), { netAmount: 100, vatAmount: 19 });
  assert.deepEqual(module.splitGrossAmount(107, 7), { netAmount: 100, vatAmount: 7 });
  assert.deepEqual(module.grossFromNetAmount(10, 19), { grossAmount: 11.9, vatAmount: 1.9, netAmount: 10 });
  assert.deepEqual(module.reverseChargeAmounts(100, 19), { amount: 100, netAmount: 100, vatAmount: 19 });
  assert.equal(module.validateVatAmounts({ entryType: 'expense', amount: 119, vatTreatment: 'taxable', netAmount: 100, vatAmount: 19 }), null);
  assert.equal(module.validateVatAmounts({ entryType: 'expense', amount: 119, vatTreatment: 'taxable', netAmount: 99, vatAmount: 19 }), 'Netto und USt müssen zusammen dem Bruttobetrag entsprechen.');
  assert.deepEqual(module.suggestVatFromLegacy({ entryType: 'expense', amount: 119, taxRate: 19, vatTreatment: null, inputTaxDeductible: null }),
    { vatTreatment: 'taxable', netAmount: 100, vatAmount: 19, inputTaxDeductible: true });
  assert.equal(module.needsVatData({ entryType: 'expense', sourceType: 'manual', vatTreatment: null, inputTaxDeductible: null }, false), true);
  assert.equal(module.needsVatData({ entryType: 'expense', sourceType: 'invoice_payment', vatTreatment: null, inputTaxDeductible: null }, false), false);
  assert.equal(module.needsVatData({ entryType: 'expense', sourceType: 'vat_payment', vatTreatment: null, inputTaxDeductible: null }, false), false);
  assert.equal(module.needsVatData({ entryType: 'expense', sourceType: 'manual', vatTreatment: null, inputTaxDeductible: null }, true), false);
});

test('USt-Anzeigehelfer formatieren Kennzahlen, Status, Beträge, Zahlarten und Datumswerte', async t => {
  const { module, temp } = await loadUtility('src/utils/vatDisplay.ts');
  t.after(() => rm(temp, { recursive: true, force: true }));
  const rows = module.vatKennzahlRows({
    kz81: 0, kz86: 0, kz87: 0, kz35: 0, kz36: 0, kz48: 0, kz46: 0, kz47: 0, kz84: 0, kz85: 0,
    kz66: 0, kz67: 0, kz39: 0, tax19: 0, tax7: 0, kz83: 0,
  }, 2026);
  assert.deepEqual(rows.map(row => row.number), ['83']);
  assert.equal(module.vatPaymentStatusLabel('open'), 'Offen');
  assert.equal(module.vatPaymentStatusLabel('open', true), 'Überfällig');
  assert.equal(module.vatPaymentStatusLabel('refund_open'), 'Erstattung erwartet');
  assert.equal(module.vatPeriodAmountLabel({ liability: -12.5, estimatedLiability: -12.5, complete: true }), 'Überschuss 12,50 €');
  assert.match(module.vatPeriodAmountLabel({ liability: 8, estimatedLiability: 10, complete: false }), /^Schätzung · 10,00/);
  assert.equal(module.vatPaymentKindLabel('special_prepayment'), 'Sondervorauszahlung');
  assert.equal(module.vatDateLabel('2026-10-09'), '09.10.2026');
  assert.equal(module.vatDateLabel(null), '–');
  assert.equal(module.vatPeriodKeyLabel('2026-Q1'), 'Q1 2026 (Jan–Mär)');
  assert.equal(module.vatPeriodKeyLabel('2026-10'), 'Okt 2026');
  assert.equal(module.vatPeriodKeyLabel(null), '–');
});

test('USt-Standardzeitraum folgt der nächsten Fälligkeit, sonst dem laufenden Zeitraum', async t => {
  const { module, temp } = await loadUtility('src/utils/vatCardDisplay.ts');
  t.after(() => rm(temp, { recursive: true, force: true }));
  const periods = [
    { key: '2026-Q1', state: 'closed' },
    { key: '2026-Q2', state: 'closed' },
    { key: '2026-Q3', state: 'running' },
    { key: '2026-Q4', state: 'future' },
  ];
  assert.equal(module.defaultVatPeriod(periods, { periodKey: '2026-Q4' }).key, '2026-Q4');
  assert.equal(module.defaultVatPeriod(periods, null).key, '2026-Q3');
  assert.equal(module.defaultVatPeriod([{ key: '2026-10', state: 'running' }], null).key, '2026-10');
  const realistic = [
    { key: '2026-Q1', state: 'closed', dueDate: '2026-04-10' },
    { key: '2026-Q2', state: 'closed', dueDate: '2026-07-10' },
    { key: '2026-Q3', state: 'closed', dueDate: '2026-10-12' },
    { key: '2026-Q4', state: 'running', dueDate: '2027-01-11' },
  ];
  // Offener, überfälliger Q1 darf nicht vorausgewählt werden – aktuell fällig ist Q3.
  assert.equal(module.defaultVatPeriod(realistic, { periodKey: '2026-Q1', dueDate: '2026-04-10' }, '2026-10-09').key, '2026-Q3');
  assert.equal(module.defaultVatPeriod(realistic, null, '2026-10-20').key, '2026-Q4');
});
