import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOpaqueToken,
  createWorkspaceSlug,
  hashOpaqueToken,
  hashPassword,
  isValidEmail,
  normaliseEmail,
  parseCookies,
  validatePassword,
  verifyPassword,
} from '../utils/auth.js';
import { authorizeLegacyRequest } from '../middleware/auth.js';

test('E-Mail-Adressen und Passwörter werden konsistent validiert', () => {
  assert.equal(normaliseEmail('  Test@Example.COM '), 'test@example.com');
  assert.equal(isValidEmail('test@example.com'), true);
  assert.equal(isValidEmail('test@example'), false);
  assert.equal(validatePassword('zu-kurz'), 'Das Passwort muss zwischen 10 und 200 Zeichen enthalten.');
  assert.equal(validatePassword('lang-genug-123'), null);
});

test('Passwort-Hashes prüfen nur das richtige Passwort', async () => {
  const hash = await hashPassword('ein-sehr-gutes-passwort');
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword('ein-sehr-gutes-passwort', hash), true);
  assert.equal(await verifyPassword('falsches-passwort', hash), false);
  assert.equal(await verifyPassword('ein-sehr-gutes-passwort', 'ungueltig'), false);
});

test('Sitzungs- und Workspace-Helfer erzeugen sichere, stabile Werte', () => {
  const token = createOpaqueToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(hashOpaqueToken(token), /^[a-f0-9]{64}$/);
  assert.deepEqual(parseCookies('a=1; encoded=Hallo%20Welt; token=a=b=c'), {
    a: '1',
    encoded: 'Hallo Welt',
    token: 'a=b=c',
  });
  assert.match(createWorkspaceSlug('Ärger & Öl GmbH'), /^arger-ol-gmbh-[a-f0-9]{6}$/);
});

function runLegacyPolicy(method, path, auth) {
  const result = { nextCalled: false, status: 200, body: null };
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  authorizeLegacyRequest({ method, path, auth }, res, () => { result.nextCalled = true; });
  return result;
}

test('Firmeneinstellungen und Startnummern ändern nur mit dem Recht „Einstellungen verwalten“', () => {
  const member = { role: 'member', permissions: {} };
  const settingsEditor = { role: 'member', permissions: { 'workspace.settings': true } };
  const owner = { role: 'owner', permissions: {} };

  assert.equal(runLegacyPolicy('GET', '/company', member).nextCalled, true);
  const denied = runLegacyPolicy('PUT', '/company', member);
  assert.equal(denied.nextCalled, false);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'FORBIDDEN');
  assert.equal(runLegacyPolicy('PUT', '/company', settingsEditor).nextCalled, true);
  assert.equal(runLegacyPolicy('PUT', '/company', owner).nextCalled, true);
  assert.equal(runLegacyPolicy('POST', '/yearly-invoice-start-numbers', member).status, 403);
  assert.equal(runLegacyPolicy('DELETE', '/yearly-invoice-start-numbers/2026', member).status, 403);
});

test('E-Mail-Verwaltung bleibt ohne das Recht „Einstellungen verwalten“ auch lesend gesperrt', () => {
  const member = { role: 'member', permissions: {} };
  const settingsEditor = { role: 'member', permissions: { 'workspace.settings': true } };
  assert.equal(runLegacyPolicy('GET', '/email-management/smtp-settings', member).status, 403);
  assert.equal(runLegacyPolicy('GET', '/email-management/smtp-settings', settingsEditor).nextCalled, true);
});
