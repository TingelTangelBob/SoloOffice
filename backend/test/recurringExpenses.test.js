import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, assertDateOnly, isPausedOn, nextOccurrence, occurrenceAt } from '../shared/recurrence.js';
import { confirmRun, generateRuns, makeSnapshot, mapExpense, mapRun, normalizePauses, normalizePriceChanges, priceForDate, validateExpense } from '../services/recurringExpenses.js';
import { mapPayment, validate as validateLevyPayment } from '../routes/levyPayments.js';

test('Monatsfälligkeiten bleiben am Starttag verankert und behandeln Schaltjahre', () => {
  assert.equal(occurrenceAt('2025-01-31', 1), '2025-02-28');
  assert.equal(occurrenceAt('2025-01-31', 2), '2025-03-31');
  assert.equal(occurrenceAt('2024-01-31', 1), '2024-02-29');
  assert.equal(occurrenceAt('2024-01-31', 2), '2024-03-31');
  assert.equal(nextOccurrence('2025-01-31', '2025-02-28'), '2025-03-31');
});

test('Wochen-, Mehrmonats- und Jahresintervalle nutzen UTC-Datumsarithmetik', () => {
  assert.equal(occurrenceAt('2026-10-25', 2, 2, 'week'), '2026-11-22');
  assert.equal(occurrenceAt('2025-01-31', 1, 3, 'month'), '2025-04-30');
  assert.equal(occurrenceAt('2024-02-29', 1, 1, 'year'), '2025-02-28');
  assert.equal(addDays('2026-03-28', 1), '2026-03-29');
});

test('Datumseingaben sind ISO-kalendertage und ungültige Kalendertage werden abgewiesen', () => {
  assert.equal(assertDateOnly('2026-12-31'), '2026-12-31');
  assert.throws(() => assertDateOnly('2026-02-29'));
  assert.throws(() => assertDateOnly('31.12.2026'));
});

test('Pausenbeginn und -ende sind inklusive, null bedeutet unbegrenzt', () => {
  const pauses = normalizePauses([{ from: '2026-03-01', until: '2026-03-10' }, { from: '2026-06-01', until: null }]);
  assert.equal(isPausedOn('2026-03-01', pauses), true);
  assert.equal(isPausedOn('2026-03-10', pauses), true);
  assert.equal(isPausedOn('2026-03-11', pauses), false);
  assert.equal(isPausedOn('2099-01-01', pauses), true);
  assert.throws(() => normalizePauses([{ from: '2026-03-02', until: '2026-03-01' }]));
});

test('Preisänderung ab heute wird übernommen; ein Lauf behält seinen vorherigen Snapshot', () => {
  const prices = normalizePriceChanges([{ validFrom: '2026-10-09', amountGross: 125, taxRate: 19 }], {}, '2026-10-09');
  const expense = { name: 'Miete', category: 'rent', scope: 'business', amount: 100, tax_rate: 19, price_changes: prices };
  const historicalSnapshot = makeSnapshot({ ...expense, price_changes: [] }, '2026-10-08');
  const currentSnapshot = makeSnapshot(expense, '2026-10-09');
  assert.equal(historicalSnapshot.amount, 100);
  assert.equal(currentSnapshot.amount, 125);
  assert.throws(() => normalizePriceChanges([{ validFrom: '2026-10-08', amountGross: 150 }], {}, '2026-10-09'));
  assert.throws(() => normalizePriceChanges([], {}, '2026-10-09', [{ validFrom: '2026-10-08', amount: 100, taxRate: null }]));
  assert.throws(() => normalizePriceChanges([{ validFrom: '2026-10-09', amountGross: 150 }], {}, '2026-10-09', [{ validFrom: '2026-10-09', amount: 125, taxRate: 19 }]));
});

test('Fixkosten validieren Bereich, Abgabenart, positive Intervalle und Enddatum exklusiv', () => {
  const base = { name: 'Miete', category: 'rent', amount: 500, taxRate: null, startDate: '2026-01-31', nextDueDate: '2026-01-31', intervalUnit: 'month' };
  assert.equal(typeof validateExpense({ ...base, endDate: '2026-01-31' }, '2026-01-01'), 'object');
  assert.match(validateExpense({ ...base, scope: 'business', category: 'gewst_vz' }, '2026-01-01'), /Private Abgaben/);
  assert.match(validateExpense({ ...base, intervalValue: 0 }, '2026-01-01'), /Intervall/);
  const contract = validateExpense({ name: 'Lizenz', category: 'software', amountGross: 19.9, interval: 'quarterly', startDate: '2026-01-01', endDate: null, nextDueDate: '2026-01-01', noticePeriodDays: 30, automaticBooking: false }, '2025-12-01');
  assert.equal(contract.intervalValue, 3);
  assert.equal(contract.intervalUnit, 'month');
  assert.equal(contract.amount, 19.9);
  assert.equal(contract.autoConfirm, false);
  assert.equal(contract.cancelledOn, null);
});

test('Canonicale Fixkosten-Request- und Responsefelder werden tatsächlich abgebildet', () => {
  const normalized = validateExpense({
    name: 'Miete', category: 'rent', scope: 'business', amountGross: 490, taxRate: 19,
    interval: 'custom', intervalCount: 2, intervalUnit: 'weeks', startDate: '2026-01-01',
    endDate: null, noticePeriodDays: 14, cancelledOn: '2026-08-01', automaticBooking: false,
    levyKind: null, priceChanges: [{ validFrom: '2026-11-01', amountGross: 510 }], pauses: [],
  }, '2026-10-09');
  assert.equal(typeof normalized, 'object');
  assert.deepEqual([normalized.amount, normalized.interval, normalized.intervalCount, normalized.intervalUnit,
    normalized.cancellationNoticeDays, normalized.cancelledOn, normalized.autoConfirm, normalized.category],
  [490, 'custom', 2, 'week', 14, '2026-08-01', false, 'rent']);
  const response = mapExpense({
    id: 'expense-id', name: 'Miete', counterparty: null, category: 'rent', scope: 'business', amount: '490.00', tax_rate: '19',
    interval_unit: 'week', interval_value: 2, start_date: '2026-01-01', end_date: null, cancelled_on: '2026-08-01',
    next_due_date: '2026-11-01', cancellation_notice_days: 14, status: 'active', auto_confirm: false,
    linked_receipt_id: null, notes: null, price_changes: [{ validFrom: '2026-11-01', amount: 510 }], pauses: [], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
  });
  assert.deepEqual(Object.keys(response), ['id','name','counterparty','category','scope','amountGross','taxRate','interval','intervalCount','intervalUnit','startDate','endDate','cancelledOn','nextDueDate','noticePeriodDays','status','automaticBooking','levyKind','linkedReceiptId','notes','priceChanges','pauses','createdAt','updatedAt']);
  assert.equal(response.amountGross, 490);
  assert.equal(response.interval, 'custom');
  assert.equal(response.intervalUnit, 'weeks');
  assert.equal(response.cancelledOn, '2026-08-01');
  assert.deepEqual(response.priceChanges, [{ validFrom: '2026-11-01', amountGross: 510 }]);
});

test('Canonicale Lauf- und Abgabenfelder werden auf Responses gemappt; Monatsperiode bleibt YYYY-MM', () => {
  const run = mapRun({
    id: 'run-id', expense_id: 'expense-id', due_date: '2026-10-01', snapshot: { amount: 42.5, name: 'Miete', scope: 'business' },
    status: 'confirmed', paid_on: '2026-10-02', euer_entry_id: 'euer-id', levy_payment_id: null, created_at: '2026-10-01T00:00:00Z', confirmed_at: '2026-10-02T00:00:00Z',
  });
  assert.deepEqual(Object.keys(run), ['id','expenseId','dueDate','amountGross','status','levyPaymentId','paidOn','euerEntryId','scope','name']);
  assert.equal(run.amountGross, 42.5);
  assert.equal(run.paidOn, '2026-10-02');
  assert.equal(run.euerEntryId, 'euer-id');
  assert.equal(run.name, 'Miete');
  assert.equal(run.scope, 'business');

  const payment = mapPayment({ id: 'payment-id', levy_type: 'kv', period_start: '2026-10-01', due_date: '2026-10-15', paid_on: null,
    amount: '42.50', source: 'manual', recurring_expense_run_id: null, notes: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' });
  assert.deepEqual(Object.keys(payment), ['id','kind','year','period','dueDate','paidOn','amount','source','expenseRunId','notes']);
  assert.equal(payment.period, '2026-10');
  assert.deepEqual(validateLevyPayment({ kind: 'kv', year: 2026, period: '2026-10', dueDate: '2026-10-15', paidOn: null, amount: 42.5, source: 'manual' }), {
    levyType: 'kv', periodStart: '2026-10-01', periodEnd: null, dueDate: '2026-10-15', paidOn: null, amount: 42.5,
    source: 'manual', recurringExpenseRunId: null, notes: null,
  });
  assert.equal(validateLevyPayment({ kind: 'kv', year: 2026, period: '2026-10-20', amount: 1 }).periodStart, '2026-10-01');
  assert.match(validateLevyPayment({ kind: 'kv', year: 2026, period: '2027-01', amount: 1 }), /passen nicht zusammen/);
  assert.match(validateLevyPayment({ kind: 'kv', year: 2026, periodStart: '2027-01-01', amount: 1 }), /passen nicht zusammen/);
  assert.match(validateLevyPayment({ kind: 'kv', year: 2026, period: '2026-10', amount: 1, source: 'recurring_expense' }), /Laufbestätigung/);
});

test('Laufgenerierung ist zeitlich begrenzt und Zukunftszahlungen können nicht bestätigt werden', async () => {
  const unusedClient = { query: async () => { throw new Error('DB-Zugriff unerwartet'); } };
  await assert.rejects(generateRuns(unusedClient, '2028-10-10', { today: '2026-10-09' }), /höchstens zwei Jahre/);
  await assert.rejects(confirmRun(unusedClient, '00000000-0000-4000-8000-000000000001', '2026-10-10', '2026-10-09'), /zukünftiges/);
});
