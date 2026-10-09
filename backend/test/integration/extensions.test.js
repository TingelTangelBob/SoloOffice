import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../../database.js';
import extensionsRouter from '../../routes/extensions.js';
import { runWithRequestContext } from '../../utils/requestContext.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Extension-Integrationstests benötigen eine ausdrücklich als Test benannte Datenbank.');
}

const workspaceIds = [randomUUID(), randomUUID()];
const handler = (method, path) => extensionsRouter.stack
  .find(layer => layer.route?.path === path && layer.route.methods[method])?.route.stack.at(-1)?.handle;

async function request(method, path, workspaceId, body = {}, role = 'owner') {
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await runWithRequestContext({ workspaceId }, () => handler(method, path)(
    { auth: { workspaceId, role }, params: { id: 'taxes' }, body }, response, error => { throw error; },
  ));
  return response;
}

after(async () => {
  await pool.query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [workspaceIds]);
  await pool.end();
});

test('Erweiterungs-API ist admin-only und trennt Einstellungen je Workspace', async () => {
  for (const [index, id] of workspaceIds.entries()) {
    await pool.query('INSERT INTO workspaces (id, name, slug) VALUES ($1, $2, $3)', [id, `Test ${index}`, `extension-test-${id}`]);
  }
  await runWithRequestContext({ workspaceId: workspaceIds[0] }, () => query(
    'INSERT INTO workspace_extensions (workspace_id, extension_id, enabled, accepted_at) VALUES ($1, $2, TRUE, NOW())',
    [workspaceIds[0], 'taxes'],
  ));

  const forbidden = await request('put', '/:id', workspaceIds[0], { enabled: false }, 'viewer');
  assert.equal(forbidden.statusCode, 403);
  const first = await request('get', '/', workspaceIds[0]);
  const second = await request('get', '/', workspaceIds[1]);
  assert.equal(first.payload.find(item => item.id === 'taxes').enabled, true);
  assert.equal(second.payload.find(item => item.id === 'taxes').enabled, false);
});

test('Steuererweiterung verlangt beim ersten Aktivieren die Bestätigung und behält sie nach Deaktivierung', async () => {
  const workspaceId = workspaceIds[1];
  const missing = await request('put', '/:id', workspaceId, { enabled: true });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.payload.code, 'EXTENSION_DISCLAIMER_REQUIRED');

  const enabled = await request('put', '/:id', workspaceId, { enabled: true, acceptDisclaimer: true });
  assert.equal(enabled.statusCode, 200);
  assert.ok(enabled.payload.acceptedAt);
  const disabled = await request('put', '/:id', workspaceId, { enabled: false });
  assert.equal(disabled.payload.enabled, false);
  assert.equal(disabled.payload.acceptedAt, enabled.payload.acceptedAt);
});
