import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTENSION_CATALOG, canUseExtension, getExtensionDefinition, workspaceExtension } from '../shared/extensions.js';
import { isExtensionEnabled, requireExtension } from '../middleware/extensions.js';

test('Katalog enthält Legacy-Module ohne zusätzliche Speicherfelder', () => {
  assert.deepEqual(EXTENSION_CATALOG.filter(item => item.legacyCompanyField).map(item => item.id), ['jobTracking', 'quotes', 'reporting']);
  assert.equal(getExtensionDefinition('taxes').legacyCompanyField, undefined);
  assert.equal(getExtensionDefinition('unbekannt'), null);
});

test('Tarifprüfung akzeptiert nur aktivierte, im Tarif verfügbare Erweiterungen', () => {
  const definition = { id: 'demo', requiredPlan: 'pro' };
  assert.equal(canUseExtension(definition, true, 'free'), false);
  assert.equal(canUseExtension(definition, true, 'pro'), true);
  assert.equal(canUseExtension(definition, false, 'pro'), false);
  assert.equal(canUseExtension(null, true, 'pro'), false);
});

test('API-Ansicht veröffentlicht nur die vereinbarten Extension-Felder', () => {
  assert.deepEqual(workspaceExtension(getExtensionDefinition('taxes'), { enabled: true, accepted_at: '2026-10-09T00:00:00Z' }), {
    id: 'taxes', name: 'Steuern & Abgaben', label: 'Steuern & Abgaben', requiredPlan: 'free', available: true, legacyCompanyField: undefined, description: 'Steuerprofil, private Abgaben und Prognosen verwalten.',
    enabled: true, acceptedAt: '2026-10-09T00:00:00Z', updatedAt: null,
  });
});

test('Extension-Status fragt ausschließlich den jeweiligen Workspace ab', async () => {
  const calls = [];
  const queryFn = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ enabled: true }] };
  };
  assert.equal(await isExtensionEnabled('workspace-1', 'taxes', queryFn), true);
  assert.match(calls[0].sql, /workspace_id = \$1 AND extension_id = \$2/);
  assert.deepEqual(calls[0].params, ['workspace-1', 'taxes']);
  assert.equal(await isExtensionEnabled('workspace-1', 'missing', queryFn), false);
});

test('requireExtension antwortet bei ausgeschaltetem Modul mit dem vereinbarten 403-Code', async () => {
  const middleware = requireExtension('taxes', async () => ({ rows: [{ enabled: false }] }));
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await middleware({ auth: { workspaceId: 'w1' } }, response, error => { throw error; });
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.code, 'EXTENSION_DISABLED');
});
