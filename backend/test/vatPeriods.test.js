import test from 'node:test';
import assert from 'node:assert/strict';
import { euerAttributionYear, nationwideHolidays, parseVatPeriodKey, paymentDueDate, shiftToBusinessDay, statutoryDueDate, vatPeriodKeyFor, vatPeriods } from '../shared/vat/index.js';

test('kennt bundesweite Feiertage zu Ostern 2026 und verschiebt Wochenenden', () => {
  const holidays = nationwideHolidays(2026);
  assert.ok(holidays.has('2026-04-03'));
  assert.ok(holidays.has('2026-04-06'));
  assert.equal(shiftToBusinessDay('2026-04-05'), '2026-04-07');
});

test('liefert Periodenschlüssel und weist ungültige Schlüssel zurück', () => {
  assert.equal(vatPeriodKeyFor('2026-11-30', 'quarterly'), '2026-Q4');
  assert.equal(parseVatPeriodKey('2026-03').end, '2026-03-31');
  assert.equal(parseVatPeriodKey('2026-Q1').start, '2026-01-01');
  assert.equal(parseVatPeriodKey('2026-Q5'), null);
  assert.equal(parseVatPeriodKey('1999-01'), null);
  assert.throws(() => vatPeriods(2026, 'weekly'), RangeError);
});

test('verschiebt Q4-Fälligkeit am Sonntag auf Montag, hält gesetzlichen Termin fest', () => {
  const q4 = parseVatPeriodKey('2026-Q4');
  assert.equal(statutoryDueDate(q4), '2027-01-10');
  assert.equal(paymentDueDate(q4), '2027-01-11');
});

test('wendet 10-Tage-Regel nach gesetzlicher Fälligkeit an und berücksichtigt DFV', () => {
  const decemberPayment = { kind: 'advance', periodKey: '2026-12', paidOn: '2027-01-08' };
  assert.equal(euerAttributionYear(decemberPayment).year, 2026);
  assert.equal(euerAttributionYear(decemberPayment).tenDayRule, true);
  assert.equal(euerAttributionYear({ ...decemberPayment, paidOn: '2027-01-11' }).year, 2027);
  assert.equal(euerAttributionYear(decemberPayment, { permanentExtension: true }).year, 2027);
  assert.equal(euerAttributionYear({ kind: 'advance', periodKey: '2026-11', paidOn: '2027-01-05' }, { permanentExtension: true }).year, 2026);
});
