const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function assertDateOnly(value, label = 'Datum') {
  const date = String(value ?? '');
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!DATE_ONLY.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new TypeError(`${label} ist ungültig.`);
  }
  return date;
}

function monthEnd(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function occurrenceAt(startDate, occurrenceIndex, intervalValue = 1, intervalUnit = 'month') {
  const start = new Date(`${assertDateOnly(startDate, 'Startdatum')}T00:00:00.000Z`);
  if (!Number.isInteger(occurrenceIndex) || occurrenceIndex < 0 || !Number.isInteger(intervalValue) || intervalValue < 1) {
    throw new TypeError('Das Intervall ist ungültig.');
  }
  const date = new Date(start);
  const count = occurrenceIndex * intervalValue;
  if (intervalUnit === 'day' || intervalUnit === 'week') {
    date.setUTCDate(date.getUTCDate() + count * (intervalUnit === 'week' ? 7 : 1));
  } else if (intervalUnit === 'month' || intervalUnit === 'year') {
    const months = count * (intervalUnit === 'year' ? 12 : 1);
    const anchorDay = start.getUTCDate();
    const targetMonth = start.getUTCMonth() + months;
    date.setUTCDate(1);
    date.setUTCMonth(targetMonth);
    date.setUTCDate(Math.min(anchorDay, monthEnd(date.getUTCFullYear(), date.getUTCMonth())));
  } else {
    throw new TypeError('Die Intervalleinheit ist ungültig.');
  }
  return date.toISOString().slice(0, 10);
}

export function nextOccurrence(startDate, currentDate, intervalValue = 1, intervalUnit = 'month') {
  const current = assertDateOnly(currentDate, 'Fälligkeit');
  let index = 0;
  while (occurrenceAt(startDate, index, intervalValue, intervalUnit) <= current) index += 1;
  return occurrenceAt(startDate, index, intervalValue, intervalUnit);
}

export function addDays(dateValue, days) {
  const date = new Date(`${assertDateOnly(dateValue)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isPausedOn(dateValue, pauses = []) {
  const date = assertDateOnly(dateValue);
  return pauses.some(pause => {
    const from = assertDateOnly(pause.from, 'Pausenbeginn');
    const until = pause.until == null ? null : assertDateOnly(pause.until, 'Pausenende');
    return date >= from && (until === null || date <= until);
  });
}
