import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

async function loadUtility() {
  const temp = await mkdtemp(path.join('/tmp', 'solooffice-customer-metrics-'));
  const bundle = await rolldown({ input: path.resolve('src/utils/customerDetailMetrics.ts'), platform: 'browser' });
  const output = path.join(temp, 'bundle.mjs');
  await bundle.write({ file: output, format: 'esm' });
  await bundle.close();
  return { module: await import(pathToFileURL(output).href), temp };
}

test('Kundenkennzahlen erkennen Bruttosummen aus verschiedenen API-Feldnamen und lassen Entwürfe aus', async t => {
  const { module, temp } = await loadUtility();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const invoices = [
    { id: '1', customerId: 'c1', invoiceNumber: 'RE-001', issueDate: '2026-01-10', status: 'sent', totalAmount: '119.00', outstandingAmount: null },
    { id: '2', customerId: 'c1', invoiceNumber: 'RE-009', issueDate: '2026-09-10', status: 'paid', gross: 238 },
    { id: '3', customerId: 'c1', issueDate: '2026-10-01', status: 'draft', total: 500 },
    { id: '4', customerId: 'c1', issueDate: '2026-09-01', status: 'paid', total: 50, documentType: 'credit_note' },
    { id: '5', customerId: 'other', issueDate: '2026-09-01', status: 'paid', total: 900 },
  ];
  const result = module.calculateCustomerInvoiceMetrics(invoices, 'c1', 2026);
  assert.equal(result.revenue, 357);
  assert.equal(result.revenueThisYear, 357);
  assert.equal(result.openAmount, 119);
  assert.equal(result.lastInvoice.invoiceNumber, 'RE-009');
});

test('Kundentermine berücksichtigen zukünftige abgerechnete Termine und ISO-Datumswerte', async t => {
  const { module, temp } = await loadUtility();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const jobs = [
    { id: 'future', customerId: 'c1', title: 'Jahresbetreuung', date: '2026-10-13T00:00:00.000Z', status: 'invoiced' },
    { id: 'today', customerId: 'c1', date: '2026-10-09', status: 'in-progress' },
    { id: 'past', customerId: 'c1', date: '2026-10-08', status: 'in-progress' },
    { id: 'done', customerId: 'c1', date: '2026-10-14', status: 'completed' },
  ];
  assert.deepEqual(module.upcomingCustomerJobs(jobs, 'c1', new Date(2026, 9, 9)).map(job => job.id), ['today', 'future']);
});
