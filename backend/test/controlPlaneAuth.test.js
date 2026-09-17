import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TIMESTAMP_TOLERANCE_SECONDS,
  computeSignature,
  controlPlaneConfiguration,
  signaturePayload,
  timestampToleranceSeconds,
  verifyControlPlaneRequest,
} from '../utils/controlPlaneAuth.js';
import { workspaceSuspensionGuard } from '../middleware/workspaceSuspension.js';

const secret = 'a'.repeat(64);
const now = 1_757_900_000_000;
const timestamp = String(Math.floor(now / 1000));
const path = '/internal/control-plane/workspaces';
const body = JSON.stringify({ name: 'Beispiel GmbH', ownerEmail: 'inhaber@example.com' });

function signedRequest(overrides = {}) {
  return {
    secret,
    timestamp,
    signature: computeSignature(secret, { timestamp, method: 'POST', path, body }),
    idempotencyKey: 'workspace:account-1:Beispiel GmbH',
    method: 'POST',
    path,
    body,
    now,
    ...overrides,
  };
}

test('die Signatur folgt dem Vertrag des Control-Plane-Adapters', () => {
  assert.equal(
    signaturePayload({ timestamp: '17', method: 'POST', path: '/x', body: '{}' }),
    '17.POST./x.{}',
  );
  // Referenzwert: HMAC-SHA256 über genau diese Zeichenkette.
  assert.equal(
    computeSignature('geheim', { timestamp: '17', method: 'POST', path: '/x', body: '{}' }),
    '191fedb898f9a89ec9386cea8a5db2041b4f2147439991aeb2f5fe975a99ea51',
  );
});

test('eine korrekt signierte Anfrage wird angenommen', () => {
  const result = verifyControlPlaneRequest(signedRequest());
  assert.equal(result.ok, true);
  assert.equal(result.idempotencyKey, 'workspace:account-1:Beispiel GmbH');
});

test('veränderter Inhalt, Pfad oder Methode brechen die Signatur', () => {
  for (const override of [
    { body: `${body} ` },
    { path: '/internal/control-plane/workspaces/x/suspend' },
    { method: 'PUT' },
    { signature: 'f'.repeat(64) },
    { signature: '' },
  ]) {
    const result = verifyControlPlaneRequest(signedRequest(override));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CONTROL_PLANE_SIGNATURE_INVALID');
    assert.equal(result.status, 401);
  }
});

test('das Zeitfenster begrenzt Wiedereinspielungen', () => {
  const stale = String(Math.floor(now / 1000) - DEFAULT_TIMESTAMP_TOLERANCE_SECONDS - 1);
  const staleResult = verifyControlPlaneRequest(signedRequest({
    timestamp: stale,
    signature: computeSignature(secret, { timestamp: stale, method: 'POST', path, body }),
  }));
  assert.equal(staleResult.code, 'CONTROL_PLANE_TIMESTAMP_EXPIRED');

  const future = String(Math.floor(now / 1000) + DEFAULT_TIMESTAMP_TOLERANCE_SECONDS + 1);
  const futureResult = verifyControlPlaneRequest(signedRequest({
    timestamp: future,
    signature: computeSignature(secret, { timestamp: future, method: 'POST', path, body }),
  }));
  assert.equal(futureResult.code, 'CONTROL_PLANE_TIMESTAMP_EXPIRED');

  assert.equal(verifyControlPlaneRequest(signedRequest({ timestamp: 'jetzt' })).code, 'CONTROL_PLANE_TIMESTAMP_INVALID');
  assert.equal(verifyControlPlaneRequest(signedRequest({ timestamp: undefined })).code, 'CONTROL_PLANE_TIMESTAMP_INVALID');
});

test('ohne Idempotency-Key wird die Anfrage abgelehnt', () => {
  assert.equal(verifyControlPlaneRequest(signedRequest({ idempotencyKey: '' })).code, 'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(verifyControlPlaneRequest(signedRequest({ idempotencyKey: 'x'.repeat(256) })).code, 'IDEMPOTENCY_KEY_REQUIRED');
});

test('ein fehlendes oder zu kurzes Geheimnis schaltet die Schnittstelle ab', () => {
  assert.deepEqual(controlPlaneConfiguration({}), { configured: false, reason: 'missing' });
  assert.deepEqual(
    controlPlaneConfiguration({ CONTROL_PLANE_INTERNAL_SECRET: 'zu-kurz' }),
    { configured: false, reason: 'too-short' },
  );
  assert.deepEqual(controlPlaneConfiguration({ CONTROL_PLANE_INTERNAL_SECRET: secret }), { configured: true });

  const result = verifyControlPlaneRequest(signedRequest({ secret: 'zu-kurz' }));
  assert.equal(result.status, 503);
  assert.equal(result.code, 'CONTROL_PLANE_API_NOT_CONFIGURED');
});

test('das Zeitfenster ist konfigurierbar und bleibt begrenzt', () => {
  assert.equal(timestampToleranceSeconds({}), DEFAULT_TIMESTAMP_TOLERANCE_SECONDS);
  assert.equal(timestampToleranceSeconds({ CONTROL_PLANE_INTERNAL_TIMESTAMP_TOLERANCE_SECONDS: '60' }), 60);
  assert.equal(timestampToleranceSeconds({ CONTROL_PLANE_INTERNAL_TIMESTAMP_TOLERANCE_SECONDS: '-5' }), DEFAULT_TIMESTAMP_TOLERANCE_SECONDS);
  assert.equal(timestampToleranceSeconds({ CONTROL_PLANE_INTERNAL_TIMESTAMP_TOLERANCE_SECONDS: '99999' }), 3600);
});

function guardResult(req) {
  const response = { statusCode: null, payload: null };
  const res = {
    status(code) {
      response.statusCode = code;
      return res;
    },
    json(payload) {
      response.payload = payload;
      return res;
    },
  };
  let passed = false;
  workspaceSuspensionGuard(req, res, () => {
    passed = true;
  });
  return { ...response, passed };
}

test('ein gesperrter Arbeitsbereich bleibt lesbar und exportierbar', () => {
  const suspended = { workspace: { suspendedAt: '2026-09-15T10:00:00.000Z' } };

  assert.equal(guardResult({ auth: suspended, method: 'GET', path: '/invoices' }).passed, true);
  assert.equal(guardResult({ auth: suspended, method: 'POST', path: '/backup/create' }).passed, true);
  assert.equal(guardResult({ auth: suspended, method: 'POST', path: '/backup/create-zip' }).passed, true);

  const blocked = guardResult({ auth: suspended, method: 'POST', path: '/invoices' });
  assert.equal(blocked.passed, false);
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.payload.code, 'WORKSPACE_SUSPENDED');

  assert.equal(guardResult({ auth: suspended, method: 'POST', path: '/backup/restore' }).statusCode, 403);
  assert.equal(guardResult({ auth: suspended, method: 'DELETE', path: '/customers/1' }).statusCode, 403);
});

test('ein aktiver Arbeitsbereich bleibt unverändert schreibbar', () => {
  const active = { workspace: { suspendedAt: null } };
  assert.equal(guardResult({ auth: active, method: 'POST', path: '/invoices' }).passed, true);
  assert.equal(guardResult({ auth: undefined, method: 'POST', path: '/invoices' }).passed, true);
});
