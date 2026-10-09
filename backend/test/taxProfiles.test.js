import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTaxProfile } from '../shared/financeDefaults.js';
import { toTaxProfile } from '../services/taxProfiles.js';
import { TAX_PROFILE_PAYLOAD_FIELDS, validateTaxProfilePayload } from '../utils/taxProfileValidation.js';

function payload(year = 2026) {
  const profile = defaultTaxProfile(year);
  return Object.fromEntries(TAX_PROFILE_PAYLOAD_FIELDS.map(key => [key, profile[key]]));
}

test('vollständige Standardprofile validieren; Zeitstempel und Version gehören nicht zum PUT', () => {
  const candidate = payload();
  assert.deepEqual(validateTaxProfilePayload(candidate, 2026), { valid: true, errors: [], value: candidate });
  for (const forbidden of ['disclaimerAcceptedAt', 'churchTaxConsentAt', 'paramsVersion', 'updatedAt', 'id']) {
    assert.ok(!TAX_PROFILE_PAYLOAD_FIELDS.includes(forbidden));
  }
});

test('Profilvalidierung weist unbekannte Felder, Pfadjahr und ungültige Jahre zurück', () => {
  const unknown = { ...payload(), taxId: 'soll-nicht-gespeichert-werden' };
  assert.match(validateTaxProfilePayload(unknown, 2026).errors.join(' '), /Unbekanntes Profilfeld/);
  assert.match(validateTaxProfilePayload(payload(2027), 2026).errors.join(' '), /Pfad überein/);
  const invalidYear = { ...payload(), year: 2201 };
  assert.match(validateTaxProfilePayload(invalidYear, 2201).errors.join(' '), /Steuerjahr/);
});

test('Profilvalidierung prüft ISO-Daten, Enumwerte, Prozentwerte und Kinderzahlen', () => {
  const badDate = { ...payload(), startedOn: '2026-02-30' };
  assert.match(validateTaxProfilePayload(badDate, 2026).errors.join(' '), /ISO-Datum/);
  const badEnum = { ...payload(), healthInsurance: 'kassenname' };
  assert.match(validateTaxProfilePayload(badEnum, 2026).errors.join(' '), /healthInsurance/);
  const badRate = { ...payload(), additionalHealthRate: 100.01 };
  assert.match(validateTaxProfilePayload(badRate, 2026).errors.join(' '), /additionalHealthRate/);
  const badChildren = { ...payload(), children: 1, childrenUnder25: 2 };
  assert.match(validateTaxProfilePayload(badChildren, 2026).errors.join(' '), /Kinder unter 25/);
});

test('toTaxProfile gibt nur Whitelist-Felder zurück und verbirgt KiSt ohne separate Einwilligung', () => {
  const row = {
    id: 'profile-id', year: 2026,
    profile: { ...payload(), churchTaxLiable: false, taxId: 'niemals ausgeben' },
    disclaimer_accepted_at: '2026-01-02T03:04:05.000Z', church_tax_consent_at: null,
    params_version: '2026.1', updated_at: '2026-01-03T04:05:06.000Z',
  };
  const converted = toTaxProfile(row);
  assert.equal(converted.churchTaxLiable, null);
  assert.equal(converted.churchTaxConsentAt, null);
  assert.equal(converted.disclaimerAcceptedAt, row.disclaimer_accepted_at);
  assert.equal(converted.paramsVersion, '2026.1');
  assert.equal(Object.hasOwn(converted, 'taxId'), false);
});

test('Profilvalidierung verhindert zukünftiges Geburtsjahr und überhöhten PKV-Basisanteil', () => {
  assert.equal(validateTaxProfilePayload({ ...payload(), birthYear: 2027 }, 2026).valid, false);
  assert.equal(validateTaxProfilePayload({ ...payload(), privateHealthMonthly: 300, privateHealthBasicMonthly: 301 }, 2026).valid, false);
  assert.equal(validateTaxProfilePayload({ ...payload(), privateHealthMonthly: 300, privateHealthBasicMonthly: 300 }, 2026).valid, true);
});

test('getTaxProfile unterstützt eine injizierte Query-Funktion', async () => {
  const { getTaxProfile } = await import('../services/taxProfiles.js');
  let sql;
  const profile = await getTaxProfile(2026, async (text, values) => {
    sql = { text, values };
    return { rows: [] };
  });
  assert.match(sql.text, /FROM tax_profiles WHERE year = \$1/);
  assert.deepEqual(sql.values, [2026]);
  assert.equal(profile.year, 2026);
  assert.equal(profile.churchTaxLiable, null);
});
