export type TaxParameters = {
  year: number;
  version: string;
  asOf: string;
  provenance: string;
  incomeTax: {
    basicAllowance: number;
    zone2End: number;
    zone3End: number;
    zone4End: number;
    zone2Quadratic: number;
    zone2Linear: number;
    zone3Quadratic: number;
    zone3Linear: number;
    zone3Offset: number;
    zone4Rate: number;
    zone4Offset: number;
    zone5Rate: number;
    zone5Offset: number;
    progressionDivisor: number;
    specialExpenseAllowance: number;
    singleParentAllowance: number;
    singleParentExtraChild: number;
    childAllowancePerParent: number;
    childBenefitMonthly: number;
  };
  solidarity: {
    exemptionSingle: number;
    exemptionJoint: number;
    rate: number;
    mitigationRate: number;
  };
  churchTax: {
    reducedRate: number;
    standardRate: number;
    reducedStates: (string)[];
    cappingIncluded: boolean;
  };
  social: {
    referenceMonthly: number;
    referenceAnnual: number;
    healthCapMonthly: number;
    healthCapAnnual: number;
    healthMinimumMonthly: number;
    healthGeneralRate: number;
    healthReducedRate: number;
    averageAdditionalRate: number;
    healthCompulsoryAnnual: number;
    careRate: number;
    careChildlessExtra: number;
    careChildlessAge: number;
    careChildDiscount: number;
    careMaximumDiscountChildren: number;
    careChildAgeLimit: number;
    pensionRate: number;
    pensionCapMonthly: number;
    pensionCapAnnual: number;
    pensionMinimumBaseMonthly: number;
    pensionMinimumMonthly: number;
    pensionStandardMonthly: number;
    pensionHalfMonthly: number;
    pensionMaximumMonthly: number;
    pensionFounderCalendarYears: number;
    craftExemptionContributionYears: number;
    unemploymentMonthly: number;
    unemploymentFounderMonthly: number;
    unemploymentFounderYears: number;
    unemploymentApplicationMonths: number;
    kskMinimumAnnual: number;
    kskFounderYears: number;
    kskHealthMinimumMonthly: number;
    kskInsuredShare: number;
    kskLevyRate: number;
    kskLevyDeMinimis: number;
    kskReportingMonth: number;
    kskReportingDay: number;
  };
  deductions: {
    pensionMaximumSingle: number;
    pensionMaximumJoint: number;
    otherMaximumSelfEmployed: number;
    otherMaximumSubsidised: number;
    healthSickPayDeductionFactor: number;
  };
  tradeTax: {
    allowance: number;
    roundingUnit: number;
    assessmentRate: number;
    minimumMultiplierPercent: number;
    defaultMultiplierPercent: number;
    creditMultiplier: number;
  };
  vat: {
    smallBusinessPreviousLimit: number;
    smallBusinessCurrentLimit: number;
    smallBusinessFounderLimit: number;
    warningRatio: number;
    cashAccountingPreviousLimit: number;
    monthlyAdvanceThreshold: number;
    advanceExemptionThreshold: number;
  };
  chambers: {
    ihkExemptionProfit: number;
    ihkLevyAllowance: number;
    ihkFounderProfitLimit: number;
    ihkFounderExemptYears: number;
    ihkFounderLevyExemptYears: number;
    hwkFounderExemptYears: number;
    hwkFounderReducedYears: number;
    hwkFounderReducedBasicFactor: number;
    hwkFounderProfitLimit: number;
  };
  bookkeeping: {
    revenueLimit: number;
    profitLimit: number;
  };
  advancePayments: {
    incomeTaxDates: ((number)[])[];
    tradeTaxDates: ((number)[])[];
    incomeTaxMinimumAnnual: number;
    incomeTaxMinimumEach: number;
  };
  forecast: {
    defaultBandRatio: number;
    monthsPerYear: number;
  };
  sources: ({
    id: string;
    url: string;
    covers: (string)[];
    status: string;
  })[];
  limitations: (string)[];
};
export interface ResolvedTaxParams { params: TaxParameters; requestedYear: number; parameterYear: number; warning: string | null }
export const TAX_PARAMS_REGISTRY: Readonly<Record<number, TaxParameters>>;
export function resolveTaxParams(year: number): ResolvedTaxParams;
