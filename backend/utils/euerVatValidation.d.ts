export type EuerVatTreatment = 'taxable' | 'exempt' | 'no_vat' | 'reverse_charge_eu' | 'reverse_charge_domestic';

export interface EuerVatFields {
  documentDate: string | null;
  vatTreatment: EuerVatTreatment | null;
  netAmount: number | null;
  vatAmount: number | null;
  inputTaxDeductible: boolean | null;
}

export declare function normalizeEuerVatFields(
  data: Record<string, unknown>,
  entryType: string,
  amount: number,
  taxRate: number | null,
): { values: EuerVatFields; error?: string };
