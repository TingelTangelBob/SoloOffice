/** Umsatzsteuer/Vorsteuer (Phase 3). Rechenvertrag: backend/shared/vat/index.d.ts. */
import type { VatComputationResult, VatPaymentKind } from '../../backend/shared/vat/index.js';

export type {
  VatTreatment, VatPaymentKind, VatStatus, VatAccounting, VatKennzahlen, VatLineItem, VatPaymentStatus,
  VatPeriodResult, VatMonthResult, VatSuggestion, VatEuerAttribution, VatEuerPaymentAttribution, VatComputationResult,
} from '../../backend/shared/vat/index.js';
export type { VatPeriodType, VatPeriod } from '../../backend/shared/vat/periods.js';

/** Gespeicherte USt-Zahlung/-Erstattung (Tabelle `vat_payments`). */
export interface VatPayment {
  id: string;
  kind: VatPaymentKind;
  taxYear: number;
  /** `2026-03`, `2026-Q1`, `2026` oder null (Sondervorauszahlung, Altbestand ohne Zeitraum). */
  periodKey: string | null;
  dueDate: string | null;
  paidOn: string | null;
  amount: number;
  euerEntryId: string | null;
  /** EÜR-Jahr nach § 11 EStG, falls abweichend vom Zahlungsjahr (10-Tage-Regel). */
  euerYear: number | null;
  source: 'manual' | 'legacy_levy';
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface VatPaymentPayload {
  kind: VatPaymentKind;
  taxYear: number;
  periodKey: string | null;
  dueDate?: string | null;
  paidOn: string | null;
  amount: number;
  notes?: string | null;
}

/** Antwort von `GET /api/vat/:year`. */
export interface VatOverview extends VatComputationResult {
  payments: VatPayment[];
}
