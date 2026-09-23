import test from 'node:test';
import assert from 'node:assert/strict';
import {
  counterMatcher,
  formatNumberPattern,
  legacyCounter,
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

test('Fremde und frühere Nummern erhöhen den Zähler nur plausibel', () => {
  assert.equal(legacyCounter('RE-2025-017', 2025), 17);
  assert.equal(legacyCounter('2025-0042', 2025), 42);
  assert.equal(legacyCounter('R20250042', 2025), 42, 'vorangestellte Jahreszahl gehört nicht zum Zähler');
  assert.equal(legacyCounter('17/2025', 2025), 17, 'nachgestellte Jahreszahl gehört nicht zum Zähler');
  assert.equal(legacyCounter('Rechnung 5', 2025), 5);
  assert.equal(legacyCounter('RE-2025', 2025), null);
  assert.equal(legacyCounter('INV-123456789', 2025), null, 'unplausibel große Zähler bleiben unberücksichtigt');
  assert.equal(legacyCounter('ohne Nummer', 2025), null);
});
