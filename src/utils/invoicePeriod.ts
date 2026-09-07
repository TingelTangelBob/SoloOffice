export type InvoiceDateValue = Date | string | null | undefined;

/** Liefert einen stabilen lokalen YYYY-MM-DD-Schlüssel für Rechnungstage. */
export function toDateInputValue(value: InvoiceDateValue): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0'),
    ].join('-');
  }

  if (typeof value !== 'string' || !value) return '';
  const isoDate = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return toDateInputValue(parsed);
}

/** Prüft den Zeitraum einschließlich Von- und Bis-Datum. */
export function isDateInInclusiveRange(value: InvoiceDateValue, from: string, to: string): boolean {
  const date = toDateInputValue(value);
  if (!date || (from && to && from > to)) return false;
  return (!from || date >= from) && (!to || date <= to);
}

export function formatDateInputValue(date: Date): string {
  return toDateInputValue(date);
}
