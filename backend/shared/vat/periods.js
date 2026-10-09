import { resolveTaxParams } from '../taxParams/index.js';
import { addDays, assertDateOnly } from '../recurrence.js';

// Voranmeldungszeiträume, gesetzliche Fälligkeiten und die Zuordnung von
// USt-Zahlungen nach § 11 EStG. Reine Kalenderlogik ohne Zeitzonen: alle
// Datumswerte sind ISO-Kalendertage (YYYY-MM-DD).

const pad = value => String(value).padStart(2, '0');
const isoDate = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;
const lastDay = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const dateKey = value => assertDateOnly(value);

export const VAT_PERIOD_TYPES = Object.freeze(['monthly', 'quarterly', 'annual']);
export const VAT_PERIOD_KEY = /^(\d{4})(?:-(0[1-9]|1[0-2])|-Q([1-4]))?$/;

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function periodFromParts(year, type, index) {
  if (type === 'monthly') {
    return { key: `${year}-${pad(index)}`, type, year, label: `${MONTH_NAMES[index - 1]} ${year}`,
      start: isoDate(year, index, 1), end: isoDate(year, index, lastDay(year, index)) };
  }
  if (type === 'quarterly') {
    const startMonth = (index - 1) * 3 + 1;
    return { key: `${year}-Q${index}`, type, year, label: `${index}. Quartal ${year}`,
      start: isoDate(year, startMonth, 1), end: isoDate(year, startMonth + 2, lastDay(year, startMonth + 2)) };
  }
  return { key: String(year), type: 'annual', year, label: `Jahr ${year}`, start: isoDate(year, 1, 1), end: isoDate(year, 12, 31) };
}

/** Alle Voranmeldungszeiträume eines Jahres in Kalenderreihenfolge. */
export function vatPeriods(year, type) {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new RangeError('Ungültiges Steuerjahr.');
  if (!VAT_PERIOD_TYPES.includes(type)) throw new RangeError('Ungültiger Voranmeldungszeitraum.');
  const count = type === 'monthly' ? 12 : type === 'quarterly' ? 4 : 1;
  return Array.from({ length: count }, (_, index) => periodFromParts(year, type, index + 1));
}

/** Zeitraum zu einem Schlüssel wie `2026-03`, `2026-Q1` oder `2026`. */
export function parseVatPeriodKey(key) {
  const match = VAT_PERIOD_KEY.exec(String(key || ''));
  if (!match) return null;
  const year = Number(match[1]);
  if (year < 2000 || year > 2200) return null;
  if (match[2]) return periodFromParts(year, 'monthly', Number(match[2]));
  if (match[3]) return periodFromParts(year, 'quarterly', Number(match[3]));
  return periodFromParts(year, 'annual', 1);
}

/** Schlüssel des Zeitraums, in den ein Kalendertag fällt. */
export function vatPeriodKeyFor(date, type) {
  const key = dateKey(date);
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  if (type === 'monthly') return `${year}-${pad(month)}`;
  if (type === 'quarterly') return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  if (type === 'annual') return String(year);
  throw new RangeError('Ungültiger Voranmeldungszeitraum.');
}

function easterSunday(year) {
  // Gaußsche Osterformel (Anonymous Gregorian algorithm).
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

/** Bundeseinheitliche gesetzliche Feiertage; Landesfeiertage bleiben bewusst außen vor. */
export function nationwideHolidays(year) {
  const easter = easterSunday(year);
  return new Set([
    isoDate(year, 1, 1), addDays(easter, -2), addDays(easter, 1), isoDate(year, 5, 1),
    addDays(easter, 39), addDays(easter, 50), isoDate(year, 10, 3), isoDate(year, 12, 25), isoDate(year, 12, 26),
  ]);
}

function isBusinessDay(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !nationwideHolidays(Number(date.slice(0, 4))).has(date);
}

/** § 108 Abs. 3 AO: Fristende am Wochenende/Feiertag verschiebt sich auf den nächsten Werktag. */
export function shiftToBusinessDay(date) {
  let current = dateKey(date);
  for (let guard = 0; guard < 10 && !isBusinessDay(current); guard += 1) current = addDays(current, 1);
  return current;
}

function addMonthsDay(endDate, months, day) {
  const year = Number(endDate.slice(0, 4));
  const month = Number(endDate.slice(5, 7)) + months;
  const targetYear = year + Math.floor((month - 1) / 12);
  const targetMonth = ((month - 1) % 12) + 1;
  return isoDate(targetYear, targetMonth, Math.min(day, lastDay(targetYear, targetMonth)));
}

/**
 * Gesetzliche Fälligkeit einer Vorauszahlung (§ 18 Abs. 1 UStG): 10. Tag nach
 * Ablauf des Zeitraums, mit Dauerfristverlängerung einen Monat später. Für
 * Jahreszeiträume gibt es keine Vorauszahlung (`null`).
 */
export function statutoryDueDate(periodOrKey, { permanentExtension = false, params } = {}) {
  const period = typeof periodOrKey === 'string' ? parseVatPeriodKey(periodOrKey) : periodOrKey;
  if (!period) throw new RangeError('Ungültiger Voranmeldungszeitraum.');
  if (period.type === 'annual') return null;
  const vat = (params || resolveTaxParams(period.year).params).vat;
  return addMonthsDay(period.end, 1 + (permanentExtension ? vat.permanentExtensionMonths : 0), vat.filingDayAfterPeriod);
}

/** Zahlungsfälligkeit nach Verschiebung gemäß § 108 Abs. 3 AO. */
export function paymentDueDate(periodOrKey, options = {}) {
  const statutory = statutoryDueDate(periodOrKey, options);
  return statutory ? shiftToBusinessDay(statutory) : null;
}

/** Fälligkeit der Sondervorauszahlung (§ 48 Abs. 1 UStDV, 10. Februar) mit Verschiebung. */
export function specialPrepaymentDueDate(year, params) {
  const vat = (params || resolveTaxParams(year).params).vat;
  return shiftToBusinessDay(isoDate(year, vat.specialPrepaymentDueMonth, vat.specialPrepaymentDueDay));
}

/**
 * EÜR-Jahr einer USt-Zahlung nach § 11 EStG (Abfluss/Zufluss) mit der
 * 10-Tage-Regel für regelmäßig wiederkehrende Vorauszahlungen: Eine
 * Vorauszahlung für einen Zeitraum des Jahres Y, die zwischen dem 22.12. (Y)
 * und dem 10.01. (Y+1) gezahlt wird und deren gesetzliche – nicht nach § 108
 * AO verschobene – Fälligkeit ebenfalls in diesem Fenster liegt, gehört zu Y
 * (BFH X R 44/16). Mit Dauerfristverlängerung liegt die Fälligkeit der
 * Dezember-/Q4-Vorauszahlung außerhalb des Fensters.
 */
export function euerAttributionYear(payment, { permanentExtension = false, params } = {}) {
  const paidOn = dateKey(payment.paidOn);
  const paidYear = Number(paidOn.slice(0, 4));
  const base = { year: paidYear, tenDayRule: false, reason: null };
  if (payment.kind !== 'advance' || !payment.periodKey) return base;
  const period = parseVatPeriodKey(payment.periodKey);
  if (!period || period.type === 'annual') return base;
  const days = (params || resolveTaxParams(period.year).params).vat.tenDayRuleDays;
  const windowStart = addDays(isoDate(period.year, 12, 31), -(days - 1));
  const windowEnd = isoDate(period.year + 1, 1, days);
  const due = statutoryDueDate(period, { permanentExtension, params });
  const inWindow = date => date >= windowStart && date <= windowEnd;
  if (paidYear === period.year + 1 && inWindow(paidOn) && due && inWindow(due)) {
    return { year: period.year, tenDayRule: true,
      reason: `Regelmäßig wiederkehrende Vorauszahlung innerhalb von ${days} Tagen nach Jahresende gezahlt und fällig; zählt nach § 11 Abs. 2 Satz 2 EStG zu ${period.year}.` };
  }
  if (paidYear === period.year + 1 && inWindow(paidOn) && due && !inWindow(due)) {
    return { ...base, reason: 'Gesetzliche Fälligkeit liegt außerhalb der 10 Tage nach Jahresende (z. B. wegen Dauerfristverlängerung); Abfluss im Zahlungsjahr.' };
  }
  return base;
}
