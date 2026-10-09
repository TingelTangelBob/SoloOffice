import { defaultTaxProfile } from '../shared/financeDefaults.js';

const ENUMS = {
  businessKind: ['teacher', 'freelance', 'commercial', 'craft_a', 'craft_b', 'artist'],
  vatStatus: ['small_business', 'regular', 'education_exempt'],
  vatAccounting: ['cash', 'accrual'],
  vatPeriod: ['monthly', 'quarterly', 'annual'],
  assessment: ['single', 'joint'],
  healthInsurance: ['gkv_voluntary', 'gkv_ksk', 'pkv', 'family'],
  pensionStatus: ['teacher', 'craft', 'single_client', 'ksk', 'voluntary', 'none', 'exempt', 'unclear'],
  pensionMode: ['standard', 'half', 'income', 'minimum', 'notice'],
  chamber: ['none', 'ihk', 'hwk'],
};
const NULLABLE = new Set([
  'businessKind', 'startedOn', 'vatStatus', 'educationCertificateUntil', 'previousYearRevenue', 'state',
  'healthInsurance', 'privateHealthBasicMonthly', 'healthNoticeMonthly', 'careNoticeMonthly',
  'healthNoticeIncomeMonthly', 'pensionNoticeMonthly', 'kskIncomeAnnual', 'tradeMultiplier',
  'incomeTaxAdvanceQuarterly', 'tradeTaxAdvanceQuarterly', 'churchTaxLiable', 'unemploymentAppliedOn', 'birthYear',
]);
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INTEGER_FIELDS = new Set(['year', 'children', 'childrenUnder25', 'birthYear']);
const BOOLEAN_FIELDS = new Set(['churchTaxLiable', 'singleParent', 'sickPay', 'unemploymentEnabled', 'chamberFounderEligible']);
const STRING_FIELDS = new Set(['state']);
const PAYLOAD_FIELDS = Object.freeze(Object.keys(defaultTaxProfile(2026)).filter(key => ![
  'id', 'disclaimerAcceptedAt', 'churchTaxConsentAt', 'updatedAt', 'paramsVersion',
].includes(key)));

function validIsoDate(value) {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Validiert vollständige PUT-Payloads. Rückgabe: { valid, errors, value }. */
export function validateTaxProfilePayload(data, pathYear) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, errors: ['Das Steuerprofil muss ein Objekt sein.'], value: null };
  }
  for (const key of Object.keys(data)) {
    if (!PAYLOAD_FIELDS.includes(key)) errors.push(`Unbekanntes Profilfeld: ${key}.`);
  }
  for (const key of PAYLOAD_FIELDS) {
    if (!Object.hasOwn(data, key)) errors.push(`Profilfeld fehlt: ${key}.`);
  }
  if (!Number.isInteger(data.year) || data.year < 2000 || data.year > 2200) errors.push('Ungültiges Steuerjahr.');
  if (pathYear !== undefined && data.year !== pathYear) errors.push('Das Profiljahr stimmt nicht mit dem Pfad überein.');

  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (data[key] === null && NULLABLE.has(key)) continue;
    if (!allowed.includes(data[key])) errors.push(`Ungültiger Wert für ${key}.`);
  }
  for (const key of ['startedOn', 'educationCertificateUntil', 'unemploymentAppliedOn']) {
    if (data[key] === null && NULLABLE.has(key)) continue;
    if (typeof data[key] !== 'string' || !validIsoDate(data[key])) errors.push(`Ungültiges ISO-Datum für ${key}.`);
  }
  for (const key of BOOLEAN_FIELDS) {
    if (data[key] === null && NULLABLE.has(key)) continue;
    if (typeof data[key] !== 'boolean') errors.push(`Ungültiger Wahrheitswert für ${key}.`);
  }
  for (const key of STRING_FIELDS) {
    if (data[key] === null && NULLABLE.has(key)) continue;
    if (typeof data[key] !== 'string' || data[key].length > 80) errors.push(`Ungültiger Textwert für ${key}.`);
  }
  for (const key of PAYLOAD_FIELDS) {
    if (ENUMS[key] || ['startedOn', 'educationCertificateUntil', 'unemploymentAppliedOn'].includes(key) || BOOLEAN_FIELDS.has(key) || STRING_FIELDS.has(key)) continue;
    const value = data[key];
    if (value === null && NULLABLE.has(key)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`Ungültige Zahl für ${key}.`);
      continue;
    }
    if (INTEGER_FIELDS.has(key) && !Number.isInteger(value)) errors.push(`${key} muss eine ganze Zahl sein.`);
    if (value < 0 || value > 1_000_000_000) errors.push(`Wert außerhalb des erlaubten Bereichs für ${key}.`);
    if (key === 'children' && value > 20) errors.push('Die Kinderzahl ist zu hoch.');
    if (key === 'childrenUnder25' && value > 20) errors.push('Die Kinderzahl ist zu hoch.');
    if (key === 'birthYear' && (value < 1900 || value > 2200)) errors.push('Ungültiges Geburtsjahr.');
    if (['additionalHealthRate', 'chamberLevyRate'].includes(key) && value > 100) errors.push(`${key} muss zwischen 0 und 100 liegen.`);
    if (key === 'tradeMultiplier' && value > 1000) errors.push('Der Hebesatz muss zwischen 0 und 1000 liegen.');
  }
  if (Number.isInteger(data.children) && Number.isInteger(data.childrenUnder25) && data.childrenUnder25 > data.children) {
    errors.push('Kinder unter 25 dürfen die Kinderzahl nicht überschreiten.');
  }
  if (Number.isInteger(data.birthYear) && data.birthYear > data.year) {
    errors.push('Das Geburtsjahr darf nicht nach dem Profiljahr liegen.');
  }
  if (typeof data.privateHealthBasicMonthly === 'number' && data.privateHealthBasicMonthly > data.privateHealthMonthly) {
    errors.push('Der PKV-Basisanteil darf den Krankenversicherungsbeitrag nicht überschreiten.');
  }

  const value = Object.fromEntries(PAYLOAD_FIELDS.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
  return { valid: errors.length === 0, errors, value };
}

export { PAYLOAD_FIELDS as TAX_PROFILE_PAYLOAD_FIELDS };
