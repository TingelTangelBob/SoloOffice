import test from 'node:test';
import assert from 'node:assert/strict';
import { computeVat } from '../shared/vat/index.js';

const profile = (overrides = {}) => ({ vatStatus: 'regular', vatAccounting: 'accrual', vatPeriod: 'quarterly', ...overrides });
const invoiceItem = (description, unitPrice, taxRate) => ({ description, quantity: 1, unitPrice, taxRate });
const invoice = (overrides = {}) => ({ id: 'inv-1', invoiceNumber: 'RE-1', documentType: 'invoice', status: 'sent', issueDate: '2026-03-10',
  serviceDate: '2026-03-15', total: 203.4, taxAmount: 23.4, items: [invoiceItem('Leistung 19 %', 100, 19), invoiceItem('Leistung 7 %', 100, 7)], ...overrides });
const entry = (id, overrides = {}) => ({ id, entryType: 'expense', entryDate: '2026-03-20', category: 'sonstiges', amount: 119,
  taxRate: 19, vatTreatment: 'taxable', netAmount: 100, vatAmount: 19, inputTaxDeductible: true, status: 'active', ...overrides });
const period = (result, key) => result.periods.find(item => item.key === key);

test('Dozent § 4 Nr. 21: steuerfreie Umsätze Kz 48, Vorsteuerabzug nur ausdrücklich markiert', () => {
  const result = computeVat({ year: 2026, profile: profile({ vatStatus: 'education_exempt', vatPeriod: 'quarterly' }), now: '2027-01-01',
    invoices: [invoice({ items: [invoiceItem('Unterricht', 300, 0)], total: 300, taxAmount: 0 })],
    entries: [entry('not-deductible', { inputTaxDeductible: false }), entry('deductible', { id: 'deductible', entryDate: '2026-04-02' })] });
  const q1 = period(result, '2026-Q1'); const q2 = period(result, '2026-Q2');
  assert.equal(q1.kennzahlen.kz48, 300);
  assert.equal(q1.outputTax, 0);
  assert.equal(q1.kennzahlen.kz66, 0);
  assert.equal(q2.kennzahlen.kz66, 19);
  assert.equal(q2.liability, -19);
});

test('19 % und 7 % mit Gesamtrabatt: Soll März, Ist Teilzahlung März/April, Jahreswerte gleich', () => {
  // 200 EUR Netto werden um 10 % (= 20 EUR) gekürzt und proportional auf beide Sätze verteilt:
  // je 90 EUR Bemessungsgrundlage; USt 17,10 + 6,30 = 23,40 EUR; Brutto 203,40 EUR.
  const doc = invoice({ globalDiscountType: 'percentage', globalDiscountValue: 10, total: 203.4, taxAmount: 23.4 });
  const accrual = computeVat({ year: 2026, profile: profile({ vatPeriod: 'monthly' }), now: '2027-01-01', invoices: [doc] });
  const cash = computeVat({ year: 2026, profile: profile({ vatAccounting: 'cash', vatPeriod: 'monthly' }), now: '2027-01-01', invoices: [doc], entries: [
    { id: 'pay-mar', entryType: 'income', sourceType: 'invoice_payment', sourceId: 'inv-1', entryDate: '2026-03-29', amount: 101.7, status: 'active' },
    { id: 'pay-apr', entryType: 'income', sourceType: 'invoice_payment', sourceId: 'inv-1', entryDate: '2026-04-02', amount: 101.7, status: 'active' },
  ] });
  assert.equal(period(accrual, '2026-03').kennzahlen.kz81, 90);
  assert.equal(period(accrual, '2026-03').kennzahlen.kz86, 90);
  assert.equal(period(cash, '2026-03').outputTax, 11.7);
  assert.equal(period(cash, '2026-04').outputTax, 11.7);
  assert.equal(accrual.annual.liability, 23.4);
  assert.equal(cash.annual.liability, 23.4);
  assert.equal(cash.euer.taxableIncomeNet, 180);
  assert.equal(cash.euer.vatCollected, 23.4);
});

test('monatlich, vierteljährlich und jährlich bilden die erwartete Anzahl Zeiträume', () => {
  for (const [type, count] of [['monthly', 12], ['quarterly', 4], ['annual', 1]]) {
    const result = computeVat({ year: 2026, profile: profile({ vatPeriod: type }), now: '2026-06-15' });
    assert.equal(result.periods.length, count);
    assert.equal(result.months.length, 12);
    if (type === 'annual') assert.equal(result.periods[0].dueDate, null);
  }
});

test('Dauerfristverlängerung verschiebt die Fälligkeit und weist Kz 39 aus', () => {
  const result = computeVat({ year: 2026, profile: profile({ vatPeriod: 'monthly', vatPermanentExtension: true }), previousYearAdvanceTotal: 1100,
    now: '2027-01-01' });
  const december = period(result, '2026-12');
  assert.equal(december.dueDate, '2027-02-10');
  assert.equal(december.statutoryDueDate, '2027-01-11');
  assert.equal(december.kennzahlen.kz39, 100);
  const noPrior = computeVat({ year: 2026, profile: profile({ vatPeriod: 'monthly', vatPermanentExtension: true }), now: '2026-12-15' });
  assert.equal(noPrior.annual.specialPrepayment.source, 'missing');
  assert.equal(period(noPrior, '2026-12').kennzahlen.kz39, 0);
  const profileValue = computeVat({ year: 2026, profile: profile({ vatPeriod: 'monthly', vatPermanentExtension: true, vatSpecialPrepayment: 123.45 }),
    previousYearAdvanceTotal: 1100, now: '2026-12-15' });
  assert.equal(profileValue.annual.specialPrepayment.source, 'profile');
  assert.equal(period(profileValue, '2026-12').kennzahlen.kz39, 123.45);
});

test('§ 13b EU und Inland sind bei vollem Abzug zahllastneutral, sonst verbleibt Steuer', () => {
  const entries = [entry('eu', { vatTreatment: 'reverse_charge_eu' }), entry('domestic', { id: 'domestic', entryDate: '2026-04-01', vatTreatment: 'reverse_charge_domestic' })];
  const full = computeVat({ year: 2026, profile: profile(), entries, now: '2027-01-01' });
  assert.equal(period(full, '2026-Q1').kennzahlen.kz46, 100);
  assert.equal(period(full, '2026-Q1').kennzahlen.kz47, 19);
  assert.equal(period(full, '2026-Q1').kennzahlen.kz67, 19);
  assert.equal(period(full, '2026-Q1').liability, 0);
  assert.equal(period(full, '2026-Q2').kennzahlen.kz84, 100);
  assert.equal(period(full, '2026-Q2').kennzahlen.kz85, 19);
  assert.equal(period(full, '2026-Q2').liability, 0);
  const restricted = computeVat({ year: 2026, profile: profile(), entries: [entry('restricted', { vatTreatment: 'reverse_charge_eu', inputTaxDeductible: false })], now: '2027-01-01' });
  assert.equal(period(restricted, '2026-Q1').liability, 19);
});

test('§ 19 weist keine reguläre Steuer oder Vorsteuer aus, § 13b bleibt geschuldet ohne Kz 67', () => {
  const small = computeVat({ year: 2026, profile: profile({ vatStatus: 'small_business' }), entries: [entry('expense')], invoices: [invoice()], now: '2027-01-01' });
  assert.equal(small.applicable, false);
  assert.equal(small.annual.liability, 0);
  assert.equal(small.euer.inputTaxPaid, 0);
  const rcSmall = computeVat({ year: 2026, profile: profile({ vatStatus: 'small_business' }), entries: [entry('rc', { vatTreatment: 'reverse_charge_eu' })], now: '2027-01-01' });
  assert.equal(rcSmall.applicable, true);
  assert.equal(period(rcSmall, '2026-Q1').kennzahlen.kz47, 19);
  assert.equal(period(rcSmall, '2026-Q1').kennzahlen.kz67, 0);
  assert.equal(period(rcSmall, '2026-Q1').liability, 19);
});

test('unvollständige Altbuchung erhält einen Schätzwert; 0 % erzeugt keinen Steuersatzvorschlag', () => {
  const result = computeVat({ year: 2026, profile: profile(), now: '2027-01-01', entries: [
    entry('unknown-19', { entryType: 'income', vatTreatment: null, netAmount: null, vatAmount: null }), entry('unknown-zero', { id: 'unknown-zero', entryType: 'income', entryDate: '2026-04-01', taxRate: 0, vatTreatment: null, netAmount: null, vatAmount: null }),
  ] });
  const q1 = period(result, '2026-Q1');
  assert.equal(q1.complete, false);
  assert.equal(q1.liability, 0);
  assert.equal(q1.estimatedLiability, 19);
  assert.deepEqual(result.completeness.suggestions.map(item => item.entryId), ['unknown-19']);
  assert.equal(period(result, '2026-Q2').complete, false);
  assert.equal(period(result, '2026-Q2').estimatedLiability, 0);
});

test('Vorsteuerüberhang wird als Erstattung offen ausgewiesen und im Zuflussjahr EÜR-Erstattung', () => {
  const open = computeVat({ year: 2026, profile: profile(), entries: [entry('input')], now: '2027-01-01' });
  assert.equal(period(open, '2026-Q1').liability, -19);
  assert.equal(period(open, '2026-Q1').paymentStatus, 'refund_open');
  const refunded = computeVat({ year: 2026, profile: profile(), entries: [entry('input')], payments: [
    { id: 'refund', kind: 'refund', taxYear: 2026, periodKey: '2026-Q1', paidOn: '2026-06-03', amount: 19 },
  ], now: '2027-01-01' });
  assert.equal(period(refunded, '2026-Q1').paymentStatus, 'settled');
  assert.equal(refunded.euer.vatRefunded, 19);
});

test('Zahlungsstatus zeigt offen, überfällig, teilweise bezahlt, bezahlt und überzahlt', () => {
  const base = { year: 2026, profile: profile(), now: '2026-04-20', entries: [
    { id: 'sale', entryType: 'income', entryDate: '2026-03-01', amount: 119, taxRate: 19, vatTreatment: 'taxable', netAmount: 100, vatAmount: 19, status: 'active' },
  ] };
  const statusFor = amountPaid => computeVat({ ...base, payments: amountPaid == null ? [] : [
    { id: 'payment', kind: 'advance', taxYear: 2026, periodKey: '2026-Q1', paidOn: '2026-04-15', amount: amountPaid },
  ] }).periods.find(item => item.key === '2026-Q1');
  assert.equal(statusFor(null).paymentStatus, 'open');
  assert.equal(statusFor(null).overdue, true);
  assert.equal(statusFor(10).paymentStatus, 'partial');
  assert.equal(statusFor(10).overdue, true);
  assert.equal(statusFor(19).paymentStatus, 'paid');
  assert.equal(statusFor(25).paymentStatus, 'overpaid');
});

test('10-Tage-Zuordnung und Bruttomethode gleichen Nettomethode über vollständigen Zyklus aus', () => {
  const result = computeVat({ year: 2026, profile: profile(), now: '2027-02-01', entries: [
    { id: 'sale', entryType: 'income', entryDate: '2026-03-01', amount: 238, taxRate: 19, vatTreatment: 'taxable', netAmount: 200, vatAmount: 38, inputTaxDeductible: null, status: 'active' },
    entry('cost', { amount: 119, netAmount: 100, vatAmount: 19 }),
  ], payments: [{ id: 'q4', kind: 'advance', taxYear: 2026, periodKey: '2026-Q4', paidOn: '2027-01-08', amount: 19 } ] });
  assert.equal(result.euer.vatCollected, 38);
  assert.equal(result.euer.inputTaxPaid, 19);
  assert.equal(result.euer.vatPaidToOffice, 19);
  assert.equal(result.euer.grossMinusNetEffect, 0);
  assert.equal(result.euer.payments[0].euerYear, 2026);
  assert.equal(result.euer.payments[0].tenDayRule, true);
  assert.equal(result.euer.unbookedPaymentIds[0], 'q4');
  const afterDeadline = computeVat({ year: 2027, profile: profile(), now: '2027-02-01', payments: [
    { id: 'late-q4', kind: 'advance', taxYear: 2026, periodKey: '2026-Q4', paidOn: '2027-01-11', amount: 10 },
  ] });
  assert.equal(afterDeadline.euer.payments[0].euerYear, 2027);
});

test('ignoriert stornierte und USt-Zahlungsbuchungen sowie Entwurfsrechnungen', () => {
  const result = computeVat({ year: 2026, profile: profile(), now: '2027-01-01', invoices: [invoice({ id: 'draft', status: 'draft' })], entries: [
    entry('void', { status: 'voided' }), entry('vat', { sourceType: 'vat_payment', category: 'vat_payment' }),
  ] });
  assert.equal(result.annual.liability, 0);
  assert.equal(result.completeness.complete, true);
});
