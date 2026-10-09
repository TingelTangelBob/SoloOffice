import type { MoneyItem } from '../../utils/documentMoney.js';
import type { VatPeriodType } from './periods.js';

export * from './periods.js';

/**
 * Umsatzsteuer-Behandlung einer EÜR-Buchung.
 * - taxable: Umsatz/Eingangsleistung mit ausgewiesener USt (taxRate, netAmount, vatAmount; amount = net + vat)
 * - exempt: steuerfreier Umsatz (Einnahme → Kz 48, § 4 Nr. 8–29 UStG); bei Ausgaben wie no_vat
 * - no_vat: keine USt (nicht steuerbar, Kleinunternehmer-Lieferant, steuerfreie Eingangsleistung, Gebühren)
 * - reverse_charge_eu: § 13b Abs. 1 UStG (sonstige Leistung EU-Unternehmer) → Kz 46/47, Vorsteuer Kz 67; nur Ausgaben
 * - reverse_charge_domestic: § 13b Abs. 2 UStG (z. B. Bauleistungen, ausländische Werklieferung) → Kz 84/85, Vorsteuer Kz 67; nur Ausgaben
 * Bei Reverse Charge ist amount = netAmount (gezahlter Betrag), vatAmount = geschuldete USt (net × taxRate).
 */
export type VatTreatment = 'taxable' | 'exempt' | 'no_vat' | 'reverse_charge_eu' | 'reverse_charge_domestic';
export type VatPaymentKind = 'advance' | 'special_prepayment' | 'annual_payment' | 'refund';
export type VatStatus = 'small_business' | 'regular' | 'education_exempt';
export type VatAccounting = 'cash' | 'accrual';

export interface VatProfileInput {
  year?: number;
  vatStatus: VatStatus | null;
  /** null → Standard: Ist bei teacher/freelance/artist, sonst Soll (accountingSource = 'default'). */
  vatAccounting: VatAccounting | null;
  vatPeriod: VatPeriodType;
  vatPermanentExtension?: boolean;
  /** Festgesetzte/angemeldete Sondervorauszahlung; null → 1/11 der Vorjahres-Vorauszahlungen, falls bekannt. */
  vatSpecialPrepayment?: number | null;
  previousYearVatLiability?: number | null;
  businessKind?: string | null;
  educationCertificateUntil?: string | null;
  startedOn?: string | null;
}

export interface VatInvoiceInput {
  id: string;
  invoiceNumber: string;
  documentType: 'invoice' | 'credit_note';
  status: string;
  issueDate: string | Date;
  serviceDate?: string | Date | null;
  total: number;
  taxAmount: number;
  items: MoneyItem[];
  globalDiscountType?: 'percentage' | 'fixed' | null;
  globalDiscountValue?: number | null;
  globalDiscountAmount?: number | null;
  referenceInvoiceId?: string | null;
}

export interface VatEntryInput {
  id: string;
  entryType: 'income' | 'expense';
  /** Zahlungsdatum = Zu-/Abfluss (§ 11 EStG). */
  entryDate: string | Date;
  /** Rechnungs-/Belegdatum, falls abweichend vom Zahlungsdatum (Vorsteuer- und Soll-Zeitpunkt). */
  documentDate?: string | Date | null;
  description?: string;
  category: string;
  amount: number;
  taxRate: number | null;
  vatTreatment: VatTreatment | null;
  netAmount: number | null;
  vatAmount: number | null;
  inputTaxDeductible: boolean | null;
  sourceType?: string;
  sourceId?: string | null;
  status?: 'active' | 'voided';
  euerYear?: number | null;
}

export interface VatPaymentInput {
  id: string;
  kind: VatPaymentKind;
  taxYear: number;
  periodKey: string | null;
  dueDate?: string | Date | null;
  paidOn: string | Date | null;
  amount: number;
  euerEntryId?: string | null;
  source?: 'manual' | 'legacy_levy';
  notes?: string | null;
}

export interface VatComputationInput {
  year: number;
  profile: VatProfileInput;
  invoices?: VatInvoiceInput[];
  entries?: VatEntryInput[];
  payments?: VatPaymentInput[];
  /** Summe der Vorauszahlungen (Kz 83 vor Kz 39) des Vorjahres, falls aus Daten bekannt. */
  previousYearAdvanceTotal?: number | null;
  now?: Date | string;
}

export interface VatKennzahlen {
  kz81: number; kz86: number; kz87: number; kz35: number; kz36: number; kz48: number;
  kz46: number; kz47: number; kz84: number; kz85: number;
  kz66: number; kz67: number; kz39: number;
  /** Steuer auf Kz 81 bzw. Kz 86 (Summe der erfassten Steuerbeträge, centgenau). */
  tax19: number; tax7: number;
  /** Verbleibende Vorauszahlung (+) bzw. Überschuss (−). */
  kz83: number;
}

export interface VatLineItem {
  sourceType: 'invoice' | 'credit_note' | 'invoice_payment' | 'euer_income' | 'euer_expense';
  sourceId: string;
  label: string;
  date: string;
  rate: number | null;
  net: number;
  tax: number;
  kennzahl: string;
  deductible?: boolean;
  /** true, wenn der Wert nur aus einem Vorschlag (vorhandener Steuersatz) stammt. */
  estimated?: boolean;
}

export type VatPaymentStatus = 'not_due' | 'open' | 'partial' | 'paid' | 'overpaid' | 'refund_open' | 'settled' | 'none';

export interface VatPeriodResult {
  key: string;
  label: string;
  type: VatPeriodType;
  start: string;
  end: string;
  statutoryDueDate: string | null;
  dueDate: string | null;
  state: 'future' | 'running' | 'closed';
  kennzahlen: VatKennzahlen;
  outputTax: number;
  reverseChargeTax: number;
  inputTax: number;
  liability: number;
  /** Zahllast inklusive Vorschlagswerten für unvollständige Buchungen (= liability, wenn complete). */
  estimatedLiability: number;
  paid: number;
  refunded: number;
  balance: number;
  paymentStatus: VatPaymentStatus;
  overdue: boolean;
  complete: boolean;
  incompleteEntryIds: string[];
  legacyInvoiceIds: string[];
  items: VatLineItem[];
  paymentIds: string[];
}

export interface VatMonthResult {
  month: string;
  outputTax: number;
  inputTax: number;
  liability: number;
  estimatedLiability: number;
  complete: boolean;
  incompleteCount: number;
}

export interface VatSuggestion {
  entryId: string;
  vatTreatment: 'taxable';
  taxRate: number;
  netAmount: number;
  vatAmount: number;
  inputTaxDeductible: boolean | null;
}

export interface VatEuerPaymentAttribution {
  paymentId: string;
  kind: VatPaymentKind;
  paidOn: string;
  amount: number;
  euerYear: number;
  tenDayRule: boolean;
  reason: string | null;
  booked: boolean;
}

export interface VatEuerAttribution {
  year: number;
  smallBusinessIncome: number;
  exemptIncome: number;
  taxableIncomeNet: number;
  vatCollected: number;
  vatRefunded: number;
  inputTaxPaid: number;
  vatPaidToOffice: number;
  /** Bruttomethode minus Nettomethode im Jahr (reine Zeitverschiebung über einen vollständigen Zyklus). */
  grossMinusNetEffect: number;
  payments: VatEuerPaymentAttribution[];
  unbookedPaymentIds: string[];
}

export interface VatComputationResult {
  year: number;
  applicable: boolean;
  vatStatus: VatStatus | null;
  accounting: VatAccounting;
  accountingSource: 'profile' | 'default';
  periodType: VatPeriodType;
  permanentExtension: boolean;
  parameterYear: number;
  paramsVersion: string;
  paramsAsOf: string;
  periods: VatPeriodResult[];
  months: VatMonthResult[];
  annual: {
    kennzahlen: VatKennzahlen;
    liability: number;
    estimatedLiability: number;
    paid: number;
    refunded: number;
    balance: number;
    specialPrepayment: { amount: number | null; source: 'profile' | 'previous_year' | 'missing' | 'not_applicable'; dueDate: string | null; paid: number };
  };
  completeness: {
    complete: boolean;
    incompleteEntries: number;
    incompleteEntryIds: string[];
    suggestions: VatSuggestion[];
    legacyPaidInvoices: number;
    zeroRatedUnclassified: number;
  };
  euer: VatEuerAttribution;
  nextDue: { periodKey: string; label: string; dueDate: string; amount: number; estimated: boolean } | null;
  warnings: string[];
  limitations: string[];
}

export declare const VAT_TREATMENTS: readonly VatTreatment[];
export declare const VAT_PAYMENT_KINDS: readonly VatPaymentKind[];
export declare function resolveVatAccounting(profile: Pick<VatProfileInput, 'vatAccounting' | 'businessKind'>): { accounting: VatAccounting; source: 'profile' | 'default' };
/** Vorschlag aus einem vorhandenen Bruttobetrag und Satz (Altbestand); null bei Satz 0/unbekannt. */
export declare function suggestVatFromRate(entry: Pick<VatEntryInput, 'id' | 'amount' | 'taxRate' | 'entryType'>, profile?: Pick<VatProfileInput, 'vatStatus'>): VatSuggestion | null;
/** Netto/USt aus Brutto bzw. Brutto/USt aus Netto, centgenau (kaufmännisch gerundet). */
export declare function splitGross(gross: number, rate: number): { netAmount: number; vatAmount: number };
export declare function fromNet(net: number, rate: number): { grossAmount: number; vatAmount: number };
/** Prüft eine Buchung auf vollständige USt-Angaben in Abhängigkeit vom USt-Status. */
export declare function isVatEntryComplete(entry: VatEntryInput, profile: Pick<VatProfileInput, 'vatStatus'>): boolean;
export declare function computeVat(input: VatComputationInput): VatComputationResult;
