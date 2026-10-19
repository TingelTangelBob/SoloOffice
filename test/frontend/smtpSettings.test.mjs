import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultTestEmailRecipient,
  isSingleEmailAddress,
  smtpFormFromSettings,
  SMTP_PROVIDERS,
  smtpProviderForSettings,
  smtpSettingsDirty,
  smtpSettingsPayload,
  validateSmtpSettings,
} from '../../.test-dist/utils/smtpSettings.js';

const storedSettings = {
  smtp_host: 'smtp.example.de', smtp_port: 587, smtp_secure: false,
  smtp_user: 'buero@example.de', smtp_pass_set: true,
  email_from: 'buero@example.de', email_from_name: 'Mein Büro', is_enabled: true,
};

test('gespeicherte Passwörter und alte Passwortmasken gelangen nie in das Eingabefeld', () => {
  const current = smtpFormFromSettings({ ...storedSettings, smtp_pass: 'versehentlich-geliefert' });
  assert.equal(current.smtp_pass, '');
  assert.equal(current.smtp_pass_set, true);
  const legacy = smtpFormFromSettings({ smtp_pass: '****' });
  assert.equal(legacy.smtp_pass, '');
  assert.equal(legacy.smtp_pass_set, true);
});

test('Änderungen an Server, Aktivierung und neuem Passwort machen den gespeicherten Stand ungültig', () => {
  const saved = smtpFormFromSettings(storedSettings);
  assert.equal(smtpSettingsDirty(saved, { ...saved }), false);
  for (const changes of [{ smtp_host: 'neuer.example.de' }, { is_enabled: false }, { smtp_pass: 'neues Passwort' }]) {
    assert.equal(smtpSettingsDirty(saved, { ...saved, ...changes }), true);
  }
  // Nur ein noch nicht geladener Stand ist kein bearbeitbares Formular.
  assert.equal(smtpSettingsDirty(null, saved), false);
});

test('Speichern und Verbindungsprüfung behalten ein vorhandenes Passwort und senden sichtbare Entwurfswerte', () => {
  const settings = { ...smtpFormFromSettings(storedSettings), smtp_host: ' neu.example.de ', smtp_user: ' buero@example.de ' };
  const payload = smtpSettingsPayload(settings);
  assert.equal(payload.smtp_host, 'neu.example.de');
  assert.equal(payload.smtp_user, 'buero@example.de');
  assert.equal(payload.smtp_port, 587);
  assert.equal(payload.smtp_pass, '');
  assert.equal('smtp_pass_set' in payload, false);
  assert.deepEqual(validateSmtpSettings(settings, true), {});
  assert.equal(smtpSettingsPayload({ ...settings, smtp_pass: '  unverändert  ' }).smtp_pass, '  unverändert  ');
});

test('unvollständiger deaktivierter Stand ist speicherbar, aber keine erfolgreiche Verbindungsprüfung', () => {
  const empty = smtpFormFromSettings();
  assert.deepEqual(validateSmtpSettings(empty), {});
  const connectionErrors = validateSmtpSettings(empty, true);
  for (const field of ['smtp_host', 'smtp_user', 'smtp_pass', 'email_from']) assert.ok(connectionErrors[field]);
  assert.ok(validateSmtpSettings({ ...empty, is_enabled: true }).smtp_pass);
});

test('falsche Ports und Server-URLs werden vor einer Prüfung abgewiesen', () => {
  const settings = smtpFormFromSettings(storedSettings);
  for (const port of ['', '0', '65536', '1.5', '587smtp']) assert.ok(validateSmtpSettings({ ...settings, smtp_port: port }).smtp_port);
  for (const port of ['1', '587', '65535']) assert.equal(validateSmtpSettings({ ...settings, smtp_port: port }).smtp_port, undefined);
  assert.ok(validateSmtpSettings({ ...settings, smtp_host: 'https://smtp.example.de' }).smtp_host);
});

test('Testmail startet beim eigenen Absender und akzeptiert genau eine Adresse', () => {
  const settings = smtpFormFromSettings(storedSettings);
  assert.equal(defaultTestEmailRecipient(settings), 'buero@example.de');
  assert.equal(defaultTestEmailRecipient({ ...settings, test_email: ' test@example.de ' }), 'test@example.de');
  assert.equal(isSingleEmailAddress(' buero@example.de '), true);
  for (const address of ['', 'name', 'name@example', 'a@example.de,b@example.de', 'a@example.de\nb@example.de', '\r\na@example.de', 'a\u0000@example.de', 'a\u007f@example.de']) assert.equal(isSingleEmailAddress(address), false);
});

test('Dashboard-Anbietervorlagen belegen SMTP vor und erkennen nur übereinstimmende Konfigurationen', () => {
  for (const provider of ['hetzner', 'gmail', 'icloud']) {
    const settings = { ...smtpFormFromSettings(storedSettings), ...SMTP_PROVIDERS[provider] };
    assert.equal(smtpProviderForSettings(settings), provider);
    assert.equal(smtpProviderForSettings({ ...settings, smtp_port: '2525' }), 'eigen');
    assert.deepEqual(validateSmtpSettings(settings, true), {});
  }
  assert.equal(smtpProviderForSettings(smtpFormFromSettings(storedSettings)), 'eigen');
});
