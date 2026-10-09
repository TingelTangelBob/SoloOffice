import { addDays, assertDateOnly, isRecurringExpenseDue, nextOccurrence, occurrenceAt, occurrenceOnOrAfter } from '../shared/recurrence.js';

const expenseCategorySet = new Set(['rent','memberships','materials','office','software','telecommunications','insurance','bank_fees','travel','vehicle','marketing','professional_services','other_expense','kv','pv','rv','av','ksk','est_vz','gewst_vz','ust']);
const levyCategorySet = new Set(['kv','pv','rv','av','ksk','est_vz','gewst_vz','ust']);
const units = new Set(['day','week','month','year']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = value => uuid.test(String(value || ''));
export const MAX_GENERATED_RUNS = 2000;

export function validateExpense(input, today = new Date().toISOString().slice(0, 10)) {
  try {
    const name = String(input.name || '').trim();
    const scope = String(input.scope || 'business');
    const category = String(input.levyKind || input.category || 'other_expense');
    const startDate = assertDateOnly(input.startDate, 'Startdatum');
    const endDate = input.endDate ? assertDateOnly(input.endDate, 'Enddatum') : null;
    const nextDueDate = assertDateOnly(input.nextDueDate || startDate, 'Nächste Fälligkeit');
    if (!name || name.length > 160) return 'Bitte geben Sie eine Bezeichnung mit höchstens 160 Zeichen ein.';
    if (!['business','private_levy'].includes(scope) || !expenseCategorySet.has(category)) return 'Ungültiger Bereich oder ungültige Kategorie.';
    if (scope === 'private_levy' && !levyCategorySet.has(category)) return 'Private Abgaben benötigen eine passende Abgabenart.';
    if (scope === 'business' && levyCategorySet.has(category)) return 'Private Abgaben können nicht als betriebliche Fixkosten gespeichert werden.';
    const amount = Number(input.amountGross ?? input.amount);
    const taxRate = input.taxRate == null || input.taxRate === '' ? null : Number(input.taxRate);
    const presets = { monthly: [1,'month'], quarterly: [3,'month'], half_yearly: [6,'month'], yearly: [1,'year'] };
    const preset = presets[input.interval];
    const intervalValue = Number(preset ? preset[0] : input.intervalCount ?? input.intervalValue ?? 1);
    const intervalUnit = String(preset ? preset[1] : input.intervalUnit === 'months' ? 'month' : input.intervalUnit === 'weeks' ? 'week' : input.intervalUnit || 'month');
    const cancellationNoticeDays = Number(input.noticePeriodDays ?? input.cancellationNoticeDays ?? 0);
    const cancelledOn = input.cancelledOn ? assertDateOnly(input.cancelledOn, 'Kündigungsdatum') : null;
    if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(intervalValue) || intervalValue < 1 || !units.has(intervalUnit)) return 'Betrag und Intervall sind ungültig.';
    if (taxRate !== null && (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100)) return 'Der MwSt.-Satz muss zwischen 0 und 100 liegen.';
    if (!Number.isInteger(cancellationNoticeDays) || cancellationNoticeDays < 0 || cancellationNoticeDays > 3650) return 'Die Kündigungsfrist ist ungültig.';
    if (endDate && endDate < startDate) return 'Das Enddatum darf nicht vor dem Startdatum liegen.';
    if (nextDueDate < startDate) return 'Die nächste Fälligkeit darf nicht vor dem Startdatum liegen.';
    if (input.linkedReceiptId && !uuid.test(String(input.linkedReceiptId))) return 'Ungültiger Belegbezug.';
    const changes = normalizePriceChanges(input.priceChanges ?? [], { amount, taxRate }, today, input.immutablePriceChanges ?? []);
    const pauses = normalizePauses(input.pauses ?? []);
    return { name, counterparty: String(input.counterparty || '').trim() || null, category, scope, amount, taxRate,
      intervalValue, intervalUnit, interval: input.interval || null, intervalCount: intervalValue, startDate, endDate, nextDueDate, cancellationNoticeDays, cancelledOn,
      status: ['active','paused','ended'].includes(input.status) ? input.status : 'active',
      autoConfirm: input.automaticBooking === true || input.autoConfirm === true, linkedReceiptId: input.linkedReceiptId || null,
      notes: String(input.notes || '').trim() || null, priceChanges: changes, pauses };
  } catch (error) { return error.message || 'Ungültige Fixkostenangaben.'; }
}

export function normalizePriceChanges(changes, base = {}, today = '9999-12-31', immutable = []) {
  if (!Array.isArray(changes)) throw new TypeError('Preisänderungen müssen eine Liste sein.');
  const normalized = changes.map(change => {
    const validFrom = assertDateOnly(change.validFrom, 'Preisgültigkeit');
    const amount = Number(change.amountGross ?? change.amount);
    const taxRate = change.taxRate == null || change.taxRate === '' ? (base.taxRate == null ? null : Number(base.taxRate)) : Number(change.taxRate);
    if (!Number.isFinite(amount) || amount < 0 || (taxRate !== null && (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100))) throw new TypeError('Eine Preisänderung enthält ungültige Werte.');
    const oldAtDate = immutable.find(old => old.validFrom === validFrom);
    if ((validFrom < today || oldAtDate) && !immutable.some(old => old.validFrom === validFrom && Number(old.amount) === amount && (old.taxRate == null ? null : Number(old.taxRate)) === taxRate)) throw new TypeError('Vergangene oder bereits gesetzte Preise können nicht geändert werden.');
    return { validFrom, amount, taxRate };
  }).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  for (const old of immutable) {
    if (old.validFrom <= today && !normalized.some(item => item.validFrom === old.validFrom && Number(item.amount) === Number(old.amount) && (item.taxRate == null ? null : Number(item.taxRate)) === (old.taxRate == null ? null : Number(old.taxRate)))) {
      throw new TypeError('Vergangene Preise können weder geändert noch entfernt werden.');
    }
  }
  if (new Set(normalized.map(item => item.validFrom)).size !== normalized.length) throw new TypeError('Je Datum ist nur eine Preisänderung möglich.');
  return normalized;
}

export function normalizePauses(pauses) {
  if (!Array.isArray(pauses)) throw new TypeError('Pausen müssen eine Liste sein.');
  return pauses.map(pause => {
    const from = assertDateOnly(pause.from, 'Pausenbeginn');
    const until = pause.until == null || pause.until === '' ? null : assertDateOnly(pause.until, 'Pausenende');
    if (until && until < from) throw new TypeError('Das Pausenende darf nicht vor dem Beginn liegen.');
    return { from, until };
  }).sort((a, b) => a.from.localeCompare(b.from));
}

export function priceForDate(expense, dueDate) {
  let price = { amount: Number(expense.amount), taxRate: expense.tax_rate == null ? null : Number(expense.tax_rate) };
  for (const change of expense.price_changes || []) {
    if (change.validFrom <= dueDate) price = { amount: Number(change.amount), taxRate: change.taxRate == null ? null : Number(change.taxRate) };
  }
  return price;
}

export function makeSnapshot(expense, dueDate) {
  return { name: expense.name, counterparty: expense.counterparty || null, category: expense.category, scope: expense.scope,
    ...priceForDate(expense, dueDate), notes: expense.notes || null, linkedReceiptId: expense.linked_receipt_id || null };
}

export function mapExpense(row) {
  const interval = row.interval_unit === 'year' && Number(row.interval_value) === 1 ? 'yearly'
    : row.interval_unit === 'month' && Number(row.interval_value) === 1 ? 'monthly'
      : row.interval_unit === 'month' && Number(row.interval_value) === 3 ? 'quarterly'
        : row.interval_unit === 'month' && Number(row.interval_value) === 6 ? 'half_yearly' : 'custom';
  return { id: row.id, name: row.name, counterparty: row.counterparty || '', category: row.category,
    scope: row.scope, amountGross: Number(row.amount), taxRate: row.tax_rate == null ? null : Number(row.tax_rate),
    interval, intervalCount: Number(row.interval_value) * (row.interval_unit === 'year' ? 12 : 1), intervalUnit: row.interval_unit === 'week' ? 'weeks' : 'months',
    startDate: dateOnly(row.start_date), endDate: dateOnly(row.end_date), cancelledOn: dateOnly(row.cancelled_on),
    nextDueDate: dateOnly(row.next_due_date), noticePeriodDays: row.cancellation_notice_days, status: row.status,
    automaticBooking: row.auto_confirm, levyKind: row.scope === 'private_levy' ? row.category : null,
    linkedReceiptId: row.linked_receipt_id || null, notes: row.notes || '',
    priceChanges: (row.price_changes || []).map(change => ({ validFrom: change.validFrom, amountGross: Number(change.amount) })),
    pauses: row.pauses || [], createdAt: row.created_at, updatedAt: row.updated_at };
}

export function mapRun(row) {
  return { id: row.id, expenseId: row.expense_id, dueDate: dateOnly(row.due_date), amountGross: Number(row.snapshot?.amount || 0), status: row.status,
    levyPaymentId: row.levy_payment_id || null, paidOn: dateOnly(row.paid_on), euerEntryId: row.euer_entry_id || null, scope: row.snapshot?.scope,
    name: row.snapshot?.name };
}

function dateOnly(value) {
  if (value == null) return null;
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return String(value).slice(0, 10);
}

export async function listExpenses(executor) {
  const result = await executor('SELECT * FROM recurring_expenses ORDER BY next_due_date, name');
  return result.rows.map(mapExpense);
}

export async function createExpense(executor, input, today) {
    const value = validateExpense(input, today);
  if (typeof value === 'string') return { error: value };
  const result = await executor(`INSERT INTO recurring_expenses
    (name,counterparty,category,scope,amount,tax_rate,interval_value,interval_unit,start_date,end_date,cancelled_on,next_due_date,cancellation_notice_days,status,auto_confirm,linked_receipt_id,notes,price_changes,pauses)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb) RETURNING *`,
  [value.name,value.counterparty,value.category,value.scope,value.amount,value.taxRate,value.intervalValue,value.intervalUnit,value.startDate,value.endDate,value.cancelledOn,value.nextDueDate,value.cancellationNoticeDays,value.status,value.autoConfirm,value.linkedReceiptId,value.notes,JSON.stringify(value.priceChanges),JSON.stringify(value.pauses)]);
  return { expense: mapExpense(result.rows[0]) };
}

export async function updateExpense(executor, id, input, today) {
  assertDateOnly(today, 'Heutiges Datum');
  const currentResult = await executor('SELECT * FROM recurring_expenses WHERE id=$1 FOR UPDATE', [id]);
  if (!currentResult.rows.length) return { missing: true };
  const current = currentResult.rows[0];
  const merged = { name: current.name, counterparty: current.counterparty, category: current.category, scope: current.scope,
    amount: current.amount, taxRate: current.tax_rate, intervalValue: current.interval_value, intervalUnit: current.interval_unit,
    startDate: dateOnly(current.start_date), endDate: dateOnly(current.end_date), nextDueDate: dateOnly(current.next_due_date),
    cancellationNoticeDays: current.cancellation_notice_days, noticePeriodDays: current.cancellation_notice_days,
    cancelledOn: dateOnly(current.cancelled_on), status: current.status, autoConfirm: current.auto_confirm, automaticBooking: current.auto_confirm,
    amountGross: Number(current.amount), intervalCount: Number(current.interval_value) * (current.interval_unit === 'year' ? 12 : 1),
    interval: current.interval_unit === 'month' && Number(current.interval_value) === 3 ? 'quarterly' : current.interval_unit === 'month' && Number(current.interval_value) === 6 ? 'half_yearly' : current.interval_unit === 'year' ? 'yearly' : current.interval_unit === 'month' && Number(current.interval_value) === 1 ? 'monthly' : 'custom',
    intervalUnit: current.interval_unit === 'week' ? 'weeks' : 'months',
    linkedReceiptId: current.linked_receipt_id, notes: current.notes, priceChanges: current.price_changes, immutablePriceChanges: current.price_changes, pauses: current.pauses, ...input };
  const value = validateExpense(merged, today);
  if (typeof value === 'string') return { error: value };
  if (value.scope !== current.scope || value.category !== current.category) {
    const existingRuns = await executor('SELECT 1 FROM recurring_expense_runs WHERE expense_id=$1 LIMIT 1', [id]);
    if (existingRuns.rows.length) return { error: 'Bereich und Kategorie können nach dem ersten Fälligkeitslauf nicht geändert werden.' };
  }
  const scheduleChanged = value.startDate !== dateOnly(current.start_date)
    || value.intervalValue !== Number(current.interval_value) || value.intervalUnit !== current.interval_unit
    || value.endDate !== dateOnly(current.end_date) || value.cancelledOn !== dateOnly(current.cancelled_on)
    || value.cancellationNoticeDays !== Number(current.cancellation_notice_days)
    || value.status !== current.status || JSON.stringify(value.pauses) !== JSON.stringify(current.pauses || []);
  const nextDueDate = scheduleChanged
    ? occurrenceOnOrAfter(value.startDate, today, value.intervalValue, value.intervalUnit)
    : value.nextDueDate;
  await executor(`UPDATE recurring_expenses SET name=$1,counterparty=$2,category=$3,scope=$4,amount=$5,tax_rate=$6,interval_value=$7,interval_unit=$8,start_date=$9,end_date=$10,cancelled_on=$11,next_due_date=$12,cancellation_notice_days=$13,status=$14,auto_confirm=$15,linked_receipt_id=$16,notes=$17,price_changes=$18::jsonb,pauses=$19::jsonb,updated_at=NOW() WHERE id=$20`,
    [value.name,value.counterparty,value.category,value.scope,value.amount,value.taxRate,value.intervalValue,value.intervalUnit,value.startDate,value.endDate,value.cancelledOn,nextDueDate,value.cancellationNoticeDays,value.status,value.autoConfirm,value.linkedReceiptId,value.notes,JSON.stringify(value.priceChanges),JSON.stringify(value.pauses),id]);
  const updated = await executor('SELECT * FROM recurring_expenses WHERE id=$1', [id]);
  const futureRuns = await executor("SELECT id,due_date FROM recurring_expense_runs WHERE expense_id=$1 AND status='planned' AND due_date >= $2", [id,today]);
  for (const run of futureRuns.rows) {
    const dueDate = dateOnly(run.due_date);
    if (scheduleChanged || !isRecurringExpenseDue(updated.rows[0], dueDate)) {
      await executor("DELETE FROM recurring_expense_runs WHERE id=$1 AND status='planned' AND due_date >= $2", [run.id,today]);
      continue;
    }
    // Der DB-Trigger schützt den unveränderlichen Tages-Snapshot; nur kommende
    // Termine dürfen durch eine reine Preisänderung neu bewertet werden.
    if (dueDate <= today) continue;
    await executor('UPDATE recurring_expense_runs SET snapshot=$1::jsonb WHERE id=$2', [JSON.stringify(makeSnapshot(updated.rows[0], dueDate)),run.id]);
  }
  return { expense: mapExpense(updated.rows[0]) };
}

export async function deleteExpense(executor, id) {
  const result = await executor('SELECT id FROM recurring_expense_runs WHERE expense_id=$1 LIMIT 1', [id]);
  if (result.rows.length) return { conflict: 'Zu dieser Vorlage bestehen Fälligkeitsläufe. Beenden Sie sie, damit die Historie erhalten bleibt.' };
  const deleted = await executor('DELETE FROM recurring_expenses WHERE id=$1 RETURNING id', [id]);
  return deleted.rowCount ? { deleted: true } : { missing: true };
}

export async function generateRuns(client, throughDate, { autoConfirm = false, canManagePrivate = false, canAccessPrivate = canManagePrivate, today = new Date().toISOString().slice(0, 10) } = {}) {
  assertDateOnly(throughDate, 'Stichtag');
  assertDateOnly(today, 'Heutiges Datum');
  if (throughDate > occurrenceAt(today, 2, 1, 'year')) throw new TypeError('Der Vorschauzeitraum darf höchstens zwei Jahre umfassen.');
  const expenses = await client.query(`SELECT * FROM recurring_expenses WHERE (status IN ('active','paused') OR (status='ended' AND end_date IS NOT NULL)) AND next_due_date <= $1 ORDER BY next_due_date,id FOR UPDATE`, [throughDate]);
  const generated = [];
  let processedDueDates = 0;
  for (const expense of expenses.rows) {
    if (expense.scope === 'private_levy' && !canAccessPrivate) continue;
    let due = dateOnly(expense.next_due_date);
    while (due <= throughDate && (!expense.end_date || due < dateOnly(expense.end_date))) {
      processedDueDates += 1;
      if (processedDueDates > MAX_GENERATED_RUNS) throw new TypeError('Zu viele Fälligkeiten für einen einzelnen Generierungslauf.');
      if (!isRecurringExpenseDue(expense, due)) {
        due = nextOccurrence(dateOnly(expense.start_date), due, expense.interval_value, expense.interval_unit);
        continue;
      }
      const snapshot = makeSnapshot(expense, due);
      const inserted = await client.query(`INSERT INTO recurring_expense_runs (workspace_id,expense_id,due_date,snapshot)
        VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (workspace_id,expense_id,due_date) DO NOTHING RETURNING *`,
      [expense.workspace_id,expense.id,due,JSON.stringify(snapshot)]);
      let run = inserted.rows[0];
      if (!run && autoConfirm && expense.auto_confirm && due <= today) {
        const pending = await client.query("SELECT * FROM recurring_expense_runs WHERE workspace_id=$1 AND expense_id=$2 AND due_date=$3 AND status='planned' FOR UPDATE", [expense.workspace_id,expense.id,due]);
        run = pending.rows[0];
      }
      if (run) {
        let mappedRun = mapRun(run);
        if (autoConfirm && expense.auto_confirm && due <= today) {
          const confirmation = await confirmRun(client, run.id, today, today);
          if (confirmation.run) mappedRun = confirmation.run;
        }
        generated.push(mappedRun);
      }
      due = nextOccurrence(dateOnly(expense.start_date), due, expense.interval_value, expense.interval_unit);
    }
    await client.query('UPDATE recurring_expenses SET next_due_date=$1,updated_at=NOW() WHERE id=$2', [due,expense.id]);
  }
  return generated;
}

export async function confirmRun(client, runId, paidOn, today = new Date().toISOString().slice(0, 10)) {
  assertDateOnly(paidOn, 'Zahlungsdatum');
  assertDateOnly(today, 'Heutiges Datum');
  if (paidOn > today) throw new TypeError('Ein zukünftiges Zahlungsdatum kann nicht als erfolgte Zahlung bestätigt werden.');
  const result = await client.query(`SELECT r.*,lp.id AS levy_payment_id,e.name,e.category,e.scope,e.amount,e.tax_rate,e.linked_receipt_id,e.price_changes,e.pauses,
    e.start_date AS expense_start_date,e.end_date AS expense_end_date,e.cancelled_on AS expense_cancelled_on,
    e.cancellation_notice_days AS expense_notice_days,e.status AS expense_status,e.interval_value AS expense_interval_value,e.interval_unit AS expense_interval_unit
    FROM recurring_expense_runs r JOIN recurring_expenses e ON e.id=r.expense_id AND e.workspace_id=r.workspace_id
    LEFT JOIN levy_payments lp ON lp.recurring_expense_run_id=r.id AND lp.workspace_id=r.workspace_id
    WHERE r.id=$1 FOR UPDATE OF r`, [runId]);
  if (!result.rows.length) return { missing: true };
  const run = result.rows[0];
  if (run.status === 'confirmed') return { run: mapRun(run), idempotent: true };
  if (run.status === 'skipped') return { conflict: 'Ein übersprungener Lauf kann nicht als bezahlt bestätigt werden.' };
  if (!isRecurringExpenseDue({ startDate: dateOnly(run.expense_start_date), endDate: dateOnly(run.expense_end_date),
    cancelledOn: dateOnly(run.expense_cancelled_on), noticePeriodDays: Number(run.expense_notice_days), status: run.expense_status,
    intervalCount: Number(run.expense_interval_value), intervalUnit: run.expense_interval_unit, pauses: run.pauses || [] }, dateOnly(run.due_date))) {
    return { conflict: 'Diese Fälligkeit ist nach der aktuellen Fixkostenregel nicht mehr zulässig.' };
  }
  if (run.snapshot.scope === 'private_levy') {
    const type = run.snapshot.category;
    const payment = await client.query(`INSERT INTO levy_payments (levy_type,period_start,due_date,paid_on,amount,source,recurring_expense_run_id,notes)
      VALUES ($1,$2,$2,$3,$4,'recurring_expense',$5,$6) RETURNING id`, [type,dateOnly(run.due_date),paidOn,Number(run.snapshot.amount),run.id,run.snapshot.name]);
    const updated = await client.query(`UPDATE recurring_expense_runs SET status='confirmed',paid_on=$1,confirmed_at=NOW() WHERE id=$2 RETURNING *`, [paidOn,run.id]);
    return { run: mapRun({ ...updated.rows[0], levy_payment_id: payment.rows[0].id }), levyPaymentId: payment.rows[0].id };
  }
  let receiptToLink = run.snapshot.linkedReceiptId || null;
  if (receiptToLink) {
    const receipt = await client.query('SELECT linked_euer_entry_id FROM receipts WHERE id=$1 FOR UPDATE', [run.snapshot.linkedReceiptId]);
    if (!receipt.rows.length) return { conflict: 'Der verknüpfte Beleg ist nicht mehr verfügbar.' };
    if (receipt.rows[0].linked_euer_entry_id) {
      const linked = await client.query(`SELECT e.status,r.expense_id FROM euer_entries e
        LEFT JOIN recurring_expense_runs r ON r.id=e.source_id AND r.workspace_id=e.workspace_id AND e.source_type='recurring_expense'
        WHERE e.id=$1`, [receipt.rows[0].linked_euer_entry_id]);
      if (linked.rows[0]?.status !== 'voided') {
        if (linked.rows[0]?.expense_id !== run.expense_id) return { conflict: 'Der verknüpfte Beleg ist bereits mit einer aktiven EÜR-Buchung verknüpft.' };
        receiptToLink = null; // Der Ausgangsbeleg gehört nur zur ersten Zahlung dieser Vorlage.
      }
    }
  }
  await client.query("SELECT set_config('app.recurring_expense_confirmation',$1,true)", [run.id]);
  const entry = await client.query(`INSERT INTO euer_entries (entry_type,entry_date,description,category,amount,tax_rate,source_type,source_id)
    VALUES ('expense',$1,$2,$3,$4,$5,'recurring_expense',$6) RETURNING id`,
  [paidOn,run.snapshot.name,run.snapshot.category,Number(run.snapshot.amount),Number(run.snapshot.taxRate || 0),run.id]);
  if (receiptToLink) {
    await client.query('UPDATE receipts SET linked_euer_entry_id=$1,updated_at=NOW() WHERE id=$2', [entry.rows[0].id,receiptToLink]);
    await client.query('UPDATE recurring_expenses SET linked_receipt_id=NULL,updated_at=NOW() WHERE id=$1 AND linked_receipt_id=$2', [run.expense_id,receiptToLink]);
  }
  const updated = await client.query(`UPDATE recurring_expense_runs SET status='confirmed',paid_on=$1,euer_entry_id=$2,confirmed_at=NOW() WHERE id=$3 RETURNING *`, [paidOn,entry.rows[0].id,run.id]);
  return { run: mapRun(updated.rows[0]) };
}

export async function skipRun(client, runId) {
  const result = await client.query('UPDATE recurring_expense_runs SET status=\'skipped\' WHERE id=$1 AND status=\'planned\' RETURNING *', [runId]);
  if (!result.rows.length) {
    const existing = await client.query('SELECT * FROM recurring_expense_runs WHERE id=$1', [runId]);
    if (!existing.rows.length) return { missing: true };
    return existing.rows[0].status === 'skipped' ? { run: mapRun(existing.rows[0]), idempotent: true } : { conflict: 'Ein bestätigter Lauf kann nicht übersprungen werden.' };
  }
  return { run: mapRun(result.rows[0]) };
}

export async function listRuns(executor, { year, dueOnly = false, today = new Date().toISOString().slice(0, 10) } = {}) {
  assertDateOnly(today, 'Heutiges Datum');
  const values = [];
  const conditions = [];
  if (year !== undefined) {
    if (!Number.isInteger(Number(year)) || Number(year) < 2000 || Number(year) > 2100) throw new TypeError('Ungültiges Jahr.');
    values.push(Number(year)); conditions.push(`r.due_date >= make_date($${values.length},1,1) AND r.due_date < make_date($${values.length}+1,1,1)`);
  }
  if (dueOnly) { values.push(today); conditions.push(`r.due_date <= $${values.length}`); }
  const result = await executor(`SELECT r.*,lp.id AS levy_payment_id,e.start_date AS expense_start_date,e.end_date AS expense_end_date,
    e.cancelled_on AS expense_cancelled_on,e.cancellation_notice_days AS expense_notice_days,e.status AS expense_status,
    e.interval_value AS expense_interval_value,e.interval_unit AS expense_interval_unit,e.pauses AS expense_pauses
    FROM recurring_expense_runs r JOIN recurring_expenses e ON e.id=r.expense_id AND e.workspace_id=r.workspace_id
    LEFT JOIN levy_payments lp ON lp.recurring_expense_run_id=r.id AND lp.workspace_id=r.workspace_id
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY r.due_date`, values);
  return result.rows.filter(row => row.status !== 'planned' || isRecurringExpenseDue({
    startDate: dateOnly(row.expense_start_date), endDate: dateOnly(row.expense_end_date), cancelledOn: dateOnly(row.expense_cancelled_on),
    noticePeriodDays: Number(row.expense_notice_days), status: row.expense_status, intervalCount: Number(row.expense_interval_value),
    intervalUnit: row.expense_interval_unit, pauses: row.expense_pauses || [],
  }, dateOnly(row.due_date))).map(mapRun);
}

export const expenseCategories = [...expenseCategorySet];
export const levyCategories = [...levyCategorySet];
export const recurrenceUnits = [...units];
export { addDays };
