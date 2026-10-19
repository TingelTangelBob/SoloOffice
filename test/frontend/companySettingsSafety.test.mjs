import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parsePaymentMethods } from '../../.test-dist/utils/paymentInformation.js';
import { SETTINGS_PREFERENCE_KEYS, resetSettingsPreferences } from '../../.test-dist/utils/settingsDefaults.js';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const readSource = relative => readFileSync(path.join(srcDir, relative), 'utf8');

const defaults = {
  name: '',
  address: '',
  bankAccount: '',
  paymentInformation: { accountHolder: '', bankAccount: '', paymentMethods: [] },
  logo: null,
  icon: null,
  invoiceNumberPattern: 'RE-{YYYY}-{NNN}',
  creditNoteNumberPattern: 'GS-{YYYY}-{NNN}',
  invoiceStartNumber: 1,
  defaultPaymentDays: 30,
  immediatePaymentClause: 'Rechnung ist per sofort fällig, ohne Abzug',
  locale: 'de-DE',
  numberFormat: 'european',
  currency: 'EUR',
  dateFormat: 'DD.MM.YYYY',
  timeFormat: '24h',
  timeZone: 'Europe/Berlin',
  themeMode: 'system',
  primaryColor: '#2563eb',
  secondaryColor: '#64748b',
  terminologyProfile: 'customers',
  terminologyColorSource: 'profile',
  receiptLabel: 'Belege',
  jobTrackingEnabled: true,
  reportingEnabled: true,
  quotesEnabled: false,
  discountsEnabled: true,
  reminderDaysAfterDue: 7,
};

test('Standardwerte setzen nur Darstellung, Formate, Module und Begriffe zurück', () => {
  const current = {
    ...defaults,
    name: 'Muster GmbH',
    address: 'Hauptstraße 1',
    bankAccount: 'DE89370400440532013000',
    paymentInformation: { accountHolder: 'Muster GmbH', bankAccount: 'DE89370400440532013000', paymentMethods: ['Überweisung'] },
    logo: 'data:image/png;base64,AAAA',
    invoiceNumberPattern: 'MG-{YYYY}-{NNN}',
    creditNoteNumberPattern: 'MG-GS-{YYYY}-{NNN}',
    invoiceStartNumber: 1000,
    defaultPaymentDays: 14,
    immediatePaymentClause: 'Sofort fällig',
    locale: 'en-US',
    numberFormat: 'american',
    primaryColor: '#ff0000',
    receiptLabel: 'Ausgaben',
    quotesEnabled: true,
    discountsEnabled: false,
    reminderDaysAfterDue: 3,
  };

  const result = resetSettingsPreferences(current, defaults);

  // Firmendaten, Bankverbindung, Logo, Zahlungsbedingungen und Nummernkreise bleiben unverändert.
  assert.equal(result.name, 'Muster GmbH');
  assert.equal(result.address, 'Hauptstraße 1');
  assert.equal(result.bankAccount, 'DE89370400440532013000');
  assert.deepEqual(result.paymentInformation, current.paymentInformation);
  assert.equal(result.logo, 'data:image/png;base64,AAAA');
  assert.equal(result.invoiceNumberPattern, 'MG-{YYYY}-{NNN}');
  assert.equal(result.creditNoteNumberPattern, 'MG-GS-{YYYY}-{NNN}');
  assert.equal(result.invoiceStartNumber, 1000);
  assert.equal(result.defaultPaymentDays, 14);
  assert.equal(result.immediatePaymentClause, 'Sofort fällig');
  assert.equal(result.reminderDaysAfterDue, 3);

  // Darstellung, Formate, Module und Begriffe bekommen die Standardwerte.
  assert.equal(result.locale, 'de-DE');
  assert.equal(result.numberFormat, 'european');
  assert.equal(result.primaryColor, '#2563eb');
  assert.equal(result.receiptLabel, 'Belege');
  assert.equal(result.quotesEnabled, false);
  assert.equal(result.discountsEnabled, true);
});

test('Die Rücksetzliste enthält keine Stammdaten, Bankdaten oder Nummernkreise', () => {
  const protectedKeys = ['name', 'address', 'city', 'taxId', 'bankAccount', 'paymentInformation', 'logo', 'icon',
    'invoiceNumberPattern', 'creditNoteNumberPattern', 'invoiceStartNumber', 'defaultPaymentDays', 'immediatePaymentClause'];
  for (const key of protectedKeys) {
    assert.equal(SETTINGS_PREFERENCE_KEYS.includes(key), false, `${key} darf nicht zurückgesetzt werden`);
  }
});

test('Zahlungsarten: Komma, Leerzeichen und leere Einträge werden beim Übernehmen bereinigt', () => {
  assert.deepEqual(parsePaymentMethods('Überweisung, PayPal,  , Barzahlung'), ['Überweisung', 'PayPal', 'Barzahlung']);
  assert.deepEqual(parsePaymentMethods('Überweisung,'), ['Überweisung']);
  assert.deepEqual(parsePaymentMethods('Überweisung '), ['Überweisung']);
  assert.deepEqual(parsePaymentMethods('Girocard, Bar, '), ['Girocard', 'Bar']);
  assert.deepEqual(parsePaymentMethods(' , '), []);
  assert.deepEqual(parsePaymentMethods(''), []);
});

test('Firmeneinstellungen und E-Mail-Versand prüfen das Recht „workspace.settings“', () => {
  const settings = readSource('components/Settings.tsx');
  const email = readSource('components/EmailManagement.tsx');

  // Lesemodus ohne Recht: Eingaben deaktiviert, Speichern und Zurücksetzen blockiert.
  assert.match(settings, /const canEditSettings = can\('workspace\.settings'\);/);
  assert.match(settings, /<fieldset disabled=\{!canEditSettings\}/);
  assert.match(settings, /if \(isSaving \|\| !canEditSettings\) return;/);
  assert.match(settings, /if \(!canEditSettings\) return;/);

  // Der E-Mail-Versand nutzt das vorhandene Recht; „settings.write“ existiert nicht.
  assert.match(email, /can\('workspace\.settings'\)/);
  assert.doesNotMatch(email, /settings\.write/);
});
