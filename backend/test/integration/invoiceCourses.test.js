import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../../database.js';
import importsRouter from '../../routes/imports.js';
import { runWithRequestContext } from '../../utils/requestContext.js';
import { clearWorkspaceBusinessData } from '../../services/workspaceData.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Integrationstests dürfen nur gegen eine als Test/Integration benannte Datenbank laufen.');
}

const workspaceId = randomUUID();
const foreignWorkspaceId = randomUUID();
const suffix = randomUUID().slice(0, 8);
const context = workspaceId => callback => runWithRequestContext({ workspaceId, userId: randomUUID() }, callback);
const own = context(workspaceId);
const foreign = context(foreignWorkspaceId);
const auth = { role: 'owner', workspaceId };

function handler(path, method) {
  const layer = importsRouter.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.equal(typeof layer?.route?.stack?.[0]?.handle, 'function', `${method.toUpperCase()} ${path} fehlt`);
  return layer.route.stack[0].handle;
}

function invoke(path, method, req = {}) {
  return new Promise((resolve, reject) => {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { resolve({ statusCode: this.statusCode, payload }); } };
    Promise.resolve(handler(path, method)({ auth, params: {}, body: {}, ...req }, response, reject)).catch(reject);
  });
}

before(async () => {
  await query('INSERT INTO workspaces (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)', [workspaceId, 'Kursimport', `course-import-${suffix}`, foreignWorkspaceId, 'Kursimport fremd', `course-import-other-${suffix}`]);
  await own(() => query(`INSERT INTO company (name, address, city, postal_code, country, phone, email, tax_id) VALUES ('Test', 'Weg 1', 'Bonn', '53111', 'Deutschland', '02281234567', 'course@example.invalid', 'DE123456789')`));
  await foreign(() => query(`INSERT INTO company (name, address, city, postal_code, country, phone, email, tax_id) VALUES ('Fremd', 'Weg 2', 'Bonn', '53111', 'Deutschland', '02281234567', 'course-other@example.invalid', 'DE987654321')`));
});

after(async () => {
  try {
    for (const [runContext, id] of [[own, workspaceId], [foreign, foreignWorkspaceId]]) await runContext(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await clearWorkspaceBusinessData(client, id);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    });
    await query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [[workspaceId, foreignWorkspaceId]]);
  } finally { await pool.end(); }
});

test('Importoption erstellt Kurse und Rückgängigmachen löscht Verknüpfungen FK-sicher', async () => {
  const customerId = (await own(() => query(`INSERT INTO customers (name, customer_number, customer_type, address, city, postal_code, country) VALUES ('Kurskunde', $1, 'person', 'Weg 1', 'Bonn', '53111', 'Deutschland') RETURNING id`, [`C-${suffix}`]))).rows[0].id;
  const result = await own(() => invoke('/:resource', 'post', {
    params: { resource: 'invoices' },
    body: { dryRun: false, createInvoiceCourses: true, rows: [{ invoiceNumber: `ALT-${suffix}`, issueDate: '2025-02-03', customerId, customerName: 'Kurskunde', taxRate: 0, items: [{ description: 'Matheunterricht', quantity: 2, unitPrice: 40, unit: 'Stunde' }] }] },
  }));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.courseSummary, { created: 1, assigned: 0 });
  const imported = await own(() => query(`SELECT i.id AS invoice_id, j.id AS job_id, j.status, j.hours_worked, j.hourly_rate, ii.unit FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id JOIN invoice_job_sources ijs ON ijs.invoice_id = i.id JOIN job_entries j ON j.id = ijs.job_id WHERE i.invoice_number = $1`, [`ALT-${suffix}`]));
  assert.equal(imported.rows.length, 1);
  assert.equal(imported.rows[0].status, 'invoiced');
  assert.equal(imported.rows[0].unit, 'Stunde');
  assert.equal(Number(imported.rows[0].hours_worked), 2);
  const reverted = await own(() => invoke('/runs/:id/revert', 'post', { params: { id: result.payload.runId } }));
  assert.equal(reverted.statusCode, 200);
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM invoice_job_sources'))).rows[0].count, 0);
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM job_entries'))).rows[0].count, 0);
});

test('Nachschritt zeigt Vorschau, führt idempotent aus und bleibt workspaceisoliert', async () => {
  const customerId = (await own(() => query(`INSERT INTO customers (name, customer_number, customer_type, address, city, postal_code, country) VALUES ('Nachkunde', $1, 'person', 'Weg 1', 'Bonn', '53111', 'Deutschland') RETURNING id`, [`N-${suffix}`]))).rows[0].id;
  const foreignCustomerId = (await foreign(() => query(`INSERT INTO customers (name, customer_number, customer_type, address, city, postal_code, country) VALUES ('Fremdkunde', $1, 'person', 'Weg 2', 'Bonn', '53111', 'Deutschland') RETURNING id`, [`F-${suffix}`]))).rows[0].id;
  const createInvoice = workspace => workspace(async () => {
    const inserted = await query(`INSERT INTO invoices (invoice_number, document_type, origin, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total, status) VALUES ($1, 'invoice', 'imported', $2, 'Kunde', '2025-03-04', '2025-03-18', 50, 0, 50, 'paid') RETURNING id`, [`ALT-N-${workspace === own ? 'own' : 'foreign'}-${suffix}`, workspace === own ? customerId : foreignCustomerId]);
    await query('INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, total, item_order) VALUES ($1, $2, 1, 50, 0, 50, 1)', [inserted.rows[0].id, 'Beratung']);
  });
  await createInvoice(own);
  await createInvoice(foreign);
  const preview = await own(() => invoke('/invoice-courses', 'post', { body: { dryRun: true } }));
  assert.equal(preview.payload.summary.created, 1);
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM job_entries'))).rows[0].count, 0);
  const executed = await own(() => invoke('/invoice-courses', 'post', { body: { dryRun: false } }));
  assert.equal(executed.statusCode, 200);
  assert.equal(executed.payload.summary.created, 1);
  const again = await own(() => invoke('/invoice-courses', 'post', { body: { dryRun: false } }));
  assert.deepEqual(again.payload.summary, { invoices: 0, created: 0, assigned: 0 });
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM invoice_job_sources'))).rows[0].count, 1);
  assert.equal((await foreign(() => query('SELECT COUNT(*)::int AS count FROM invoice_job_sources'))).rows[0].count, 0);
  await own(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await clearWorkspaceBusinessData(client, workspaceId);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM job_entries'))).rows[0].count, 0);
});

test('Umzugsassistent übernimmt Kurse mit geprüfter Option und Reset löscht Verknüpfungen', async () => {
  const customerId = (await own(() => query(`INSERT INTO customers (name, customer_number, customer_type, address, city, postal_code, country) VALUES ('Umzugskunde', $1, 'person', 'Weg 1', 'Bonn', '53111', 'Deutschland') RETURNING id`, [`U-${suffix}`]))).rows[0].id;
  const sessionId = (await own(() => query('INSERT INTO migration_sessions (workspace_id) VALUES ($1) RETURNING id', [workspaceId]))).rows[0].id;
  const rows = [{ invoiceNumber: `ALT-U-${suffix}`, issueDate: '2025-04-09', customerId, customerName: 'Umzugskunde', taxRate: 0, items: [{ description: 'Übersetzung', quantity: 3, unitPrice: 25, unit: 'Stunde' }] }];
  const preview = await own(() => invoke('/:resource', 'post', {
    params: { resource: 'invoices' },
    body: { rows, dryRun: true, createInvoiceCourses: true, takeover: { sessionId, phase: 'preview' } },
  }));
  assert.equal(preview.statusCode, 200);
  assert.deepEqual(preview.payload.courseSummary, { created: 1, assigned: 0 });
  const stale = await own(() => invoke('/:resource', 'post', {
    params: { resource: 'invoices' },
    body: { rows, dryRun: false, createInvoiceCourses: false, takeover: { sessionId, phase: 'execute', categoryId: preview.payload.categoryId, previewDigest: preview.payload.previewDigest, idempotencyKey: randomUUID() } },
  }));
  assert.equal(stale.statusCode, 409);
  assert.equal((await own(() => query('SELECT status FROM migration_categories WHERE id = $1', [preview.payload.categoryId]))).rows[0].status, 'open');

  const executed = await own(() => invoke('/:resource', 'post', {
    params: { resource: 'invoices' },
    body: { rows, dryRun: false, createInvoiceCourses: true, takeover: { sessionId, phase: 'execute', categoryId: preview.payload.categoryId, previewDigest: preview.payload.previewDigest, idempotencyKey: randomUUID() } },
  }));
  assert.equal(executed.statusCode, 200);
  assert.deepEqual(executed.payload.courseSummary, { created: 1, assigned: 0 });
  const linked = await own(() => query(`SELECT j.date, j.hours_worked, ijs.id AS link_id FROM job_entries j JOIN invoice_job_sources ijs ON ijs.job_id = j.id`));
  assert.equal(linked.rows.length, 1);
  const linkedDate = linked.rows[0].date instanceof Date
    ? `${linked.rows[0].date.getFullYear()}-${String(linked.rows[0].date.getMonth() + 1).padStart(2, '0')}-${String(linked.rows[0].date.getDate()).padStart(2, '0')}`
    : String(linked.rows[0].date).slice(0, 10);
  assert.equal(linkedDate, '2025-04-09');
  assert.equal(Number(linked.rows[0].hours_worked), 3);

  await own(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await clearWorkspaceBusinessData(client, workspaceId);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM invoice_job_sources'))).rows[0].count, 0);
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM job_entries'))).rows[0].count, 0);
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM invoice_history'))).rows[0].count, 0);
});
