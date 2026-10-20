/** Shared format checks for setup, settings, demo and the company API.
 * Values are checked without changing what the user entered or what is saved.
 * Format/checksum checks do not confirm an account or tax registration exists.
 */
export function emailFormatError(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value)
      || value.split('@')[0].length > 64 || /(^\.|\.\.|\.@)/.test(value)
      || !/^[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+$/u.test(value.split('@')[0])
      || value.split('@')[1].split('.').some(label => !/^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u.test(label))) {
    return 'Bitte eine gültige E-Mail-Adresse eingeben, z. B. name@example.de.';
  }
  return null;
}

export function isGermanCountry(country) {
  return country == null || (typeof country === 'string' && /^(|d|de|deu|deutschland|germany|bundesrepublik deutschland)$/i.test(country.trim()));
}

export function postalCodeFormatError(value, country = 'Deutschland') {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return 'Bitte die Postleitzahl als Text eingeben.';
  return isGermanCountry(country) && !/^\d{5}$/.test(value)
    ? 'Eine deutsche Postleitzahl muss genau 5 Ziffern enthalten.' : null;
}

// National syntax from the BZSt overview „Aufbau der USt-IdNr. in den EU-Mitgliedstaaten“:
// https://www.bzst.de/SharedDocs/Downloads/DE/Merkblaetter/ust_idnr_aufbau.pdf
const vatIdPatterns = {
  AT: /^ATU\d{8}$/, BE: /^BE\d{10}$/, BG: /^BG\d{9,10}$/, CY: /^CY\d{8}[A-Z]$/,
  CZ: /^CZ\d{8,10}$/, DE: /^DE\d{9}$/, DK: /^DK\d{8}$/, EE: /^EE\d{9}$/, EL: /^EL\d{9}$/,
  ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/, FI: /^FI\d{8}$/, FR: /^FR[A-Z0-9]{2}\d{9}$/, HR: /^HR\d{11}$/,
  HU: /^HU\d{8}$/, IE: /^IE(?:\d{7}[A-Z]{1,2}|\d[A-Z0-9+*]\d{5}[A-Z])$/, IT: /^IT\d{11}$/,
  LT: /^LT(?:\d{9}|\d{12})$/, LU: /^LU\d{8}$/, LV: /^LV\d{11}$/, MT: /^MT\d{8}$/,
  NL: /^NL\d{9}B\d{2}$/, PL: /^PL\d{10}$/, PT: /^PT\d{9}$/, RO: /^RO\d{2,10}$/,
  SE: /^SE\d{12}$/, SI: /^SI\d{8}$/, SK: /^SK\d{10}$/, XI: /^XI(?:\d{9}|\d{12}|(?:GD|HA)\d{3})$/,
};

export function vatIdFormatError(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !vatIdPatterns[value.slice(0, 2)]?.test(value)) {
    return typeof value === 'string' && value.startsWith('DE')
      ? 'Die deutsche USt-IdNr. muss „DE“ und genau 9 Ziffern enthalten.'
      : 'Bitte eine USt-IdNr. mit gültigem Länderpräfix und Format in Großbuchstaben eingeben, z. B. DE123456789.';
  }
  return null;
}

export function ibanFormatError(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Z]{2}\d{2}[A-Z0-9 ]+$/.test(value)) {
    return 'Bitte eine IBAN in Großbuchstaben eingeben. Leerzeichen zur Gliederung sind erlaubt.';
  }
  // Spaces are ignored only for the calculation; the input is never rewritten.
  // DE structure: https://www.bundesbank.de/de/aufgaben/unbarer-zahlungsverkehr/serviceangebot/iban-regeln
  // Other countries use the general ISO 13616 structure and Mod-97 check here.
  const iban = value.replace(/ /g, '');
  if (iban.length < 15 || iban.length > 34 || (iban.startsWith('DE') && !/^DE\d{20}$/.test(iban))) {
    return 'Die IBAN hat ein ungültiges Format. Eine deutsche IBAN enthält DE und genau 20 Ziffern.';
  }
  if (Number(iban.slice(2, 4)) < 2 || Number(iban.slice(2, 4)) > 98) {
    return 'Die Prüfziffer der IBAN stimmt nicht. Bitte die IBAN prüfen.';
  }
  let remainder = 0;
  for (const character of iban.slice(4) + iban.slice(0, 4)) {
    const digits = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1 ? null : 'Die Prüfziffer der IBAN stimmt nicht. Bitte die IBAN prüfen.';
}

/** Only fields present in the patch are checked; empty optional fields are allowed. */
export function validateCompanyFormats(data, context = {}) {
  const errors = {};
  const check = (field, error) => { if (error) errors[field] = error; };
  if ('email' in data) check('email', emailFormatError(data.email));
  if ('postalCode' in data || 'country' in data) {
    check('postalCode', postalCodeFormatError(data.postalCode ?? context.postalCode, data.country ?? context.country ?? 'Deutschland'));
  }
  if ('taxId' in data) check('taxId', vatIdFormatError(data.taxId));
  const paymentInformation = data.paymentInformation;
  if (paymentInformation != null && (typeof paymentInformation !== 'object' || Array.isArray(paymentInformation))) {
    errors['paymentInformation.bankAccount'] = 'Bitte gültige Zahlungsinformationen angeben.';
  } else if (paymentInformation && 'bankAccount' in paymentInformation) {
    check('paymentInformation.bankAccount', ibanFormatError(data.paymentInformation.bankAccount));
  } else if ('bankAccount' in data) {
    check('bankAccount', ibanFormatError(data.bankAccount));
  }
  return errors;
}
