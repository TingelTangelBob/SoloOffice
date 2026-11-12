import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeEuer, splitEuerEntryVat } from '../../.test-dist/utils/euerSummary.js';
import { normaliseIncomeCategory } from '../../.test-dist/utils/euerIncomeCategory.js';

const entries = [
  { entryType: 'income', category: 'operating_income', amount: 1190, taxRate: 19 },
  { entryType: 'income', category: 'operating_income', amount: 107, taxRate: 7, vatTreatment: 'taxable', netAmount: 100, vatAmount: 7 },
  { entryType: 'income', category: 'other_income', amount: 50, taxRate: 0 },
  { entryType: 'expense', category: 'software', amount: 119, taxRate: 19, inputTaxDeductible: true },
  { entryType: 'expense', category: 'office', amount: 59.5, taxRate: 19, inputTaxDeductible: false },
  { entryType: 'expense', category: 'vat_payment', amount: 80 },
  { entryType: 'income', category: 'vat_refund', amount: 10 },
  { entryType: 'expense', category: 'office', amount: 999, taxRate: 19, status: 'voided' },
];

test('Regelbesteuerer: netto, Umsatzsteuer und Vorsteuer getrennt', () => {
  const s = summarizeEuer(entries, { smallBusiness: false });
  assert.equal(s.income, 1150);
  assert.equal(s.vatCollected, 197);
  assert.equal(s.expenses, 100 + 59.5);
  assert.equal(s.inputTax, 19);
  assert.equal(s.vatPaid, 80);
  assert.equal(s.vatRefunded, 10);
  assert.equal(s.count, 7);
});

test('Gewinn ist in beiden Darstellungen identisch (Summe der gespeicherten Beträge)', () => {
  const regular = summarizeEuer(entries, { smallBusiness: false });
  const small = summarizeEuer(entries, { smallBusiness: true });
  assert.equal(regular.profit, small.profit);
  assert.equal(regular.profit, 1190 + 107 + 50 + 10 - 119 - 59.5 - 80);
  const parts = regular.income + regular.vatCollected + regular.vatRefunded - regular.expenses - regular.inputTax - regular.vatPaid;
  assert.equal(Math.round(parts * 100) / 100, regular.profit);
});

test('Kleinunternehmer: Ausgaben brutto, keine Umsatzsteuer', () => {
  const s = summarizeEuer(entries.filter(e => !String(e.category).startsWith('vat_')), { smallBusiness: true });
  assert.equal(s.income, 1347);
  assert.equal(s.expenses, 178.5);
  assert.equal(s.vatCollected, 0);
  assert.equal(s.inputTax, 0);
});

test('Aufteilung ohne Satz und bei Reverse-Charge bleibt brutto gleich netto', () => {
  assert.deepEqual(splitEuerEntryVat({ entryType: 'expense', amount: 100 }), { net: 100, vat: 0 });
  assert.deepEqual(splitEuerEntryVat({ entryType: 'expense', amount: 100, vatTreatment: 'reverse_charge_eu', netAmount: 100, vatAmount: 19, taxRate: 19 }), { net: 100, vat: 0 });
});

test('Rechnungszahlungen sind Betriebseinnahmen, manuelle Einnahmen bleiben sonstige', () => {
  assert.equal(normaliseIncomeCategory({ entryType: 'income', sourceType: 'invoice_payment', category: 'other_income' }).category, 'operating_income');
  assert.equal(normaliseIncomeCategory({ entryType: 'income', sourceType: 'manual', category: 'other_income' }).category, 'other_income');
  assert.equal(normaliseIncomeCategory({ entryType: 'income', sourceType: 'manual', category: 'operating_income' }).category, 'other_income');
  assert.equal(normaliseIncomeCategory({ entryType: 'expense', sourceType: 'manual', category: 'office' }).category, 'office');
});
