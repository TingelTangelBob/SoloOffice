import test from 'node:test';
import assert from 'node:assert/strict';
import {
  counterMatcher,
  formatNumberPattern,
  invoiceDateParts,
  numberPatternError,
} from '../utils/invoiceNumberPattern.js';

test('Rechnungsnummernmuster akzeptieren genau einen Zähler', () => {
  assert.equal(numberPatternError('RE-{YYYY}-{NNN}'), null);
  assert.match(numberPatternError('RE-{YYYY}'), /genau einen Zähler/);
  assert.match(numberPatternError('RE-{NN}-{NNN}'), /genau einen Zähler/);
  assert.match(numberPatternError('RE-{FOO}-{NNN}'), /unbekannten Platzhalter/);
});

test('Datum und Nummer werden ohne lokale Zeitzonenverschiebung formatiert', () => {
  const date = invoiceDateParts('2028-02-29');
  assert.deepEqual(date, { year: 2028, month: '02' });
  assert.equal(invoiceDateParts('2027-02-29'), null);
  assert.equal(formatNumberPattern('RE-{YY}-{MM}-{NNNN}', date, 42), 'RE-28-02-0042');
});

test('Zähler werden aus bestehenden Nummern sicher erkannt', () => {
  const matcher = counterMatcher('RE.{YYYY}/{NNN}', { year: 2026, month: '08' });
  assert.deepEqual('RE.2026/017'.match(matcher)?.slice(1), ['017']);
  assert.equal(matcher.test('REX2026/017'), false);
});
