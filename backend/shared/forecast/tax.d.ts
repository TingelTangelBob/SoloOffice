import type { TaxParameters } from '../taxParams/index.js';

export type TaxAssessment = 'single' | 'joint';
export interface TaxProfileInput {
  assessment?: TaxAssessment;
  businessKind?: 'teacher' | 'freelance' | 'commercial' | 'craft_a' | 'craft_b' | 'artist' | null;
  otherIncomeAnnual?: number;
  partnerIncomeAnnual?: number;
  children?: number;
  singleParent?: boolean;
  churchTaxLiable?: boolean | null;
  churchTaxConsentAt?: string | null;
  state?: string | null;
  tradeMultiplier?: number | null;
}
export interface SocialTaxInput { deductible?: number | null }
export interface TaxResult {
  taxableIncome: number;
  incomeTaxBeforeCredit: number;
  incomeTax: number;
  solidarity: number;
  churchTax: number;
  tradeTax: number;
  tradeAssessment: number;
  tradeCredit: number;
  total: number;
  marginalRate: number;
  warnings: string[];
}
export function incomeTax(taxableIncome: number, assessment?: TaxAssessment, params?: TaxParameters): number;
export function solidarity(incomeTax: number, assessment: TaxAssessment, params: TaxParameters): number;
export function tradeTax(
  profit: number,
  multiplier: number | null | undefined,
  incomeTax: number,
  commercialIncomeShare: number,
  params: TaxParameters,
): { tradeTax: number; tradeAssessment: number; tradeCredit: number };
export function calculateTaxes(
  profitAnnual: number,
  profile: TaxProfileInput,
  social: SocialTaxInput,
  params: TaxParameters,
): TaxResult;
