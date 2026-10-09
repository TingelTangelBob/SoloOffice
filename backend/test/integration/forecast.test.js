import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../../database.js';
import forecastRouter from '../../routes/forecast.js';
import { runWithRequestContext } from '../../utils/requestContext.js';
import { cleanupFinanceWorkspaces } from './financeTestCleanup.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Forecast-Integrationstests benötigen eine ausdrücklich als Test benannte Datenbank.');
}

const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const suffix = randomUUID().slice(0, 8);
const forecastYear = new Date().getUTCFullYear();
const seededDescription = `Forecast RLS ${suffix}`;
const routeHandler = forecastRouter.stack.find(layer => layer.route?.path === '/:year' && layer.route.methods.get)?.route.stack.at(-1)?.handle;
const extensionGuard = forecastRouter.stack.find(layer => !layer.route)?.handle;
function inWorkspace(id, callback) { return runWithRequestContext({ workspaceId: id, userId: randomUUID() }, callback); }
async function invoke(handler, id, { role = 'owner', params = { year: '2026' } } = {}) {
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await inWorkspace(id, () => handler({ auth: { workspaceId: id, role, workspace: { plan: 'free' } }, params }, response, error => { throw error; }));
  return response;
}

before(async () => {
  await pool.query('INSERT INTO workspaces (id,name,slug) VALUES ($1,$2,$3),($4,$5,$6)', [workspaceId, 'Forecast Test', `forecast-${suffix}`, otherWorkspaceId, 'Forecast Fremd', `forecast-other-${suffix}`]);
  await inWorkspace(workspaceId, () => query("INSERT INTO workspace_extensions (extension_id,enabled,accepted_at) VALUES ('taxes',TRUE,NOW())"));
  await inWorkspace(workspaceId, () => query(`INSERT INTO euer_entries (entry_type,entry_date,description,category,amount,tax_rate)
    VALUES ('income',$1,$2,'other_income',3200,0)`, [`${forecastYear}-01-01`, seededDescription]));
});
after(() => cleanupFinanceWorkspaces([workspaceId, otherWorkspaceId]));

test('Erweiterungszugriff und workspace.settings schützen den schreibfreien Endpunkt', async () => {
  const disabled = await invoke(extensionGuard, otherWorkspaceId);
  assert.equal(disabled.statusCode, 403);
  assert.equal(disabled.payload.code, 'EXTENSION_DISABLED');
  const denied = await invoke(routeHandler, workspaceId, { role: 'viewer' });
  assert.equal(denied.statusCode, 403);
  const badYear = await invoke(routeHandler, workspaceId, { params: { year: 'nope' } });
  assert.equal(badYear.statusCode, 400);
});

test('fehlende Bestätigung der Erweiterungsbedingungen gibt eine klare 403-Antwort', async () => {
  await inWorkspace(workspaceId, () => query("UPDATE workspace_extensions SET accepted_at=NULL WHERE extension_id='taxes'"));
  const denied = await invoke(routeHandler, workspaceId, { params: { year: String(forecastYear) } });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.payload.code, 'DISCLAIMER_REQUIRED');
  assert.match(denied.payload.error, /Bitte bestätige zuerst/);
  await inWorkspace(workspaceId, () => query("UPDATE workspace_extensions SET accepted_at=NOW() WHERE extension_id='taxes'"));
});

test('RLS beschränkt EÜR-Daten auf den Workspace und der GET-Endpunkt verändert sie nicht', async () => {
  const ownBefore = await inWorkspace(workspaceId, () => query('SELECT id FROM euer_entries WHERE description=$1', [seededDescription]));
  const foreignBefore = await inWorkspace(otherWorkspaceId, () => query('SELECT id FROM euer_entries WHERE description=$1', [seededDescription]));
  assert.equal(ownBefore.rows.length, 1);
  assert.deepEqual(foreignBefore.rows, []);
  const result = await invoke(routeHandler, workspaceId, { params: { year: String(forecastYear) } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.monthly.length, 12);
  assert.equal(result.payload.revenueYtd, 3200);
  assert.equal(result.payload.monthly[0].revenue, 3200);
  const ownAfter = await inWorkspace(workspaceId, () => query('SELECT id FROM euer_entries WHERE description=$1', [seededDescription]));
  assert.deepEqual(ownAfter.rows, ownBefore.rows);
});
