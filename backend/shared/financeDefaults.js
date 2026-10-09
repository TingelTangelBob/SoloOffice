import { resolveTaxParams } from './taxParams/index.js';
/** Unausgefüllte Felder bleiben erkennbar; keine Tätigkeit/Pflicht wird abgeleitet. */
export function defaultTaxProfile(year) {
  const { params } = resolveTaxParams(year);
  return {
    year, businessKind: null, startedOn: null, vatStatus: null, educationCertificateUntil: null, previousYearRevenue: null,
    vatAccounting: 'cash', vatPeriod: 'quarterly', assessment: 'single', otherIncomeAnnual: 0, partnerIncomeAnnual: 0,
    otherContributoryIncomeAnnual: 0, state: null, churchTaxLiable: null, churchTaxConsentAt: null,
    children: 0, childrenUnder25: 0, singleParent: false, birthYear: null, healthInsurance: null,
    sickPay: true, additionalHealthRate: Number((params.social.averageAdditionalRate * 100).toFixed(6)),
    privateHealthMonthly: 0, privateCareMonthly: 0, privateHealthBasicMonthly: null,
    healthNoticeMonthly: null, careNoticeMonthly: null, healthNoticeIncomeMonthly: null,
    pensionStatus: 'unclear', pensionMode: 'income', pensionNoticeMonthly: null,
    unemploymentEnabled: false, unemploymentAppliedOn: null, kskIncomeAnnual: null,
    tradeMultiplier: null, chamber: 'none', chamberBasicAnnual: 0, chamberLevyRate: 0, chamberFounderEligible: false,
    incomeTaxAdvanceQuarterly: null, tradeTaxAdvanceQuarterly: null,
    disclaimerAcceptedAt: null, paramsVersion: params.version,
  };
}
