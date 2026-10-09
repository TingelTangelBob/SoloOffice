import type { ForecastMonth, LevyPayment, TaxResult, ThresholdResult } from '../types/finance';

export interface ReserveRatioDisplay {
  ratio: number | null;
  denominator: number;
}

export function vatReserveLabel(basis: 'calculated' | 'estimate' | 'rough', incompleteEntries: number, remainder = false): string {
  if (basis === 'calculated') return 'Umsatzsteuer, aus deinen erfassten Belegen berechnet';
  if (basis === 'estimate') return `Umsatzsteuer, Schätzung · ${incompleteEntries} Buchungen ohne USt-Angaben`;
  return remainder ? 'Umsatzsteuer-Restbedarf (grob), separat' : 'Umsatzsteuer-Richtwert, separat';
}

export function reserveRatioDisplay(expectedRemainingInflows: number, remainingReserve: number): ReserveRatioDisplay {
  const denominator = Math.max(0, Number(expectedRemainingInflows) || 0);
  const reserve = Math.max(0, Number(remainingReserve) || 0);
  return { ratio: denominator > 0 ? reserve / denominator : null, denominator };
}

/** §35 ist bereits in der Einkommensteuer nach Anrechnung enthalten. GewSt bleibt zusätzlich. */
export function taxBreakdown(taxes: Pick<TaxResult, 'incomeTax' | 'solidarity' | 'churchTax' | 'tradeTax' | 'tradeCredit'>) {
  const incomeTax = Math.max(0, Number(taxes.incomeTax) || 0);
  const solidarity = Math.max(0, Number(taxes.solidarity) || 0);
  const churchTax = Math.max(0, Number(taxes.churchTax) || 0);
  const tradeTax = Math.max(0, Number(taxes.tradeTax) || 0);
  const tradeCredit = Math.max(0, Number(taxes.tradeCredit) || 0);
  return { incomeTax, solidarity, churchTax, tradeTax, tradeCredit, total: incomeTax + solidarity + churchTax + tradeTax };
}

export function fixedCostComparison(selected?: Pick<ForecastMonth, 'fixedCosts'> | null, comparison?: Pick<ForecastMonth, 'fixedCosts'> | null) {
  if (!selected) return null;
  const current = Number(selected.fixedCosts) || 0;
  const previous = comparison ? Number(comparison.fixedCosts) || 0 : null;
  return { current, comparison: previous, difference: previous === null ? null : current - previous };
}

export function previousRevenueDisplay(value: number, known: boolean) {
  return known ? value : null;
}

const statusText = { green: 'Im Richtwert', yellow: 'Nahe am Richtwert', red: 'Oberhalb des Richtwerts' } as const;
export function germanThresholdStatus(status: keyof typeof statusText) {
  return statusText[status];
}

export function thresholdDistance(threshold: Pick<ThresholdResult, 'value' | 'bands'>) {
  const bands = [...threshold.bands].sort((a, b) => a.from - b.from);
  const value = Math.max(0, Number(threshold.value) || 0);
  const active = bands.find(band => value >= band.from && (band.to === null || value < band.to)) ?? bands.at(-1);
  if (!active) return null;
  const next = bands.find(band => band.from > value);
  const boundary = next?.from ?? active.to;
  return {
    activeBand: active,
    nextBoundary: boundary ?? null,
    distance: boundary === null || boundary === undefined ? null : Math.max(0, boundary - value),
    aboveLastBoundary: !next && active.to === null && value >= active.from,
  };
}

export function fixedCostMonthlyComparison(selected?: Pick<ForecastMonth, 'fixedCosts'> | null, comparison?: Pick<ForecastMonth, 'fixedCosts'> | null) {
  return fixedCostComparison(selected, comparison);
}

/** Virtuelle Prognosetermine sind keine bestätigten Fälligkeiten. */
export function isRecordedAdvanceOverdue(payment: Pick<LevyPayment, 'id' | 'dueDate' | 'paidOn'>, today: string): boolean {
  return !payment.id.startsWith('forecast:') && !payment.paidOn && payment.dueDate < today;
}
