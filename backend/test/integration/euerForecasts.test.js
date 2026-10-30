import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../../database.js';
import { runWithRequestContext } from '../../utils/requestContext.js';
import { cleanupFinanceWorkspaces } from './financeTestCleanup.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Integrationstests dürfen nur gegen eine als Test/Integration benannte Datenbank laufen.');
}
const workspaceA = randomUUID(), workspaceB = randomUUID(), userA = randomUUID(), userB = randomUUID();
const suffix = randomUUID().slice(0, 8);
const inWorkspace = (workspaceId, userId, callback) => runWithRequestContext({ workspaceId, userId }, callback);

before(async () => {
  await pool.query('INSERT INTO workspaces (id,name,slug) VALUES ($1,$2,$3),($4,$5,$6)', [workspaceA,'Forecast A',`forecast-a-${suffix}`,workspaceB,'Forecast B',`forecast-b-${suffix}`]);
});
after(() => cleanupFinanceWorkspaces([workspaceA, workspaceB]));

test('EÜR-Prognosen sind durch FORCE RLS getrennt und unabhängig von EÜR-Istbuchungen gespeichert', async () => {
  const own = await inWorkspace(workspaceA,userA,() => query(`INSERT INTO euer_forecasts (entry_type,forecast_date,description,category,amount)
    VALUES ('expense','2026-11-01','Planwert','software',42) RETURNING id`));
  const foreign = await inWorkspace(workspaceB,userB,() => query('SELECT id FROM euer_forecasts WHERE id=$1', [own.rows[0].id]));
  assert.equal(foreign.rowCount, 0);
  const policy = await pool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='euer_forecasts'");
  assert.equal(policy.rowCount, 1);
  assert.equal(policy.rows[0].relrowsecurity, true);
  assert.equal(policy.rows[0].relforcerowsecurity, true);
  const entry = await inWorkspace(workspaceA,userA,() => query('SELECT COUNT(*)::int AS count FROM euer_entries WHERE description=$1', ['Planwert']));
  assert.equal(entry.rows[0].count, 0);
  await inWorkspace(workspaceA,userA,() => query('DELETE FROM euer_forecasts WHERE id=$1', [own.rows[0].id]));
});
