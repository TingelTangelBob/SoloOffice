import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

async function loadDisplay() {
  const base = path.resolve('.test-dist');
  await mkdir(base, { recursive: true });
  const temp = await mkdtemp(path.join(base, 'recurring-display-'));
  const bundle = await rolldown({ input: path.resolve('src/utils/recurringExpenseDisplay.ts'), platform: 'browser' });
  const output = path.join(temp, 'recurring-display.mjs');
  await bundle.write({ file: output, format: 'esm' });
  await bundle.close();
  return { module: await import(`${pathToFileURL(output).href}?display-test=${Date.now()}`), temp };
}

const expense = overrides => ({
  id: 'expense-1', name: 'Beispiel', counterparty: '', category: 'software', amountGross: 80, taxRate: 19,
  interval: 'monthly', intervalCount: 1, intervalUnit: 'months', startDate: '2025-01-15', endDate: null,
  noticePeriodDays: 0, cancelledOn: null, status: 'active', pauses: [], priceChanges: [], automaticBooking: false,
  scope: 'business', levyKind: null, linkedReceiptId: null, notes: '', ...overrides,
});
const run = (dueDate, status = 'confirmed') => ({
  id: dueDate, expenseId: 'expense-1', dueDate, amountGross: 80, status, paidOn: status === 'confirmed' ? dueDate : null,
  euerEntryId: null, levyPaymentId: null,
});

test('offener Lauf im aktuellen Jahr hat Vorrang vor dem Raster und dem anfänglichen Startdatum', async t => {
  const { module: display, temp } = await loadDisplay();
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  const item = expense();
  const runs = [run('2025-01-15'), run('2026-09-15'), run('2026-10-15', 'planned'), run('2026-11-15', 'planned')];
  assert.equal(display.nextRecurringExpenseDueDate(item, runs, '2026-10-09'), '2026-10-15');
  assert.equal(display.nextRecurringExpenseDueDate(item, [run('2025-12-15', 'planned')], '2026-10-09'), '2025-12-15');
});

test('bestätigte und übersprungene Termine werden nicht wieder als nächste Fälligkeit angezeigt', async t => {
  const { module: display, temp } = await loadDisplay();
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  const item = expense();
  const runs = [run('2025-01-15'), run('2026-10-15', 'skipped')];
  assert.equal(display.nextRecurringExpenseDueDate(item, runs, '2026-10-09'), '2026-11-15');
});

test('Raster startet ab heute auch bei einem früheren Startjahr und beachtet künftige Pausen', async t => {
  const { module: display, temp } = await loadDisplay();
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  const item = expense({ pauses: [{ from: '2026-10-15', until: '2026-11-15' }] });
  assert.equal(display.nextRecurringExpenseDueDate(item, [], '2026-10-09'), '2026-12-15');
});

test('Enddatum ist exklusiv und verhindert Fälligkeiten ab dem Vertragsende', async t => {
  const { module: display, temp } = await loadDisplay();
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  const item = expense({ endDate: '2026-10-15' });
  assert.equal(display.nextRecurringExpenseDueDate(item, [], '2026-10-09'), null);
});

test('endliche Vergangenheitspause und künftige Pause ändern den heutigen Aktivstatus nicht', async t => {
  const { module: display, temp } = await loadDisplay();
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  assert.equal(display.currentExpenseStatus(expense({ status: 'paused', pauses: [{ from: '2026-07-01', until: '2026-07-31' }] }), '2026-10-09'), 'active');
  assert.equal(display.currentExpenseStatus(expense({ status: 'paused', pauses: [{ from: '2026-11-01', until: null }] }), '2026-10-09'), 'active');
  assert.equal(display.currentExpenseStatus(expense({ status: 'paused', pauses: [{ from: '2026-10-01', until: null }] }), '2026-10-09'), 'paused');
  assert.equal(display.currentExpenseStatus(expense({ endDate: '2026-10-09' }), '2026-10-09'), 'ended');
});
