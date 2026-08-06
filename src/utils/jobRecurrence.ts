import type { JobRecurrenceRule } from '../types';

export const RECURRENCE_WEEKDAYS = [
  { value: 1, shortLabel: 'Mo', label: 'Montag' },
  { value: 2, shortLabel: 'Di', label: 'Dienstag' },
  { value: 3, shortLabel: 'Mi', label: 'Mittwoch' },
  { value: 4, shortLabel: 'Do', label: 'Donnerstag' },
  { value: 5, shortLabel: 'Fr', label: 'Freitag' },
  { value: 6, shortLabel: 'Sa', label: 'Samstag' },
  { value: 7, shortLabel: 'So', label: 'Sonntag' },
] as const;

function parseDateInput(value: string | Date): Date {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const datePart = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart)
    ? new Date(`${datePart}T00:00:00`)
    : new Date(value);
}

function formatDateInput(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getIsoWeekday(value: string | Date): number {
  const day = parseDateInput(value).getDay();
  return day === 0 ? 7 : day;
}

export function getJobRecurrenceDates(rule: JobRecurrenceRule): string[] {
  const startDate = parseDateInput(rule.startDate);
  if (Number.isNaN(startDate.getTime())) return [];

  const interval = Math.max(1, Math.floor(Number(rule.interval) || 1));
  const duration = Math.max(1, Math.floor(Number(rule.duration ?? rule.durationWeeks) || 1));

  if (rule.intervalUnit === 'month' || rule.intervalUnit === 'year') {
    const dates: string[] = [];
    for (let offset = 0; offset < duration; offset += interval) {
      const occurrence = new Date(startDate);
      occurrence.setDate(1);
      if (rule.intervalUnit === 'month') {
        occurrence.setMonth(startDate.getMonth() + offset);
        occurrence.setDate(Math.min(startDate.getDate(), new Date(occurrence.getFullYear(), occurrence.getMonth() + 1, 0).getDate()));
      } else {
        occurrence.setFullYear(startDate.getFullYear() + offset);
        occurrence.setDate(Math.min(startDate.getDate(), new Date(occurrence.getFullYear(), occurrence.getMonth() + 1, 0).getDate()));
      }
      dates.push(formatDateInput(occurrence));
    }
    return dates;
  }

  const startWeekday = getIsoWeekday(startDate);
  const weekdays = [...new Set([startWeekday, ...(rule.weekdays || [])].map(Number))]
    .filter(day => day >= 1 && day <= 7)
    .sort((a, b) => a - b);

  const startMonday = new Date(startDate);
  startMonday.setDate(startMonday.getDate() - (startWeekday - 1));
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + duration * 7);
  const dates: string[] = [];

  for (let weekOffset = 0; ; weekOffset += interval) {
    const weekStart = new Date(startMonday);
    weekStart.setDate(startMonday.getDate() + weekOffset * 7);
    if (weekStart >= endDate) break;
    for (const weekday of weekdays) {
      const occurrence = new Date(weekStart);
      occurrence.setDate(weekStart.getDate() + weekday - 1);
      if (occurrence >= startDate && occurrence < endDate) dates.push(formatDateInput(occurrence));
    }
  }

  return dates;
}

export function getRecurrenceWeekdayLabel(weekday: number): string {
  return RECURRENCE_WEEKDAYS.find(day => day.value === weekday)?.label || '';
}
