import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(String(key), String(value)); }
  removeItem(key) { this.#values.delete(String(key)); }
  clear() { this.#values.clear(); }
}

async function loadDemoApi() {
  const base = path.resolve('.test-dist');
  await mkdir(base, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(base, 'demo-reporting-'));
  const bundle = await rolldown({
    input: path.resolve('src/services/demoApi.ts'), platform: 'browser',
    plugins: [{
      name: 'demo-reporting-env',
      transform(code) {
        return code.replaceAll('import.meta.env', "({ VITE_API_URL: '/api', VITE_DEMO_MODE: 'true', DEV: false, PROD: true })");
      },
    }],
  });
  const output = path.join(temporaryDirectory, 'demo-reporting.mjs');
  await bundle.write({ file: output, format: 'esm' });
  await bundle.close();
  return { module: await import(pathToFileURL(output).href), temporaryDirectory };
}

const storageKey = 'solooffice-demo-data-v1';
const readState = () => JSON.parse(globalThis.localStorage.getItem(storageKey));
const writeState = state => globalThis.localStorage.setItem(storageKey, JSON.stringify(state));

test('Demo-Auswertungen trennen ausgestellte Rechnungen und EÜR-Zahlungseingänge', async t => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  const { module: api, temporaryDirectory } = await loadDemoApi();
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  api.resetDemoWorkspaceData({ companyProfile: true, takeover: true });

  const state = readState();
  state.customers = [{ id: 'customer-1', name: 'Demokunde' }];
  state.invoices = [
    { id: 'draft', invoiceNumber: 'RE-2026-001', customerId: 'customer-1', customerName: 'Demokunde',
      status: 'draft', documentType: 'invoice', issueDate: '2026-09-01', subtotal: 999, taxAmount: 189.81, total: 1188.81 },
    { id: 'open', invoiceNumber: 'RE-2026-002', customerId: 'customer-1', customerName: 'Demokunde',
      status: 'sent', documentType: 'invoice', issueDate: '2026-09-02', subtotal: 168.07, taxAmount: 31.93, total: 200 },
    { id: 'legacy-paid', invoiceNumber: 'RE-2026-003', customerId: 'customer-1', customerName: 'Demokunde',
      status: 'paid', documentType: 'invoice', issueDate: '2026-10-02', subtotal: 252.10, taxAmount: 47.90, total: 300 },
    { id: 'paid-with-entry', invoiceNumber: 'RE-2026-004', customerId: 'customer-1', customerName: 'Demokunde',
      status: 'paid', documentType: 'invoice', issueDate: '2026-09-03', subtotal: 336.13, taxAmount: 63.87, total: 400 },
    { id: 'older-invoice', invoiceNumber: 'RE-2025-001', customerId: 'customer-1', customerName: 'Demokunde',
      status: 'sent', documentType: 'invoice', issueDate: '2025-12-03', subtotal: 420.17, taxAmount: 79.83, total: 500 },
  ];
  state.euerEntries = [
    { id: 'payment-1', entryType: 'income', entryDate: '2026-11-10', amount: 400, sourceType: 'invoice_payment', sourceId: 'paid-with-entry', status: 'active' },
    { id: 'payment-2', entryType: 'income', entryDate: '2026-12-10', amount: 100, sourceType: 'invoice_payment', sourceId: 'older-invoice', status: 'active' },
    { id: 'payment-voided', entryType: 'income', entryDate: '2026-08-10', amount: 999, sourceType: 'invoice_payment', sourceId: 'older-invoice', status: 'voided' },
    { id: 'manual-income', entryType: 'income', entryDate: '2026-10-12', amount: 50, sourceType: 'manual', customerId: 'customer-1', status: 'active' },
  ];
  writeState(state);

  const stats = await api.demoRequest('/reporting/statistics?year=2026');
  assert.equal(stats.yearOverview.totalInvoices, 3, 'Entwürfe werden nicht als ausgestellte Rechnung gezählt');
  assert.equal(stats.yearOverview.totalAmount, 900, 'Rechnungsvolumen umfasst nur ausgestellte Rechnungen und offene Beträge');
  assert.equal(stats.yearOverview.paidAmount, 500, 'Zahlungseingänge zählen nur aktive Buchungen mit tatsächlichem Datum');
  assert.equal(stats.yearOverview.incompletePaidInvoiceCount, 1, 'Status-only-Altbestand wird zur Klärung gezählt, aber nicht als Zahlung angesetzt');
  assert.equal(stats.yearOverview.otherIncome, 50, 'Einnahmen ohne Rechnung bleiben als eigene Position getrennt');
  assert.equal(stats.topCustomers[0].totalRevenue, 900, 'Kunden-Rechnungsvolumen wird nicht mit Einnahmen ohne Rechnung addiert');
  assert.equal(stats.topCustomers[0].otherIncome, 50);

  const month = number => stats.monthlyRevenue.find(item => item.month === number);
  assert.equal(month(9).totalSum, 600, 'Offene und bezahlte ausgestellte Rechnungen zählen zum Rechnungsvolumen');
  assert.equal(month(9).paidSum, 0, 'Der Rechnungsmonat wird nicht mit späteren Zahlungseingängen verwechselt');
  assert.equal(month(10).paidSum, 0, 'Ein bezahlter Status ohne Zahlungseintrag erhält kein erfundenes Rechnungsdatum');
  assert.equal(month(10).otherIncomeSum, 50);
  assert.equal(month(11).paidSum, 400, 'Zahlungseingänge erscheinen im EÜR-Buchungsmonat');
  assert.equal(month(12).paidSum, 100, 'Zahlungen auf Rechnungen aus Vorjahren zählen im Zahlungsjahr');

  const journal = await api.demoRequest('/reporting/invoice-journal');
  assert.equal(journal.summary.totalInvoices, 4, 'Das Rechnungsjournal führt nur ausgestellte Rechnungen');
  assert.equal(journal.summary.totalAmount, 1400);
  assert.equal(journal.summary.paidAmount, 500, 'Die Journal-Zahlungssumme enthält nur erfasste Zahlungsbuchungen');
  assert.equal(journal.invoices.find(invoice => invoice.id === 'legacy-paid').paidAmount, 0,
    'Ein Status ohne Zahlungsbuchung erzeugt im Journal keinen Zahlungseingang');
  assert.ok(journal.invoices.every(invoice => invoice.status !== 'draft'));

  const attributedState = readState();
  attributedState.euerEntries.find(entry => entry.id === 'payment-1').amount = 399;
  writeState(attributedState);
  const attributed = await api.demoRequest('/reporting/statistics?year=2026');
  assert.equal(attributed.yearOverview.incompletePaidInvoiceCount, 2, 'Eine zu niedrige Teilzahlung klärt einen Bezahlt-Altfall noch nicht');
  assert.equal(attributed.yearOverview.paidAmount, 499, 'Zahlungseingänge verwenden das tatsächliche Zahlungsjahr');
  assert.equal(attributed.yearOverview.otherIncome, 50);
  assert.equal(attributed.topCustomers[0].otherIncome, 50);
  assert.equal(attributed.monthlyRevenue.find(item => item.month === 1).paidSum, 0);
  assert.equal(attributed.monthlyRevenue.find(item => item.month === 11).paidSum, 399);
  const prior = await api.demoRequest('/reporting/statistics?year=2025');
  assert.equal(prior.yearOverview.paidAmount, 0);
  assert.equal(prior.yearOverview.otherIncome, 0);
  const future = await api.demoRequest('/reporting/statistics?year=2027');
  assert.equal(future.yearOverview.paidAmount, 0, 'Die Jahresverschiebung erzeugt im Zahlungsjahr keine zweite Summe');
  assert.equal(future.yearOverview.otherIncome, 0);
});
