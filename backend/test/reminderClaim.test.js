import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDefaultInterest,
  calculateReminderClaim,
  cumulativeReminderFee,
  describeInterest,
  interestSurchargePoints,
  normalizeReminderClaim,
} from '../shared/reminderClaim.js';

test('Verzugszinsen: 0 Tage ergeben 0,00', () => {
  assert.deepEqual(calculateDefaultInterest({ openAmount: 1000, dueDate: '2026-10-01', asOfDate: '2026-10-01', annualRatePercent: 6.27 }), { amount: 0, days: 0 });
  assert.equal(calculateDefaultInterest({ openAmount: 1000, dueDate: '2026-10-05', asOfDate: '2026-10-01', annualRatePercent: 6.27 }).days, 0);
});

test('Verzugszinsen: 30 Tage, Verzug beginnt am Folgetag der Fälligkeit', () => {
  // 1000 x 6,27 % x 30 / 365 = 5,1534... -> 5,15
  const result = calculateDefaultInterest({ openAmount: 1000, dueDate: '2026-10-01', asOfDate: '2026-10-31', annualRatePercent: 6.27 });
  assert.deepEqual(result, { amount: 5.15, days: 30 });
});

test('Verzugszinsen: Schaltjahr rechnet mit 365', () => {
  // 2028 ist Schaltjahr: 366 Tage Verzug, Divisor bleibt 365
  const result = calculateDefaultInterest({ openAmount: 365, dueDate: '2027-12-31', asOfDate: '2028-12-31', annualRatePercent: 10 });
  assert.equal(result.days, 366);
  assert.equal(result.amount, 36.6);
});

test('Verzugszinsen: kaufmännisch auf Cent gerundet', () => {
  // 100 x 5 % x 1 / 365 = 0,0137 -> 0,01; 73 x 10 % x 25 / 365 = 0,5 -> 0,50
  assert.equal(calculateDefaultInterest({ openAmount: 100, dueDate: '2026-01-01', asOfDate: '2026-01-02', annualRatePercent: 5 }).amount, 0.01);
  assert.equal(calculateDefaultInterest({ openAmount: 73, dueDate: '2026-01-01', asOfDate: '2026-01-26', annualRatePercent: 10 }).amount, 0.5);
  // 0,005 genau: 36,5 x 10 % x 1 / 365 = 0,01 ; 18,25 x 10 % x 1 / 365 = 0,005 -> 0,01
  assert.equal(calculateDefaultInterest({ openAmount: 18.25, dueDate: '2026-01-01', asOfDate: '2026-01-02', annualRatePercent: 10 }).amount, 0.01);
});

test('Verzugszinsen: Teilzahlung mindert den Betrag ab dem Zahlungsdatum', () => {
  // 1000 EUR, fällig 01.10.; 400 EUR am 11.10.; Stichtag 31.10.; Satz 10 %
  // 10 Tage x 1000 + 20 Tage x 600 = 22000 -> 22000 x 0,10 / 365 = 6,0274 -> 6,03
  const result = calculateDefaultInterest({
    invoiceTotal: 1000,
    payments: [{ date: '2026-10-11', amount: 400 }],
    dueDate: '2026-10-01', asOfDate: '2026-10-31', annualRatePercent: 10,
  });
  assert.deepEqual(result, { amount: 6.03, days: 30 });
});

test('Verzugszinsen: Zahlung vor Fälligkeit oder nach Stichtag', () => {
  const before = calculateDefaultInterest({ invoiceTotal: 1000, payments: [{ date: '2026-09-20', amount: 400 }], dueDate: '2026-10-01', asOfDate: '2026-10-31', annualRatePercent: 10 });
  assert.equal(before.amount, calculateDefaultInterest({ openAmount: 600, dueDate: '2026-10-01', asOfDate: '2026-10-31', annualRatePercent: 10 }).amount);
  const after = calculateDefaultInterest({ invoiceTotal: 1000, payments: [{ date: '2026-11-15', amount: 400 }], dueDate: '2026-10-01', asOfDate: '2026-10-31', annualRatePercent: 10 });
  assert.equal(after.amount, calculateDefaultInterest({ openAmount: 1000, dueDate: '2026-10-01', asOfDate: '2026-10-31', annualRatePercent: 10 }).amount);
});

test('Aufschlag nach Kundenart: 5 Verbraucher, 9 Unternehmer, unbekannt wie Verbraucher', () => {
  assert.equal(interestSurchargePoints('person'), 5);
  assert.equal(interestSurchargePoints('organization'), 9);
  assert.equal(interestSurchargePoints(undefined), 5);
});

test('Mahngebühren sind kumulativ je Stufe; Stufe 0 ohne Gebühr', () => {
  const settings = { reminderFeeStage1: 0, reminderFeeStage2: 2.5, reminderFeeStage3: 5 };
  assert.equal(cumulativeReminderFee(settings, 0), 0);
  assert.equal(cumulativeReminderFee(settings, 1), 0);
  assert.equal(cumulativeReminderFee(settings, 2), 2.5);
  assert.equal(cumulativeReminderFee(settings, 3), 7.5);
});

test('Forderung: Zinsen aus, Gebühr 0 bleibt als 0 in der Aufstellung', () => {
  const claim = calculateReminderClaim({
    invoice: { total: 119, outstandingAmount: 119, dueDate: '2026-10-01' },
    stage: 1, settings: { reminderFeeStage1: 0, reminderFeeStage2: 2.5, reminderFeeStage3: 5 },
    asOfDate: '2026-10-31',
  });
  assert.equal(claim.fee, 0);
  assert.equal(claim.interestEnabled, false);
  assert.equal(claim.interest, 0);
  assert.equal(claim.total, 119);
});

test('Forderung: Zinsen an, Unternehmer, Gebühr Stufe 2, keine USt-Aufschläge', () => {
  const claim = calculateReminderClaim({
    invoice: { total: 1190, outstandingAmount: 1000, paidAmount: 190, dueDate: '2026-10-01' },
    stage: 2,
    settings: { reminderFeeStage1: 0, reminderFeeStage2: 2.5, reminderFeeStage3: 5, reminderInterestEnabled: true, reminderBaseInterestRate: 1.27 },
    customerType: 'organization', asOfDate: '2026-10-31',
  });
  // Satz 1,27 + 9 = 10,27 %; 1000 x 10,27 % x 30 / 365 = 8,4411 -> 8,44
  assert.equal(claim.interestRatePercent, 10.27);
  assert.equal(claim.interest, 8.44);
  assert.equal(claim.interestDays, 30);
  assert.equal(claim.fee, 2.5);
  assert.equal(claim.total, 1010.94);
  assert.equal(describeInterest(claim), '30 Tage zu 10,27 % p. a.');
});

test('normalizeReminderClaim rechnet die Summe neu und lehnt Ungültiges ab', () => {
  const normalized = normalizeReminderClaim({ outstanding: 100, fee: 2.5, interestEnabled: true, interest: 1.2, interestDays: 10, interestRatePercent: 6.27, total: 9999 });
  assert.equal(normalized.total, 103.7);
  assert.equal(normalizeReminderClaim({ outstanding: -1, fee: 0 }), null);
  assert.equal(normalizeReminderClaim({ outstanding: 'x', fee: 0 }), null);
  assert.equal(normalizeReminderClaim(null), null);
  assert.equal(normalizeReminderClaim({ outstanding: 10, fee: 0, interestEnabled: false, interest: 5 }).total, 10);
});
