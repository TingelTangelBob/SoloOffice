import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateRevenue,
  averageInvoiceAmount,
  buildRevenueRecords,
  compareRevenue,
  countActiveCustomers,
  sumRevenue,
  summarizeIncomeExpense,
  summarizeOpenInvoices,
  summarizeOpenQuotes,
  upcomingJobs,
} from '../../.test-dist/utils/dashboardMetrics.js';

test('bezahlte Beträge verwenden Zahlungstage, offene Beträge Rechnungsdaten', () => {
  const invoices = [
    { id: 'paid', issueDate: '2025-01-01', status: 'paid', total: 120, customerName: 'A' },
    { id: 'open', issueDate: '2026-02-03', status: 'sent', total: 100, customerName: 'B' },
    { id: 'draft', issueDate: '2026-02-04', status: 'draft', total: 80, customerName: 'C' },
  ];
  const euerEntries = [
    { entryType: 'income', sourceType: 'invoice_payment', sourceId: 'paid', entryDate: '2026-03-10', amount: 120, status: 'active' },
    { entryType: 'income', sourceType: 'invoice_payment', sourceId: 'open', entryDate: '2026-02-10', amount: 30, status: 'active' },
  ];
  const paidOnly = buildRevenueRecords({ invoices, euerEntries, customers: [], includeUnpaidInvoices: false });
  assert.deepEqual(paidOnly.map(record => [record.date.getFullYear(), record.amount]), [[2026, 120], [2026, 30]]);
  const withOpen = buildRevenueRecords({ invoices, euerEntries, customers: [], includeUnpaidInvoices: true });
  assert.equal(withOpen.length, 3);
  assert.deepEqual([withOpen[2].date.getFullYear(), withOpen[2].date.getMonth(), withOpen[2].amount], [2026, 1, 70]);
});

test('Vorjahresvergleich berechnet Prozent und Vergleichssumme', () => {
  const current = [{ value: 300 }, { value: 200 }];
  const previous = [{ value: 100 }, { value: 100 }];
  assert.equal(sumRevenue(current), 500);
  assert.equal(compareRevenue(sumRevenue(current), sumRevenue(previous)), 150);
  assert.equal(compareRevenue(20, 0), null);
});

test('Gesamtzeitraum summiert Jahre und bei einem Datenjahr zeigt Monate', () => {
  const records = [
    { customerName: 'A', date: new Date(2025, 0, 5), amount: 50 },
    { customerName: 'A', date: new Date(2025, 5, 5), amount: 25 },
    { customerName: 'B', date: new Date(2026, 0, 5), amount: 100 },
  ];
  const allYears = aggregateRevenue(records, 'all');
  assert.deepEqual(allYears.map(point => [point.key, point.value]), [['2025', 75], ['2026', 100]]);
  const oneYear = aggregateRevenue(records.slice(0, 2), 'all');
  assert.equal(oneYear.length, 12);
  assert.equal(oneYear[0].value, 50);
  assert.equal(oneYear[5].value, 25);
});

const today = new Date(2026, 9, 9);

test('Offene Posten: Restbetrag nach Teilzahlung, überfällig nach Fälligkeit, ohne Entwürfe und Gutschriften', () => {
  const invoices = [
    { id: 'a', invoiceNumber: 'R-1', issueDate: '2026-08-01', dueDate: '2026-08-15', status: 'overdue', total: 200 },
    { id: 'b', invoiceNumber: 'R-2', issueDate: '2026-10-01', dueDate: '2026-10-20', status: 'sent', total: 100, outstandingAmount: 40 },
    { id: 'c', invoiceNumber: 'R-3', issueDate: '2026-10-01', dueDate: '2026-10-20', status: 'draft', total: 999 },
    { id: 'd', invoiceNumber: 'G-1', issueDate: '2026-10-01', dueDate: '2026-10-20', status: 'sent', total: 50, documentType: 'credit_note' },
    { id: 'e', invoiceNumber: 'R-4', issueDate: '2026-09-01', dueDate: '2026-09-15', status: 'paid', total: 70 },
  ];
  const euerEntries = [{ entryType: 'income', sourceType: 'invoice_payment', sourceId: 'a', entryDate: '2026-09-01', amount: 50, status: 'active' }];
  const summary = summarizeOpenInvoices(invoices, euerEntries, today);
  assert.deepEqual(summary.items.map(item => [item.invoice.id, item.outstanding, item.overdue]), [['a', 150, true], ['b', 40, false]]);
  assert.equal(summary.total, 190);
  assert.equal(summary.overdueCount, 1);
  assert.equal(summary.overdueTotal, 150);
});

test('Einnahmen und Ausgaben folgen der EÜR: Buchungen, bezahlte Rechnungen ohne Zahlung, ohne Stornos', () => {
  const invoices = [
    { id: 'p', issueDate: '2026-03-05', status: 'paid', total: 300 },
    { id: 'q', issueDate: '2026-04-05', status: 'paid', total: 999 },
  ];
  const euerEntries = [
    { entryType: 'income', sourceType: 'invoice_payment', sourceId: 'q', entryDate: '2026-05-02', amount: 999, status: 'active' },
    { entryType: 'expense', sourceType: 'manual', entryDate: '2026-03-20', amount: 120, status: 'active' },
    { entryType: 'expense', sourceType: 'manual', entryDate: '2026-03-21', amount: 80, status: 'voided' },
    { entryType: 'expense', sourceType: 'manual', entryDate: '2025-12-31', amount: 500, status: 'active' },
  ];
  const year = summarizeIncomeExpense({ invoices, euerEntries, year: 2026 });
  assert.equal(year.points.length, 12);
  assert.equal(year.income, 1299);
  assert.equal(year.expenses, 120);
  assert.equal(year.result, 1179);
  assert.deepEqual([year.points[2].income, year.points[2].expenses], [300, 120]);
  assert.equal(year.points[4].income, 999);
  const all = summarizeIncomeExpense({ invoices, euerEntries, year: 'all' });
  assert.deepEqual(all.points.map(point => [point.key, point.income, point.expenses]), [['2025', 0, 500], ['2026', 1299, 120]]);
});

test('Ø Rechnungsbetrag und aktive Kunden respektieren Zeitraum und „Nur bezahlte“', () => {
  const invoices = [
    { id: '1', customerId: 'k1', issueDate: '2026-01-10', status: 'paid', total: 100 },
    { id: '2', customerId: 'k2', issueDate: '2026-02-10', status: 'sent', total: 300 },
    { id: '3', customerId: 'k3', issueDate: '2026-02-11', status: 'draft', total: 1000 },
    { id: '4', customerId: 'k1', issueDate: '2025-02-11', status: 'paid', total: 50 },
  ];
  assert.deepEqual(averageInvoiceAmount(invoices, 2026, false), { count: 2, average: 200, total: 400 });
  assert.deepEqual(averageInvoiceAmount(invoices, 2026, true), { count: 1, average: 100, total: 100 });
  assert.equal(averageInvoiceAmount(invoices, 'all', true).count, 2);
  assert.equal(averageInvoiceAmount([], 2026, true).average, 0);
  const jobs = [{ customerId: 'k4', date: '2026-06-01' }, { customerId: 'k1', date: '2024-06-01' }];
  assert.equal(countActiveCustomers({ invoices, jobs, year: 2026 }), 3);
  assert.equal(countActiveCustomers({ invoices, jobs, year: 'all' }), 3);
  assert.equal(countActiveCustomers({ invoices, jobs, year: 2024 }), 1);
});

test('Nächste Termine ab heute und offene Angebote nach Gültigkeit', () => {
  const jobs = [
    { id: 'gestern', date: '2026-10-08' },
    { id: 'spaeter', date: '2026-10-09', startTime: '14:00' },
    { id: 'frueh', date: '2026-10-09', startTime: '08:00' },
    { id: 'morgen', date: '2026-10-10' },
  ];
  assert.deepEqual(upcomingJobs(jobs, today, 2).map(entry => entry.job.id), ['frueh', 'spaeter']);
  const quotes = [
    { id: 'x', status: 'sent', validUntil: '2026-11-01', total: 100 },
    { id: 'y', status: 'sent', validUntil: '2026-10-01', total: 50 },
    { id: 'z', status: 'accepted', validUntil: '2026-10-01', total: 500 },
  ];
  const open = summarizeOpenQuotes(quotes, today);
  assert.deepEqual(open.items.map(item => [item.quote.id, item.expired]), [['y', true], ['x', false]]);
  assert.equal(open.total, 150);
});
