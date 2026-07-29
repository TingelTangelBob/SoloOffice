
export function formatCurrency(amount: number, locale: string = 'de-DE'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: getCurrencyForLocale(locale),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
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
