import type { DateFormat, NumberFormat, TimeFormat } from '../types';

export function getNumberLocale(locale: string = 'de-DE', numberFormat?: NumberFormat): string {
  if (numberFormat === 'american') return 'en-US';
  if (numberFormat === 'european') return 'de-DE';
  return locale;
}

export type DecimalInputValue = number | string | null | undefined;

export function parseLocalizedNumber(
  value: DecimalInputValue,
  locale: string = 'de-DE',
  numberFormat?: NumberFormat,
): number {
  if (typeof value === 'number') return value;
  if (value === null || value === undefined || value.trim() === '') return Number.NaN;

  let normalized = value.trim().replace(/\s/g, '');
  const decimalSeparator = new Intl.NumberFormat(getNumberLocale(locale, numberFormat))
    .formatToParts(1.1)
    .find((part) => part.type === 'decimal')?.value;
  const usesComma = decimalSeparator === ',';

  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = usesComma
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized.replace(/,/g, '');
  } else {
    normalized = normalized.replace(',', '.');
  }

  return Number(normalized);
}

export function formatDecimalInput(
  value: DecimalInputValue,
  locale: string = 'de-DE',
  numberFormat?: NumberFormat,
  maximumFractionDigits = 6,
): string {
  if (value === null || value === undefined || value === '') return '';

  const numericValue = parseLocalizedNumber(value, locale, numberFormat);
  if (!Number.isFinite(numericValue)) return '';

  return new Intl.NumberFormat(getNumberLocale(locale, numberFormat), {
    useGrouping: false,
    maximumFractionDigits,
  }).format(numericValue);
}

export function formatNumber(
  amount: number,
  locale: string = 'de-DE',
  numberFormat?: NumberFormat,
  fractionDigits = 2,
): string {
  return new Intl.NumberFormat(getNumberLocale(locale, numberFormat), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}

export function formatCurrency(
  amount: number,
  locale: string = 'de-DE',
  numberFormat?: NumberFormat,
  currency?: string,
): string {
  try {
    return new Intl.NumberFormat(getNumberLocale(locale, numberFormat), {
      style: 'currency',
      currency: currency?.toUpperCase() || getCurrencyForLocale(locale),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return new Intl.NumberFormat(getNumberLocale(locale, numberFormat), {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }
}

export function getCurrencySymbol(
  locale: string = 'de-DE',
  numberFormat?: NumberFormat,
  currency?: string,
): string {
  const currencyCode = currency?.toUpperCase() || getCurrencyForLocale(locale);

  try {
    const currencyPart = new Intl.NumberFormat(getNumberLocale(locale, numberFormat), {
      style: 'currency',
      currency: currencyCode,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0).find((part) => part.type === 'currency');

    return currencyPart?.value || currencyCode;
  } catch {
    return currencyCode;
  }
}

export function formatDate(
  value: Date | string | number | null | undefined,
  locale: string = 'de-DE',
  dateFormat?: DateFormat,
): string {
  if (value === null || value === undefined) return '';
  const date = new Date(value);
  if (!dateFormat) return date.toLocaleDateString(locale);

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());

  switch (dateFormat) {
    case 'DD/MM/YYYY':
      return `${day}/${month}/${year}`;
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`;
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'DD.MM.YYYY':
    default:
      return `${day}.${month}.${year}`;
  }
}

export function formatTime(value: Date | string | number, locale = 'de-DE', timeFormat?: TimeFormat): string {
  if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) {
    const [hours, minutes] = value.split(':').map(Number);
    if (timeFormat === '12h') {
      const suffix = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      return `${displayHours}:${String(minutes).padStart(2, '0')} ${suffix}`;
    }
    return value;
  }
  return new Date(value).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: timeFormat === '12h',
  });
}

function getCurrencyForLocale(locale: string): string {
  switch (locale) {
    case 'de-DE':
      return 'EUR';
    case 'en-US':
      return 'USD';
    case 'fr-FR':
      return 'EUR';
    case 'es-ES':
      return 'EUR';
    default:
      return 'EUR';
  }
}

export function getLocaleDisplayName(locale: string): string {
  switch (locale) {
    case 'de-DE':
      return 'Deutsch (Deutschland)';
    case 'en-US':
      return 'English (United States)';
    case 'fr-FR':
      return 'Français (France)';
    case 'es-ES':
      return 'Español (España)';
    default:
      return 'Deutsch (Deutschland)';
  }
}
