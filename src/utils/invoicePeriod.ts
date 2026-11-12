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

const UTC_DAY_MS = 86_400_000;

/**
 * Kalendertag (YYYY-MM-DD) eines Auftrags. Ein Auftragstag ist ein Kalendertag:
 * - reiner `YYYY-MM-DD`-String: unverändert,
 * - Zeitstempel genau um 00:00:00.000 UTC (so serialisiert das Backend eine
 *   DATE-Spalte): der UTC-Tag, unabhängig von der Zeitzone des Browsers,
 * - jeder andere Zeitstempel und jedes `Date` (etwa lokale Mitternacht aus dem
 *   Formular, östlich von UTC also 23:00 Uhr des Vortags in UTC): der lokale Tag.
 * Für Rechnungsdaten bleibt `toDateInputValue` zuständig.
 */
export function toJobDayValue(value: InvoiceDateValue): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? '' : toJobDayValue(parsed);
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
  if (value.getTime() % UTC_DAY_MS === 0) return value.toISOString().slice(0, 10);
  return toDateInputValue(value);
}

/** Lokale Mitternacht des Auftragstages (für Gruppierung und Anzeige). */
export function jobDayToDate(value: InvoiceDateValue): Date {
  const day = toJobDayValue(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return new Date(NaN);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
