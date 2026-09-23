// Wiederholungsregeln für Aufträge und Kurse. Die Auftragsroute und der
// Import erzeugen Serien damit identisch; das Modul ist browserfähig und wird
// auch vom Demo-Modus genutzt.
const parseDateOnly = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!match) return new Date(NaN);
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return new Date(NaN);
  return date;
};

const formatDateOnly = (value) => value.toISOString().split('T')[0];

export const normalizeRecurrence = (value) => {
  if (!value) return null;

  const intervalUnit = value.intervalUnit || 'week';
  const interval = Math.floor(Number(value.interval));
  const startDate = String(value.startDate || '');
  const parsedStartDate = parseDateOnly(startDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(parsedStartDate.getTime())) {
    throw new Error('Ungültiges Startdatum für die Wiederholung');
  }

  const duration = Math.floor(Number(value.duration ?? value.durationWeeks));
  const maxDuration = intervalUnit === 'week' ? 104 : intervalUnit === 'month' ? 120 : 100;
  if (!['week', 'month', 'year'].includes(intervalUnit) || !Number.isInteger(interval) || interval < 1 || interval > maxDuration) {
    throw new Error('Ungültiges Wiederholungsintervall');
  }
  if (!Number.isInteger(duration) || duration < 1 || duration > maxDuration) {
    throw new Error('Ungültige Wiederholungsdauer');
  }

  const startWeekday = parsedStartDate.getUTCDay() === 0 ? 7 : parsedStartDate.getUTCDay();
  const weekdays = [...new Set([startWeekday, ...(Array.isArray(value.weekdays) ? value.weekdays : [])].map(Number))]
    .filter(day => day >= 1 && day <= 7)
    .sort((a, b) => a - b);

  return {
    intervalUnit,
    interval,
    startDate,
    duration,
    ...(intervalUnit === 'week' ? { weekdays, durationWeeks: duration } : {}),
  };
};

export const expandRecurrence = (rule) => {
  const startDate = parseDateOnly(rule.startDate);
  const duration = Number(rule.duration ?? rule.durationWeeks);
  if (Number.isNaN(startDate.getTime()) || !Number.isFinite(duration)) return [];

  if (rule.intervalUnit === 'month' || rule.intervalUnit === 'year') {
    const dates = [];
    for (let offset = 0; offset < duration; offset += rule.interval) {
      const occurrence = new Date(startDate);
      occurrence.setUTCDate(1);
      if (rule.intervalUnit === 'month') {
        occurrence.setUTCMonth(startDate.getUTCMonth() + offset);
      } else {
        occurrence.setUTCFullYear(startDate.getUTCFullYear() + offset);
      }
      const daysInMonth = new Date(Date.UTC(occurrence.getUTCFullYear(), occurrence.getUTCMonth() + 1, 0)).getUTCDate();
      occurrence.setUTCDate(Math.min(startDate.getUTCDate(), daysInMonth));
      dates.push(formatDateOnly(occurrence));
    }
    return dates;
  }

  const isoWeekday = startDate.getUTCDay() === 0 ? 7 : startDate.getUTCDay();
  const startMonday = new Date(startDate);
  startMonday.setUTCDate(startMonday.getUTCDate() - (isoWeekday - 1));
  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + duration * 7);
  const weekdays = [...new Set([isoWeekday, ...(rule.weekdays || [])])].sort((a, b) => a - b);
  const dates = [];

  for (let weekOffset = 0; ; weekOffset += rule.interval) {
    const weekStart = new Date(startMonday);
    weekStart.setUTCDate(startMonday.getUTCDate() + weekOffset * 7);
    if (weekStart >= endDate) break;
    for (const weekday of weekdays) {
      const occurrence = new Date(weekStart);
      occurrence.setUTCDate(weekStart.getUTCDate() + weekday - 1);
      if (occurrence >= startDate && occurrence < endDate) dates.push(formatDateOnly(occurrence));
    }
  }

  return dates;
};
