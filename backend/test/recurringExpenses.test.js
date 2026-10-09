import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, assertDateOnly, isPausedOn, isRecurringExpenseDue, nextOccurrence, occurrenceAt, occurrenceOnOrAfter } from '../shared/recurrence.js';
import { confirmRun, generateRuns, makeSnapshot, mapExpense, mapRun, normalizePauses, normalizePriceChanges, priceForDate, updateExpense, validateExpense } from '../services/recurringExpenses.js';
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

test('Gemeinsame Fälligkeitsregel berücksichtigt exklusives Ende und finite Pausen; Kündigungsfrist ersetzt kein Enddatum', () => {
  const expense = { startDate: '2026-01-01', endDate: '2026-04-01', cancelledOn: null, status: 'active',
    intervalCount: 1, intervalUnit: 'months', pauses: [{ from: '2026-02-01', until: '2026-02-28' }] };
  assert.equal(isRecurringExpenseDue(expense, '2026-01-01'), true);
  assert.equal(isRecurringExpenseDue(expense, '2026-02-01'), false);
  assert.equal(isRecurringExpenseDue(expense, '2026-03-01'), true);
  assert.equal(isRecurringExpenseDue(expense, '2026-04-01'), false);
  assert.equal(isRecurringExpenseDue({ ...expense, endDate: null, cancelledOn: '2026-03-01', noticePeriodDays: 30 }, '2026-03-01'), true);
  assert.equal(isRecurringExpenseDue({ ...expense, endDate: null, cancelledOn: '2026-03-01', noticePeriodDays: 30 }, '2026-04-01'), true);
  assert.equal(isRecurringExpenseDue({ ...expense, endDate: '2026-04-01', cancelledOn: '2026-03-01', noticePeriodDays: 30 }, '2026-04-01'), false);
  assert.equal(occurrenceOnOrAfter('2020-01-31', '2026-10-09', 1, 'month'), '2026-10-31');
});

test('Status pausiert mit endlicher Pause läuft nach deren Ende weiter; unbefristet pausiert bleibt aus', () => {
  const expense = { startDate: '2026-01-01', intervalCount: 1, intervalUnit: 'months', status: 'paused',
    pauses: [{ from: '2026-01-01', until: '2026-02-28' }] };
  assert.equal(isRecurringExpenseDue(expense, '2026-02-01'), false);
  assert.equal(isRecurringExpenseDue(expense, '2026-03-01'), true);
  assert.equal(isRecurringExpenseDue({ ...expense, pauses: [{ from: '2026-01-01', until: null }] }, '2026-03-01'), false);
  assert.equal(isRecurringExpenseDue({ ...expense, status: 'ended' }, '2026-03-01'), false);
});

test('Intervalländerung entfernt nur geplante Zukunftsläufe und setzt den Generator neu auf', async () => {
  const current = { id: 'expense-id', workspace_id: 'workspace-id', name: 'Lizenz', category: 'software', scope: 'business', amount: '50', tax_rate: null,
    interval_value: 1, interval_unit: 'month', start_date: '2026-01-01', end_date: null, cancelled_on: null, next_due_date: '2026-12-01',
    cancellation_notice_days: 0, status: 'active', auto_confirm: false, linked_receipt_id: null, notes: null, price_changes: [], pauses: [] };
  const runs = [
    { id: 'planned-future', due_date: '2026-12-01' },
    { id: 'planned-past', due_date: '2026-10-01' },
  ];
  let updated = { ...current };
  const deleted = [];
  const snapshots = [];
  const executor = async (sql, params = []) => {
    if (sql.startsWith('SELECT * FROM recurring_expenses WHERE id=$1 FOR UPDATE')) return { rows: [current] };
    if (sql.startsWith('UPDATE recurring_expenses SET')) {
      const p = params;
      updated = { ...current, name: p[0], counterparty: p[1], category: p[2], scope: p[3], amount: p[4], tax_rate: p[5], interval_value: p[6], interval_unit: p[7], start_date: p[8], end_date: p[9], cancelled_on: p[10], next_due_date: p[11], cancellation_notice_days: p[12], status: p[13], auto_confirm: p[14], linked_receipt_id: p[15], notes: p[16], price_changes: JSON.parse(p[17]), pauses: JSON.parse(p[18]) };
      return { rowCount: 1 };
    }
    if (sql === 'SELECT * FROM recurring_expenses WHERE id=$1') return { rows: [updated] };
    if (sql.includes("FROM recurring_expense_runs WHERE expense_id=$1 AND status='planned'")) return { rows: runs.filter(run => run.due_date >= params[1]) };
    if (sql.startsWith("DELETE FROM recurring_expense_runs")) { deleted.push(params[0]); return { rowCount: 1 }; }
    if (sql.startsWith('UPDATE recurring_expense_runs SET snapshot=')) { snapshots.push(params[1]); return { rowCount: 1 }; }
    throw new Error(`Unerwartete SQL: ${sql}`);
  };
  const result = await updateExpense(executor, current.id, { interval: 'quarterly', intervalCount: 3, intervalUnit: 'months' }, '2026-10-09');
  assert.equal(result.expense.nextDueDate, '2027-01-01');
  assert.deepEqual(deleted, ['planned-future']);
  assert.deepEqual(snapshots, []);
});

test('Generator erzeugt Fälligkeiten nach endlicher Pause und nicht bei unbefristeter Pause', async () => {
  const rows = [
    { id: 'finite', workspace_id: 'workspace', name: 'Finite Pause', category: 'rent', scope: 'business', amount: 10, tax_rate: null,
      start_date: '2026-01-01', next_due_date: '2026-01-01', interval_value: 1, interval_unit: 'month', status: 'paused', auto_confirm: false,
      end_date: null, cancelled_on: null, cancellation_notice_days: 0, pauses: [{ from: '2026-01-01', until: '2026-02-28' }], price_changes: [] },
    { id: 'indefinite', workspace_id: 'workspace', name: 'Pause offen', category: 'rent', scope: 'business', amount: 10, tax_rate: null,
      start_date: '2026-01-01', next_due_date: '2026-01-01', interval_value: 1, interval_unit: 'month', status: 'paused', auto_confirm: false,
      end_date: null, cancelled_on: null, cancellation_notice_days: 0, pauses: [{ from: '2026-01-01', until: null }], price_changes: [] },
  ];
  const inserts = [];
  const client = { query: async (sql, params = []) => {
    if (sql.includes("SELECT * FROM recurring_expenses WHERE")) return { rows };
    if (sql.startsWith('INSERT INTO recurring_expense_runs')) {
      inserts.push(params[2]);
      return { rows: [{ id: `run-${inserts.length}`, expense_id: params[1], due_date: params[2], snapshot: JSON.parse(params[3]), status: 'planned' }] };
    }
    if (sql.startsWith('UPDATE recurring_expenses SET next_due_date')) return { rowCount: 1 };
    throw new Error(`Unerwartete SQL: ${sql}`);
  } };
  const result = await generateRuns(client, '2026-03-01', { today: '2026-01-01' });
  assert.deepEqual(inserts, ['2026-03-01']);
  assert.deepEqual(result.map(run => run.dueDate), ['2026-03-01']);
});

test('Past planned Läufe mit inzwischen unzulässigem Enddatum lassen sich nicht bestätigen', async () => {
  const client = { query: async sql => {
    assert.match(sql, /FROM recurring_expense_runs/);
    return { rows: [{ id: 'run-id', due_date: '2026-03-01', snapshot: { scope: 'business' }, status: 'planned',
      expense_start_date: '2026-01-01', expense_end_date: '2026-03-01', expense_cancelled_on: null, expense_notice_days: 0,
      expense_status: 'active', expense_interval_value: 1, expense_interval_unit: 'month', pauses: [] }] };
  } };
  const result = await confirmRun(client, '00000000-0000-4000-8000-000000000001', '2026-03-01', '2026-10-09');
  assert.match(result.conflict, /aktuellen Fixkostenregel/);
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

test('Jahresintervalle werden im kanonischen Monatsvertrag korrekt abgebildet', () => {
  const record = { id:'jährlich', name:'Beitrag', category:'memberships', scope:'business', amount:'120', interval_value:1, interval_unit:'year', start_date:'2026-02-15', next_due_date:'2026-02-15' };
  const yearly = mapExpense(record);
  assert.equal(yearly.interval, 'yearly');
  assert.equal(yearly.intervalUnit, 'months');
  assert.equal(yearly.intervalCount, 12);
  assert.equal(isRecurringExpenseDue(yearly, '2026-03-15'), false);
  assert.equal(isRecurringExpenseDue(yearly, '2027-02-15'), true);
  const biennial = mapExpense({ ...record, interval_value:2 });
  assert.equal(biennial.interval, 'custom');
  assert.equal(biennial.intervalCount, 24);
});

test('Eine unbegrenzte Pause ab Oktober lässt eine ungezahlte Septemberfälligkeit bestehen', () => {
  const expense = { startDate:'2026-01-01', intervalCount:1, intervalUnit:'months', status:'paused', pauses:[{ from:'2026-10-01', until:null }] };
  assert.equal(isRecurringExpenseDue(expense, '2026-09-01'), true);
  assert.equal(isRecurringExpenseDue(expense, '2026-10-01'), false);
  assert.equal(isRecurringExpenseDue(expense, '2027-01-01'), false);
});


test('Beendete Vorlage erhält frühere ungezahlte Fälligkeiten vor dem exklusiven Ende', () => {
  const template = { status: 'ended', startDate: '2026-01-01', endDate: '2026-10-09', intervalCount: 1, intervalUnit: 'months' };
  assert.equal(isRecurringExpenseDue(template, '2026-09-01'), true);
  assert.equal(isRecurringExpenseDue(template, '2026-11-01'), false);
});

test('Ausgangsbeleg wird nicht erneut verknüpft, wenn er zu einer früheren Zahlung derselben Vorlage gehört', async () => {
  const written = [];
  const client = { query: async (sql, params = []) => {
    if (sql.includes('FROM recurring_expense_runs r JOIN')) return { rows: [{ id: 'run', expense_id: 'template', due_date: '2026-02-01', status: 'planned',
      snapshot: { scope: 'business', category: 'rent', name: 'Miete', amount: 100, linkedReceiptId: 'receipt' },
      expense_start_date: '2026-01-01', expense_status: 'active', expense_interval_value: 1, expense_interval_unit: 'month', pauses: [] }] };
    if (sql.startsWith('SELECT linked_euer_entry_id')) return { rows: [{ linked_euer_entry_id: 'first' }] };
    if (sql.startsWith('SELECT e.status')) return { rows: [{ status: 'active', expense_id: 'template' }] };
    written.push(sql);
    if (sql.startsWith('INSERT INTO euer_entries')) return { rows: [{ id: 'second' }] };
    if (sql.startsWith('UPDATE recurring_expense_runs')) return { rows: [{ id: 'run', expense_id: 'template', due_date: '2026-02-01', snapshot: { scope: 'business', amount: 100 }, status: 'confirmed', paid_on: params[0], euer_entry_id: 'second' }] };
    return { rows: [] };
  } };
  const result = await confirmRun(client, 'run', '2026-02-02', '2026-10-09');
  assert.equal(result.run.euerEntryId, 'second');
  assert.equal(written.some(sql => sql.startsWith('UPDATE receipts')), false);
});

test('Abgaben behalten PostgreSQL-DATE-Kalendertage und ihr Bezugsjahr', () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  try {
    const payment = mapPayment({ id: 'date-payment', levy_type: 'kv',
      period_start: new Date(2026, 0, 1), due_date: new Date(2026, 1, 1),
      paid_on: new Date(2026, 1, 1), amount: '100', source: 'manual' });
    assert.equal(payment.year, 2026);
    assert.equal(payment.period, '2026-01');
    assert.equal(payment.dueDate, '2026-02-01');
    assert.equal(payment.paidOn, '2026-02-01');
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});
