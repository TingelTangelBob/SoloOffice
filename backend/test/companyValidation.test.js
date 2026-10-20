import test from 'node:test';
import assert from 'node:assert/strict';
import { emailFormatError, postalCodeFormatError, vatIdFormatError, ibanFormatError, validateCompanyFormats, validateCompanyRequiredFields } from '../shared/companyValidation.js';

test('E-Mail: übliche Adressen sind gültig, unvollständige und fehlerhafte Formate nicht', () => {
  for (const email of ['buero@example.de', 'name+rechnung@sub.example.de', 'name@büro.de']) {
    assert.equal(emailFormatError(email), null, email);
  }
  for (const email of ['probe-kunde@', 'ohne-at.de', 'a@@example.de', 'a@-example.de', 'a@example..de', '.name@example.de', 'name..name@example.de', ' name@example.de', 'a@under_score.de', 'a<>@example.de', 123]) {
    assert.match(emailFormatError(email), /E-Mail-Adresse/, String(email));
  }
});

test('PLZ: führende Null bleibt gültig, deutsche fünfstellige Regel wird nicht auf andere Länder übertragen', () => {
  assert.equal(postalCodeFormatError('01067', 'Deutschland'), null);
  assert.equal(postalCodeFormatError('1234', 'Österreich'), null);
  assert.equal(postalCodeFormatError('SW1A 1AA', 'United Kingdom'), null);
  for (const country of ['Deutschland', 'DE', 'Germany', '', undefined]) {
    assert.match(postalCodeFormatError('1234', country), /5 Ziffern/);
  }
  assert.match(postalCodeFormatError(' 10115', 'DE'), /5 Ziffern/);
});

test('USt-IdNr.: deutsche Länge und Länderformate werden geprüft, ohne Registrierung zu behaupten', () => {
  for (const vatId of ['DE123456789', 'ATU12345678', 'NL123456789B01', 'FRAB123456789']) assert.equal(vatIdFormatError(vatId), null, vatId);
  for (const vatId of ['DE12', 'DE1234567890', 'de123456789', '123456789', 'DE123 456 789', 'XX123456789']) assert.ok(vatIdFormatError(vatId), vatId);
});

test('IBAN: gültige Prüfungen mit und ohne Leerzeichen und ausländische Konten', () => {
  for (const iban of ['DE89370400440532013000', 'DE89 3704 0044 0532 0130 00', 'GB82 WEST 1234 5698 7654 32', 'FR14 2004 1010 0505 0001 3M02 606']) {
    assert.equal(ibanFormatError(iban), null, iban);
  }
});

test('IBAN: falsche Prüfziffer, Länge, Sonderzeichen und Kleinbuchstaben verhindern Speichern', () => {
  for (const iban of ['DE90370400440532013000', 'DE8937040044053201300', 'DE89-3704-0044-0532-0130-00', 'de89370400440532013000', 'DE89\n370400440532013000', 'DE00370400440532013000']) {
    assert.ok(ibanFormatError(iban), iban);
  }
});

test('Leere optionale Angaben bleiben zulässig und Werte werden nicht verändert', () => {
  assert.deepEqual(validateCompanyFormats({ email: '', postalCode: '', taxId: null, bankAccount: '' }), {});
  const data = { bankAccount: 'DE89 3704 0044 0532 0130 00', email: 'buero@example.de' };
  const before = structuredClone(data);
  assert.deepEqual(validateCompanyFormats(data), {});
  assert.deepEqual(data, before);
});

test('Teiländerungen prüfen betroffene Felder mit gespeichertem Land und maßgeblicher Zahlungs-IBAN', () => {
  assert.deepEqual(validateCompanyFormats({ postalCode: '1234' }, { country: 'Österreich' }), {});
  assert.ok(validateCompanyFormats({ postalCode: '1234' }, { country: 'Deutschland' }).postalCode);
  assert.ok(validateCompanyFormats({ country: 'Deutschland' }, { postalCode: '1234' }).postalCode);
  assert.deepEqual(validateCompanyFormats({ name: 'Neuer Name' }), {});
  assert.deepEqual(validateCompanyFormats({ bankAccount: 'alter ungültiger Fallback', paymentInformation: { bankAccount: 'DE89370400440532013000' } }), {});
  assert.ok(validateCompanyFormats({ paymentInformation: { bankAccount: 'DE90 3704 0044 0532 0130 00' } })['paymentInformation.bankAccount']);
  assert.ok(validateCompanyFormats({ paymentInformation: 123 })['paymentInformation.bankAccount']);
});

test('Pflichtfelder: leere übermittelte Stammdaten werden abgewiesen, ausgelassene Felder bleiben für Teilupdates zulässig', () => {
  assert.deepEqual(validateCompanyRequiredFields({ name: 'Muster GmbH', city: 'Berlin' }), {});
  assert.deepEqual(validateCompanyRequiredFields({ name: '  ', email: '', phone: null, taxBusinessType: undefined }), {
    name: 'Bitte einen Firmennamen eingeben.',
    email: 'Bitte eine E-Mail-Adresse eingeben.',
    phone: 'Bitte eine Telefonnummer eingeben.',
    taxBusinessType: 'Bitte eine Betriebsart auswählen.',
  });
});
