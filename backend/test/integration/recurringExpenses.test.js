import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../../database.js';
import { runWithRequestContext } from '../../utils/requestContext.js';
import { confirmRun, createExpense, generateRuns, listExpenses, updateExpense } from '../../services/recurringExpenses.js';
import recurringExpensesRouter from '../../routes/recurringExpenses.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Integrationstests dürfen nur gegen eine als Test/Integration benannte Datenbank laufen.');
}

const workspaceA = randomUUID();
const workspaceB = randomUUID();
const userA = randomUUID();
const userB = randomUUID();
const suffix = randomUUID().slice(0, 8);
let businessExpenseId;
let privateExpenseId;
let confirmedRunId;

const inWorkspace = (workspaceId, userId, callback) => runWithRequestContext({ workspaceId, userId }, callback);
const routeHandler = (method, path) => recurringExpensesRouter.stack
  .find(layer => layer.route?.path === path && layer.route.methods[method])?.route.stack.at(-1)?.handle;

async function invoke(method, path, workspaceId, userId, { role = 'owner', params = {}, body = {} } = {}) {
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await inWorkspace(workspaceId,userId,() => routeHandler(method,path)(
    { auth: { workspaceId, role, workspace: { plan: 'free' } }, params, body, query: {} },response,error => { throw error; },
  ));
  return response;
}

before(async () => {
  await pool.query(`INSERT INTO workspaces (id,name,slug) VALUES ($1,'Fixkosten A',$2),($3,'Fixkosten B',$4)`, [workspaceA,`recurring-a-${suffix}`,workspaceB,`recurring-b-${suffix}`]);
  await inWorkspace(workspaceA,userA,() => query(`INSERT INTO workspace_extensions (extension_id,enabled,accepted_at) VALUES ('taxes',TRUE,NOW())`));
  await inWorkspace(workspaceA,userA,async () => {
    const business = await createExpense(query, { name: `Miete ${suffix}`, category: 'rent', amount: 500, startDate: '2026-01-31', nextDueDate: '2026-01-31', intervalUnit: 'month' }, '2026-01-01');
    businessExpenseId = business.expense.id;
    const privateExpense = await createExpense(query, { name: `KV ${suffix}`, scope: 'private_levy', category: 'kv', amount: 300, startDate: '2026-01-31', nextDueDate: '2026-01-31', intervalUnit: 'month' }, '2026-01-01');
    privateExpenseId = privateExpense.expense.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await generateRuns(client, '2026-01-31', { today: '2026-01-31', canAccessPrivate: true });
      const runs = await client.query('SELECT id FROM recurring_expense_runs WHERE expense_id=$1', [businessExpenseId]);
      confirmedRunId = runs.rows[0].id;
      await confirmRun(client, confirmedRunId, '2026-01-31');
      await client.query('COMMIT');
    } finally { client.release(); }
  });
});

after(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.allow_history_purge','true',true)");
    await client.query('DELETE FROM workspaces WHERE id=ANY($1::uuid[])', [[workspaceA,workspaceB]]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  await pool.end();
});

test('Fixkosten und private Abgaben sind durch FORCE RLS getrennt', async () => {
  const own = await inWorkspace(workspaceA,userA,() => listExpenses(query));
  const foreign = await inWorkspace(workspaceB,userB,() => listExpenses(query));
  assert.ok(own.some(row => row.id === businessExpenseId));
  assert.ok(foreign.every(row => row.id !== businessExpenseId && row.id !== privateExpenseId));
  const policies = await pool.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('recurring_expenses','recurring_expense_runs','levy_payments') ORDER BY relname`);
  assert.equal(policies.rowCount, 3);
  assert.ok(policies.rows.every(row => row.relrowsecurity && row.relforcerowsecurity));
  const receiptFk = await pool.query("SELECT condeferrable,condeferred FROM pg_constraint WHERE conname='recurring_expenses_receipt_workspace_fk'");
  assert.equal(receiptFk.rows[0]?.condeferrable,true);
  assert.equal(receiptFk.rows[0]?.condeferred,true);
});

test('GET verbirgt private Vorlagen und private Änderungen erfordern workspace.settings', async () => {
  const viewerList = await invoke('get','/',workspaceA,userA,{ role: 'viewer' });
  assert.equal(viewerList.statusCode,200);
  assert.ok(viewerList.payload.some(item => item.id === businessExpenseId));
  assert.ok(viewerList.payload.every(item => item.id !== privateExpenseId));
  const ownerList = await invoke('get','/',workspaceA,userA);
  assert.ok(ownerList.payload.some(item => item.id === privateExpenseId));
  const denied = await invoke('put','/:id',workspaceA,userA,{ role: 'viewer', params: { id: privateExpenseId }, body: { notes: 'unberechtigt' } });
  assert.equal(denied.statusCode,403);
  const disabled = await invoke('post','/',workspaceB,userB,{ body: { name: 'KV', scope: 'private_levy', category: 'kv', amountGross: 1, startDate: '2026-01-01' } });
  assert.equal(disabled.statusCode,403);
  assert.equal(disabled.payload.code,'EXTENSION_DISABLED');
  const invalidId = await invoke('put','/:id',workspaceA,userA,{ params: { id: 'not-a-uuid' }, body: {} });
  assert.equal(invalidId.statusCode,400);
});

test('Bestätigter betrieblicher Lauf erzeugt idempotent genau eine EÜR-Ausgabe', async () => {
  await inWorkspace(workspaceA,userA,async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const first = await confirmRun(client, confirmedRunId, '2026-01-31');
      const second = await confirmRun(client, confirmedRunId, '2026-02-01');
      await client.query('COMMIT');
      assert.equal(second.idempotent, true);
      assert.equal(first.run.euerEntryId, second.run.euerEntryId);
      const entries = await query("SELECT id,source_type,source_id FROM euer_entries WHERE source_type='recurring_expense' AND source_id=$1", [confirmedRunId]);
      assert.equal(entries.rowCount, 1);
    } finally { client.release(); }
  });
});

test('generische EÜR-Quelle kann keinen Lauf ohne Bestätigungskontext buchen', async () => {
  await inWorkspace(workspaceA,userA,async () => {
    await assert.rejects(query(`INSERT INTO euer_entries (entry_type,entry_date,description,category,amount,tax_rate,source_type,source_id)
      VALUES ('expense','2026-02-01','Gefälschte Quelle','rent',500,0,'recurring_expense',$1)`, [confirmedRunId]), /nur durch die Bestätigung|Fixkosten-EÜR/i);
  });
});

test('private Fixkostenläufe lassen sich nicht als EÜR-Quelle buchen', async () => {
  await inWorkspace(workspaceA,userA,async () => {
    const privateRuns = await query('SELECT id FROM recurring_expense_runs WHERE expense_id=$1', [privateExpenseId]);
    assert.equal(privateRuns.rowCount, 1);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.recurring_expense_confirmation',$1,true)", [privateRuns.rows[0].id]);
      await assert.rejects(client.query(`INSERT INTO euer_entries (entry_type,entry_date,description,category,amount,tax_rate,source_type,source_id)
        VALUES ('expense','2026-01-31','Private Abgabe','kv',300,0,'recurring_expense',$1)`, [privateRuns.rows[0].id]), /Nur ein betrieblicher/);
      await client.query('ROLLBACK');
    } finally { client.release(); }
    const noPrivateEuer = await query("SELECT id FROM euer_entries WHERE source_type='recurring_expense' AND source_id=$1", [privateRuns.rows[0].id]);
    assert.equal(noPrivateEuer.rowCount, 0);
  });
});

test('Preisänderung ab heute aktualisiert geplante Läufe, bestätigter Snapshot bleibt unverändert', async () => {
  await inWorkspace(workspaceA,userA,async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await generateRuns(client, '2026-11-30', { canAccessPrivate: true, today: '2026-10-09' });
      const before = await client.query('SELECT snapshot FROM recurring_expense_runs WHERE id=$1', [confirmedRunId]);
      const changed = await updateExpense(client.query.bind(client), businessExpenseId, {
        priceChanges: [{ validFrom: '2026-10-09', amountGross: 650 }],
      }, '2026-10-09');
      assert.ok(changed.expense);
      const confirmed = await client.query('SELECT snapshot FROM recurring_expense_runs WHERE id=$1', [confirmedRunId]);
      assert.equal(Number(before.rows[0].snapshot.amount),500);
      assert.equal(Number(confirmed.rows[0].snapshot.amount),500);
      const future = await client.query("SELECT snapshot FROM recurring_expense_runs WHERE expense_id=$1 AND due_date >= '2026-10-09' AND status='planned' ORDER BY due_date LIMIT 1", [businessExpenseId]);
      assert.equal(Number(future.rows[0].snapshot.amount),650);
      await client.query('ROLLBACK');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
});

test('Restore-Wartung darf historische Läufe löschen und Restore-INSERT prüft weiterhin den businessSnapshot', async () => {
  await inWorkspace(workspaceA,userA,async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SAVEPOINT guarded_delete');
      await assert.rejects(client.query('DELETE FROM recurring_expense_runs WHERE id=$1', [confirmedRunId]), /Historische Fixkostenläufe/);
      await client.query('ROLLBACK TO SAVEPOINT guarded_delete');
      await client.query("SELECT set_config('app.audit_disabled','true',true)");
      const deleted = await client.query('DELETE FROM recurring_expense_runs WHERE id=$1 RETURNING id', [confirmedRunId]);
      assert.equal(deleted.rowCount,1);
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.allow_history_purge','true',true)");
      const resetDelete = await client.query('DELETE FROM recurring_expense_runs WHERE id=$1 RETURNING id', [confirmedRunId]);
      assert.equal(resetDelete.rowCount,1);
      await client.query('ROLLBACK');
    } finally { client.release(); }

    const client2 = await pool.connect();
    try {
      await client2.query('BEGIN');
      await generateRuns(client2, '2026-11-30', { canAccessPrivate: true, today: '2026-10-09' });
      const pending = await client2.query("SELECT id,due_date,snapshot FROM recurring_expense_runs WHERE expense_id=$1 AND status='planned' ORDER BY due_date LIMIT 1", [businessExpenseId]);
      assert.ok(pending.rows.length);
      await client2.query("SELECT set_config('app.audit_disabled','true',true)");
      await client2.query(`INSERT INTO euer_entries (entry_type,entry_date,description,category,amount,tax_rate,source_type,source_id)
        VALUES ('expense',$1,$2,$3,$4,0,'recurring_expense',$5)`, [pending.rows[0].due_date,'Restore-Test',pending.rows[0].snapshot.category,pending.rows[0].snapshot.amount,pending.rows[0].id]);
      const privateRun = await client2.query('SELECT id FROM recurring_expense_runs WHERE expense_id=$1 LIMIT 1', [privateExpenseId]);
      await assert.rejects(client2.query(`INSERT INTO euer_entries (entry_type,entry_date,description,category,amount,tax_rate,source_type,source_id)
        VALUES ('expense','2026-01-31','Restore private','kv',1,0,'recurring_expense',$1)`, [privateRun.rows[0].id]), /Nur ein betrieblicher/);
      await client2.query('ROLLBACK');
    } finally { client2.release(); }
  });
});
