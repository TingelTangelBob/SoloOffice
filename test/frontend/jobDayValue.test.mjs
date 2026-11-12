// Zeitzone vor jedem Date-Zugriff festlegen: der Fehler zeigt sich nur östlich von UTC.
process.env.TZ = 'Europe/Berlin';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toJobDayValue, jobDayToDate } from '../../.test-dist/utils/invoicePeriod.js';
import { deriveServiceDateFromJobs } from '../../.test-dist/utils/serviceDate.js';

test('Testlauf nutzt Europe/Berlin', () => {
  assert.equal(new Date(2026, 10, 5).toISOString(), '2026-11-04T23:00:00.000Z');
});

test('Formularwert 05.11.2026 (lokale Mitternacht) bleibt der 05.11.', () => {
  const formValue = new Date('2026-11-05T00:00:00');
  assert.equal(toJobDayValue(formValue), '2026-11-05');
  assert.equal(deriveServiceDateFromJobs([formValue], '2026-11-12'), '2026-11-05');
});

test('als UTC-Zeitstempel gespeicherte lokale Mitternacht bleibt der 05.11.', () => {
  assert.equal(toJobDayValue('2026-11-04T23:00:00.000Z'), '2026-11-05');
  assert.equal(deriveServiceDateFromJobs(['2026-11-04T23:00:00.000Z'], '2026-11-12'), '2026-11-05');
});

test('Sommerzeit: 05.07.2026 lokal ist 22:00 UTC am Vortag und bleibt der 05.07.', () => {
  assert.equal(toJobDayValue('2026-07-04T22:00:00.000Z'), '2026-07-05');
});

test('Backend-DATE als UTC-Mitternacht und reiner Datumsstring bleiben unverändert', () => {
  assert.equal(toJobDayValue('2026-11-05T00:00:00.000Z'), '2026-11-05');
  assert.equal(toJobDayValue(new Date('2026-11-05T00:00:00.000Z')), '2026-11-05');
  assert.equal(toJobDayValue('2026-11-05'), '2026-11-05');
});

test('ungültige und leere Werte ergeben einen leeren String', () => {
  assert.equal(toJobDayValue(''), '');
  assert.equal(toJobDayValue(null), '');
  assert.equal(toJobDayValue(undefined), '');
  assert.equal(toJobDayValue('kein Datum'), '');
});

test('mehrere Aufträge: spätester Tag, gemischte Formen', () => {
  assert.equal(
    deriveServiceDateFromJobs(['2026-10-13', new Date('2026-11-16T00:00:00'), '2026-11-04T23:00:00.000Z'], '2026-11-12'),
    '2026-11-16',
  );
});

test('jobDayToDate liefert die lokale Mitternacht des Auftragstages', () => {
  const day = jobDayToDate('2026-11-04T23:00:00.000Z');
  assert.equal([day.getFullYear(), day.getMonth() + 1, day.getDate(), day.getHours()].join('-'), '2026-11-5-0');
  assert.ok(Number.isNaN(jobDayToDate('').getTime()));
});
