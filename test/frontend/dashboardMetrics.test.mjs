import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateRevenue, buildRevenueRecords, compareRevenue, sumRevenue } from '../../.test-dist/utils/dashboardMetrics.js';

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
