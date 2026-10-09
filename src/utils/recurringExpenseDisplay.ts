import type { RecurringExpense, RecurringExpenseRun } from '../types/finance';
import { addDays, isRecurringExpenseDue, occurrenceOnOrAfter } from '../../backend/shared/recurrence.js';

export const recurrenceLabels: Record<RecurringExpense['interval'], string> = {
  monthly: 'Monatlich', quarterly: 'Vierteljährlich', half_yearly: 'Halbjährlich', yearly: 'Jährlich', custom: 'Individuell',
};

export function monthlyEquivalent(expense: Pick<RecurringExpense, 'amountGross' | 'interval' | 'intervalCount' | 'intervalUnit'>) {
  const amount = Number(expense.amountGross) || 0;
  switch (expense.interval) {
    case 'monthly': return amount;
    case 'quarterly': return amount / 3;
    case 'half_yearly': return amount / 6;
    case 'yearly': return amount / 12;
    default: return expense.intervalUnit === 'weeks'
      ? amount * 52 / (Number(expense.intervalCount) || 1) / 12
      : amount / (Number(expense.intervalCount) || 1);
  }
}

export function annualEquivalent(expense: Pick<RecurringExpense, 'amountGross' | 'interval' | 'intervalCount' | 'intervalUnit'>) {
  return monthlyEquivalent(expense) * 12;
}

export function currentExpenseAmount(expense: Pick<RecurringExpense, 'amountGross' | 'priceChanges'>, date = new Date().toISOString().slice(0, 10)) {
  return [...(expense.priceChanges || [])]
    .filter(change => change.validFrom <= date)
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom))
    .at(-1)?.amountGross ?? expense.amountGross;
}

export function isExpensePaused(expense: Pick<RecurringExpense, 'pauses'>, date = new Date().toISOString().slice(0, 10)) {
  return expense.pauses.some(pause => pause.from <= date && (!pause.until || pause.until >= date));
}

/** Zeigt den wirksamen Zustand, ohne die gespeicherte Pausenhistorie zu ändern. */
export function currentExpenseStatus(
  expense: Pick<RecurringExpense, 'status' | 'pauses' | 'endDate'>,
  date = new Date().toISOString().slice(0, 10),
): RecurringExpense['status'] {
  if ((expense.endDate && expense.endDate <= date) || (expense.status === 'ended' && !expense.endDate)) return 'ended';
  if (isExpensePaused(expense, date) || (expense.status === 'paused' && !expense.pauses.length)) return 'paused';
  return 'active';
}

export function runStatusLabel(run: Pick<RecurringExpenseRun, 'status'>) {
  return run.status === 'confirmed' ? 'Bezahlt' : run.status === 'skipped' ? 'Übersprungen' : 'Geplant';
}

export function nextDueLabel(date: string | null | undefined, locale = 'de-DE') {
  if (!date) return 'Keine weitere Fälligkeit';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));
}

/** Leitet die nächste offene oder kommende Fälligkeit ohne Änderung am Datensatz ab. */
export function nextRecurringExpenseDueDate(
  expense: RecurringExpense,
  runs: RecurringExpenseRun[],
  fromDate = new Date().toISOString().slice(0, 10),
) {
  const expenseRuns = runs.filter(run => run.expenseId === expense.id);
  const openRuns = expenseRuns
    .filter(run => run.status === 'planned' && isRecurringExpenseDue(expense, run.dueDate))
    .map(run => run.dueDate)
    .sort();
  if (openRuns.length) return openRuns[0];
  if ((expense.status === 'ended' && !expense.endDate) || (expense.status === 'paused' && !expense.pauses.length)) return null;

  const interval = expense.intervalCount || 1;
  const unit = expense.intervalUnit === 'weeks' ? 'week' : 'month';
  let dueDate = occurrenceOnOrAfter(expense.startDate, fromDate, interval, unit);
  const knownRuns = new Set(expenseRuns.map(run => run.dueDate));
  // Geplante/abgeschlossene Termine bleiben sichtbarkeitswirksam: bestätigte und
  // übersprungene Termine werden nicht erneut als nächste Fälligkeit angeboten.
  for (let attempt = 0; attempt < 2400; attempt += 1) {
    if (!isRecurringExpenseDue(expense, dueDate)) {
      if (expense.endDate && dueDate >= expense.endDate) return null;
      if (expense.pauses.some(pause => pause.until === null && pause.from <= dueDate)) return null;
      dueDate = occurrenceOnOrAfter(expense.startDate, addDays(dueDate, 1), interval, unit);
      continue;
    }
    if (!knownRuns.has(dueDate)) return dueDate;
    dueDate = occurrenceOnOrAfter(expense.startDate, addDays(dueDate, 1), interval, unit);
  }
  return null;
}
