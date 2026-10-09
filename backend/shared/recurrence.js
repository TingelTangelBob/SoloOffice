const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// pg liefert DATE-Spalten als lokale Mitternacht; deshalb lokale Kalenderbestandteile verwenden.
function dateValueToKey(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return String(value ?? '');
  const pad = number => String(number).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function assertDateOnly(value, label = 'Datum') {
  const date = dateValueToKey(value);
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

export function occurrenceOnOrAfter(startDate, dateValue, intervalValue = 1, intervalUnit = 'month') {
  const start = assertDateOnly(startDate, 'Startdatum');
  const target = assertDateOnly(dateValue, 'Stichtag');
  if (!Number.isInteger(intervalValue) || intervalValue < 1) throw new TypeError('Das Intervall ist ungültig.');
  if (start >= target) return start;
  // Grobe Schätzung des Index, danach höchstens wenige Kalenderperioden korrigieren.
  const startDateValue = new Date(`${start}T00:00:00.000Z`);
  const targetDateValue = new Date(`${target}T00:00:00.000Z`);
  const days = Math.floor((targetDateValue - startDateValue) / 86400000);
  let index;
  if (intervalUnit === 'day' || intervalUnit === 'week') {
    index = Math.floor(days / (intervalValue * (intervalUnit === 'week' ? 7 : 1)));
  } else if (intervalUnit === 'month' || intervalUnit === 'year') {
    const months = (targetDateValue.getUTCFullYear() - startDateValue.getUTCFullYear()) * 12
      + targetDateValue.getUTCMonth() - startDateValue.getUTCMonth();
    index = Math.floor(months / (intervalValue * (intervalUnit === 'year' ? 12 : 1)));
  } else {
    throw new TypeError('Die Intervalleinheit ist ungültig.');
  }
  let due = occurrenceAt(start, Math.max(0, index), intervalValue, intervalUnit);
  while (due < target) due = occurrenceAt(start, ++index, intervalValue, intervalUnit);
  return due;
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

/** Gemeinsame Fälligkeitssemantik für API und Forecast bei einem kanonischen Fixkostenobjekt. */
export function isRecurringExpenseDue(expense, dueDate) {
  const due = assertDateOnly(dueDate, 'Fälligkeit');
  const start = assertDateOnly(expense.startDate ?? expense.start_date, 'Startdatum');
  const status = expense.status || 'active';
  const pauses = expense.pauses || [];
  // Mit erfassten Zeiträumen gilt die Pause ausschließlich an diesen Tagen;
  // ältere ungezahlte Fälligkeiten bleiben vor dem Pausenbeginn zulässig.
  if ((status === 'ended' && !(expense.endDate ?? expense.end_date)) || (status === 'paused' && pauses.length === 0) || due < start) return false;
  const endValue = expense.endDate ?? expense.end_date;
  const end = endValue ? assertDateOnly(endValue, 'Enddatum') : null;
  // Die Kündigungserklärung und ihre Frist bestimmen keinen Vertragsendtermin.
  // Nur das ausdrücklich erfasste Ende beendet die Fälligkeitsreihe.
  if ((end && due >= end) || isPausedOn(due, pauses)) return false;
  const interval = Number(expense.intervalCount ?? expense.intervalValue ?? expense.interval_value ?? 1);
  const unitValue = expense.intervalUnit ?? expense.interval_unit ?? 'month';
  const unit = unitValue === 'weeks' ? 'week' : unitValue === 'months' ? 'month' : unitValue;
  if (!Number.isInteger(interval) || interval < 1) return false;
  return occurrenceOnOrAfter(start, due, interval, unit) === due;
}
