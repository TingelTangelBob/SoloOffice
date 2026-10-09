import type { TaxParameters } from '../taxParams/index.js';

export type VatPeriodType = 'monthly' | 'quarterly' | 'annual';
export interface VatPeriod { key: string; type: VatPeriodType; year: number; label: string; start: string; end: string }
export interface VatAttribution { year: number; tenDayRule: boolean; reason: string | null }

export declare const VAT_PERIOD_TYPES: readonly VatPeriodType[];
export declare const VAT_PERIOD_KEY: RegExp;
export declare function vatPeriods(year: number, type: VatPeriodType): VatPeriod[];
export declare function parseVatPeriodKey(key: string | null | undefined): VatPeriod | null;
export declare function vatPeriodKeyFor(date: string | Date, type: VatPeriodType): string;
export declare function nationwideHolidays(year: number): Set<string>;
export declare function shiftToBusinessDay(date: string | Date): string;
export declare function statutoryDueDate(period: VatPeriod | string, options?: { permanentExtension?: boolean; params?: TaxParameters }): string | null;
export declare function paymentDueDate(period: VatPeriod | string, options?: { permanentExtension?: boolean; params?: TaxParameters }): string | null;
export declare function specialPrepaymentDueDate(year: number, params?: TaxParameters): string;
export declare function euerAttributionYear(
  payment: { kind: 'advance' | 'special_prepayment' | 'annual_payment' | 'refund'; periodKey?: string | null; paidOn: string | Date },
  options?: { permanentExtension?: boolean; params?: TaxParameters },
): VatAttribution;
