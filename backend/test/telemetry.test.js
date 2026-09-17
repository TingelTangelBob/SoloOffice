import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTelemetryPayload,
  looksLikeInstallationId,
  relayTelemetry,
  sanitizeTelemetryEvents,
  telemetryConfiguration,
} from '../services/telemetry.js';

const installationId = 'sh_3f2c2c1e-8a3d-4d33-9a12-123456789abc';
const installedAt = '2026-09-15T10:00:00.000Z';

test('Self-Host-Konfiguration ist nur mit vollständigem Opt-in aktiv', () => {
  assert.equal(telemetryConfiguration({}).enabled, false);
  const config = telemetryConfiguration({
    TELEMETRY_ENABLED: 'true',
    TELEMETRY_SOURCE: 'selfhost',
    TELEMETRY_URL: 'https://control-plane.example/api/telemetry/ingest',
    TELEMETRY_SECRET: 'x'.repeat(32),
    TELEMETRY_INSTALLATION_ID: installationId,
    TELEMETRY_INSTALLED_AT: installedAt,
  });
  assert.equal(config.enabled, true);
  assert.equal(config.installationId, installationId);
  assert.equal(looksLikeInstallationId(installationId), true);
  assert.equal(looksLikeInstallationId('sh_2026-09-15-id'), false);
});

test('Allowlist, Hosted-Sonderfall und Props werden eingehalten', () => {
  const events = sanitizeTelemetryEvents([
    { name: 'customer_created', props: { count: 1, email: 'kunde@example.com', amount: 12.5 } },
    { name: 'not_allowed', props: { count: 1 } },
    { name: 'invoice_sent_count', props: { count: 2 } },
  ], 'selfhost', new Date(installedAt));
  assert.deepEqual(events, [{ name: 'customer_created', occurredAt: installedAt, props: { count: 1 } }]);

  const hosted = sanitizeTelemetryEvents([{ name: 'invoice_sent_count', props: { count: 2 } }], 'hosted', new Date(installedAt));
  assert.deepEqual(hosted[0].props, { count: 2 });
});

test('Payload enthält kein Secret und keine Fremdfelder', () => {
  const configuration = telemetryConfiguration({
    TELEMETRY_ENABLED: 'true',
    TELEMETRY_SOURCE: 'selfhost',
    TELEMETRY_URL: 'https://control-plane.example/api/telemetry/ingest',
    TELEMETRY_SECRET: 's'.repeat(32),
    TELEMETRY_INSTALLATION_ID: installationId,
    TELEMETRY_INSTALLED_AT: installedAt,
  });
  const payload = buildTelemetryPayload(
    [{ name: 'heartbeat', props: { count: 1, name: 'verboten' } }],
    configuration,
    { SOLOOFFICE_VERSION: '0.8.2' },
    new Date(installedAt),
  );
  assert.deepEqual(payload, {
    source: 'selfhost',
    installationId,
    installedAt,
    appVersion: '0.8.2',
    events: [{ name: 'heartbeat', occurredAt: installedAt, props: { count: 1 } }],
  });
  assert.equal(JSON.stringify(payload).includes('s'.repeat(32)), false);
});

test('Relay verwendet das serverseitige Secret nur als Header', async () => {
  let request;
  const result = await relayTelemetry(
    [{ name: 'heartbeat' }],
    {
      TELEMETRY_ENABLED: 'true',
      TELEMETRY_SOURCE: 'selfhost',
      TELEMETRY_URL: 'https://control-plane.example/api/telemetry/ingest',
      TELEMETRY_SECRET: 'r'.repeat(32),
      TELEMETRY_INSTALLATION_ID: installationId,
      TELEMETRY_INSTALLED_AT: installedAt,
    },
    async (_url, options) => {
      request = options;
      return { ok: true, json: async () => ({ accepted: 1 }) };
    },
  );
  assert.equal(result.sent, true);
  assert.equal(request.headers['X-Telemetry-Secret'], 'r'.repeat(32));
  assert.equal(request.body.includes('rrrr'), false);
});

test('Hosted-Relay sendet die Workspace-UUID mit, selfhost nie', () => {
  const workspaceId = '2b3a1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
  const hosted = buildTelemetryPayload(
    [{ name: 'heartbeat' }],
    telemetryConfiguration({
      TELEMETRY_ENABLED: 'true',
      TELEMETRY_SOURCE: 'hosted',
      TELEMETRY_URL: 'https://control-plane.example/api/telemetry/ingest',
      TELEMETRY_SECRET: 's'.repeat(32),
    }),
    {},
    new Date(installedAt),
    { workspaceId },
  );
  assert.equal(hosted.workspaceId, workspaceId);

  const hostedWithoutUuid = buildTelemetryPayload(
    [{ name: 'heartbeat' }],
    telemetryConfiguration({
      TELEMETRY_ENABLED: 'true',
      TELEMETRY_SOURCE: 'hosted',
      TELEMETRY_URL: 'https://control-plane.example/api/telemetry/ingest',
      TELEMETRY_SECRET: 's'.repeat(32),
    }),
    {},
    new Date(installedAt),
    { workspaceId: 'kein-uuid' },
  );
  assert.equal('workspaceId' in hostedWithoutUuid, false);

  const selfhost = buildTelemetryPayload(
    [{ name: 'heartbeat' }],
    telemetryConfiguration({
      TELEMETRY_ENABLED: 'true',
      TELEMETRY_SOURCE: 'selfhost',
      TELEMETRY_URL: 'https://control-plane.example/api/telemetry/ingest',
      TELEMETRY_SECRET: 's'.repeat(32),
      TELEMETRY_INSTALLATION_ID: installationId,
      TELEMETRY_INSTALLED_AT: installedAt,
    }),
    {},
    new Date(installedAt),
    { workspaceId },
  );
  assert.equal('workspaceId' in selfhost, false);
});
