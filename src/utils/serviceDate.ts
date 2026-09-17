import type { DateFormat } from '../types';
import { formatDate } from './formatters.js';
import { toDateInputValue, type InvoiceDateValue } from './invoicePeriod.js';

/**
 * Rechnung oder Rechnungs-Payload: die Oberfläche hält `Date`, die API liefert
 * ISO-Strings. Beide Formen werden gleich behandelt.
 */
export interface ServiceDateSource {
  issueDate: InvoiceDateValue;
  serviceDate?: InvoiceDateValue;
}

/** Effektives Leistungsdatum als stabiles date-only-Format. */
export function resolveServiceDate(invoice: ServiceDateSource): string {
  return toDateInputValue(invoice.serviceDate) || toDateInputValue(invoice.issueDate);
}

/** True wenn kein abweichendes Leistungsdatum gesetzt ist. */
export function serviceDateMatchesIssueDate(invoice: ServiceDateSource): boolean {
  if (invoice.serviceDate == null) return true;
  const service = toDateInputValue(invoice.serviceDate);
  const issue = toDateInputValue(invoice.issueDate);
  return !service || !issue || service === issue;
}

/** PDF-Metadatenfeld für § 14 Abs. 4 Nr. 6 UStG. */
export function buildServiceDatePdfField(
  invoice: ServiceDateSource,
  locale: string,
  dateFormat?: DateFormat,
): { label: string; value: string } {
  if (serviceDateMatchesIssueDate(invoice)) {
    return { label: 'Leistungsdatum:', value: 'entspricht Rechnungsdatum' };
  }
  return {
    label: 'Leistungsdatum:',
    value: formatDate(resolveServiceDate(invoice), locale, dateFormat),
  };
}
