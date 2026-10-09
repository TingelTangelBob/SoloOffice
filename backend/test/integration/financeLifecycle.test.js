import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../../database.js';
import backupRouter from '../../routes/backup.js';
import euerEntriesRouter from '../../routes/euerEntries.js';
import forecastRouter from '../../routes/forecast.js';
import levyPaymentsRouter from '../../routes/levyPayments.js';
import recurringExpensesRouter from '../../routes/recurringExpenses.js';
import taxProfilesRouter from '../../routes/taxProfiles.js';
import { createBackupManifest } from '../../utils/backupIntegrity.js';
import { runWithRequestContext } from '../../utils/requestContext.js';
import { readBackupSnapshot } from '../../services/backupExport.js';
import { confirmRun, createExpense, generateRuns, updateExpense } from '../../services/recurringExpenses.js';
import { clearWorkspaceBusinessData } from '../../services/workspaceData.js';
import { cleanupFinanceWorkspaces } from './financeTestCleanup.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Finanz-Lifecycle-Integrationstests dürfen nur gegen eine als Test/Integration benannte Datenbank laufen.');
}

const workspaceA = randomUUID();
const workspaceB = randomUUID();
const userA = randomUUID();
const userB = randomUUID();
const suffix = randomUUID().slice(0, 8);
const inWorkspace = (workspaceId, userId, callback) => runWithRequestContext({ workspaceId, userId }, callback);
const handler = (router, method, path) => router.stack
  .find(layer => layer.route?.path === path && layer.route.methods[method])?.route.stack.at(-1)?.handle;

async function invoke(router, method, path, workspaceId, userId, { role = 'owner', params = {}, body = {}, query: queryParams = {} } = {}) {
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await inWorkspace(workspaceId, userId, () => handler(router, method, path)(
    { auth: { workspaceId, role, workspace: { plan: 'free' } }, params, body, query: queryParams },
    response,
    error => { throw error; },
  ));
  return response;
}

async function invokeBackupRestore(workspaceId, body) {
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await inWorkspace(workspaceId, userA, () => handler(backupRouter, 'post', '/restore')(
    { auth: { workspaceId }, body, requestId: 'finance-lifecycle-test' }, response,
  ));
  return response;
}

async function invokeExtensionGuard(router, workspaceId, userId) {
  const middleware = router.stack.find(layer => !layer.route)?.handle;
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await inWorkspace(workspaceId, userId, () => middleware(
    { auth: { workspaceId, workspace: { plan: 'free' } } }, response, () => { response.calledNext = true; },
  ));
  return response;
}

async function makeRuns() {
  return inWorkspace(workspaceA, userA, async () => {
    const business = await createExpense(query, {
      name: `Miete ${suffix}`, category: 'rent', amount: 500, startDate: '2026-01-31',
      nextDueDate: '2026-01-31', intervalUnit: 'month',
    }, '2026-01-01');
    const privateExpense = await createExpense(query, {
      name: `KV ${suffix}`, scope: 'private_levy', category: 'kv', amount: 300,
      startDate: '2026-01-31', nextDueDate: '2026-01-31', intervalUnit: 'month',
    }, '2026-01-01');
    assert.ok(business.expense?.id, business.error);
    assert.ok(privateExpense.expense?.id, privateExpense.error);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await generateRuns(client, '2026-01-31', { today: '2026-01-31', canManagePrivate: true, canAccessPrivate: true });
      const businessRun = await client.query('SELECT id FROM recurring_expense_runs WHERE expense_id=$1', [business.expense.id]);
      const privateRun = await client.query('SELECT id FROM recurring_expense_runs WHERE expense_id=$1', [privateExpense.expense.id]);
      const confirmed = await confirmRun(client, businessRun.rows[0].id, '2026-01-31', '2026-01-31');
      await confirmRun(client, privateRun.rows[0].id, '2026-01-31', '2026-01-31');
      await client.query('COMMIT');
      return { businessId: business.expense.id, privateId: privateExpense.expense.id,
        businessRunId: businessRun.rows[0].id, privateRunId: privateRun.rows[0].id,
        entryId: confirmed.run.euerEntryId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  });
}

let fixtures;

before(async () => {
  await pool.query('INSERT INTO workspaces (id,name,slug) VALUES ($1,$2,$3),($4,$5,$6)', [
    workspaceA, 'Finanztest A', `finance-a-${suffix}`, workspaceB, 'Finanztest B', `finance-b-${suffix}`,
  ]);
  await inWorkspace(workspaceA, userA, () => query("INSERT INTO workspace_extensions (extension_id,enabled,accepted_at) VALUES ('taxes',TRUE,NOW())"));
  await inWorkspace(workspaceA, userA, async () => {
    await query(`INSERT INTO company (workspace_id,id,name,address,city,postal_code,country,phone,email,tax_id)
      VALUES ($1,nextval('company_id_seq'),$2,'Musterstraße 1','Berlin','10115','Deutschland','030 123','finance-${suffix}@example.invalid','DE123')`, [workspaceA, `Firma ${suffix}`]);
  });
  fixtures = await makeRuns();
});

after(() => cleanupFinanceWorkspaces([workspaceA, workspaceB]));

test('FORCE RLS trennt Vorlagen, Läufe, Abgaben und EÜR bei Lesen und Schreiben', async () => {
  const own = await inWorkspace(workspaceA, userA, () => query('SELECT id FROM recurring_expenses'));
  const foreignRead = await inWorkspace(workspaceB, userB, () => query('SELECT id FROM recurring_expenses WHERE id=ANY($1::uuid[])', [[fixtures.businessId, fixtures.privateId]]));
  assert.ok(own.rows.some(row => row.id === fixtures.businessId));
  assert.deepEqual(foreignRead.rows, []);
  await assert.rejects(inWorkspace(workspaceA, userA, () => query(`INSERT INTO recurring_expenses (workspace_id,name,category,scope,amount,interval_unit,start_date,next_due_date)
    VALUES ($1,'fremd','rent','business',1,'month','2026-01-01','2026-01-01')`, [workspaceB])), error => error?.code === '42501');
  const metadata = await pool.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('recurring_expenses','recurring_expense_runs','levy_payments') ORDER BY relname");
  assert.equal(metadata.rowCount, 3);
  assert.ok(metadata.rows.every(row => row.relrowsecurity && row.relforcerowsecurity));
  const fk = await pool.query("SELECT condeferrable,condeferred FROM pg_constraint WHERE conname='recurring_expenses_receipt_workspace_fk'");
  assert.deepEqual(fk.rows[0], { condeferrable: true, condeferred: true });
});

test('private EÜR wird trotz Bestätigungskontext und gefälschter generischer Quelle abgewiesen', async () => {
  await inWorkspace(workspaceA, userA, async () => {
    const privateEntry = await query("SELECT id FROM euer_entries WHERE source_type='recurring_expense' AND source_id=$1", [fixtures.privateRunId]);
    assert.equal(privateEntry.rowCount, 0);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.recurring_expense_confirmation',$1,true)", [fixtures.privateRunId]);
      await assert.rejects(client.query(`INSERT INTO euer_entries (entry_type,entry_date,description,category,amount,tax_rate,source_type,source_id)
        VALUES ('expense','2026-01-31','Private Abgabe','rent',300,0,'recurring_expense',$1)`, [fixtures.privateRunId]), /Nur ein betrieblicher/);
      await client.query('ROLLBACK');
    } finally { client.release(); }
    await assert.rejects(query(`INSERT INTO euer_entries (entry_type,entry_date,description,category,amount,tax_rate,source_type,source_id)
      VALUES ('expense','2026-01-31','Gefälschte Quelle','rent',500,0,'recurring_expense',$1)`, [randomUUID()]), /Fixkosten-EÜR|betrieblicher/);
  });
});

test('die Datenbank lässt eine private Abgabenart nicht als betriebliche Vorlage zu', async () => {
  await inWorkspace(workspaceA, userA, async () => {
    await assert.rejects(query(`INSERT INTO recurring_expenses (name,category,scope,amount,interval_unit,start_date,next_due_date)
      VALUES ($1,'kv','business',1,'month','2099-01-01','2099-01-01')`, [`falsche Zuordnung ${suffix}`]),
    /check constraint|Kategorie|Abgabe/i);
  });
});

test('private Kategorien werden auch bei manueller Quelle und Restore-Kontext abgewiesen', async () => {
  await inWorkspace(workspaceA, userA, async () => {
    for (const category of ['kv', 'pv', 'rv', 'av', 'ksk', 'est_vz', 'gewst_vz', 'ust']) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.audit_disabled','true',true)");
        await assert.rejects(client.query(`INSERT INTO euer_entries
          (entry_type,entry_date,description,category,amount,tax_rate,source_type)
          VALUES ('expense','2026-01-31','Private Kategorie',$1,100,0,'manual')`, [category]),
        error => error?.code === '23514' && error?.constraint === 'euer_private_category_guard');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    }
  });
});

test('EÜR erlaubt nur unveränderte bestätigte betriebliche Quelle bei PUT', async () => {
  const edited = await invoke(euerEntriesRouter, 'put', '/:id', workspaceA, userA, {
    params: { id: fixtures.entryId }, body: { description: 'Miete angepasst', amount: 525 },
  });
  assert.equal(edited.statusCode, 200);
  assert.equal(edited.payload.sourceType, 'recurring_expense');
  assert.equal(edited.payload.sourceId, fixtures.businessRunId);
  const wrongRun = await invoke(euerEntriesRouter, 'put', '/:id', workspaceA, userA, {
    params: { id: fixtures.entryId }, body: { sourceId: fixtures.privateRunId },
  });
  assert.equal(wrongRun.statusCode, 400);
  assert.match(wrongRun.payload.error, /quelle/i);
  const newExpense = await inWorkspace(workspaceA, userA, () => query(`INSERT INTO euer_entries (entry_type,entry_date,description,category,amount,tax_rate)
    VALUES ('expense','2026-01-31','Manuell','rent',1,0) RETURNING id`));
  const forged = await invoke(euerEntriesRouter, 'put', '/:id', workspaceA, userA, {
    params: { id: newExpense.rows[0].id }, body: { sourceType: 'recurring_expense', sourceId: fixtures.businessRunId },
  });
  assert.equal(forged.statusCode, 400);
  assert.match(forged.payload.error, /quelle|fixkosten/i);
});

test('private Berechtigungen und Erweiterungsschutz gelten, betriebliche Fixkosten bleiben verfügbar', async () => {
  const businessViewer = await invoke(recurringExpensesRouter, 'get', '/', workspaceA, userA, { role: 'viewer' });
  assert.equal(businessViewer.statusCode, 200);
  assert.ok(businessViewer.payload.some(item => item.id === fixtures.businessId));
  assert.ok(businessViewer.payload.every(item => item.id !== fixtures.privateId));
  const privateDenied = await invoke(recurringExpensesRouter, 'put', '/:id', workspaceA, userA, {
    role: 'viewer', params: { id: fixtures.privateId }, body: { notes: 'nicht erlaubt' },
  });
  assert.equal(privateDenied.statusCode, 403);
  for (const router of [taxProfilesRouter, forecastRouter, levyPaymentsRouter]) {
    const withoutExtension = await invokeExtensionGuard(router, workspaceB, userB);
    assert.equal(withoutExtension.statusCode, 403);
    assert.equal(withoutExtension.payload.code, 'EXTENSION_DISABLED');
  }
  const privateExpenseDisabled = await invoke(recurringExpensesRouter, 'post', '/', workspaceB, userB, {
    body: { name: 'KV', scope: 'private_levy', category: 'kv', amount: 1, startDate: '2026-01-01' },
  });
  assert.equal(privateExpenseDisabled.statusCode, 403);
  assert.equal(privateExpenseDisabled.payload.code, 'EXTENSION_DISABLED');
  const businessRouteAfterDisable = await invoke(recurringExpensesRouter, 'get', '/', workspaceB, userB);
  assert.equal(businessRouteAfterDisable.statusCode, 200);
});

test('Preiswechsel ab künftiger Gültigkeit lässt bestätigte Snapshots unverändert', async () => {
  await inWorkspace(workspaceA, userA, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await generateRuns(client, '2026-11-30', { canAccessPrivate: true, today: '2026-10-09' });
      const confirmedBefore = await client.query('SELECT snapshot FROM recurring_expense_runs WHERE id=$1', [fixtures.businessRunId]);
      const changed = await updateExpense(client.query.bind(client), fixtures.businessId, {
        priceChanges: [{ validFrom: '2026-11-30', amountGross: 650 }],
      }, '2026-10-09');
      assert.ok(changed.expense);
      const confirmedAfter = await client.query('SELECT snapshot FROM recurring_expense_runs WHERE id=$1', [fixtures.businessRunId]);
      assert.equal(Number(confirmedBefore.rows[0].snapshot.amount), 500);
      assert.equal(Number(confirmedAfter.rows[0].snapshot.amount), 500);
      const future = await client.query(`SELECT snapshot FROM recurring_expense_runs
        WHERE expense_id=$1 AND due_date='2026-11-30' AND status='planned'`, [fixtures.businessId]);
      assert.equal(Number(future.rows[0].snapshot.amount), 650);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  });
});

test('Abgaben-PUT ändert kanonischen Zeitraum; widersprüchliche Jahresangabe gibt 400', async () => {
  const inserted = await invoke(levyPaymentsRouter, 'post', '/', workspaceA, userA, {
    body: { kind: 'kv', year: 2026, period: '2026-01', amount: 123.45 },
  });
  assert.equal(inserted.statusCode, 201);
  const moved = await invoke(levyPaymentsRouter, 'put', '/:id', workspaceA, userA, {
    params: { id: inserted.payload.id }, body: { year: 2026, period: '2026-03' },
  });
  assert.equal(moved.statusCode, 200);
  assert.equal(moved.payload.period, '2026-03');
  const mismatch = await invoke(levyPaymentsRouter, 'put', '/:id', workspaceA, userA, {
    params: { id: inserted.payload.id }, body: { year: 2027, period: '2026-04' },
  });
  assert.equal(mismatch.statusCode, 400);
  assert.match(mismatch.payload.error, /passen nicht zusammen/);
});

test('Lauferzeugung und parallele Bestätigung bleiben idempotent', async () => {
  const next = await inWorkspace(workspaceA, userA, () => createExpense(query, {
    name: `Software ${suffix}`, category: 'software', amount: 45, startDate: '2026-04-01',
    nextDueDate: '2026-04-01', intervalUnit: 'month',
  }, '2026-01-01'));
  const runId = await inWorkspace(workspaceA, userA, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await generateRuns(client, '2026-04-01', { today: '2026-04-01' });
      await client.query("UPDATE recurring_expenses SET next_due_date='2026-04-01' WHERE id=$1", [next.expense.id]);
      const duplicateGeneration = await generateRuns(client, '2026-04-01', { today: '2026-04-01' });
      assert.deepEqual(duplicateGeneration, []);
      const run = await client.query('SELECT id FROM recurring_expense_runs WHERE expense_id=$1', [next.expense.id]);
      await client.query('COMMIT');
      return run.rows[0].id;
    } finally { client.release(); }
  });
  await inWorkspace(workspaceA, userA, async () => {
    const clients = await Promise.all([pool.connect(), pool.connect()]);
    try {
      // Jede Verbindung committet für sich: die zweite wartet auf die Zeilensperre der ersten
      // und muss danach den bestehenden Lauf idempotent zurückgeben.
      const confirmations = await Promise.all(clients.map(async client => {
        await client.query('BEGIN');
        const result = await confirmRun(client, runId, '2026-04-01', '2026-04-01');
        await client.query('COMMIT');
        return result;
      }));
      assert.equal(confirmations.filter(result => result.idempotent).length, 1);
    } catch (error) {
      await Promise.all(clients.map(client => client.query('ROLLBACK').catch(() => {})));
      throw error;
    } finally { clients.forEach(client => client.release()); }
    const runs = await query('SELECT id FROM recurring_expense_runs WHERE expense_id=$1', [next.expense.id]);
    const entries = await query("SELECT id FROM euer_entries WHERE source_type='recurring_expense' AND source_id=$1", [runId]);
    assert.equal(runs.rowCount, 1);
    assert.equal(entries.rowCount, 1);
  });
});

test('Backup/Restore erhält wiederkehrende Quelle, private Abgaben, Audit-Trigger und Firmen-ID', async () => {
  const backup = await inWorkspace(workspaceA, userA, async () => {
    const client = await pool.connect();
    try {
      const tables = ['company','workspace_extensions','tax_profiles','recurring_expenses','recurring_expense_runs','euer_entries','euer_entry_history','levy_payments'];
      const { data } = await readBackupSnapshot(client, tables);
      return { version: '3.0', workspaceId: workspaceA, data, manifest: createBackupManifest(data) };
    } finally { client.release(); }
  });
  assert.ok(backup.data.recurring_expense_runs.some(run => run.id === fixtures.businessRunId));
  assert.ok(backup.data.levy_payments.some(payment => payment.recurring_expense_run_id === fixtures.privateRunId));
  const historyBefore = await inWorkspace(workspaceA, userA, () => query('SELECT id FROM euer_entry_history'));
  const companyIdBefore = backup.data.company[0].id;
  const result = await invokeBackupRestore(workspaceA, { backupData: backup });
  assert.equal(result.statusCode, 200, result.payload?.message);
  assert.equal(result.payload.success, true);
  const restored = await inWorkspace(workspaceA, userA, async () => {
    const company = await query('SELECT id,name FROM company');
    const source = await query("SELECT e.id,e.source_id,r.status,r.euer_entry_id FROM euer_entries e JOIN recurring_expense_runs r ON r.id=e.source_id WHERE e.id=$1", [fixtures.entryId]);
    const privateLevy = await query('SELECT id,recurring_expense_run_id FROM levy_payments WHERE recurring_expense_run_id=$1', [fixtures.privateRunId]);
    const privateEuer = await query("SELECT id FROM euer_entries WHERE source_type='recurring_expense' AND source_id=$1", [fixtures.privateRunId]);
    const historyAfter = await query('SELECT id FROM euer_entry_history');
    return { company: company.rows[0], source: source.rows[0], privateLevy: privateLevy.rows[0], privateEuer, historyAfter };
  });
  assert.equal(restored.company.id, companyIdBefore);
  assert.equal(restored.source.status, 'confirmed');
  assert.equal(restored.source.euer_entry_id, fixtures.entryId);
  assert.equal(restored.privateLevy.recurring_expense_run_id, fixtures.privateRunId);
  assert.equal(restored.privateEuer.rowCount, 0);
  assert.equal(restored.historyAfter.rowCount, historyBefore.rowCount, 'Restore darf Audit-Historie nicht mit künstlichen Lösch-/Anlageereignissen füllen.');
});

test('Workspace-Reset mit behaltenem Firmenprofil löscht neue private und wiederkehrende Fachdaten', async () => {
  await inWorkspace(workspaceA, userA, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query('SELECT id FROM company WHERE workspace_id=$1', [workspaceA]);
      const plan = await clearWorkspaceBusinessData(client, workspaceA, { companyProfile: false, takeover: true });
      assert.ok(!plan.tables.includes('company'));
      assert.equal((await client.query('SELECT id FROM company WHERE workspace_id=$1', [workspaceA])).rowCount, before.rowCount);
      assert.equal((await client.query('SELECT id FROM recurring_expenses WHERE workspace_id=$1', [workspaceA])).rowCount, 0);
      assert.equal((await client.query('SELECT id FROM recurring_expense_runs WHERE workspace_id=$1', [workspaceA])).rowCount, 0);
      assert.equal((await client.query('SELECT id FROM levy_payments WHERE workspace_id=$1', [workspaceA])).rowCount, 0);
      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  });
});
