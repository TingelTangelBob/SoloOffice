import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectDateOrder,
  detectNumberFormat,
  normaliseEuerCategory,
  parseDate,
  parseEntryType,
  parseNumber,
  parsePaymentStatus,
  parseTime,
} from '../utils/importValues.js';

test('Zahlen im deutschen und englischen Format werden erkannt', () => {
  assert.equal(parseNumber('10,00 €'), 10);
  assert.equal(parseNumber('1.234,56'), 1234.56);
  assert.equal(parseNumber('1,234.56'), 1234.56);
  assert.equal(parseNumber('1.234'), 1234, 'ein Punkt vor drei Ziffern ist ein Tausenderpunkt');
  assert.equal(parseNumber('0.125'), 0.125);
  assert.equal(parseNumber('12.5'), 12.5);
  assert.equal(parseNumber('1,0'), 1);
  assert.equal(parseNumber('1.234', { decimal: '.' }), 1.234, 'erkanntes Spaltenformat hat Vorrang');
  assert.equal(parseNumber('1.234,5', { decimal: ',' }), 1234.5);
});

test('negative Beträge, Einheiten und Sonderschreibweisen', () => {
  assert.equal(parseNumber('-10,00 €'), -10);
  assert.equal(parseNumber('\u221210,00'), -10, 'typografisches Minus');
  assert.equal(parseNumber('(123,45)'), -123.45, 'Klammern stehen für negative Beträge');
  assert.equal(parseNumber('10,00-'), -10, 'nachgestelltes Minus');
  assert.equal(parseNumber('10,-'), 10, '„10,-“ ist ein glatter Betrag');
  assert.equal(parseNumber('1,5 Std.'), 1.5);
  assert.equal(parseNumber('EUR 12.50'), 12.5);
  assert.equal(parseNumber('\u2013'), null, 'ein Gedankenstrich ist kein Wert');
  assert.equal(parseNumber('12-15'), null, 'Bereiche sind keine Zahl');
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber(42), 42);
});

test('Dezimaltrennzeichen einer Spalte wird aus den Werten erkannt', () => {
  assert.equal(detectNumberFormat(['5,00 €', '10,00 €', '1.234,00 €']).decimal, ',');
  assert.equal(detectNumberFormat(['5.00', '10.50', '1,234.00']).decimal, '.');
  assert.equal(detectNumberFormat(['1.234', '2.345']).decimal, ',', 'ohne Beleg gilt das deutsche Format');
});

test('Datumswerte werden ohne Zeitzonenverschiebung gelesen', () => {
  assert.equal(parseDate('15.09.21'), '2021-09-15');
  assert.equal(parseDate('5.3.2025'), '2025-03-05');
  assert.equal(parseDate('2025-03-05'), '2025-03-05');
  assert.equal(parseDate('2025/03/05'), '2025-03-05');
  assert.equal(parseDate('05.03.2025 00:00:00'), '2025-03-05');
  assert.equal(parseDate('2025-03-05T23:30:00+02:00'), '2025-03-05');
  assert.equal(parseDate('20250305'), '2025-03-05');
  assert.equal(parseDate('15. September 2021'), '2021-09-15');
  assert.equal(parseDate('3. Mär 2024'), '2024-03-03');
  assert.equal(parseDate('Sep 15, 2021'), '2021-09-15');
  assert.equal(parseDate('31.02.2025'), null, 'ungültige Tage werden abgelehnt');
  assert.equal(parseDate('45292'), '2024-01-01', 'Excel-Seriennummer');
  assert.equal(parseDate(45658), '2025-01-01');
  assert.equal(parseDate('123'), null, 'kleine Zahlen sind kein Datum');
  assert.equal(parseDate('irgendwann'), null);
  assert.equal(parseDate('03/15/2025', { order: 'mdy' }), '2025-03-15');
});

test('Reihenfolge von Tag und Monat wird je Spalte erkannt', () => {
  assert.equal(detectDateOrder(['15.09.21', '01.10.21']), 'dmy');
  assert.equal(detectDateOrder(['09/15/2021', '10/01/2021']), 'mdy');
  assert.equal(detectDateOrder(['01/02/2021']), 'dmy');
});

test('Uhrzeiten, Buchungsarten, Kategorien und Zahlungsstatus', () => {
  assert.equal(parseTime('9:05'), '09:05');
  assert.equal(parseTime(0.5), '12:00', 'Excel speichert Uhrzeiten als Tagesbruchteil');
  assert.equal(parseEntryType('Einnahme'), 'income');
  assert.equal(parseEntryType('Ausgaben'), 'expense');
  assert.equal(parseEntryType('+'), 'income');
  assert.equal(parseEntryType('-'), 'expense');
  assert.equal(parseEntryType('Gutschrift'), null);
  assert.equal(normaliseEuerCategory('Fahrtkosten'), 'travel');
  assert.equal(normaliseEuerCategory('Büromaterial'), 'office');
  assert.equal(normaliseEuerCategory('software'), 'software');
  assert.equal(normaliseEuerCategory('Unbekannt'), null);
  assert.equal(parsePaymentStatus('bezahlt'), 'paid');
  assert.equal(parsePaymentStatus('offen'), 'open');
  assert.equal(parsePaymentStatus('vielleicht'), null);
});
