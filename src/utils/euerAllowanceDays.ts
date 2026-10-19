import type { EuerEntry } from '../types';

export type AllowanceDayBasis = {
  version: 1;
  year: number;
  mode: 'annual' | 'weekly';
  days: number;
  from: string;
  to: string;
  weekdays: number[];
  vacationDays: number;
  otherDays: number;
};

type AllowanceWorkdayInput = {
  year: number;
  from: string;
  to: string;
  weekdays: number[];
  vacationDays: number;
  otherDays: number;
  today: string;
};

type WorkdayResult = { baseDays: number; days: number; error: string | null };

const DAY_MS = 24 * 60 * 60 * 1000;
const BASIS_PREFIX = 'Tagesberechnung (SoloOffice): ';
const BASIS_FIELDS = new Set(['version', 'year', 'mode', 'days', 'from', 'to', 'weekdays', 'vacationDays', 'otherDays']);

/** Recognizes current and historical annual entries so updating never creates a second post. */
export function isHomeOfficeAllowanceEntry(
  entry: Pick<EuerEntry, 'entryType' | 'category' | 'status' | 'description' | 'notes'>,
  year: number,
): boolean {
  return entry.entryType === 'expense' && entry.category === 'allowance' && entry.status !== 'voided'
    && entry.description === `Homeoffice-Tagespauschale ${year}`
    && Boolean(entry.notes?.includes(BASIS_PREFIX)
      || entry.notes?.includes('Tagesnachweis (Datum=Art):')
      || entry.notes?.includes('Tage mit überwiegender Tätigkeit in der häuslichen Wohnung ohne Besuch der ersten Tätigkeitsstätte:'));
}

function validYear(year: unknown): year is number {
  return Number.isInteger(year) && Number(year) >= 1 && Number(year) <= 9999;
}

function dateValue(value: unknown): { year: number; timestamp: number } | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, timestamp: date.getTime() };
}

function daysInYear(year: number): number {
  return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
}

function yearEnd(year: number): string {
  return `${String(year).padStart(4, '0')}-12-31`;
}

function validWeekdays(value: unknown, requireOne: boolean): value is number[] {
  return Array.isArray(value)
    && (!requireOne || value.length > 0)
    && value.every(day => Number.isInteger(day) && day >= 0 && day <= 6)
    && new Set(value).size === value.length;
}

function validNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function baseWorkdays(from: string, to: string, weekdays: number[]): number {
  const start = dateValue(from);
  const end = dateValue(to);
  if (!start || !end || end.timestamp < start.timestamp) return 0;
  const selected = new Set(weekdays);
  let count = 0;
  for (let timestamp = start.timestamp; timestamp <= end.timestamp; timestamp += DAY_MS) {
    if (selected.has(new Date(timestamp).getUTCDay())) count += 1;
  }
  return count;
}

/** Returns the available date range through today, or an empty range for a future year. */
export function getAllowanceYearRange(year: number, today: string): { from: string; to: string; maxDays: number } {
  if (!validYear(year)) throw new RangeError('Ungültiges Steuerjahr.');
  const todayValue = dateValue(today);
  if (!todayValue) throw new RangeError('Ungültiges Tagesdatum.');
  const from = `${String(year).padStart(4, '0')}-01-01`;
  const to = today < yearEnd(year) ? today : yearEnd(year);
  const end = dateValue(to);
  const start = dateValue(from);
  const maxDays = todayValue.year < year || !end || !start || end.timestamp < start.timestamp
    ? 0 : Math.floor((end.timestamp - start.timestamp) / DAY_MS) + 1;
  return { from, to, maxDays };
}

/** Counts selected weekdays in an inclusive date range, capped at today. */
export function calculateAllowanceWorkdays(input: AllowanceWorkdayInput): WorkdayResult {
  const { year, from, to, weekdays, vacationDays, otherDays, today } = input;
  const failure = (error: string): WorkdayResult => ({ baseDays: 0, days: 0, error });
  if (!validYear(year)) return failure('Ungültiges Steuerjahr.');
  const start = dateValue(from);
  const end = dateValue(to);
  const cutoff = dateValue(today);
  if (!start || !end || !cutoff) return failure('Bitte gültige Datumswerte eingeben.');
  if (start.year !== year || end.year !== year) return failure('Der Zeitraum muss im gewählten Steuerjahr liegen.');
  if (end.timestamp < start.timestamp) return failure('Das Enddatum liegt vor dem Startdatum.');
  if (!validWeekdays(weekdays, true)) return failure('Bitte mindestens einen eindeutigen Wochentag auswählen.');
  if (!validNonNegativeInteger(vacationDays) || !validNonNegativeInteger(otherDays)) {
    return failure('Urlaubstage und weitere freie Tage müssen ganze Zahlen ab null sein.');
  }

  const cappedTo = cutoff.timestamp < start.timestamp
    ? null
    : end.timestamp <= cutoff.timestamp ? to : today;
  const baseDays = cappedTo === null ? 0 : baseWorkdays(from, cappedTo, weekdays);
  if (vacationDays + otherDays > baseDays) {
    return { baseDays, days: 0, error: 'Die abzuziehenden freien Tage übersteigen die berechneten Arbeitstage.' };
  }
  return { baseDays, days: baseDays - vacationDays - otherDays, error: null };
}

export function serializeAllowanceDayBasis(basis: AllowanceDayBasis): string {
  return `${BASIS_PREFIX}${JSON.stringify(basis)}`;
}

function parseBasis(value: unknown, year: number): AllowanceDayBasis | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !validYear(year)) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== BASIS_FIELDS.size || Object.keys(candidate).some(key => !BASIS_FIELDS.has(key))) return null;
  if (candidate.version !== 1 || candidate.year !== year || (candidate.mode !== 'annual' && candidate.mode !== 'weekly')) return null;
  if (!validNonNegativeInteger(candidate.days) || !validNonNegativeInteger(candidate.vacationDays)
    || !validNonNegativeInteger(candidate.otherDays)
    || !validWeekdays(candidate.weekdays, candidate.mode === 'weekly')) return null;
  const from = dateValue(candidate.from);
  const to = dateValue(candidate.to);
  if (!from || !to || from.year !== year || to.year !== year || to.timestamp < from.timestamp) return null;
  if (candidate.mode === 'annual') {
    if (Number(candidate.days) > daysInYear(year) || candidate.vacationDays !== 0 || candidate.otherDays !== 0) return null;
  } else {
    const result = calculateAllowanceWorkdays({ year, from: candidate.from as string, to: candidate.to as string,
      weekdays: candidate.weekdays as number[], vacationDays: candidate.vacationDays as number,
      otherDays: candidate.otherDays as number, today: candidate.to as string });
    if (result.error || result.days !== candidate.days) return null;
  }
  return candidate as unknown as AllowanceDayBasis;
}

export function parseAllowanceDayBasis(notes: string | null | undefined, year: number): AllowanceDayBasis | null {
  if (typeof notes !== 'string' || !validYear(year)) return null;
  const matchingLines = notes.split(/\r?\n/).filter(line => line.startsWith(BASIS_PREFIX));
  if (matchingLines.length !== 1) return null;
  try {
    return parseBasis(JSON.parse(matchingLines[0].slice(BASIS_PREFIX.length)), year);
  } catch {
    return null;
  }
}

export function readLegacyAllowanceDayCount(notes: string | null | undefined, year: number, today: string): number | null {
  if (typeof notes !== 'string' || !validYear(year)) return null;
  const todayValue = dateValue(today);
  if (!todayValue) return null;
  const evidenceLines = notes.split(/\r?\n/).filter(line => line.startsWith('Tagesnachweis (Datum=Art):'));
  if (evidenceLines.length !== 1) return null;
  const prefix = 'Tagesnachweis (Datum=Art): ';
  const line = evidenceLines[0];
  if (!line.startsWith(prefix) || !line.endsWith('.')) return null;
  const records = line.slice(prefix.length, -1).split(',');
  if (!records.length || records.some(record => !record.trim())) return null;
  const cutoff = today < yearEnd(year) ? today : yearEnd(year);
  const seen = new Set<string>();
  let count = 0;
  for (const record of records) {
    const match = /^\s*(\d{4}-\d{2}-\d{2})=(home_majority|home_no_other_workspace)\s*$/.exec(record);
    if (!match) return null;
    const date = dateValue(match[1]);
    if (!date || date.year !== year || seen.has(match[1])) return null;
    seen.add(match[1]);
    if (match[1] <= cutoff) count += 1;
  }
  return count;
}
