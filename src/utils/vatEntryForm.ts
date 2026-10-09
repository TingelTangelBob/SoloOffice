import type { EuerEntry, EuerEntryPayload, EuerEntryType, EuerVatFields, EuerVatTreatment } from '../types';
import { resolveTaxParams } from '../../backend/shared/taxParams/index.js';

export type VatRateOption = number | 'other';

const toCents = (value: number) => Math.round((value + Number.EPSILON) * 100);
const fromCents = (value: number) => value / 100;
const round2 = (value: number) => fromCents(toCents(value));

/** Teilt einen Bruttobetrag centgenau in Netto und Umsatzsteuer. */
export function splitGrossAmount(grossAmount: number, taxRate: number) {
  if (!Number.isFinite(grossAmount) || !Number.isFinite(taxRate) || taxRate < 0) return null;
  const grossCents = toCents(grossAmount);
  const netCents = Math.round(grossCents / (1 + taxRate / 100));
  return { netAmount: fromCents(netCents), vatAmount: fromCents(grossCents - netCents) };
}

/** Berechnet Brutto aus Netto; Rundung erfolgt auf ganze Cent. */
export function grossFromNetAmount(netAmount: number, taxRate: number) {
  if (!Number.isFinite(netAmount) || !Number.isFinite(taxRate) || taxRate < 0) return null;
  const netCents = toCents(netAmount);
  const grossCents = Math.round(netCents * (1 + taxRate / 100));
  return { grossAmount: fromCents(grossCents), vatAmount: fromCents(grossCents - netCents), netAmount: fromCents(netCents) };
}

/** Reverse Charge: gezahlter Betrag ist Netto, die Steuer wird separat berechnet. */
export function reverseChargeAmounts(netAmount: number, taxRate: number) {
  if (!Number.isFinite(netAmount) || !Number.isFinite(taxRate) || taxRate < 0) return null;
  const netCents = toCents(netAmount);
  const vatCents = Math.round(netCents * taxRate / 100);
  return { amount: fromCents(netCents), netAmount: fromCents(netCents), vatAmount: fromCents(vatCents) };
}

export function validateVatAmounts(
  entry: Pick<EuerEntryPayload, 'entryType' | 'amount' | 'vatTreatment' | 'netAmount' | 'vatAmount'>,
): string | null {
  const treatment = entry.vatTreatment;
  if (treatment === 'taxable') {
    if (entry.netAmount == null || entry.vatAmount == null) return 'Bitte Netto- und USt-Betrag angeben.';
    if (Math.abs(toCents(entry.netAmount) + toCents(entry.vatAmount) - toCents(entry.amount)) > 1) return 'Netto und USt müssen zusammen dem Bruttobetrag entsprechen.';
  }
  if (treatment === 'reverse_charge_eu' || treatment === 'reverse_charge_domestic') {
    if (entry.entryType !== 'expense') return 'Reverse Charge kann hier nur bei Ausgaben gewählt werden.';
    if (entry.netAmount == null || entry.vatAmount == null || Math.abs(toCents(entry.netAmount) - toCents(entry.amount)) > 1 || entry.vatAmount < 0) return 'Bei Reverse Charge muss Netto dem Betrag entsprechen.';
  }
  if ((treatment === 'exempt' || treatment === 'no_vat') && entry.vatAmount != null && Math.abs(entry.vatAmount) > 0.01) return 'Bei dieser Behandlung muss der USt-Betrag 0 sein.';
  return null;
}

/** Altbestände werden nur als unverbindlicher, vom Nutzer zu bestätigender Vorschlag vorbelegt. */
export function suggestVatFromLegacy(entry: Pick<EuerEntry, 'entryType' | 'amount' | 'taxRate' | 'vatTreatment' | 'inputTaxDeductible'>): EuerVatFields | null {
  const rate = Number(entry.taxRate);
  if (entry.vatTreatment || !Number.isFinite(rate) || rate <= 0) return null;
  const split = splitGrossAmount(Number(entry.amount), rate);
  if (!split) return null;
  return { vatTreatment: 'taxable', netAmount: split.netAmount, vatAmount: split.vatAmount, inputTaxDeductible: entry.entryType === 'expense' ? entry.inputTaxDeductible ?? true : null };
}

/** Altbestand mit Steuersatz 0 bleibt ohne Behandlung unvollständig. */
export function needsVatData(entry: Pick<EuerEntry, 'entryType' | 'sourceType' | 'vatTreatment' | 'inputTaxDeductible'>, isSmallBusiness: boolean): boolean {
  if (isSmallBusiness || entry.sourceType === 'invoice_payment' || entry.sourceType === 'vat_payment') return false;
  if (!entry.vatTreatment) return true;
  return entry.entryType === 'expense'
    && ['taxable', 'reverse_charge_eu', 'reverse_charge_domestic'].includes(entry.vatTreatment)
    && entry.inputTaxDeductible == null;
}

export function rateFromTreatment(treatment: EuerVatTreatment | null | undefined, rate: number) {
  return treatment === 'no_vat' || treatment === 'exempt' ? 0 : round2(rate);
}

export function suggestedTreatmentForRate(rate: number): EuerVatTreatment {
  return rate > 0 ? 'taxable' : 'no_vat';
}

export function isReverseCharge(treatment: EuerVatTreatment | null | undefined) {
  return treatment === 'reverse_charge_eu' || treatment === 'reverse_charge_domestic';
}

export function vatRateOptions(year: number) {
  const vat = resolveTaxParams(year).params.vat;
  return [vat.standardRate, vat.reducedRate, vat.zeroRate];
}

export function defaultVatRate(value: number, year: number): VatRateOption {
  return vatRateOptions(year).includes(value) ? value : 'other';
}

export type VatEntryFormType = EuerEntryType;
