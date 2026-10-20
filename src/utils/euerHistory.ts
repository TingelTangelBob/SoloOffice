import type { EuerEntry, EuerEntryHistory } from '../types';

/** Stornierte Zeilen sind Nachweise, keine wirksamen Buchungen. */
export const isActiveEuerEntry = (entry: Pick<EuerEntry, 'status'>) => entry.status !== 'voided';

const historyFields = [
  ['entryType', 'Art'], ['entryDate', 'Zahlungsdatum'], ['description', 'Beschreibung'],
  ['category', 'Kategorie'], ['amount', 'Bruttobetrag'], ['taxRate', 'USt-Satz'],
  ['documentDate', 'Belegdatum'], ['vatTreatment', 'USt-Behandlung'],
  ['netAmount', 'Nettobetrag'], ['vatAmount', 'USt-Betrag'],
  ['inputTaxDeductible', 'Vorsteuer abziehbar'], ['notes', 'Notiz / Beleghinweis'],
  ['sourceType', 'Buchungsart'], ['sourceId', 'Zuordnung'], ['customerId', 'Kunde'],
  ['externalReference', 'Externe Referenz'], ['euerYear', 'EÜR-Jahr'],
  ['status', 'Status'], ['correctionReason', 'Korrekturgrund'],
] as const;

const valueLabels: Record<string, string> = {
  active: 'Aktiv', voided: 'Storniert', income: 'Einnahme', expense: 'Ausgabe',
  manual: 'Manuelle Buchung', invoice_payment: 'Rechnungszahlung', receipt: 'Beleg',
  correction: 'Korrektur / Gegenbuchung', recurring_expense: 'Fixkosten', vat_payment: 'Umsatzsteuer',
  taxable: 'Mit USt', exempt: 'Steuerfrei', no_vat: 'Ohne USt',
  reverse_charge_eu: 'Reverse Charge EU', reverse_charge_domestic: 'Reverse Charge Inland',
};

type HistoryFormatters = {
  amount: (value: number) => string;
  date: (value: string) => string;
  number: (value: number) => string;
  categories: Record<string, string>;
  customers?: ReadonlyMap<string, string>;
  sources?: ReadonlyMap<string, string>;
};

const readField = (record: Record<string, unknown> | undefined, key: string): unknown => {
  if (!record) return undefined;
  if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  return record[key.replace(/[A-Z]/g, character => `_${character.toLowerCase()}`)];
};

export function getEuerHistoryChanges(item: EuerEntryHistory, format: HistoryFormatters) {
  // Die Demo und ältere Löschprotokolle enthalten beim Storno nur den vorherigen Stand.
  const after = item.action === 'voided' && !item.newData
    ? { ...item.oldData, status: 'voided' }
    : item.newData;
  const display = (key: string, value: unknown): string => {
    if (value == null || value === '') return '—';
    if (['amount', 'netAmount', 'vatAmount'].includes(key)) return format.amount(Number(value));
    if (key === 'taxRate') return `${format.number(Number(value))} %`;
    if (key === 'entryDate' || key === 'documentDate') return format.date(String(value));
    if (key === 'inputTaxDeductible') return value === true ? 'Ja' : 'Nein';
    if (key === 'category') return format.categories[String(value)] || String(value);
    if (key === 'customerId') return format.customers?.get(String(value)) || String(value);
    if (key === 'sourceId') return format.sources?.get(String(value)) || String(value);
    return ['entryType', 'sourceType', 'vatTreatment', 'status'].includes(key)
      ? valueLabels[String(value)] || String(value)
      : String(value);
  };
  return historyFields.flatMap(([key, label]) => {
    const beforeValue = display(key, readField(item.oldData, key));
    const afterValue = display(key, readField(after, key));
    return beforeValue === afterValue ? [] : [{ key, label, before: beforeValue, after: afterValue }];
  });
}
