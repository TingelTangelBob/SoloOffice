import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import router from '../routes/emailManagement.js';
import { pool } from '../database.js';
import { decryptSecret, encryptSecret } from '../utils/secretBox.js';
import { getRequestContext, runWithRequestContext } from '../utils/requestContext.js';

const plaintextPassword = 'fixture-only-smtp-password';
const inputSettings = {
  smtp_host: 'smtp.saved.example.invalid', smtp_port: 587, smtp_secure: false,
  smtp_user: 'account@example.invalid', smtp_pass: '', email_from: 'sender@example.invalid',
  email_from_name: 'Musterbetrieb', is_enabled: true, test_email: 'self@example.invalid',
};

async function invoke(path, method, body = {}) {
  const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method])?.route;
  assert.ok(route, `Route ${method} ${path} existiert`);
  const handler = route.stack.find(layer => layer.method === method)?.handle;
  const response = {
    statusCode: 200,
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({ body }, response);
  return response;
}

function fixture(t) {
  const previousKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = '2'.repeat(64);
  t.after(() => {
    if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previousKey;
  });
  const state = {
    stored: { ...inputSettings, id: 1, smtp_pass_encrypted: encryptSecret(plaintextPassword), workspace_id: 'workspace-fixture' },
    calls: [], options: [], messages: [], verifyCalls: 0, closeCalls: 0,
    verifyError: null, sendError: null, historyError: null, delivery: null,
  };
  t.mock.method(pool, 'connect', async () => ({
    query: async (sql, params) => {
      state.calls.push({ sql, params, workspaceId: getRequestContext()?.workspaceId });
      if (sql.includes('FROM smtp_settings')) return { rows: state.stored ? [state.stored] : [] };
      if (sql.includes('INSERT INTO email_history') && state.historyError) throw state.historyError;
      return { rows: [] };
    },
    release() {},
  }));
  t.mock.method(nodemailer, 'createTransport', options => {
    state.options.push(options);
    return {
      verify: async () => { state.verifyCalls += 1; if (state.verifyError) throw state.verifyError; return true; },
      sendMail: async message => {
        state.messages.push(message);
        if (state.sendError) throw state.sendError;
        return { messageId: 'fixture-message-id', accepted: [message.to], rejected: [], response: '250 OK', ...(state.delivery || {}) };
      },
      close: () => { state.closeCalls += 1; },
    };
  });
  return state;
}

test('SMTP GET meldet Passwortstatus, liefert keine Geheimnisse und bewahrt den Workspace-Kontext', async t => {
  const state = fixture(t);
  const response = await runWithRequestContext({ workspaceId: 'workspace-fixture' }, () => invoke('/smtp-settings', 'get'));
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.settings.smtp_pass, '');
  assert.equal(response.payload.settings.smtp_pass_set, true);
  assert.equal(response.payload.settings.smtp_pass_encrypted, undefined);
  assert.doesNotMatch(JSON.stringify(response.payload), /fixture-only-smtp-password|v1:/);
  assert.ok(state.calls.every(call => call.workspaceId === 'workspace-fixture'));
  state.stored = null;
  const empty = await invoke('/smtp-settings', 'get');
  assert.equal(empty.payload.settings.smtp_pass_set, false);
  assert.equal(empty.payload.settings.is_enabled, false);
});

test('SMTP speichern bewahrt das verschlüsselte Passwort bei leeren oder früher maskierten Feldern', async t => {
  const state = fixture(t);
  const original = state.stored.smtp_pass_encrypted;
  for (const smtp_pass of ['', '****']) {
    const response = await invoke('/smtp-settings', 'post', { ...inputSettings, smtp_pass, smtp_host: 'smtp.changed.example.invalid' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.success, true);
    const update = state.calls.filter(call => call.sql.startsWith('UPDATE smtp_settings')).at(-1);
    assert.equal(update.params[0], 'smtp.changed.example.invalid');
    assert.equal(update.params[4], original);
  }
  const changed = await invoke('/smtp-settings', 'post', { ...inputSettings, smtp_pass: 'new-fixture-password' });
  assert.equal(changed.payload.success, true);
  const update = state.calls.filter(call => call.sql.startsWith('UPDATE smtp_settings')).at(-1);
  assert.notEqual(update.params[4], original);
  assert.equal(decryptSecret(update.params[4]), 'new-fixture-password');
  assert.equal(state.messages.length, 0);
});

test('Neue aktive SMTP-Einrichtung verlangt ein Passwort und speichert es ausschließlich verschlüsselt', async t => {
  const state = fixture(t);
  state.stored = null;
  const missing = await invoke('/smtp-settings', 'post', inputSettings);
  assert.equal(missing.statusCode, 400);
  assert.match(missing.payload.message, /SMTP-Passwort/);
  assert.ok(!state.calls.some(call => call.sql.startsWith('INSERT INTO smtp_settings')));
  const created = await invoke('/smtp-settings', 'post', { ...inputSettings, smtp_pass: plaintextPassword });
  assert.equal(created.statusCode, 200);
  const insert = state.calls.find(call => call.sql.startsWith('INSERT INTO smtp_settings'));
  assert.match(insert.params[4], /^v1:/);
  assert.equal(decryptSecret(insert.params[4]), plaintextPassword);
  assert.doesNotMatch(JSON.stringify(created.payload), /fixture-only-smtp-password|v1:/);
});

test('Entwurfs-Verbindungsprüfung verwendet geänderte Serverwerte und gespeichertes Passwort ohne Mailversand', async t => {
  const state = fixture(t);
  const response = await invoke('/test-smtp', 'post', {
    use_database_settings: false,
    settings: { ...inputSettings, smtp_host: 'smtp.draft.example.invalid', smtp_port: 2525, smtp_user: 'changed@example.invalid' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.success, true);
  assert.equal(state.options[0].host, 'smtp.draft.example.invalid');
  assert.equal(state.options[0].port, 2525);
  assert.equal(state.options[0].auth.user, 'changed@example.invalid');
  assert.equal(state.options[0].auth.pass, plaintextPassword);
  assert.equal(state.options[0].requireTLS, true);
  assert.equal(state.verifyCalls, 1);
  assert.equal(state.messages.length, 0);
  assert.equal(state.closeCalls, 1);
  assert.ok(!state.calls.some(call => call.sql.startsWith('UPDATE smtp_settings')));
});

test('Ein neues Entwurfs-Passwort funktioniert auch bei nicht mehr entschlüsselbarem Altpasswort', async t => {
  const state = fixture(t);
  state.stored.smtp_pass_encrypted = 'v1:broken';
  const response = await invoke('/test-smtp', 'post', { use_database_settings: false, settings: { ...inputSettings, smtp_pass: 'new-fixture-password' } });
  assert.equal(response.payload.success, true);
  assert.equal(state.options[0].auth.pass, 'new-fixture-password');
  assert.equal(state.closeCalls, 1);
});

test('Verbindungsfehler schließen den Transport und zeigen eine verständliche Meldung ohne rohe Credentials', async t => {
  const state = fixture(t);
  state.verifyError = Object.assign(new Error(`535 Authentication failed ${plaintextPassword}`), { code: 'EAUTH' });
  const response = await invoke('/test-smtp', 'post', { use_database_settings: true });
  assert.equal(response.statusCode, 502);
  assert.equal(response.payload.success, false);
  assert.match(response.payload.message, /Anmeldung.*abgelehnt/);
  assert.doesNotMatch(JSON.stringify(response.payload), /fixture-only-smtp-password|535 Authentication/);
  assert.equal(state.messages.length, 0);
  assert.equal(state.closeCalls, 1);
});

test('Testmail verlangt eine einzelne gültige Adresse und einen gespeicherten aktivierten SMTP-Stand', async t => {
  const state = fixture(t);
  for (const recipient_email of ['', 'invalid', 'one@example.invalid,two@example.invalid', 'test\0@example.invalid']) {
    const response = await invoke('/send-test-email', 'post', { recipient_email });
    assert.equal(response.statusCode, 400);
  }
  for (const stored of [null, { ...state.stored, is_enabled: false }]) {
    state.stored = stored;
    const response = await invoke('/send-test-email', 'post', { recipient_email: 'self@example.invalid' });
    assert.equal(response.statusCode, 400);
    assert.match(response.payload.message, /speichern.*aktivieren/);
  }
  assert.equal(state.messages.length, 0);
  assert.equal(state.options.length, 0);
});

test('Testmail lehnt zu langen oder injizierten Betreff vor dem Versand ab', async t => {
  const state = fixture(t);
  for (const custom_subject of ['x'.repeat(501), 'Betreff\r\nBcc: other@example.invalid']) {
    const response = await invoke('/send-test-email', 'post', { recipient_email: 'self@example.invalid', custom_subject });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(state.messages.length, 0);
});

test('Testmail verwendet ausschließlich gespeicherten SMTP-Stand, wird einmal gesendet und protokolliert', async t => {
  const state = fixture(t);
  const response = await invoke('/send-test-email', 'post', {
    recipient_email: ' SELF@example.invalid ', custom_subject: 'SMTP-Test', custom_message: '<script>fixture</script>',
    settings: { ...inputSettings, smtp_host: 'ignored.example.invalid', smtp_pass: 'ignored-password' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.success, true);
  assert.equal(response.payload.recipient, 'SELF@example.invalid');
  assert.match(response.payload.message, /Mailserver.*Posteingang.*Spamordner/);
  assert.equal(state.options[0].host, inputSettings.smtp_host);
  assert.equal(state.options[0].auth.pass, plaintextPassword);
  assert.equal(state.options[0].requireTLS, true);
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].bcc, undefined);
  assert.equal(state.messages[0].to, 'SELF@example.invalid');
  assert.equal(state.messages[0].subject, 'SMTP-Test');
  assert.match(state.messages[0].html, /&lt;script&gt;fixture&lt;\/script&gt;/);
  const history = state.calls.filter(call => call.sql.startsWith('INSERT INTO email_history'));
  assert.equal(history.length, 1);
  assert.match(history[0].sql, /'test', 'sent'/);
  assert.equal(history[0].params[2], 'SELF@example.invalid');
  assert.equal(state.closeCalls, 1);
});

test('SMTP-Ablehnung der Testmail liefert Fehler und fehlgeschlagenen Historieneintrag', async t => {
  const state = fixture(t);
  state.delivery = { accepted: [], rejected: ['self@example.invalid'] };
  const response = await invoke('/send-test-email', 'post', { recipient_email: 'self@example.invalid' });
  assert.equal(response.statusCode, 502);
  assert.equal(response.payload.success, false);
  assert.match(response.payload.message, /adresse.*abgelehnt/);
  assert.equal(state.messages.length, 1);
  const history = state.calls.filter(call => call.sql.startsWith('INSERT INTO email_history'));
  assert.equal(history.length, 1);
  assert.match(history[0].sql, /'test', 'failed'/);
  assert.equal(state.closeCalls, 1);
});

test('Protokollfehler nach angenommener Testmail liefern Erfolg mit Warnung und lösen keinen erneuten Versand aus', async t => {
  const state = fixture(t);
  state.historyError = Object.assign(new Error('database fixture-sensitive-detail'), { code: 'XX000' });
  const response = await invoke('/send-test-email', 'post', { recipient_email: 'self@example.invalid' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.success, true);
  assert.match(response.payload.warning, /Verlauf.*gespeichert/);
  assert.doesNotMatch(JSON.stringify(response.payload), /fixture-sensitive-detail/);
  assert.equal(state.messages.length, 1);
  assert.equal(state.calls.filter(call => call.sql.startsWith('INSERT INTO email_history')).length, 1);
  assert.equal(state.closeCalls, 1);
});

test('Transportfehler bei Testmail werden ohne Zugangsdaten gemeldet und schließen den Transport', async t => {
  const state = fixture(t);
  state.sendError = Object.assign(new Error(`535 Authentication failed ${plaintextPassword}`), { code: 'EAUTH' });
  const response = await invoke('/send-test-email', 'post', { recipient_email: 'self@example.invalid' });
  assert.equal(response.statusCode, 502);
  assert.equal(response.payload.success, false);
  assert.match(response.payload.message, /Anmeldung.*abgelehnt/);
  assert.doesNotMatch(JSON.stringify(response.payload), /fixture-only-smtp-password|535 Authentication/);
  assert.equal(state.closeCalls, 1);
});
