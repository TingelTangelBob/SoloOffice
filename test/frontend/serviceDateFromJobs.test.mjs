import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveServiceDateFromJobs } from '../../.test-dist/utils/serviceDate.js';

test('ein Auftrag: dessen Ausführungsdatum, nicht das Rechnungsdatum', () => {
  assert.equal(deriveServiceDateFromJobs(['2026-10-14'], '2026-11-12'), '2026-10-14');
});

test('mehrere Aufträge am selben Tag ergeben diesen Tag', () => {
  assert.equal(deriveServiceDateFromJobs(['2026-10-14', '2026-10-14'], '2026-11-12'), '2026-10-14');
});

test('mehrere Tage: spätester Leistungstag, unabhängig von der Reihenfolge', () => {
  assert.equal(deriveServiceDateFromJobs(['2026-10-30', '2026-10-02', '2026-10-17'], '2026-11-12'), '2026-10-30');
});

test('Date-Objekte werden als lokaler Kalendertag gelesen', () => {
  assert.equal(deriveServiceDateFromJobs([new Date(2026, 9, 5, 0, 30)], '2026-11-12'), '2026-10-05');
});

test('ISO-Strings mit Uhrzeit liefern nur den Kalendertag', () => {
  assert.equal(deriveServiceDateFromJobs(['2026-10-14T00:00:00.000Z'], '2026-11-12'), '2026-10-14');
});

test('ohne Ausführungsdatum bleibt es beim Rechnungsdatum', () => {
  assert.equal(deriveServiceDateFromJobs([], '2026-11-12'), '2026-11-12');
  assert.equal(deriveServiceDateFromJobs([null, undefined, ''], new Date(2026, 10, 12)), '2026-11-12');
});

test('einzelne Aufträge ohne Datum werden übersprungen', () => {
  assert.equal(deriveServiceDateFromJobs([null, '2026-10-03'], '2026-11-12'), '2026-10-03');
});
