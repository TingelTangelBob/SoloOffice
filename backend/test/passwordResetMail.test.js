import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIL_NOT_CONFIGURED_MESSAGE, instanceMailKnownMissing } from '../routes/auth.js';

const HOSTED = { CONTROL_PLANE_URL: 'http://cp:4100', CONTROL_PLANE_INTERNAL_SECRET: 's'.repeat(48) };

test('Gehostet ohne SMTP_HOST: Mailversand gilt als nicht eingerichtet', () => {
  assert.equal(instanceMailKnownMissing(HOSTED), true);
  assert.equal(instanceMailKnownMissing({ ...HOSTED, SMTP_HOST: '  ' }), true);
});

test('Gehostet mit SMTP_HOST: Mailversand gilt als eingerichtet', () => {
  assert.equal(instanceMailKnownMissing({ ...HOSTED, SMTP_HOST: 'smtp.example.test' }), false);
});

test('Self-Hosting ohne Control Plane: keine Aussage, weil der SMTP-Zugang auch je Workspace in der Datenbank liegen kann', () => {
  assert.equal(instanceMailKnownMissing({}), false);
});

test('Die Meldung ist deutsch, ehrlich und nennt keine Adresse', () => {
  assert.match(MAIL_NOT_CONFIGURED_MESSAGE, /nicht eingerichtet/);
  assert.doesNotMatch(MAIL_NOT_CONFIGURED_MESSAGE, /@/);
});
