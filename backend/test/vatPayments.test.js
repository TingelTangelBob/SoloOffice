import test from 'node:test';
import assert from 'node:assert/strict';
import { mapVatPayment, validateVatPayment } from '../services/vatPayments.js';

test('USt-Zahlungen prüfen Art, Jahr, Betrag, Zeitraum und Notiz', () => {
  const profile = { vatPeriod: 'quarterly', vatPermanentExtension: true };
  const valid = validateVatPayment({ kind: 'advance', taxYear: 2026, periodKey: '2026-Q2', amount: 123.45, paidOn: '2026-07-08' }, { profile });
  assert.equal(valid.value.dueDate, '2026-08-10');
  assert.deepEqual(valid.warnings, []);
  assert.equal(validateVatPayment({ kind: 'other', taxYear: 2026, amount: 1 }).error, 'Ungültige Art der Umsatzsteuer-Zahlung.');
  assert.equal(validateVatPayment({ kind: 'advance', taxYear: 2026, periodKey: '2026', amount: 1 }).error,
    'Für eine Vorauszahlung ist ein Monat oder Quartal im Steuerjahr erforderlich.');
  assert.match(validateVatPayment({ kind: 'advance', taxYear: 2026, periodKey: '2026-01', amount: 1.001 }, { profile }).error, /zwei Nachkommastellen/);
  assert.match(validateVatPayment({ kind: 'special_prepayment', taxYear: 2026, periodKey: '2026-Q1', amount: 1 }).error, /keinen Voranmeldungszeitraum/);
});

test('abweichender UStVA-Rhythmus ist ein Hinweis, kein Validierungsfehler', () => {
  const result = validateVatPayment({ kind: 'advance', taxYear: 2026, periodKey: '2026-03', amount: 50 }, {
    profile: { vatPeriod: 'quarterly', vatPermanentExtension: false },
  });
  assert.ok(result.value);
  assert.match(result.warnings[0], /weicht vom im Steuerprofil hinterlegten Voranmeldungsrhythmus ab/);
});

test('Jahresnachzahlung und Erstattung erlauben ihre vereinbarten Zeiträume', () => {
  assert.equal(validateVatPayment({ kind: 'annual_payment', taxYear: 2026, periodKey: '2026', amount: 25 }).value.periodKey, '2026');
  assert.equal(validateVatPayment({ kind: 'annual_payment', taxYear: 2026, periodKey: null, amount: 25 }).value.periodKey, null);
  assert.equal(validateVatPayment({ kind: 'refund', taxYear: 2026, periodKey: '2026-Q4', amount: 25 }).value.periodKey, '2026-Q4');
});

test('Zahlungs-Mapping liefert camelCase und ISO-DATUM', () => {
  const mapped = mapVatPayment({ id: 'id', kind: 'refund', tax_year: 2026, period_key: null,
    due_date: new Date(2026, 1, 10), paid_on: new Date(2026, 1, 12), amount: '35.20',
    euer_entry_id: null, source: 'manual', notes: null, created_at: null, updated_at: null });
  assert.equal(mapped.taxYear, 2026);
  assert.equal(mapped.amount, 35.2);
  assert.equal(mapped.dueDate, '2026-02-10');
  assert.equal(mapped.paidOn, '2026-02-12');
  assert.equal(mapped.euerEntryId, null);
});
