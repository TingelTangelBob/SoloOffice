/**
 * Common XML utilities
 */

/**
 * Format a number as currency string for XML
 * @param amount - Amount to format
 * @returns Formatted amount string
 */
export function formatAmountForXML(amount: number): string {
  const numericAmount = Number(amount);
  return (Number.isFinite(numericAmount) ? numericAmount : 0).toFixed(2);
}

/**
 * Escape XML special characters
 * @param text - Text to escape
 * @returns Escaped text
 */
export function escapeXML(text: unknown): string {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const COUNTRY_CODES: Record<string, string> = {
  deutschland: 'DE',
  germany: 'DE',
  österreich: 'AT',
  austria: 'AT',
  schweiz: 'CH',
  switzerland: 'CH',
  frankreich: 'FR',
  france: 'FR',
  niederlande: 'NL',
  netherlands: 'NL',
  belgien: 'BE',
  belgium: 'BE',
  luxemburg: 'LU',
  luxembourg: 'LU',
  italien: 'IT',
  italy: 'IT',
  spanien: 'ES',
  spain: 'ES',
  polen: 'PL',
  poland: 'PL',
  tschechien: 'CZ',
  'czech republic': 'CZ',
  dänemark: 'DK',
  denmark: 'DK',
  schweden: 'SE',
  sweden: 'SE',
  norwegen: 'NO',
  norway: 'NO',
  finnland: 'FI',
  finland: 'FI',
  'vereinigtes königreich': 'GB',
  'united kingdom': 'GB',
  usa: 'US',
  'vereinigte staaten': 'US',
};

export function countryCode(country?: string): string {
  const normalised = String(country || '').trim().toLocaleLowerCase('de-DE');
  if (/^[a-z]{2}$/i.test(normalised)) return normalised.toUpperCase();
  return COUNTRY_CODES[normalised] || 'DE';
}

export function taxCategoryCode(rate: number, isSmallBusiness = false): 'S' | 'E' | 'AE' {
  if (isSmallBusiness) return 'E';
  return Number(rate) === 0 ? 'AE' : 'S';
}

export function taxExemptionReason(category: 'S' | 'E' | 'AE'): string {
  if (category === 'E') return 'Steuerbefreiung für Kleinunternehmer gemäß § 19 UStG';
  if (category === 'AE') return 'Steuerschuldnerschaft des Leistungsempfängers gemäß § 13b UStG';
  return '';
}


