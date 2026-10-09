export interface TaxTexts {
  badge: string;
  tooltip(year: number): string;
  activationTitle: string;
  activationBody: string;
  activationCheckbox: string;
  churchTitle: string;
  churchBody: string;
  churchCheckbox: string;
  draftNotice: string;
  termsDraft: string;
  socialNotice: string;
  smallBusinessNotice: string;
  educationNotice: string;
  pensionNotice: string;
  kskNotice: string;
  vatRoughNotice: string;
  missingYearNotice(requestedYear: number, parameterYear: number, asOf: string): string;
  helpTitle: string;
}

export const TAX_TEXTS: Readonly<TaxTexts>;
