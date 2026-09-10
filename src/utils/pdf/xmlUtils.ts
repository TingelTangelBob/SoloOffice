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

// Peppol BIS Billing, geprüfte Liste vom 09.09.2026 (inkl. 1A und XI):
// https://docs.peppol.eu/poacc/billing/3.0/codelist/ISO3166/
const DOCUMENT_COUNTRY_CODES = new Set('1A AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XI YE YT ZA ZM ZW'.split(' '));
let countryNames: Map<string, string> | undefined;

export function countryCode(country?: string): string {
  const normalised = String(country || '').trim().toLocaleLowerCase('de-DE');
  const code = normalised.toUpperCase();
  if (DOCUMENT_COUNTRY_CODES.has(code)) return code;
  if (COUNTRY_CODES[normalised]) return COUNTRY_CODES[normalised];
  if (!countryNames) {
    countryNames = new Map([['kosovo', '1A'], ['nordirland', 'XI'], ['northern ireland', 'XI']]);
    for (const language of ['de', 'en']) {
      const names = new Intl.DisplayNames([language], { type: 'region', fallback: 'none' });
      for (const candidate of DOCUMENT_COUNTRY_CODES) {
        if (!/^[A-Z]{2}$/.test(candidate)) continue;
        const name = names.of(candidate);
        if (name) countryNames.set(name.toLocaleLowerCase('de-DE'), candidate);
      }
    }
  }
  const resolved = countryNames.get(normalised);
  if (resolved) return resolved;
  throw new Error('Das Land fehlt oder ist unbekannt. Bitte hinterlegen Sie ein gültiges Land oder Länderkürzel, zum Beispiel DE.');
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

