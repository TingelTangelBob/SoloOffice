import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSingleEmailAddress,
  publicSmtpSettings,
  SmtpSettingsError,
  smtpErrorMessage,
  smtpPassword,
  smtpTransportOptions,
  validateSmtpSettings,
} from '../utils/smtpSettings.js';

const enabled = {
  smtp_host: 'smtp.example.invalid', smtp_port: 587, smtp_secure: false,
  smtp_user: 'mail@example.invalid', smtp_pass: 'fixture-password',
  email_from: 'sender@example.invalid', email_from_name: 'Musterbetrieb',
  is_enabled: true, test_email: 'test@example.invalid',
};

test('SMTP akzeptiert genau eine Mailadresse und keine Empfängerlisten oder Steuerzeichen', () => {
  for (const address of ['mail@example.invalid', ' MAIL@EXAMPLE.INVALID ']) {
    assert.equal(isSingleEmailAddress(address), true);
  }
  for (const address of [null, '', {}, 'mail@example', 'Name <mail@example.invalid>',
    'one@example.invalid,two@example.invalid', 'one@example.invalid;two@example.invalid',
    'one@example.invalid\r\nBcc: two@example.invalid', 'one\0@example.invalid', 'one\x7f@example.invalid']) {
    assert.equal(isSingleEmailAddress(address), false);
  }
});

test('Leere oder maskierte Passwortfelder bewahren das gespeicherte Geheimnis', () => {
  for (const empty of [undefined, null, '', '****']) {
    assert.equal(smtpPassword(empty, 'stored-password'), 'stored-password');
    assert.equal(smtpPassword(empty), '');
  }
  assert.equal(smtpPassword('  new-password  ', 'stored-password'), '  new-password  ');
  for (const invalid of [{}, 'invalid\npassword', 'invalid\0password', 'x'.repeat(4097)]) {
    assert.throws(() => smtpPassword(invalid), { name: 'Error', status: 400 });
  }
});

test('Aktiver Versand verlangt vollständige Einstellungen; gespeichertes Passwort reicht beim Bearbeiten', () => {
  const normalised = validateSmtpSettings({ ...enabled, smtp_host: ' smtp.example.invalid ', smtp_port: '587', smtp_user: ' mail@example.invalid ' });
  assert.equal(normalised.smtp_host, enabled.smtp_host);
  assert.equal(normalised.smtp_port, 587);
  assert.equal(normalised.smtp_user, enabled.smtp_user);
  assert.equal(validateSmtpSettings({ ...enabled, smtp_pass: '' }, { hasStoredPassword: true }).smtp_pass, '');
  assert.equal(validateSmtpSettings({ smtp_secure: false, is_enabled: false }).is_enabled, false);
  assert.throws(() => validateSmtpSettings({ ...enabled, smtp_pass: '' }), /SMTP-Passwort/);
  assert.throws(() => validateSmtpSettings({ ...enabled, smtp_host: '' }), /Server und Benutzer/);
  assert.throws(() => validateSmtpSettings({ ...enabled, email_from: '' }), /Absenderadresse/);
  assert.throws(() => validateSmtpSettings({ ...enabled, smtp_host: 'https://smtp.example.invalid' }), /Servernamen/);
  assert.throws(() => validateSmtpSettings({ ...enabled, email_from_name: 'Name\r\nBcc: other@example.invalid' }), SmtpSettingsError);
});

test('SMTP prüft Portgrenzen und trennt STARTTLS von SSL/TLS', () => {
  for (const port of [0, -1, 65536, 587.5, 'invalid']) {
    assert.throws(() => validateSmtpSettings({ ...enabled, smtp_port: port }), /SMTP-Port/);
  }
  assert.throws(() => validateSmtpSettings({ ...enabled, smtp_port: 465 }), /SSL\/TLS/);
  assert.throws(() => validateSmtpSettings({ ...enabled, smtp_secure: true }), /STARTTLS/);
  assert.throws(() => validateSmtpSettings({ ...enabled, smtp_secure: 'false' }), /Schalter/);
  assert.throws(() => validateSmtpSettings({ ...enabled, is_enabled: 'true' }), /Schalter/);
  const ssl = validateSmtpSettings({ ...enabled, smtp_port: 465, smtp_secure: true });
  assert.equal(ssl.smtp_secure, true);
  const connection = validateSmtpSettings({ ...enabled, is_enabled: false, email_from: '' }, { forConnection: true });
  assert.equal(connection.email_from, '');
  const starttls = smtpTransportOptions(enabled, 'stored-password');
  assert.equal(starttls.requireTLS, true);
  assert.deepEqual(starttls.auth, { user: enabled.smtp_user, pass: 'stored-password' });
  assert.equal(starttls.connectionTimeout, 10000);
  assert.equal(starttls.socketTimeout, 30000);
  assert.equal(smtpTransportOptions(ssl, 'stored-password').requireTLS, false);
});

test('Öffentliche SMTP-Antwort enthält nur den Passwortstatus und keine internen Felder', () => {
  const result = publicSmtpSettings({ ...enabled, smtp_pass_encrypted: 'encrypted-secret', workspace_id: 'workspace-fixture', secret: 'hidden' });
  assert.equal(result.smtp_pass, '');
  assert.equal(result.smtp_pass_set, true);
  assert.equal(result.smtp_pass_encrypted, undefined);
  assert.equal(result.workspace_id, undefined);
  assert.equal(result.secret, undefined);
  assert.equal(publicSmtpSettings().smtp_pass_set, false);
  assert.equal(publicSmtpSettings().smtp_port, 587);
});

test('SMTP-Fehler erklären das Problem ohne die rohe Antwort oder Zugangsdaten', () => {
  const cases = [
    ['EAUTH', '535 Authentication failed fixture-secret', /Anmeldung.*abgelehnt/],
    ['ENOTFOUND', 'getaddrinfo smtp.example.invalid fixture-secret', /nicht gefunden/],
    ['ETIMEDOUT', 'connection timeout fixture-secret', /nicht rechtzeitig/],
    ['ECONNREFUSED', 'connection refused fixture-secret', /verweigert/],
    ['CERT_HAS_EXPIRED', 'expired certificate fixture-secret', /Zertifikat/],
    ['ETLS', 'STARTTLS unavailable fixture-secret', /verschlüsselte Verbindung/],
    ['EENVELOPE', 'mailbox denied fixture-secret', /Adresse.*abgelehnt|adresse.*abgelehnt/],
    ['UNKNOWN', 'fixture-secret rejected by smtp.internal.invalid', /Mailverbindung.*fehlgeschlagen/],
  ];
  for (const [code, message, expected] of cases) {
    const friendly = smtpErrorMessage({ code, message });
    assert.match(friendly, expected);
    assert.doesNotMatch(friendly, /fixture-secret|smtp\.internal/);
  }
});
