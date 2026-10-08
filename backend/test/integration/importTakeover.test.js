import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { pool, query } from '../../database.js';
import importsRouter from '../../routes/imports.js';
import { runWithRequestContext } from '../../utils/requestContext.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Integrationstests dürfen nur gegen eine als Test/Integration benannte Datenbank laufen.');
}

const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const requestUserId = randomUUID();
const suffix = randomUUID().slice(0, 8);
const auth = { role: 'owner', workspaceId };
const otherAuth = { role: 'owner', workspaceId: otherWorkspaceId };
const inWorkspace = (id, callback) => runWithRequestContext({ workspaceId: id, userId: requestUserId }, callback);

function importHandler() {
  const layer = importsRouter.stack.find(item => item.route?.path === '/:resource' && item.route.methods.post);
  assert.equal(typeof layer?.route?.stack?.[0]?.handle, 'function', 'POST /:resource fehlt');
  return layer.route.stack[0].handle;
}

function invoke(resource, body, requestAuth = auth) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ statusCode: this.statusCode, payload }); },
    };
    Promise.resolve(importHandler()({
      auth: requestAuth,
      params: { resource },
      body: { ...body },
    }, response, reject)).catch(reject);
  });
}

// In Produktion nutzt requireAuth eine Pool-Verbindung zuerst ohne
// Workspace-Kontext. Der Wrapper setzt den Kontext dann erst nach BEGIN –
// eine Kategorieübernahme muss das vertragen.
async function withForeignContextConnection(callback) {
  const originalConnect = pool.connect;
  pool.connect = async (...args) => {
    pool.connect = originalConnect;
    const client = await originalConnect(...args);
    await runWithRequestContext({ workspaceId: '', userId: '' }, () => client.query('SELECT 1'));
    return client;
  };
  try {
    return await callback();
  } finally {
    pool.connect = originalConnect;
  }
}

const warningRows = [{
  _rowNumber: 2,
  entryDate: '2099-02-01',
  entryType: 'expense',
  amount: 12.5,
  description: 'Warnungsimport',
}];
const jobWarningRows = [{
  _rowNumber: 2,
  customerId: null,
  date: '2099-02-02',
  title: 'Warnungsauftrag',
}];
let customerId;

before(async () => {
  await query(`
    INSERT INTO workspaces (id, name, slug)
    VALUES ($1, 'Import-Übernahme A', $2), ($3, 'Import-Übernahme B', $4)
  `, [workspaceId, `import-takeover-a-${suffix}`, otherWorkspaceId, `import-takeover-b-${suffix}`]);
  await inWorkspace(workspaceId, () => query(`
    INSERT INTO company (name, address, city, postal_code, country, phone, email, tax_id)
    VALUES ('Import-Test', 'Teststraße 1', 'Berlin', '10115', 'Deutschland', '0301234567', 'import-test@example.invalid', 'DE123456789')
  `));
  customerId = (await inWorkspace(workspaceId, () => query(`
    INSERT INTO customers (customer_number, name, address, city, postal_code, country)
    VALUES ($1, 'Importkunde', 'Kundenstraße 1', 'Berlin', '10115', 'Deutschland')
    RETURNING id
  `, [`TAKEOVER-${suffix}`]))).rows[0].id;
});

after(async () => {
  try {
    await inWorkspace(workspaceId, async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.audit_disabled','true',true), set_config('app.allow_history_purge','true',true)");
        for (const table of ['import_run_items', 'import_runs', 'migration_categories', 'migration_sessions', 'euer_entry_history', 'euer_entries', 'job_entries', 'customers', 'company']) {
          await client.query(`DELETE FROM ${table}`);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
    await inWorkspace(otherWorkspaceId, () => query('DELETE FROM migration_sessions'));
    await query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [[workspaceId, otherWorkspaceId]]);
  } finally {
    await pool.end();
  }
});

test('übernimmt einen Import mit Warnung nach erfolgreicher Vorschau', async () => {
  const rows = [{ ...jobWarningRows[0], customerId }];
  const preview = await inWorkspace(workspaceId, () => invoke('jobs', { rows }));
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.payload));
  assert.equal(preview.payload.dryRun, true);
  assert.equal(preview.payload.summary.warnings, 1, 'der fehlende Status ist eine Warnung');
  assert.equal(preview.payload.summary.errors, 0);
  assert.equal(preview.payload.summary.records, 1);
  assert.equal(preview.payload.rows[0].status, 'warning');

  const commit = await inWorkspace(workspaceId, () => invoke('jobs', { rows, dryRun: false }));
  assert.equal(commit.statusCode, 200, JSON.stringify(commit.payload));
  assert.equal(commit.payload.summary.imported, 1);
  assert.ok(commit.payload.runId);
  assert.equal((await inWorkspace(workspaceId, () => query(
    "SELECT COUNT(*)::int AS count FROM job_entries WHERE title = 'Warnungsauftrag'",
  ))).rows[0].count, 1);
  const savedRun = (await inWorkspace(workspaceId, () => query(
    'SELECT id, report FROM import_runs WHERE id = $1', [commit.payload.runId],
  ))).rows[0];
  assert.equal(savedRun.id, commit.payload.runId);
  assert.equal(savedRun.report[0].status, 'imported');
});

let sessionId;

test('blockiert einen normalen Commit während der eigenen offenen Umzugssitzung', async () => {
  sessionId = (await inWorkspace(workspaceId, () => query(
    'INSERT INTO migration_sessions (workspace_id, started_by) VALUES ($1, $2) RETURNING id',
    [workspaceId, null],
  ))).rows[0].id;

  const result = await inWorkspace(workspaceId, () => invoke('euerEntries', {
    rows: [{ ...warningRows[0], description: 'Blockierter Direktimport' }],
    dryRun: false,
  }));
  assert.equal(result.statusCode, 409, JSON.stringify(result.payload));
  assert.equal(result.payload.code, 'TAKEOVER_CATEGORY_APPROVAL_REQUIRED');
});

test('führt eine geprüfte Kategorie aus und liefert bei Wiederholung denselben Lauf', async () => {
  const preview = await inWorkspace(workspaceId, () => invoke('euerEntries', {
    rows: [{ ...warningRows[0], description: 'Freigegebener Import' }],
    takeover: { phase: 'preview', sessionId },
  }));
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.payload));
  assert.ok(preview.payload.categoryId);
  assert.match(preview.payload.previewDigest, /^[0-9a-f]{64}$/);

  const executeBody = {
    rows: [{ ...warningRows[0], description: 'Freigegebener Import' }],
    dryRun: false,
    takeover: {
      phase: 'execute',
      sessionId,
      categoryId: preview.payload.categoryId,
      previewDigest: preview.payload.previewDigest,
      idempotencyKey: randomUUID(),
    },
  };
  const execute = await withForeignContextConnection(() => inWorkspace(workspaceId, () => invoke('euerEntries', executeBody)));
  assert.equal(execute.statusCode, 200, JSON.stringify(execute.payload));
  assert.ok(execute.payload.runId);
  assert.equal(execute.payload.idempotentReplay, undefined);

  const replay = await inWorkspace(workspaceId, () => invoke('euerEntries', executeBody));
  assert.equal(replay.statusCode, 200, JSON.stringify(replay.payload));
  assert.equal(replay.payload.idempotentReplay, true);
  assert.equal(replay.payload.runId, execute.payload.runId);
  assert.equal((await inWorkspace(workspaceId, () => query(
    "SELECT COUNT(*)::int AS count FROM euer_entries WHERE description = 'Freigegebener Import'",
  ))).rows[0].count, 1);

  await inWorkspace(workspaceId, () => query(
    "UPDATE migration_sessions SET status = 'completed', completed_at = NOW() WHERE id = $1",
    [sessionId],
  ));
  const closedReplay = await inWorkspace(workspaceId, () => invoke('euerEntries', executeBody));
  assert.equal(closedReplay.statusCode, 200, JSON.stringify(closedReplay.payload));
  assert.equal(closedReplay.payload.idempotentReplay, true);
  assert.equal(closedReplay.payload.runId, execute.payload.runId);
  assert.equal((await inWorkspace(workspaceId, () => query(
    'SELECT COUNT(*)::int AS count FROM import_runs WHERE migration_category_id = $1', [preview.payload.categoryId],
  ))).rows[0].count, 1);
});

let staleSessionId;

test('rollt einen Commit mit veraltetem Preview-Digest vollständig zurück', async () => {
  staleSessionId = (await inWorkspace(otherWorkspaceId, () => query(
    'INSERT INTO migration_sessions (workspace_id, started_by) VALUES ($1, $2) RETURNING id',
    [otherWorkspaceId, null],
  ))).rows[0].id;
  const preview = await inWorkspace(otherWorkspaceId, () => invoke('euerEntries', {
    rows: [{ ...warningRows[0], description: 'Stale-Übernahme' }],
    takeover: { phase: 'preview', sessionId: staleSessionId },
  }, otherAuth));
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.payload));

  const result = await inWorkspace(otherWorkspaceId, () => invoke('euerEntries', {
    rows: [{ ...warningRows[0], amount: 13.5, description: 'Stale-Übernahme' }],
    dryRun: false,
    takeover: {
      phase: 'execute', sessionId: staleSessionId, categoryId: preview.payload.categoryId,
      previewDigest: preview.payload.previewDigest, idempotencyKey: randomUUID(),
    },
  }, otherAuth));
  assert.equal(result.statusCode, 409, JSON.stringify(result.payload));
  assert.equal(result.payload.code, 'TAKEOVER_PREVIEW_STALE');
  assert.equal((await inWorkspace(otherWorkspaceId, () => query(
    "SELECT COUNT(*)::int AS count FROM euer_entries WHERE description = 'Stale-Übernahme'",
  ))).rows[0].count, 0, 'Stale-Commit darf keine EÜR-Buchung hinterlassen');
  assert.equal((await inWorkspace(otherWorkspaceId, () => query(
    'SELECT COUNT(*)::int AS count FROM import_runs',
  ))).rows[0].count, 0, 'Stale-Commit darf keinen Importlauf hinterlassen');
  assert.equal((await inWorkspace(otherWorkspaceId, () => query(
    'SELECT status FROM migration_categories WHERE id = $1', [preview.payload.categoryId],
  ))).rows[0].status, 'open');
});

test('blockiert die offene Sitzung eines anderen Workspace nicht', async () => {
  const result = await inWorkspace(workspaceId, () => invoke('euerEntries', {
    rows: [{ ...warningRows[0], description: 'Anderer Workspace blockiert nicht' }],
    dryRun: false,
  }));
  assert.equal(result.statusCode, 200, JSON.stringify(result.payload));

  const foreignTakeover = await inWorkspace(workspaceId, () => invoke('euerEntries', {
    rows: [{ ...warningRows[0], description: 'Fremde Sitzung' }],
    takeover: { phase: 'preview', sessionId: staleSessionId },
  }));
  assert.equal(foreignTakeover.statusCode, 409, JSON.stringify(foreignTakeover.payload));
  assert.equal(foreignTakeover.payload.code, 'TAKEOVER_NOT_OPEN');
});
