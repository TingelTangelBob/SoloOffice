import type { LevyPayment, RecurringExpense, RecurringExpenseRun } from '../../src/types/finance';
import type { VatPaymentKind } from './vat/index.js';
export function validateDemoLevy(input: Record<string, unknown>, today?: string): string | Omit<LevyPayment, 'id'>;
export function validateDemoVatPayment(input: Record<string, unknown>, profile: { vatPeriod?: 'monthly' | 'quarterly' | 'annual' } | null | undefined, today?: string): string | {
  kind: VatPaymentKind; taxYear: number; periodKey: string | null; paidOn: string | null; dueDate: string | null;
  amount: number; notes: string; source: 'manual' | 'legacy_levy';
};
export function validateDemoExpense(input: Record<string, unknown>, today: string, immutablePriceChanges?: { validFrom: string; amount: number; taxRate: number | null }[]): string | {
  name: string; counterparty: string | null; category: string; scope: 'business' | 'private_levy'; amount: number; taxRate: number | null;
  intervalValue: number; intervalUnit: string; interval: string | null; startDate: string; endDate: string | null; nextDueDate: string;
  cancellationNoticeDays: number; cancelledOn: string | null; status: 'active' | 'paused' | 'ended'; autoConfirm: boolean;
  linkedReceiptId: string | null; notes: string | null; priceChanges: { validFrom: string; amount: number; taxRate: number | null }[];
  pauses: { from: string; until: string | null }[];
};
export function validateDemoTaxProfile(input: unknown, year: number): { valid: boolean; errors: string[]; value: Record<string, unknown> | null };
export function canAccessDemoFinance(input: { enabled: boolean; hasSettingsPermission: boolean }): boolean;
export function demoExpenseDueDates(expense: RecurringExpense, throughDate: string, maxRuns?: number, today?: string): { dates: string[]; nextDueDate: string; processedCount: number };
export function demoNewRunDates(expenseId: string, dueDates: string[], existingRuns: Pick<RecurringExpenseRun, 'expenseId' | 'dueDate'>[]): string[];
export function demoPriceForDate(expense: RecurringExpense, dueDate: string): number;
export function demoRunSnapshot(expense: RecurringExpense, dueDate: string): Record<string, unknown>;
export function demoRunRecord(expense: RecurringExpense, dueDate: string, id: string): RecurringExpenseRun & { snapshot: Record<string, unknown> };
export function demoLevyFromRun(run: RecurringExpenseRun & { snapshot: Record<string, unknown> }, paidOn: string, id: string): LevyPayment;
export function addDays(dateValue: string, days: number): string;
