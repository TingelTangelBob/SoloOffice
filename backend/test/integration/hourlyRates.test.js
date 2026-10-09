import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../../database.js';
import hourlyRatesRouter from '../../routes/hourlyRates.js';
import { runWithRequestContext } from '../../utils/requestContext.js';
import { cleanupFinanceWorkspaces } from './financeTestCleanup.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Stundensatz-Integrationstests dürfen nur gegen eine als Test/Integration benannte Datenbank laufen.');
}

const workspaceId = randomUUID();
const userId = randomUUID();
const suffix = randomUUID().slice(0, 8);
const findHandler = method => hourlyRatesRouter.stack.find(layer => layer.route?.path === '/' && layer.route.methods[method])?.route.stack.at(-1)?.handle;

async function invoke(method, body = {}) {
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await runWithRequestContext({ workspaceId, userId }, () => findHandler(method)(
    { auth: { workspaceId, role: 'owner' }, body }, response, error => { throw error; },
  ));
  return response;
}

before(async () => {
  await pool.query('INSERT INTO workspaces (id,name,slug) VALUES ($1,$2,$3)', [workspaceId, 'Stundensatztest', `rate-${suffix}`]);
  await runWithRequestContext({ workspaceId, userId }, () => query(`INSERT INTO company (workspace_id,id,name,address,city,postal_code,country,email)
    VALUES ($1,nextval('company_id_seq'),$2,'Testweg 1','Berlin','10115','Deutschland',$3)`, [workspaceId, `Firma ${suffix}`, `rate-${suffix}@example.invalid`]));
});

after(() => cleanupFinanceWorkspaces([workspaceId]));

test('Stundensatz wird über die API mit Betrag gespeichert und beim erneuten Laden geliefert', async () => {
  const created = await invoke('post', { name: `Satz ${suffix}`, description: 'Regression', rate: 87.5, taxRate: 0, isDefault: false });
  assert.equal(created.statusCode, 201);
  assert.equal(Number(created.payload.rate), 87.5);
  assert.equal(Number(created.payload.taxRate), 0);

  const loaded = await invoke('get');
  const persisted = loaded.payload.find(rate => rate.id === created.payload.id);
  assert.ok(persisted);
  assert.equal(Number(persisted.rate), 87.5);
  assert.equal(Number(persisted.taxRate), 0);
});
