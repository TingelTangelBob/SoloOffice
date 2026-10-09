import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../../database.js';
import taxProfilesRouter from '../../routes/taxProfiles.js';
import { defaultTaxProfile } from '../../shared/financeDefaults.js';
import { TAX_PROFILE_PAYLOAD_FIELDS } from '../../utils/taxProfileValidation.js';
import { runWithRequestContext } from '../../utils/requestContext.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Steuerprofil-Integrationstests benötigen eine ausdrücklich als Test benannte Datenbank.');
}

const workspaceIds = [randomUUID(), randomUUID()];
const suffix = randomUUID().slice(0, 8);
const routeHandler = (method, path) => taxProfilesRouter.stack
  .find(layer => layer.route?.path === path && layer.route.methods[method])?.route.stack.at(-1)?.handle;
const extensionGuard = taxProfilesRouter.stack.find(layer => !layer.route)?.handle;

function inWorkspace(workspaceId, callback) {
  return runWithRequestContext({ workspaceId, userId: randomUUID() }, callback);
}

async function invoke(handler, workspaceId, { role = 'owner', params = {}, body = {} } = {}) {
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await inWorkspace(workspaceId, () => handler(
    { auth: { workspaceId, role, workspace: { plan: 'free' } }, params, body },
    response,
    error => { throw error; },
  ));
  return response;
}

async function call(method, path, workspaceId, options = {}) {
  return invoke(routeHandler(method, path), workspaceId, options);
}

async function enableExtension(workspaceId) {
  await inWorkspace(workspaceId, () => query(`
    INSERT INTO workspace_extensions (workspace_id, extension_id, enabled, accepted_at)
    VALUES ($1, 'taxes', TRUE, NOW())
    ON CONFLICT (workspace_id, extension_id) DO UPDATE SET enabled = TRUE
  `, [workspaceId]));
}

function profilePayload(year) {
  const profile = defaultTaxProfile(year);
  return Object.fromEntries(TAX_PROFILE_PAYLOAD_FIELDS.map(key => [key, profile[key]]));
}

before(async () => {
  await pool.query('INSERT INTO workspaces (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)', [
    workspaceIds[0], 'Steuerprofil A', `tax-profile-a-${suffix}`,
    workspaceIds[1], 'Steuerprofil B', `tax-profile-b-${suffix}`,
  ]);
  await enableExtension(workspaceIds[0]);
});

after(async () => {
  await pool.query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [workspaceIds]);
  await pool.end();
});

test('Erweiterungsschutz und sensible workspace.settings-Berechtigung gelten auch für GET', async () => {
  const disabled = await invoke(extensionGuard, workspaceIds[1], { params: { year: '2026' } });
  assert.equal(disabled.statusCode, 403);
  assert.equal(disabled.payload.code, 'EXTENSION_DISABLED');

  const forbidden = await call('get', '/:year', workspaceIds[0], { role: 'viewer', params: { year: '2026' } });
  assert.equal(forbidden.statusCode, 403);

  const allowed = await call('get', '/:year', workspaceIds[0], { params: { year: '2026' } });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.payload.year, 2026);
  assert.equal(allowed.payload.churchTaxLiable, null);
});

test('Profil, Einwilligungen und Kopie sind je Workspace und Jahr getrennt', async () => {
  const workspaceId = workspaceIds[0];
  const accepted = await call('post', '/:year/disclaimer', workspaceId, {
    params: { year: '2026' }, body: { accepted: true },
  });
  assert.equal(accepted.statusCode, 200);
  assert.ok(accepted.payload.disclaimerAcceptedAt);

  const consent = await call('post', '/:year/church-consent', workspaceId, {
    params: { year: '2026' }, body: { consented: true, liable: false },
  });
  assert.equal(consent.statusCode, 200);
  assert.equal(consent.payload.churchTaxLiable, false);
  assert.ok(consent.payload.churchTaxConsentAt);

  const profile = { ...profilePayload(2026), otherIncomeAnnual: 1500, churchTaxLiable: false };
  const saved = await call('put', '/:year', workspaceId, { params: { year: '2026' }, body: profile });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.payload.otherIncomeAnnual, 1500);
  assert.equal(saved.payload.churchTaxLiable, false);

  const copied = await call('post', '/:year/copy', workspaceId, {
    params: { year: '2026' }, body: { targetYear: 2027 },
  });
  assert.equal(copied.statusCode, 200);
  assert.equal(copied.payload.year, 2027);
  assert.equal(copied.payload.otherIncomeAnnual, 1500);
  assert.equal(copied.payload.churchTaxLiable, null);
  assert.equal(copied.payload.churchTaxConsentAt, null);
  assert.ok(copied.payload.disclaimerAcceptedAt);

  const withdrawn = await call('post', '/:year/church-consent', workspaceId, {
    params: { year: '2026' }, body: { consented: false },
  });
  assert.equal(withdrawn.statusCode, 200);
  assert.equal(withdrawn.payload.churchTaxLiable, null);
  assert.equal(withdrawn.payload.churchTaxConsentAt, null);

  const forged = { ...profilePayload(2027), churchTaxLiable: false };
  const rejected = await call('put', '/:year', workspaceId, { params: { year: '2027' }, body: forged });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.payload.code, 'CHURCH_TAX_CONSENT_REQUIRED');

  const own = await inWorkspace(workspaceId, () => query('SELECT year, profile, church_tax_consent_at FROM tax_profiles ORDER BY year'));
  const other = await inWorkspace(workspaceIds[1], () => query('SELECT year FROM tax_profiles'));
  assert.equal(own.rows.length, 2);
  assert.deepEqual(other.rows, []);
  assert.equal(Object.hasOwn(own.rows[0].profile, 'disclaimerAcceptedAt'), false);
  assert.equal(own.rows.find(row => row.year === 2026).church_tax_consent_at, null);
});

test('FORCE RLS lehnt fremde Workspace-IDs bei Inserts ab', async () => {
  await assert.rejects(inWorkspace(workspaceIds[0], () => query(`
    INSERT INTO tax_profiles (workspace_id, year, profile, params_version)
    VALUES ($1, 2099, '{}'::jsonb, 'test')
  `, [workspaceIds[1]])), error => error?.code === '42501');
  const metadata = await pool.query(`
    SELECT relrowsecurity, relforcerowsecurity
    FROM pg_class WHERE oid = 'tax_profiles'::regclass
  `);
  assert.deepEqual(metadata.rows[0], { relrowsecurity: true, relforcerowsecurity: true });
});
