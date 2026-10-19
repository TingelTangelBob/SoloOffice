import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../../database.js';
import backupRouter from '../../routes/backup.js';
import importsRouter from '../../routes/imports.js';
import { readBackupSnapshot } from '../../services/backupExport.js';
import { clearWorkspaceBusinessData } from '../../services/workspaceData.js';
import { createBackupManifest } from '../../utils/backupIntegrity.js';
import { runWithRequestContext } from '../../utils/requestContext.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Restore-Integrationstests dürfen nur gegen eine Test-/Integrationsdatenbank laufen.');
}

const suffix = randomUUID().slice(0, 8);
const workspaces = [randomUUID(), randomUUID(), randomUUID()];
const [workspaceA, workspaceB, workspaceLegacy] = workspaces;
const own = (workspaceId, callback) => runWithRequestContext({ workspaceId }, callback);
const fixtures = new Map();

async function invoke(router, routePath, workspaceId, body = {}, params = {}) {
  const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods.post);
  assert.ok(layer, `POST ${routePath} fehlt`);
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await own(workspaceId, () => layer.route.stack.at(-1).handle({
    auth: { role: 'owner', workspaceId }, body, params, requestId: 'backup-takeover-test',
  }, response, error => { throw error; }));
  return response;
}

const importCustomers = (workspaceId, body) => invoke(importsRouter, '/:resource', workspaceId, body, { resource: 'customers' });

async function importCategory(workspaceId, sessionId, name) {
  const rows = [{ name, customerNumber: `IMP-${randomUUID().slice(0, 8)}`, address: 'Weg 2', city: 'Bonn', postalCode: '53111', country: 'Deutschland' }];
  const preview = await importCustomers(workspaceId, { rows, takeover: { sessionId, phase: 'preview' } });
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.payload));
  const execution = {
    rows, dryRun: false,
    takeover: { sessionId, phase: 'execute', categoryId: preview.payload.categoryId,
      previewDigest: preview.payload.previewDigest, idempotencyKey: randomUUID() },
  };
  const result = await importCustomers(workspaceId, execution);
  assert.equal(result.statusCode, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.summary.imported, 1);
  return { execution, categoryId: preview.payload.categoryId, runId: result.payload.runId };
}

before(async () => {
  for (const [index, workspaceId] of workspaces.entries()) {
    await query('INSERT INTO workspaces (id,name,slug) VALUES ($1,$2,$3)',
      [workspaceId, `Restore-Umzug ${index}`, `restore-takeover-${index}-${suffix}`]);
    await own(workspaceId, async () => {
      await query(`INSERT INTO company (name,address,city,postal_code,country,phone,email,tax_id)
        VALUES ('Restore-Test','Weg 1','Bonn','53111','Deutschland','02281234567','restore@example.invalid','DE123456789')`);
      const customer = await query(`INSERT INTO customers (name,customer_number,address,city,postal_code,country)
        VALUES ('Vorhandener Kunde',$1,'Weg 1','Bonn','53111','Deutschland') RETURNING id`, [`BASE-${suffix}`]);
      const client = await pool.connect();
      let backup;
      try {
        const { data } = await readBackupSnapshot(client, ['company', 'customers']);
        backup = { version: '3.0', workspaceId, data, manifest: createBackupManifest(data) };
      } finally { client.release(); }
      const session = await query('INSERT INTO migration_sessions (workspace_id) VALUES ($1) RETURNING id', [workspaceId]);
      fixtures.set(workspaceId, { backup, customerId: customer.rows[0].id, sessionId: session.rows[0].id });
    });
  }
  for (const workspaceId of [workspaceA, workspaceB]) {
    const fixture = fixtures.get(workspaceId);
    Object.assign(fixture, await importCategory(workspaceId, fixture.sessionId, workspaceId === workspaceA ? 'Neu-A' : 'Neu-B'));
  }
  await own(workspaceB, () => query(`UPDATE migration_sessions SET status='completed',completed_at=NOW() WHERE workspace_id=$1`, [workspaceB]));
  await own(workspaceLegacy, () => query('UPDATE migration_sessions SET legacy_backfill=TRUE WHERE workspace_id=$1', [workspaceLegacy]));
});

after(async () => {
  try {
    for (const workspaceId of workspaces) await own(workspaceId, async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await clearWorkspaceBusinessData(client, workspaceId);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    });
    await query('DELETE FROM workspaces WHERE id=ANY($1::uuid[])', [workspaces]);
  } finally { await pool.end(); }
});

test('älteres Backup setzt nur offene Kategorie-Fortschritte zurück und erlaubt eine neue Freigabe', async () => {
  const fixture = fixtures.get(workspaceA);
  const sessionBefore = await own(workspaceA, () => query('SELECT * FROM migration_sessions'));
  const otherBefore = await own(workspaceB, () => query('SELECT * FROM migration_categories'));
  const restored = await invoke(backupRouter, '/restore', workspaceA, { backupData: fixture.backup });
  assert.equal(restored.statusCode, 200, JSON.stringify(restored.payload));
  const state = await own(workspaceA, async () => ({
    session: (await query('SELECT * FROM migration_sessions')).rows[0],
    category: (await query('SELECT * FROM migration_categories WHERE id=$1', [fixture.categoryId])).rows[0],
    customers: (await query('SELECT id FROM customers')).rows,
    runs: (await query('SELECT id FROM import_runs')).rows,
  }));
  assert.equal(state.session.id, fixture.sessionId, 'der einmalige Sitzungs-Claim bleibt erhalten');
  assert.equal(state.session.status, 'open');
  assert.equal(state.session.progress_revision, sessionBefore.rows[0].progress_revision + 1);
  assert.equal(state.category.status, 'open');
  assert.equal(state.category.preview_digest, null);
  assert.equal(state.category.idempotency_key, null);
  assert.equal(state.category.completed_at, null);
  assert.deepEqual(state.customers.map(row => row.id), [fixture.customerId]);
  assert.equal(state.runs.length, 0);
  assert.deepEqual((await own(workspaceB, () => query('SELECT * FROM migration_categories'))).rows, otherBefore.rows);
  const stale = await importCustomers(workspaceA, fixture.execution);
  assert.equal(stale.statusCode, 409, 'eine Freigabe vor dem Restore darf nicht wiederverwendet werden');
  assert.equal(stale.payload.code, 'TAKEOVER_PREVIEW_STALE');
  await importCategory(workspaceA, fixture.sessionId, 'Nach-Restore');
});

test('Restore reaktiviert weder abgeschlossene Sitzungen noch einen historischen Umzugs-Claim', async () => {
  for (const workspaceId of [workspaceB, workspaceLegacy]) {
    const before = (await own(workspaceId, () => query('SELECT * FROM migration_sessions'))).rows[0];
    const restored = await invoke(backupRouter, '/restore', workspaceId, { backupData: fixtures.get(workspaceId).backup });
    assert.equal(restored.statusCode, 200, JSON.stringify(restored.payload));
    const after = (await own(workspaceId, () => query('SELECT * FROM migration_sessions'))).rows[0];
    assert.equal(after.id, before.id);
    assert.equal(after.status, before.status);
    assert.equal(after.legacy_backfill, before.legacy_backfill);
    assert.equal(after.progress_revision, before.progress_revision);
  }
  const category = (await own(workspaceB, () => query('SELECT status FROM migration_categories'))).rows[0];
  assert.equal(category.status, 'completed');
});

test('fehlgeschlagener Restore rollt auch die Kategorie- und Sitzungsänderung zurück', async () => {
  const fixture = fixtures.get(workspaceA);
  const before = await own(workspaceA, async () => ({
    session: (await query('SELECT * FROM migration_sessions')).rows,
    categories: (await query('SELECT * FROM migration_categories')).rows,
    customers: (await query('SELECT id FROM customers ORDER BY id')).rows,
  }));
  const data = structuredClone(fixture.backup.data);
  data.customers[0].id = fixtures.get(workspaceB).customerId;
  const invalidBackup = { ...fixture.backup, data, manifest: createBackupManifest(data) };
  const restored = await invoke(backupRouter, '/restore', workspaceA, { backupData: invalidBackup });
  assert.equal(restored.statusCode, 409, JSON.stringify(restored.payload));
  const after = await own(workspaceA, async () => ({
    session: (await query('SELECT * FROM migration_sessions')).rows,
    categories: (await query('SELECT * FROM migration_categories')).rows,
    customers: (await query('SELECT id FROM customers ORDER BY id')).rows,
  }));
  assert.deepEqual(after, before);
});
