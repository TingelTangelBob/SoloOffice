import { addDays, assertDateOnly, isRecurringExpenseDue, nextOccurrence, occurrenceAt } from './recurrence.js';
import { validateExpense } from '../services/recurringExpenses.js';
import { validateTaxProfilePayload } from '../utils/taxProfileValidation.js';

/** Reine Demo-Helfer. Alle Daten bleiben im übergebenen Workspace-Zustand. */
export function validateDemoLevy(input, today = new Date().toISOString().slice(0, 10)) {
  const kinds = new Set(['kv', 'pv', 'rv', 'av', 'ksk', 'est_vz', 'gewst_vz', 'ust']);
  if (!kinds.has(String(input.kind))) return 'Ungültige Abgabenart.';
  if (!['notice', 'manual'].includes(input.source ?? 'manual')) return 'Ungültige Zahlungsquelle.';
  const year = Number(input.year);
  const amount = Number(input.amount);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isFinite(amount) || amount < 0) return 'Jahr oder Betrag ist ungültig.';
  try {
    const period = String(input.period || '');
    let periodStartValue = input.periodStart;
    if (!periodStartValue) {
      const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(period);
      if (match && Number(match[1]) !== year) return 'Jahr und Zeitraum passen nicht zusammen.';
      if (match?.[3]) assertDateOnly(period, 'Zeitraum');
      const month = match?.[2] || (/^(0?[1-9]|1[0-2])$/.test(period) ? period.padStart(2, '0') : null);
      if (!month) return 'Der Zeitraum muss als Monat im Format JJJJ-MM angegeben werden.';
      periodStartValue = `${year}-${month}-01`;
    }
    const periodStart = assertDateOnly(String(periodStartValue), 'Zeitraum');
    const periodEnd = input.periodEnd ? assertDateOnly(String(input.periodEnd), 'Zeitraumende') : null;
    const dueDate = input.dueDate ? assertDateOnly(input.dueDate, 'Fälligkeit') : null;
    const paidOn = input.paidOn ? assertDateOnly(input.paidOn, 'Zahlungsdatum') : null;
    if (periodEnd && periodEnd < periodStart) return 'Das Zeitraumende darf nicht vor dem Beginn liegen.';
    if (paidOn && paidOn > assertDateOnly(today, 'Heutiges Datum')) return 'Ein zukünftiges Zahlungsdatum kann nicht als erfolgte Zahlung bestätigt werden.';
    if (Number(periodStart.slice(0, 4)) !== year) return 'Jahr und Zeitraum passen nicht zusammen.';
    return { kind: input.kind, year, period: periodStart.slice(0, 7), dueDate, paidOn, amount,
      source: input.source || 'manual', expenseRunId: null, notes: String(input.notes || '').trim() };
  } catch (error) { return error.message; }
}

export function validateDemoExpense(input, today, immutablePriceChanges = []) {
  return validateExpense({ ...input, immutablePriceChanges }, today);
}

export function validateDemoTaxProfile(input, year) {
  return validateTaxProfilePayload(input, year);
}

export function canAccessDemoFinance({ enabled, hasSettingsPermission }) {
  return enabled === true && hasSettingsPermission === true;
}

export function demoExpenseDueDates(expense, throughDate, maxRuns = 2000, today = new Date().toISOString().slice(0, 10)) {
  const through = assertDateOnly(throughDate, 'Stichtag');
  const todayDate = assertDateOnly(today, 'Heutiges Datum');
  if (through > occurrenceAt(todayDate, 2, 1, 'year')) throw new TypeError('Der Vorschauzeitraum darf höchstens zwei Jahre umfassen.');
  let due = assertDateOnly(expense.nextDueDate || expense.startDate, 'Nächste Fälligkeit');
  const endDate = expense.endDate ? assertDateOnly(expense.endDate, 'Enddatum') : null;
  const interval = Number(expense.intervalCount || 1);
  const unit = expense.intervalUnit === 'weeks' ? 'week' : 'month';
  const dates = [];
  let count = 0;
  while (due <= through && (!endDate || due < endDate)) {
    if (++count > maxRuns) throw new TypeError('Zu viele Fälligkeiten für einen einzelnen Generierungslauf.');
    if (isRecurringExpenseDue(expense, due)) dates.push(due);
    due = nextOccurrence(expense.startDate, due, interval, unit);
  }
  return { dates, nextDueDate: due, processedCount: count };
}

export function demoNewRunDates(expenseId, dueDates, existingRuns) {
  const existing = new Set(existingRuns.filter(run => run.expenseId === expenseId).map(run => run.dueDate));
  return dueDates.filter(dueDate => !existing.has(dueDate));
}

export function demoPriceForDate(expense, dueDate) {
  const changes = [...(expense.priceChanges || [])].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  let amountGross = Number(expense.amountGross || 0);
  for (const change of changes) if (change.validFrom <= dueDate) amountGross = Number(change.amountGross);
  return amountGross;
}

export function demoRunSnapshot(expense, dueDate) {
  return { name: expense.name, counterparty: expense.counterparty || null, category: expense.category,
    scope: expense.scope, amount: demoPriceForDate(expense, dueDate), taxRate: expense.taxRate,
    notes: expense.notes || null, linkedReceiptId: expense.linkedReceiptId || null };
}

export function demoRunRecord(expense, dueDate, id) {
  const snapshot = demoRunSnapshot(expense, dueDate);
  return { id, expenseId: expense.id, dueDate, amountGross: snapshot.amount, status: 'planned', paidOn: null,
    euerEntryId: null, levyPaymentId: null, name: snapshot.name, scope: snapshot.scope, snapshot };
}

export function demoLevyFromRun(run, paidOn, id) {
  const date = assertDateOnly(paidOn, 'Zahlungsdatum');
  return { id, kind: run.snapshot.category, year: Number(run.dueDate.slice(0, 4)), period: run.dueDate.slice(0, 7),
    dueDate: run.dueDate, paidOn: date, amount: run.snapshot.amount, source: 'recurring_expense', expenseRunId: run.id,
    notes: run.snapshot.name };
}

export { addDays };
