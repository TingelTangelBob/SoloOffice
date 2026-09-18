import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlaneClientError, callControlPlane, controlPlaneClientConfiguration, signedHeaders } from '../services/controlPlaneClient.js';
import { verifyControlPlaneRequest } from '../utils/controlPlaneAuth.js';

const SECRET = 'f'.repeat(48);

test('controlPlaneClientConfiguration: explizite URL, Rückfall auf TELEMETRY_URL nur im gehosteten Betrieb', () => {
  assert.deepEqual(controlPlaneClientConfiguration({}), { enabled: false, reason: 'url_missing' });
  assert.equal(controlPlaneClientConfiguration({ CONTROL_PLANE_URL: 'http://cp:4100/', CONTROL_PLANE_INTERNAL_SECRET: 'kurz' }).reason, 'secret_missing');
  const explicit = controlPlaneClientConfiguration({ CONTROL_PLANE_URL: 'http://cp:4100/', CONTROL_PLANE_INTERNAL_SECRET: SECRET, CONTROL_PLANE_TIMEOUT_MS: '500' });
  assert.equal(explicit.enabled, true);
  assert.equal(explicit.url, 'http://cp:4100');
  assert.equal(explicit.timeoutMs, 1_000);
  const hosted = controlPlaneClientConfiguration({ TELEMETRY_SOURCE: 'hosted', TELEMETRY_URL: 'http://control-plane:4100/api/telemetry/ingest', CONTROL_PLANE_INTERNAL_SECRET: SECRET });
  assert.equal(hosted.enabled, true);
  assert.equal(hosted.url, 'http://control-plane:4100');
  assert.equal(controlPlaneClientConfiguration({ TELEMETRY_SOURCE: 'selfhost', TELEMETRY_URL: 'http://control-plane:4100/api/telemetry/ingest', CONTROL_PLANE_INTERNAL_SECRET: SECRET }).enabled, false);
});

test('signedHeaders erzeugen eine Signatur, die die Gegenseite mit derselben Regel prüft', () => {
  const body = JSON.stringify({ workspaceId: 'w' });
  const headers = signedHeaders(SECRET, { method: 'POST', path: '/internal/fachapp/tickets', body });
  const verification = verifyControlPlaneRequest({
    secret: SECRET,
    timestamp: headers['X-Control-Plane-Timestamp'],
    signature: headers['X-Control-Plane-Signature'],
    idempotencyKey: 'egal',
    method: 'POST',
    path: '/internal/fachapp/tickets',
    body,
  });
  assert.equal(verification.ok, true);
});

test('callControlPlane: ohne Konfiguration 503, fachliche Ablehnung wird durchgereicht, Netzfehler allgemein', async () => {
  await assert.rejects(callControlPlane('/internal/fachapp/tickets', {}, { env: {} }), error => error instanceof ControlPlaneClientError && error.status === 503 && error.code === 'CONTROL_PLANE_NOT_CONFIGURED');

  const env = { CONTROL_PLANE_URL: 'http://cp:4100', CONTROL_PLANE_INTERNAL_SECRET: SECRET };
  const calls = [];
  const okFetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => JSON.stringify({ tickets: [] }) }; };
  const result = await callControlPlane('/internal/fachapp/tickets/list', { workspaceId: 'w' }, { env, fetchImpl: okFetch });
  assert.deepEqual(result, { tickets: [] });
  assert.equal(calls[0].url, 'http://cp:4100/internal/fachapp/tickets/list');
  assert.equal(calls[0].init.method, 'POST');
  assert.ok(calls[0].init.headers['X-Control-Plane-Signature']);

  const rejected = async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ error: 'Zu viele Anfragen heute.', code: 'TICKET_RATE_LIMIT' }) });
  await assert.rejects(callControlPlane('/internal/fachapp/tickets', {}, { env, fetchImpl: rejected }), error => error.status === 429 && error.code === 'TICKET_RATE_LIMIT' && error.message === 'Zu viele Anfragen heute.');

  const broken = async () => ({ ok: false, status: 500, text: async () => 'kaputt' });
  await assert.rejects(callControlPlane('/internal/fachapp/tickets', {}, { env, fetchImpl: broken }), error => error.status === 502 && error.code === 'CONTROL_PLANE_ERROR');

  const offline = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(callControlPlane('/internal/fachapp/tickets', {}, { env, fetchImpl: offline }), error => error.status === 502 && error.code === 'CONTROL_PLANE_UNAVAILABLE');
});
