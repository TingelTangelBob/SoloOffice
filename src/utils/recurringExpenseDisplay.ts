import type { RecurringExpense, RecurringExpenseRun } from '../types/finance';

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

export function runStatusLabel(run: Pick<RecurringExpenseRun, 'status'>) {
  return run.status === 'confirmed' ? 'Bezahlt' : run.status === 'skipped' ? 'Übersprungen' : 'Geplant';
}

export function nextDueLabel(date: string | null | undefined, locale = 'de-DE') {
  if (!date) return 'Keine weitere Fälligkeit';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));
}
