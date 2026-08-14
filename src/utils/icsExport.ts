import type { CalendarEvent, JobEntry } from '../types';

/**
 * Kalenderdatei nach RFC 5545.
 *
 * Bewusst ein Download und kein Abonnement-Link: Ein Abonnement bräuchte einen
 * öffentlich erreichbaren, mit einem Token abgesicherten Endpunkt. Das ist bei
 * einer selbst gehosteten Anwendung eine Sicherheitsentscheidung, die getroffen
 * werden muss, bevor sie gebaut wird. Die Datei lässt sich dagegen in jeden
 * Kalender importieren und verlässt das Gerät nicht.
 */

const escapeText = (value: string) => value
  .replace(/\\/g, '\\\\')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

const pad = (value: number) => String(value).padStart(2, '0');

/** Datum ohne Uhrzeit, für ganztägige Einträge (VALUE=DATE). */
const toDateValue = (date: Date) => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;

/** Zeitpunkt in UTC, wie es RFC 5545 für DTSTAMP und Zeitangaben vorsieht. */
const toUtcValue = (date: Date) => [
  date.getUTCFullYear(),
  pad(date.getUTCMonth() + 1),
  pad(date.getUTCDate()),
  'T',
  pad(date.getUTCHours()),
  pad(date.getUTCMinutes()),
  pad(date.getUTCSeconds()),
  'Z',
].join('');

const encoder = new TextEncoder();

/**
 * Zeilen dürfen laut RFC 5545 höchstens 75 Oktette lang sein; längere werden
 * mit einem führenden Leerzeichen fortgesetzt.
 *
 * Gezählt wird in Oktetten, nicht in Zeichen: Umlaute belegen in UTF-8 zwei
 * Byte, eine Zählung nach Zeichen ergäbe also zu lange Zeilen. Umgekehrt darf
 * die Faltung kein Zeichen zerschneiden, deshalb wird zeichenweise addiert.
 */
const foldLine = (line: string) => {
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  // Die erste Zeile darf 75 Oktette nutzen, jede Fortsetzung nur 74 –
  // das führende Leerzeichen zählt mit.
  let limit = 75;

  for (const character of line) {
    const size = encoder.encode(character).length;
    if (currentBytes + size > limit) {
      parts.push(parts.length === 0 ? current : ` ${current}`);
      current = '';
      currentBytes = 0;
      limit = 74;
    }
    current += character;
    currentBytes += size;
  }
  if (current) parts.push(parts.length === 0 ? current : ` ${current}`);

  return parts.join('\r\n');
};

const parseLocalDate = (value: Date | string) => {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const datePart = String(value).slice(0, 10);
  const [year, month, day] = datePart.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
};

const withTime = (date: Date, time?: string) => {
  if (!time) return null;
  const [hours, minutes] = time.split(':').map(Number);
  if (!Number.isFinite(hours)) return null;
  const result = new Date(date);
  result.setHours(hours, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return result;
};

interface IcsSource {
  jobs: JobEntry[];
  events: CalendarEvent[];
  /** Wird Teil der UID, damit Einträge aus verschiedenen Arbeitsbereichen kollisionsfrei bleiben. */
  calendarName: string;
}

export function buildCalendarIcs({ jobs, events, calendarName }: IcsSource): string {
  const stamp = toUtcValue(new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SoloOffice//Kalender//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];

  jobs.forEach(job => {
    const day = parseLocalDate(job.date);
    const firstEntry = job.timeEntries?.find(entry => entry.startTime || entry.endTime);
    const start = withTime(day, job.startTime || firstEntry?.startTime);
    const end = withTime(day, job.endTime || firstEntry?.endTime);
    const description = [job.jobNumber, job.customerName, job.description]
      .filter(Boolean)
      .join(' · ');

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:job-${job.id}@solooffice`);
    lines.push(`DTSTAMP:${stamp}`);

    if (start && end && end > start) {
      lines.push(`DTSTART:${toUtcValue(start)}`);
      lines.push(`DTEND:${toUtcValue(end)}`);
    } else if (start) {
      lines.push(`DTSTART:${toUtcValue(start)}`);
    } else {
      // Ganztägig: DTEND ist laut Norm exklusiv, also der Folgetag.
      const nextDay = new Date(day);
      nextDay.setDate(nextDay.getDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${toDateValue(day)}`);
      lines.push(`DTEND;VALUE=DATE:${toDateValue(nextDay)}`);
    }

    lines.push(`SUMMARY:${escapeText(job.title || 'Auftrag')}`);
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
    if (job.location) lines.push(`LOCATION:${escapeText(job.location)}`);
    lines.push('END:VEVENT');
  });

  events.forEach(event => {
    const start = parseLocalDate(event.startDate);
    const endExclusive = parseLocalDate(event.endDate);
    endExclusive.setDate(endExclusive.getDate() + 1);
    if (endExclusive <= start) endExclusive.setTime(start.getTime() + 24 * 60 * 60 * 1000);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:event-${event.id}@solooffice`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${toDateValue(start)}`);
    lines.push(`DTEND;VALUE=DATE:${toDateValue(endExclusive)}`);
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`);
    lines.push('TRANSP:TRANSPARENT');
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export function downloadCalendarIcs(source: IcsSource, fileName: string): void {
  const blob = new Blob([buildCalendarIcs(source)], { type: 'text/calendar;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
