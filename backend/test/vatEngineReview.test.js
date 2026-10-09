import test from 'node:test';
import assert from 'node:assert/strict';
import { computeVat } from '../shared/vat/index.js';

// Regressionen aus dem Lead-Review des Rechenkerns.
const invoice = (overrides = {}) => ({ id: 'inv-1', invoiceNumber: 'RE-1', documentType: 'invoice', status: 'paid', issueDate: '2026-02-10',
  serviceDate: '2026-02-10', total: 500, taxAmount: 0, items: [{ description: 'Unterricht', quantity: 1, unitPrice: 500, taxRate: 0 }], ...overrides });
const payment = (overrides = {}) => ({ id: 'pay-1', entryType: 'income', sourceType: 'invoice_payment', sourceId: 'inv-1', entryDate: '2026-02-20',
  amount: 500, taxRate: 0, category: 'other_income', status: 'active', vatTreatment: null, netAmount: null, vatAmount: null, inputTaxDeductible: null, ...overrides });

test('EÜR-Zuordnung zählt Rechnungszahlungen bei Bildungsbefreiung und § 19 genau einmal', () => {
  const exempt = computeVat({ year: 2026, profile: { vatStatus: 'education_exempt', vatAccounting: 'cash', vatPeriod: 'quarterly' }, now: '2026-10-09',
    invoices: [invoice()], entries: [payment()] });
  assert.equal(exempt.euer.exemptIncome, 500);
  const small = computeVat({ year: 2026, profile: { vatStatus: 'small_business', vatAccounting: 'cash', vatPeriod: 'quarterly' }, now: '2026-10-09',
    invoices: [invoice()], entries: [payment()] });
  assert.equal(small.euer.smallBusinessIncome, 500);
});

test('Altbuchungen ohne USt-Angabe werden nicht still als steuerfrei eingeordnet', () => {
  const result = computeVat({ year: 2026, profile: { vatStatus: 'regular', vatAccounting: 'cash', vatPeriod: 'quarterly' }, now: '2026-10-09',
    entries: [{ id: 'legacy', entryType: 'income', entryDate: '2026-03-01', amount: 100, taxRate: 0, category: 'other_income', status: 'active',
      vatTreatment: null, netAmount: null, vatAmount: null, inputTaxDeductible: null }] });
  assert.equal(result.euer.exemptIncome, 0);
  assert.deepEqual(result.completeness.incompleteEntryIds, ['legacy']);
  assert.equal(result.completeness.suggestions.length, 0);
});

test('Sondervorauszahlung und Jahresabschluss verändern keinen Zeitraumstatus, wohl aber den Jahressaldo', () => {
  // Q1: 190 € USt, Vorauszahlung 190 € bezahlt. Jahresabschluss 50 € ohne Zeitraum.
  const result = computeVat({ year: 2026, profile: { vatStatus: 'regular', vatAccounting: 'accrual', vatPeriod: 'quarterly' }, now: '2027-03-01',
    entries: [{ id: 'inc', entryType: 'income', entryDate: '2026-02-01', amount: 1190, taxRate: 19, category: 'other_income', status: 'active',
      vatTreatment: 'taxable', netAmount: 1000, vatAmount: 190, inputTaxDeductible: null }],
    payments: [
      { id: 'adv', kind: 'advance', taxYear: 2026, periodKey: '2026-Q1', paidOn: '2026-04-09', amount: 190 },
      { id: 'final', kind: 'annual_payment', taxYear: 2026, periodKey: null, paidOn: '2027-02-15', amount: 50 },
    ] });
  const q1 = result.periods.find(item => item.key === '2026-Q1');
  const q4 = result.periods.find(item => item.key === '2026-Q4');
  assert.equal(q1.paymentStatus, 'paid');
  assert.equal(q4.paid, 0);
  assert.equal(q4.paymentStatus, 'none');
  assert.equal(result.annual.paid, 240);
  assert.equal(result.annual.balance, -50);
});

test('nächste Fälligkeit nennt den offenen Saldo statt der vollen Zahllast', () => {
  const result = computeVat({ year: 2026, profile: { vatStatus: 'regular', vatAccounting: 'accrual', vatPeriod: 'quarterly' }, now: '2026-10-09',
    entries: [{ id: 'inc', entryType: 'income', entryDate: '2026-08-01', amount: 1190, taxRate: 19, category: 'other_income', status: 'active',
      vatTreatment: 'taxable', netAmount: 1000, vatAmount: 190, inputTaxDeductible: null }],
    payments: [{ id: 'part', kind: 'advance', taxYear: 2026, periodKey: '2026-Q3', paidOn: '2026-10-05', amount: 90 }] });
  assert.equal(result.nextDue.periodKey, '2026-Q3');
  assert.equal(result.nextDue.amount, 100);
  assert.equal(result.nextDue.dueDate, '2026-10-12');
});
