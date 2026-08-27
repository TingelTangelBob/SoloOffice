import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCsv, csvFileName } from '../../.test-dist/utils/csvExport.js';
import {
  buildDuplicateCustomerMessage,
  findDuplicateCustomer,
  formatCustomerNumber,
} from '../../.test-dist/utils/customerUtils.js';
import {
  formatCurrency,
  formatDate,
  formatDecimalInput,
  formatTime,
  getCurrencySymbol,
  parseLocalizedNumber,
} from '../../.test-dist/utils/formatters.js';
import {
  formatInvoiceNumberPattern,
  validateInvoiceNumberPattern,
} from '../../.test-dist/utils/invoiceNumberPattern.js';
import {
  getIsoWeekday,
  getJobRecurrenceDates,
  getRecurrenceWeekdayLabel,
} from '../../.test-dist/utils/jobRecurrence.js';
import { calculateTotalHours } from '../../.test-dist/utils/jobUtils.js';
import { getEffectivePaymentInformation } from '../../.test-dist/utils/paymentInformation.js';
import { DEFAULT_TIME_ZONE, getTimeZoneLabel } from '../../.test-dist/utils/timeZones.js';

test('Rechnungsnummernmuster akzeptieren genau einen Zähler', () => {
  assert.equal(validateInvoiceNumberPattern('RE-{YYYY}-{NNNN}'), null);
  assert.match(validateInvoiceNumberPattern('RE-{YYYY}') || '', /genau einen Nummernplatzhalter/);
  assert.match(validateInvoiceNumberPattern('{NN}-{NNN}') || '', /genau einen Nummernplatzhalter/);
});

test('Rechnungsnummernmuster lehnen unbekannte Platzhalter und Steuerzeichen ab', () => {
  assert.match(validateInvoiceNumberPattern('RE-{DAY}-{NNN}') || '', /unbekannten Platzhalter/);
  assert.match(validateInvoiceNumberPattern('RE-\n-{NNN}') || '', /Steuerzeichen/);
  assert.match(validateInvoiceNumberPattern(`${'R'.repeat(48)}-{NN}`) || '', /1 bis 50 Zeichen/);
});

test('Rechnungsnummern werden mit Datum und Zähler formatiert', () => {
  const date = new Date(2026, 7, 28, 12, 0, 0);
  assert.equal(formatInvoiceNumberPattern('RE-{YY}-{MM}-{NNNN}', date, 42), 'RE-26-08-0042');
});

test('Lokalisierte Zahlen werden in deutschen und amerikanischen Formaten gelesen', () => {
  assert.equal(parseLocalizedNumber('1.234,56', 'de-DE', 'european'), 1234.56);
  assert.equal(parseLocalizedNumber('1,234.56', 'en-US', 'american'), 1234.56);
  assert.ok(Number.isNaN(parseLocalizedNumber('')));
});

test('Dezimalfelder bleiben gruppierungsfrei und lokalisieren den Trenner', () => {
  assert.equal(formatDecimalInput('1234.5', 'de-DE', 'european'), '1234,5');
  assert.equal(formatDecimalInput('1234,5', 'en-US', 'american'), '1234.5');
});

test('Währung und Symbol folgen der Workspace-Konfiguration', () => {
  assert.match(formatCurrency(12.5, 'de-DE', 'european', 'EUR'), /12,50/);
  assert.equal(getCurrencySymbol('en-US', 'american', 'USD'), '$');
  assert.match(formatCurrency(12.5, 'de-DE', 'european', 'ungueltig'), /12,50/);
});

test('Datum und Uhrzeit folgen den expliziten Anzeigeformaten', () => {
  const date = new Date(2026, 7, 28, 13, 5, 0);
  assert.equal(formatDate(date, 'de-DE', 'DD.MM.YYYY'), '28.08.2026');
  assert.equal(formatDate(date, 'de-DE', 'YYYY-MM-DD'), '2026-08-28');
  assert.equal(formatTime('13:05', 'de-DE', '12h'), '1:05 PM');
});

test('CSV schützt Text vor Formeleinschleusung, Zahlen bleiben berechenbar', () => {
  const csv = buildCsv(
    [{ label: '=SUM(A1:A2)', amount: -12.5, note: 'Text; mit "Zitat"' }],
    [
      { header: 'Name', value: row => row.label },
      { header: 'Betrag', value: row => row.amount, decimals: 2 },
      { header: 'Notiz', value: row => row.note },
    ],
  );

  assert.equal(csv, 'Name;Betrag;Notiz\r\n\'=SUM(A1:A2);-12,50;"Text; mit ""Zitat"""\r\n');
  assert.match(csvFileName('rechnungen'), /^rechnungen-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('Wöchentliche Wiederholungen respektieren Intervall und Wochentage', () => {
  assert.deepEqual(getJobRecurrenceDates({
    startDate: '2026-08-24',
    interval: 1,
    intervalUnit: 'week',
    duration: 2,
    weekdays: [1, 3],
  }), ['2026-08-24', '2026-08-26', '2026-08-31', '2026-09-02']);
});

test('Monatliche Wiederholungen begrenzen Monatsendtage korrekt', () => {
  assert.deepEqual(getJobRecurrenceDates({
    startDate: '2026-01-31',
    interval: 1,
    intervalUnit: 'month',
    duration: 3,
    weekdays: [],
  }), ['2026-01-31', '2026-02-28', '2026-03-31']);
});

test('Wochentagshelfer verwenden ISO-Wochentage', () => {
  assert.equal(getIsoWeekday('2026-08-30'), 7);
  assert.equal(getRecurrenceWeekdayLabel(1), 'Montag');
  assert.equal(getRecurrenceWeekdayLabel(9), '');
});

test('Zeitsummen verwenden Einträge und fallen auf den Altwert zurück', () => {
  assert.equal(calculateTotalHours({ timeEntries: [{ hoursWorked: 1.5 }, { hoursWorked: 2 }] }), 3.5);
  assert.equal(calculateTotalHours({ hoursWorked: 4 }), 4);
});

test('Zahlungsinformationen unterscheiden Firmen- und abweichenden Kontoinhaber', () => {
  const base = {
    name: 'Muster GmbH',
    bankAccount: 'DE-FIRMA',
    bic: 'FIRMA-BIC',
    paymentInformation: { accountHolder: 'Privat', bankAccount: 'DE-PRIVAT', bic: 'PRIVAT-BIC' },
  };
  assert.deepEqual(getEffectivePaymentInformation({ ...base, paymentInformationMode: 'company' }), {
    accountHolder: 'Muster GmbH', bankAccount: 'DE-FIRMA', bic: 'FIRMA-BIC',
  });
  assert.deepEqual(getEffectivePaymentInformation({ ...base, paymentInformationMode: 'custom' }), {
    accountHolder: 'Privat', bankAccount: 'DE-PRIVAT', bic: 'PRIVAT-BIC',
  });
});

test('Kundendubletten vergleichen Name, Adresse und E-Mail ohne Großschreibung', () => {
  const existing = {
    id: 'kunde-1', customerNumber: '42', name: 'Muster GmbH', email: 'INFO@MUSTER.DE',
    address: 'Hauptstraße 1', postalCode: '12345', city: 'Berlin',
  };
  const draft = {
    name: 'muster gmbh', email: 'info@muster.de', address: 'hauptstraße 1',
    postalCode: '12345', city: 'berlin',
  };
  assert.equal(findDuplicateCustomer([existing], draft)?.id, 'kunde-1');
  assert.equal(findDuplicateCustomer([existing], draft, 'kunde-1'), null);
  assert.equal(formatCustomerNumber(existing.customerNumber), '0042');
  assert.match(buildDuplicateCustomerMessage(existing, 'Kunde', 'Kundennummer'), /Kundennummer: 0042/);
});

test('Zeitzonen liefern verständliche Labels und einen stabilen Standard', () => {
  assert.equal(DEFAULT_TIME_ZONE, 'Europe/Berlin');
  assert.match(getTimeZoneLabel('Europe/Berlin'), /Berlin/);
  assert.equal(getTimeZoneLabel('Antarctica/Troll'), 'Antarctica/Troll');
  assert.equal(getTimeZoneLabel(), DEFAULT_TIME_ZONE);
});
