/** Gemeinsame API-Verträge, WP0. Beträge in Euro, Sätze im Profil in Prozent. */
export type BusinessKind = 'teacher' | 'freelance' | 'commercial' | 'craft_a' | 'craft_b' | 'artist';
export type LevyKind = 'kv' | 'pv' | 'rv' | 'av' | 'ksk' | 'est_vz' | 'gewst_vz' | 'ust';
export interface TaxProfile {
  id?: string; year: number; businessKind: BusinessKind | null; startedOn: string | null;
  vatStatus: 'small_business' | 'regular' | 'education_exempt' | null;
  educationCertificateUntil: string | null; previousYearRevenue: number | null;
  vatAccounting: 'cash' | 'accrual'; vatPeriod: 'monthly' | 'quarterly' | 'annual';
  assessment: 'single' | 'joint'; otherIncomeAnnual: number; partnerIncomeAnnual: number;
  otherContributoryIncomeAnnual: number; state: string | null;
  churchTaxLiable: boolean | null; churchTaxConsentAt: string | null;
  children: number; childrenUnder25: number; singleParent: boolean; birthYear: number | null;
  healthInsurance: 'gkv_voluntary' | 'gkv_ksk' | 'pkv' | 'family' | null;
  sickPay: boolean; additionalHealthRate: number; privateHealthMonthly: number; privateCareMonthly: number;
  privateHealthBasicMonthly: number | null; healthNoticeMonthly: number | null; careNoticeMonthly: number | null;
  healthNoticeIncomeMonthly: number | null;
  pensionStatus: 'teacher' | 'craft' | 'single_client' | 'ksk' | 'voluntary' | 'none' | 'exempt' | 'unclear';
  pensionMode: 'standard' | 'half' | 'income' | 'minimum' | 'notice'; pensionNoticeMonthly: number | null;
  unemploymentEnabled: boolean; unemploymentAppliedOn: string | null; kskIncomeAnnual: number | null;
  tradeMultiplier: number | null; chamber: 'none' | 'ihk' | 'hwk'; chamberBasicAnnual: number;
  chamberLevyRate: number; chamberFounderEligible: boolean;
  incomeTaxAdvanceQuarterly: number | null; tradeTaxAdvanceQuarterly: number | null;
  disclaimerAcceptedAt: string | null; paramsVersion: string; updatedAt?: string;
}
export type TaxProfilePayload = Omit<TaxProfile, 'id' | 'disclaimerAcceptedAt' | 'churchTaxConsentAt' | 'updatedAt' | 'paramsVersion'>;
export interface PriceChange { id?: string; validFrom: string; amountGross: number }
export interface ExpensePause { from: string; until: string | null }
export interface RecurringExpense {
  id: string; name: string; counterparty: string; category: string; amountGross: number; taxRate: number | null;
  interval: 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'custom'; intervalCount: number;
  intervalUnit: 'months' | 'weeks'; startDate: string; endDate: string | null;
  noticePeriodDays: number; cancelledOn: string | null; status: 'active' | 'paused' | 'ended';
  pauses: ExpensePause[]; priceChanges: PriceChange[]; automaticBooking: boolean;
  scope: 'business' | 'private_levy'; levyKind: LevyKind | null; linkedReceiptId: string | null; notes: string;
  nextDueDate?: string | null; createdAt?: string; updatedAt?: string;
}
export type RecurringExpensePayload = Omit<RecurringExpense, 'id' | 'createdAt' | 'updatedAt' | 'nextDueDate'>;
export interface RecurringExpenseRun {
  id: string; expenseId: string; dueDate: string; amountGross: number; status: 'planned' | 'confirmed' | 'skipped';
  paidOn: string | null; euerEntryId: string | null; levyPaymentId: string | null; name?: string; scope?: 'business' | 'private_levy';
}
export interface LevyPayment {
  id: string; kind: LevyKind; year: number; period: string; dueDate: string; paidOn: string | null;
  amount: number; source: 'notice' | 'manual' | 'recurring_expense'; expenseRunId: string | null; notes: string;
}
export type LevyPaymentPayload = Omit<LevyPayment, 'id' | 'expenseRunId'>;
export interface ThresholdBand { id: string; label: string; from: number; to: number | null; rate?: number; tone: 'neutral' | 'success' | 'warning' | 'danger' }
export interface ThresholdResult { id: 'est' | 'kv' | 'rv' | 'small_business' | 'trade' | 'ksk' | 'ihk' | 'bookkeeping_revenue' | 'bookkeeping_profit'; label: string; value: number; bands: ThresholdBand[]; message: string; marginalRate?: number }
export interface ChartSeries { id: 'fixed_costs' | 'social' | 'tax_reserve' | 'vat_reserve' | 'available' | 'paid_levies' | `expense:${string}`; label: string; points: { label: string; value: number; forecast: boolean }[]; kind: 'bar' | 'line'; tooltip: string }
export interface SocialResult { health: number; care: number; pension: number; unemployment: number; total: number; deductible: number; healthAssessmentMonthly: number; healthBackpaymentRisk: number | null; warnings: string[] }
export interface TaxResult { taxableIncome: number; incomeTaxBeforeCredit: number; incomeTax: number; solidarity: number; churchTax: number; tradeTax: number; tradeAssessment: number; tradeCredit: number; total: number; marginalRate: number; warnings: string[] }
export interface ForecastMonth {
  month: string; revenue: number; expenses: number; fixedCosts: number; social: number;
  taxReserve: number; vatReserve: number; available: number; forecast: boolean;
}
export interface ForecastResult {
  year: number; parameterYear: number; paramsVersion: string; paramsAsOf: string; generatedAt: string;
  profileComplete: boolean; missingFields: string[]; warnings: string[]; method: 'linear' | 'seasonal';
  profitYtd: number; profitAnnual: number; profitBand: { low: number; high: number }; revenueYtd: number; revenueAnnual: number;
  social: SocialResult; taxes: TaxResult; annualBurden: number; paidLevies: number; paidUst: number; remainingReserve: number;
  reserveRatio: number; expectedRemainingInflows: number; vatStatus: TaxProfile['vatStatus'];
  previousYearRevenueKnown: boolean; paidNonVatLevies: number;
  paidAdvances: { est_vz: number; gewst_vz: number; ust: number };
  paidAdvanceMonths: { month: string; est_vz: number; gewst_vz: number; ust: number }[];
  dueExpenses: RecurringExpenseRun[];
  expenseNotices: { id: string; name: string; noticePeriodDays: number; endDate: string | null; noticeDeadline: string | null }[];
  combinedMarginalRate: number; vatReserveGrossEstimate: number; vatRemainingReserve: number;
  thresholds: ThresholdResult[]; smallBusiness: { previous: 'green' | 'yellow' | 'red'; current: 'green' | 'yellow' | 'red'; previousValue: number; currentValue: number; currentLimit: number; forecastValue: number };
  series: ChartSeries[]; upcomingLevies: LevyPayment[]; upcomingExpenses: RecurringExpenseRun[];
  fixedCostsMonthly: number; fixedCostsAnnual: number; calculationSteps: { label: string; amount: number }[];
  monthly: ForecastMonth[];
}
export interface ExtensionDefinition { id: string; label: string; description: string; requiredPlan: 'free' | 'pro'; legacyCompanyField?: string }
export interface WorkspaceExtension extends ExtensionDefinition { enabled: boolean; available: boolean; acceptedAt: string | null }
