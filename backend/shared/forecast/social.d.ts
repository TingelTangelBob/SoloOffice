import type { TaxParameters } from '../taxParams/index.js';

export interface SocialProfile {
  year?: number;
  startedOn: string | null;
  assessment: 'single' | 'joint';
  otherContributoryIncomeAnnual: number;
  birthYear: number | null;
  children: number;
  childrenUnder25: number;
  healthInsurance: 'gkv_voluntary' | 'gkv_ksk' | 'pkv' | 'family' | null;
  sickPay: boolean;
  additionalHealthRate: number;
  privateHealthMonthly: number;
  privateCareMonthly: number;
  privateHealthBasicMonthly: number | null;
  healthNoticeMonthly: number | null;
  careNoticeMonthly: number | null;
  pensionStatus: 'teacher' | 'craft' | 'single_client' | 'ksk' | 'voluntary' | 'none' | 'exempt' | 'unclear';
  pensionMode: 'standard' | 'half' | 'income' | 'minimum' | 'notice';
  pensionNoticeMonthly: number | null;
  unemploymentEnabled: boolean;
  unemploymentAppliedOn: string | null;
  kskIncomeAnnual: number | null;
  chamber: 'none' | 'ihk' | 'hwk';
  chamberBasicAnnual: number;
  chamberLevyRate: number;
  chamberFounderEligible: boolean;
}

export type SocialParameters = TaxParameters;

export interface SocialResult {
  health: number;
  care: number;
  pension: number;
  unemployment: number;
  total: number;
  deductible: number;
  healthAssessmentMonthly: number;
  /** null when a GKV/PV notice is missing and the delta cannot be estimated. */
  healthBackpaymentRisk: number | null;
  warnings: string[];
}

export interface ChamberContributionResult { annual: number; warnings: string[] }
export function calculateSocial(profitAnnual: number, profile: SocialProfile, params: SocialParameters): SocialResult;
export function chamberContribution(profitAnnual: number, profile: SocialProfile, params: SocialParameters): ChamberContributionResult;
