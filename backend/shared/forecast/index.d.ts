import type { ForecastResult, TaxProfile, RecurringExpense, RecurringExpenseRun, LevyPayment } from '../../../src/types/finance.js';
import type { VatComputationResult } from '../vat/index.js';
export interface ForecastEntry { entryType: 'income' | 'expense'; entryDate: string | Date; amount: number; taxRate?: number; sourceType?: string; status?: string; description?: string; category?: string }
export function buildForecast(input: { year: number; profile?: Partial<TaxProfile> & Record<string, unknown>; entries?: ForecastEntry[]; expenses?: RecurringExpense[]; runs?: RecurringExpenseRun[]; levyPayments?: LevyPayment[]; previousEntries?: ForecastEntry[]; vat?: VatComputationResult | null; now?: Date | string }): ForecastResult;
