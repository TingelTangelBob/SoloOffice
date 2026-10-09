import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDemoVatPayment, validateDemoLevy } from '../shared/financeDemo.js';
import { computeVat } from '../shared/vat/index.js';
import { paymentDueDate } from '../shared/vat/periods.js';
import { resolveTaxParams } from '../shared/taxParams/index.js';

test('Demo-USt-Zahlungen validieren Art, Zeitraum, Betrag und Zahlungsdatum', () => {
  const profile = { vatPeriod: 'quarterly' };
  assert.equal(typeof validateDemoVatPayment({ kind: 'advance', taxYear: 2026, periodKey: '2026-Q2', amount: 100, paidOn: '2026-08-10' }, profile, '2026-10-09'), 'object');
  assert.match(validateDemoVatPayment({ kind: 'advance', taxYear: 2026, periodKey: '2026-02', amount: 100 }, profile), /Zeitraum/);
  assert.match(validateDemoVatPayment({ kind: 'advance', taxYear: 2026, periodKey: '2026-Q2', amount: 0 }, profile), /größer als 0/);
  assert.match(validateDemoVatPayment({ kind: 'special_prepayment', taxYear: 2026, periodKey: '2026-Q2', amount: 100 }, profile), /Sondervorauszahlung/);
  assert.match(validateDemoVatPayment({ kind: 'refund', taxYear: 2026, periodKey: '2026-Q2', amount: 100, paidOn: '2026-10-10' }, profile, '2026-10-09'), /zukünftiges Zahlungsdatum/);
  assert.match(validateDemoLevy({ kind: 'ust', year: 2026, period: '2026-02', amount: 100 }), /Umsatzsteuerzahlungen/);
});

test('Demo-Beispielrechnung Q2 2026 liefert Kennzahlen, Fälligkeit und gebuchte Vorauszahlung', () => {
  const rates = resolveTaxParams(2026).params.vat;
  const entries = [];
  for (const month of ['04', '05', '06']) {
    entries.push({ id: `income-${month}`, entryType: 'income', entryDate: `2026-${month}-05`, documentDate: `2026-${month}-01`, amount: 4500, taxRate: rates.standardRate,
      vatTreatment: 'taxable', netAmount: 3781.51, vatAmount: 718.49, inputTaxDeductible: null, category: 'honorarium', sourceType: 'manual', status: 'active' });
    for (const [name, gross, rate, treatment] of [['rent', 920, rates.standardRate, 'taxable'], ['software', 85, rates.standardRate, 'reverse_charge_eu'], ['phone', 39, rates.standardRate, 'taxable'], ['insurance', 28, rates.zeroRate, 'no_vat'], ['journal', 24, rates.reducedRate, 'taxable']]) {
      const netAmount = treatment === 'reverse_charge_eu' || treatment === 'no_vat' ? gross : Math.round((gross / (1 + rate / 100) + Number.EPSILON) * 100) / 100;
      const vatAmount = treatment === 'reverse_charge_eu' ? 16.15 : treatment === 'no_vat' ? 0 : Math.round((gross - netAmount + Number.EPSILON) * 100) / 100;
      entries.push({ id: `${name}-${month}`, entryType: 'expense', entryDate: `2026-${month}-01`, documentDate: `2026-${month}-01`, amount: gross, taxRate: rate,
        vatTreatment: treatment, netAmount, vatAmount, inputTaxDeductible: treatment !== 'no_vat', category: name, sourceType: 'recurring_expense', status: 'active' });
    }
  }
  entries.push({ id: 'income-7', entryType: 'income', entryDate: '2026-05-18', documentDate: '2026-05-15', amount: 1070, taxRate: rates.reducedRate,
    vatTreatment: 'taxable', netAmount: 1000, vatAmount: 70, inputTaxDeductible: null, category: 'workshop', sourceType: 'manual', status: 'active' });
  const payments = [{ id: 'paid-q2', kind: 'advance', taxYear: 2026, periodKey: '2026-Q2', dueDate: '2026-07-10', paidOn: '2026-07-10', amount: 1500 }];
  const result = computeVat({ year: 2026, profile: { vatStatus: 'regular', vatAccounting: 'cash', vatPeriod: 'quarterly', vatPermanentExtension: false }, entries, payments, now: '2026-10-09' });
  const q2 = result.periods.find(period => period.key === '2026-Q2');
  assert.ok(q2);
  assert.equal(q2.kennzahlen.kz81, 11344.53);
  assert.equal(q2.kennzahlen.kz86, 1000);
  assert.equal(q2.kennzahlen.kz66, 464.07);
  assert.equal(q2.kennzahlen.kz67, 48.45);
  assert.equal(q2.kennzahlen.kz47, 48.45);
  assert.equal(q2.kennzahlen.kz83, 1761.40);
  assert.equal(q2.dueDate, paymentDueDate('2026-Q2', { permanentExtension: false }));
  assert.equal(q2.paid, 1500);
  assert.equal(q2.balance, 261.40);
});
