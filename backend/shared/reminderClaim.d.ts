export type ReminderCustomerType = 'person' | 'organization';
export interface ReminderClaimSettings {
  reminderFeeStage1?: number;
  reminderFeeStage2?: number;
  reminderFeeStage3?: number;
  reminderInterestEnabled?: boolean;
  reminderBaseInterestRate?: number;
}
export interface ReminderPaymentInput { date: string | Date; amount: number }
export interface ReminderClaim {
  stage: number;
  outstanding: number;
  fee: number;
  interestEnabled: boolean;
  interest: number;
  interestDays: number;
  interestRatePercent: number;
  baseRatePercent: number;
  surchargePoints: number;
  total: number;
}
export const REMINDER_DEFAULT_FEES: readonly [number, number, number];
export const DEFAULT_BASE_INTEREST_RATE: number;
export const CONSUMER_SURCHARGE_POINTS: number;
export const BUSINESS_SURCHARGE_POINTS: number;
export function toCalendarDay(value: unknown): string | null;
export function interestSurchargePoints(customerType?: ReminderCustomerType): number;
export function calculateDefaultInterest(input: {
  openAmount?: number;
  invoiceTotal?: number;
  payments?: ReminderPaymentInput[];
  dueDate: string | Date;
  asOfDate: string | Date;
  annualRatePercent: number;
}): { amount: number; days: number };
export function cumulativeReminderFee(settings: ReminderClaimSettings | undefined, stage: number): number;
export function calculateReminderClaim(input: {
  invoice: { total?: number; paidAmount?: number; outstandingAmount?: number; status?: string; dueDate: string | Date };
  stage: number;
  settings: ReminderClaimSettings;
  customerType?: ReminderCustomerType;
  asOfDate: string | Date;
  payments?: ReminderPaymentInput[];
}): ReminderClaim;
export function describeInterest(claim: Pick<ReminderClaim, 'interestDays' | 'interestRatePercent'>): string;
export function normalizeReminderClaim(raw: unknown): ReminderClaim | null;
