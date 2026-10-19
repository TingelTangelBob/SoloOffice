import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../../database.js';
import importsRouter from '../../routes/imports.js';
import takeoverRouter from '../../routes/takeover.js';
import { runWithRequestContext } from '../../utils/requestContext.js';
import { clearWorkspaceBusinessData } from '../../services/workspaceData.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Integrationstests dürfen nur gegen eine als Test/Integration benannte Datenbank laufen.');
}

const workspaceId = randomUUID();
const foreignWorkspaceId = randomUUID();
const userId = randomUUID();
const suffix = randomUUID().slice(0, 8);
const context = workspaceId => callback => runWithRequestContext({ workspaceId, userId }, callback);
const own = context(workspaceId);
const foreign = context(foreignWorkspaceId);
const auth = { role: 'owner', workspaceId, userId };

function handler(path, method) {
  return routerHandler(importsRouter, path, method);
}

function routerHandler(router, path, method) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.equal(typeof layer?.route?.stack?.[0]?.handle, 'function', `${method.toUpperCase()} ${path} fehlt`);
  return layer.route.stack[0].handle;
}

function invoke(path, method, req = {}) {
  return invokeRouter(importsRouter, path, method, req);
}

function invokeRouter(router, path, method, req = {}) {
  return new Promise((resolve, reject) => {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { resolve({ statusCode: this.statusCode, payload }); } };
    Promise.resolve(routerHandler(router, path, method)({ auth, params: {}, body: {}, ...req }, response, reject)).catch(reject);
  });
}

before(async () => {
  await query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [userId, `course-import-${suffix}@example.invalid`, 'integration-only']);
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
    await query('DELETE FROM users WHERE id = $1', [userId]);
  } finally { await pool.end(); }
});

test('Importoption erstellt Kurse und Rückgängigmachen löscht Verknüpfungen FK-sicher', async () => {
  const customerId = (await own(() => query(`INSERT INTO customers (name, customer_number, customer_type, address, city, postal_code, country) VALUES ('Kurskunde', $1, 'person', 'Weg 1', 'Bonn', '53111', 'Deutschland') RETURNING id`, [`C-${suffix}`]))).rows[0].id;
  const result = await own(() => invoke('/:resource', 'post', {
    params: { resource: 'invoices' },
    body: { dryRun: false, createInvoiceCourses: true, rows: [{ invoiceNumber: `ALT-${suffix}`, issueDate: '2025-02-03', customerId, customerName: 'Kurskunde', taxRate: 0, itemDescription: 'Position aus Altbestand', courseName: 'Kurs aus Mapping', itemQuantity: 2, itemUnitPrice: 40, itemUnit: 'Stunde' }] },
  }));
  assert.equal(result.statusCode, 200, JSON.stringify(result.payload));
  assert.deepEqual(result.payload.courseSummary, { created: 1, assigned: 0 });
  const createdCourse = await own(() => query('SELECT title FROM job_entries WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1', [customerId]));
  assert.equal(createdCourse.rows[0]?.title, 'Kurs aus Mapping');
  const imported = await own(() => query(`SELECT i.id AS invoice_id, j.id AS job_id, j.status, j.hours_worked, j.hourly_rate, ii.unit FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id JOIN invoice_job_sources ijs ON ijs.invoice_id = i.id JOIN job_entries j ON j.id = ijs.job_id WHERE i.invoice_number = $1`, [`ALT-${suffix}`]));
  assert.equal(imported.rows.length, 1);
  assert.equal(imported.rows[0].status, 'invoiced');
  assert.equal(imported.rows[0].unit, 'Stunde');
  assert.equal(Number(imported.rows[0].hours_worked), 2);
  const reverted = await own(() => invoke('/runs/:id/revert', 'post', { params: { id: result.payload.runId } }));
  assert.equal(reverted.statusCode, 200, JSON.stringify(reverted.payload));
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM invoice_job_sources'))).rows[0].count, 0);
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM job_entries'))).rows[0].count, 0);
});

test('Legacy-Rechnungsimporte ohne Link-Items nehmen nur ihre eigenen Kursverknüpfungen zurück', async () => {
  const customerId = (await own(() => query(`INSERT INTO customers (name, customer_number, customer_type, address, city, postal_code, country) VALUES ('Legacykunde', $1, 'person', 'Weg 1', 'Bonn', '53111', 'Deutschland') RETURNING id`, [`LEGACY-${suffix}`]))).rows[0].id;
  const imported = await own(() => invoke('/:resource', 'post', {
    params: { resource: 'invoices' },
    body: { dryRun: false, createInvoiceCourses: true, rows: [{ invoiceNumber: `ALT-LEGACY-${suffix}`, issueDate: '2025-02-04', customerId, customerName: 'Legacykunde', taxRate: 0, itemDescription: 'Legacy-Kurs', courseName: 'Legacy-Kurs', itemQuantity: 1, itemUnitPrice: 31, itemUnit: 'Stunde' }] },
  }));
  assert.equal(imported.statusCode, 200, JSON.stringify(imported.payload));
  assert.equal((await own(() => query("SELECT COUNT(*)::int AS count FROM import_run_items WHERE run_id = $1 AND table_name = 'invoice_job_sources'", [imported.payload.runId]))).rows[0].count, 1);
  // Entspricht einem vor dem Tracking-Fix gespeicherten Importlauf.
  await own(() => query("DELETE FROM import_run_items WHERE run_id = $1 AND table_name = 'invoice_job_sources'", [imported.payload.runId]));

  const reverted = await own(() => invoke('/runs/:id/revert', 'post', { params: { id: imported.payload.runId } }));
  assert.equal(reverted.statusCode, 200, JSON.stringify(reverted.payload));
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM invoice_job_sources'))).rows[0].count, 0);
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM invoices'))).rows[0].count, 0);
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM job_entries'))).rows[0].count, 0);
});

test('Gemappter Kursname bleibt im bestätigten Nachschritt nach Rechnungsimport erhalten', async () => {
  const customerId = (await own(() => query(`INSERT INTO customers (name, customer_number, customer_type, address, city, postal_code, country) VALUES ('Mappingkunde', $1, 'person', 'Weg 1', 'Bonn', '53111', 'Deutschland') RETURNING id`, [`M-${suffix}`]))).rows[0].id;
  const imported = await own(() => invoke('/:resource', 'post', {
    params: { resource: 'invoices' },
    body: { dryRun: false, createInvoiceCourses: false, rows: [{ invoiceNumber: `ALT-M-${suffix}`, issueDate: '2025-02-03', customerId, customerName: 'Mappingkunde', taxRate: 0, itemDescription: 'Positionsbeschreibung', courseName: 'Ausgewählter Kursname', itemQuantity: 2, itemUnitPrice: 40, itemUnit: 'Stunde' }] },
  }));
  assert.equal(imported.statusCode, 200, JSON.stringify(imported.payload));
  const preview = await own(() => invoke('/invoice-courses', 'post', { body: { dryRun: true } }));
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.payload));
  const invoice = preview.payload.preview.find(item => item.invoiceNumber === `ALT-M-${suffix}`);
  assert.equal(invoice?.actions[0]?.title, 'Ausgewählter Kursname');
  assert.equal(invoice?.actions[0]?.description, 'Positionsbeschreibung');
  // Aufräumen, damit nachfolgende Nachschritt-Tests nur ihre eigenen Rechnungen sehen.
  const reverted = await own(() => invoke('/runs/:id/revert', 'post', { params: { id: imported.payload.runId } }));
  assert.equal(reverted.statusCode, 200, JSON.stringify(reverted.payload));
});

test('Nachschritt zeigt Vorschau, protokolliert den Undo-Lauf idempotent und bleibt workspaceisoliert', async () => {
  const customerId = (await own(() => query(`INSERT INTO customers (name, customer_number, customer_type, address, city, postal_code, country) VALUES ('Nachkunde', $1, 'person', 'Weg 1', 'Bonn', '53111', 'Deutschland') RETURNING id`, [`N-${suffix}`]))).rows[0].id;
  const foreignCustomerId = (await foreign(() => query(`INSERT INTO customers (name, customer_number, customer_type, address, city, postal_code, country) VALUES ('Fremdkunde', $1, 'person', 'Weg 2', 'Bonn', '53111', 'Deutschland') RETURNING id`, [`F-${suffix}`]))).rows[0].id;
  const createInvoice = workspace => workspace(async () => {
    const inserted = await query(`INSERT INTO invoices (invoice_number, document_type, origin, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total, status) VALUES ($1, 'invoice', 'imported', $2, 'Kunde', '2025-03-04', '2025-03-18', 50, 0, 50, 'draft') RETURNING id`, [`ALT-N-${workspace === own ? 'own' : 'foreign'}-${suffix}`, workspace === own ? customerId : foreignCustomerId]);
    await query('INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, total, item_order) VALUES ($1, $2, 1, 50, 0, 50, 1)', [inserted.rows[0].id, 'Beratung']);
    await query("UPDATE invoices SET status = 'paid' WHERE id = $1", [inserted.rows[0].id]);
  });
  await createInvoice(own);
  await createInvoice(foreign);
  const preview = await own(() => invoke('/invoice-courses', 'post', { body: { dryRun: true } }));
  assert.equal(preview.payload.summary.created, 1);
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM job_entries'))).rows[0].count, 0);
  const executed = await own(() => invoke('/invoice-courses', 'post', { body: { dryRun: false } }));
  assert.equal(executed.statusCode, 200, JSON.stringify(executed.payload));
  assert.equal(executed.payload.summary.created, 1);
  assert.equal(executed.payload.summary.imported, 1);
  assert.ok(executed.payload.runId);
  const run = await own(() => query('SELECT resource, status FROM import_runs WHERE id = $1', [executed.payload.runId]));
  assert.deepEqual(run.rows[0], { resource: 'invoiceCourses', status: 'pending' });
  const tracked = await own(() => query("SELECT table_name, action FROM import_run_items WHERE run_id = $1 ORDER BY seq", [executed.payload.runId]));
  assert.deepEqual(tracked.rows.map(row => [row.table_name, row.action]), [['job_entries', 'created'], ['invoice_job_sources', 'created']]);
  const again = await own(() => invoke('/invoice-courses', 'post', { body: { dryRun: false } }));
  assert.deepEqual(again.payload.summary, { invoices: 0, created: 0, assigned: 0, imported: 0 });
  assert.equal(again.payload.runId, null);
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM invoice_job_sources'))).rows[0].count, 1);
  assert.equal((await foreign(() => query('SELECT COUNT(*)::int AS count FROM invoice_job_sources'))).rows[0].count, 0);
  await own(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await clearWorkspaceBusinessData(client, workspaceId, { companyProfile: false });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM job_entries'))).rows[0].count, 0);
});

test('Kursnachschritt lässt sich vor dem Rechnungsimport zurücknehmen; Zuordnung stellt den alten Status wieder her', async () => {
  const customerId = (await own(() => query(`INSERT INTO customers (name, customer_number, customer_type, address, city, postal_code, country) VALUES ('Undo-Kurskunde', $1, 'person', 'Weg 1', 'Bonn', '53111', 'Deutschland') RETURNING id`, [`UNDO-${suffix}`]))).rows[0].id;
  const oldJob = (await own(() => query(`INSERT INTO job_entries (job_number, customer_id, title, description, date, hours_worked, hourly_rate, status) VALUES ($1, $2, 'Bestehender Kurs', 'Beschreibung', '2025-05-06', 1, 30, 'completed') RETURNING id`, [`AB-UNDO-${suffix}`, customerId]))).rows[0].id;
  const invoiceRun = await own(() => invoke('/:resource', 'post', {
    params: { resource: 'invoices' },
    body: { dryRun: false, createInvoiceCourses: false, rows: [{
      invoiceNumber: `ALT-UNDO-${suffix}`, issueDate: '2025-05-06', customerId, customerName: 'Undo-Kurskunde', taxRate: 0,
      items: [
        { description: 'Bestehender Kurs', courseName: 'Bestehender Kurs', quantity: 1, unitPrice: 30, unit: 'Stunde' },
        { description: 'Neu anzulegender Kurs', quantity: 2, unitPrice: 40, unit: 'Stunde' },
      ],
    }] },
  }));
  assert.equal(invoiceRun.statusCode, 200, JSON.stringify(invoiceRun.payload));

  const coursePreview = await own(() => invoke('/invoice-courses', 'post', { body: { dryRun: true } }));
  const target = coursePreview.payload.preview.find(row => row.invoiceNumber === `ALT-UNDO-${suffix}`);
  assert.deepEqual(target.actions.map(action => action.action), ['assign', 'create']);
  const courseRun = await own(() => invoke('/invoice-courses', 'post', { body: { dryRun: false } }));
  assert.equal(courseRun.statusCode, 200, JSON.stringify(courseRun.payload));
  assert.ok(courseRun.payload.runId);
  assert.deepEqual(courseRun.payload.preview.find(row => row.invoiceNumber === `ALT-UNDO-${suffix}`).actions.map(action => action.action), ['assign', 'create']);
  const savedCourseRun = (await own(() => query('SELECT summary, report FROM import_runs WHERE id = $1', [courseRun.payload.runId]))).rows[0];
  assert.equal(savedCourseRun.summary.total, 2);
  assert.equal(savedCourseRun.summary.records, 2);
  assert.deepEqual(savedCourseRun.report.map(row => [row.rowNumber, row.status, row.message]), [
    [1, 'imported', `ALT-UNDO-${suffix} · Zuordnung`],
    [2, 'imported', `ALT-UNDO-${suffix} · Neu`],
  ]);
  assert.deepEqual(Object.keys(savedCourseRun.report[0].values).sort(), ['customer', 'date', 'hourlyRate', 'hoursWorked', 'title']);
  assert.equal(savedCourseRun.report[0].values.title, 'Bestehender Kurs');
  assert.equal(savedCourseRun.report[1].values.title, 'Neu anzulegender Kurs');

  const tooEarly = await own(() => invoke('/runs/:id/revert', 'post', { params: { id: invoiceRun.payload.runId } }));
  assert.equal(tooEarly.statusCode, 409, JSON.stringify(tooEarly.payload));
  assert.equal((await own(() => query('SELECT status FROM job_entries WHERE id = $1', [oldJob]))).rows[0].status, 'invoiced');
  const readOnlyRevert = await own(() => invoke('/runs/:id/revert', 'post', {
    auth: { role: 'viewer', workspaceId }, params: { id: courseRun.payload.runId },
  }));
  assert.equal(readOnlyRevert.statusCode, 403, JSON.stringify(readOnlyRevert.payload));
  assert.equal((await own(() => query('SELECT status FROM import_runs WHERE id = $1', [courseRun.payload.runId]))).rows[0].status, 'pending');

  const courseRevert = await own(() => invoke('/runs/:id/revert', 'post', { params: { id: courseRun.payload.runId } }));
  assert.equal(courseRevert.statusCode, 200, JSON.stringify(courseRevert.payload));
  assert.equal((await own(() => query('SELECT status FROM job_entries WHERE id = $1', [oldJob]))).rows[0].status, 'completed');
  assert.equal((await own(() => query("SELECT COUNT(*)::int AS count FROM job_entries WHERE title = 'Neu anzulegender Kurs'"))).rows[0].count, 0);
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM invoice_job_sources'))).rows[0].count, 0);

  const invoiceRevert = await own(() => invoke('/runs/:id/revert', 'post', { params: { id: invoiceRun.payload.runId } }));
  assert.equal(invoiceRevert.statusCode, 200, JSON.stringify(invoiceRevert.payload));
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM invoices'))).rows[0].count, 0);
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM job_entries'))).rows[0].count, 1);
});

test('Kurslauf protokolliert nur den aktiven Workspace und blockiert nachträglich ergänzte Materialien', async () => {
  const customerId = (await own(() => query(`INSERT INTO customers (name, customer_number, customer_type, address, city, postal_code, country) VALUES ('Sicherheitskunde', $1, 'person', 'Weg 1', 'Bonn', '53111', 'Deutschland') RETURNING id`, [`SAFE-${suffix}`]))).rows[0].id;
  const foreignJob = (await foreign(() => query(`INSERT INTO job_entries (job_number, title, description, date, hours_worked, hourly_rate, status) VALUES ($1, 'Fremder Kurs', '', '2025-06-07', 1, 20, 'completed') RETURNING id`, [`AB-FREM-${suffix}`]))).rows[0].id;
  const imported = await own(() => invoke('/:resource', 'post', {
    params: { resource: 'invoices' },
    body: { dryRun: false, rows: [{ invoiceNumber: `ALT-SAFE-${suffix}`, issueDate: '2025-06-07', customerId, customerName: 'Sicherheitskunde', taxRate: 0, itemDescription: 'Eigener Kurs', courseName: 'Eigener Kurs', itemQuantity: 1, itemUnitPrice: 20, itemUnit: 'Stunde' }] },
  }));
  assert.equal(imported.statusCode, 200, JSON.stringify(imported.payload));
  const courseRun = await own(() => invoke('/invoice-courses', 'post', { body: { dryRun: false } }));
  assert.equal(courseRun.statusCode, 200, JSON.stringify(courseRun.payload));
  assert.equal((await foreign(() => query('SELECT COUNT(*)::int AS count FROM invoice_job_sources WHERE job_id = $1', [foreignJob]))).rows[0].count, 0);

  const createdJob = (await own(() => query("SELECT id FROM job_entries WHERE title = 'Eigener Kurs'"))).rows[0].id;
  const snapshot = (await own(() => query("SELECT old_data->'expected' AS expected FROM import_run_items WHERE run_id = $1 AND table_name = 'job_entries' AND action = 'created'", [courseRun.payload.runId]))).rows[0].expected;
  assert.deepEqual(snapshot.materials, []);
  assert.equal('created_at' in snapshot, false);
  assert.equal('updated_at' in snapshot, false);
  await own(() => query("UPDATE job_entries SET materials = '[{\"name\":\"Zusatzmaterial\",\"quantity\":1}]'::jsonb WHERE id = $1", [createdJob]));
  const blocked = await own(() => invoke('/runs/:id/revert', 'post', { params: { id: courseRun.payload.runId } }));
  assert.equal(blocked.statusCode, 409, JSON.stringify(blocked.payload));
  assert.deepEqual((await own(() => query('SELECT materials FROM job_entries WHERE id = $1', [createdJob]))).rows[0].materials, [{ name: 'Zusatzmaterial', quantity: 1 }]);
  await own(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await clearWorkspaceBusinessData(client, workspaceId, { companyProfile: false });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
});

test('Kurslauf gehört zur offenen Umzugssitzung und wird beim Abschluss endgültig', async () => {
  const customerId = (await own(() => query(`INSERT INTO customers (name, customer_number, customer_type, address, city, postal_code, country) VALUES ('Sitzungskunde', $1, 'person', 'Weg 1', 'Bonn', '53111', 'Deutschland') RETURNING id`, [`SESSION-${suffix}`]))).rows[0].id;
  const sessionId = (await own(() => query('INSERT INTO migration_sessions (workspace_id) VALUES ($1) RETURNING id', [workspaceId]))).rows[0].id;
  const invoiceId = (await own(() => query(`
    INSERT INTO invoices (invoice_number, document_type, origin, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total, status)
    VALUES ($1, 'invoice', 'imported', $2, 'Sitzungskunde', '2025-07-08', '2025-07-22', 25, 0, 25, 'draft') RETURNING id
  `, [`ALT-SESSION-${suffix}`, customerId]))).rows[0].id;
  await own(() => query('INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, total, item_order, unit) VALUES ($1, $2, 1, 25, 0, 25, 1, \'Stunde\')', [invoiceId, 'Sitzungskurs']));
  await own(() => query("UPDATE invoices SET status = 'sent' WHERE id = $1", [invoiceId]));

  const executed = await own(() => invoke('/invoice-courses', 'post', { body: { dryRun: false } }));
  assert.equal(executed.statusCode, 200, JSON.stringify(executed.payload));
  const run = await own(() => query('SELECT migration_session_id, status FROM import_runs WHERE id = $1', [executed.payload.runId]));
  assert.deepEqual(run.rows[0], { migration_session_id: sessionId, status: 'pending' });

  const completed = await own(() => invokeRouter(takeoverRouter, '/:sessionId/complete', 'post', {
    params: { sessionId },
  }));
  assert.equal(completed.statusCode, 200, JSON.stringify(completed.payload));
  assert.equal(completed.payload.session.completedBy, userId);
  assert.equal((await own(() => query('SELECT status FROM import_runs WHERE id = $1', [executed.payload.runId]))).rows[0].status, 'confirmed');
  const reverted = await own(() => invoke('/runs/:id/revert', 'post', { params: { id: executed.payload.runId } }));
  assert.equal(reverted.statusCode, 409, JSON.stringify(reverted.payload));
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM invoice_job_sources WHERE invoice_id = $1', [invoiceId]))).rows[0].count, 1);
  await own(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await clearWorkspaceBusinessData(client, workspaceId, { companyProfile: false });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
});

test('Umzugsassistent übernimmt Kurse mit geprüfter Option und Reset löscht Verknüpfungen', async () => {
  const customerId = (await own(() => query(`INSERT INTO customers (name, customer_number, customer_type, address, city, postal_code, country) VALUES ('Umzugskunde', $1, 'person', 'Weg 1', 'Bonn', '53111', 'Deutschland') RETURNING id`, [`U-${suffix}`]))).rows[0].id;
  const sessionId = (await own(() => query('INSERT INTO migration_sessions (workspace_id) VALUES ($1) RETURNING id', [workspaceId]))).rows[0].id;
  const rows = [{ invoiceNumber: `ALT-U-${suffix}`, issueDate: '2025-04-09', customerId, customerName: 'Umzugskunde', taxRate: 0, items: [{ description: 'Übersetzung', quantity: 3, unitPrice: 25, unit: 'Stunde' }] }];
  const preview = await own(() => invoke('/:resource', 'post', {
    params: { resource: 'invoices' },
    body: { rows, dryRun: true, createInvoiceCourses: true, takeover: { sessionId, phase: 'preview' } },
  }));
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.payload));
  assert.deepEqual(preview.payload.courseSummary, { created: 1, assigned: 0 });
  const stale = await own(() => invoke('/:resource', 'post', {
    params: { resource: 'invoices' },
    body: { rows, dryRun: false, createInvoiceCourses: false, takeover: { sessionId, phase: 'execute', categoryId: preview.payload.categoryId, previewDigest: preview.payload.previewDigest, idempotencyKey: randomUUID() } },
  }));
  assert.equal(stale.statusCode, 409, JSON.stringify(stale.payload));
  assert.equal((await own(() => query('SELECT status FROM migration_categories WHERE id = $1', [preview.payload.categoryId]))).rows[0].status, 'open');

  const executed = await own(() => invoke('/:resource', 'post', {
    params: { resource: 'invoices' },
    body: { rows, dryRun: false, createInvoiceCourses: true, takeover: { sessionId, phase: 'execute', categoryId: preview.payload.categoryId, previewDigest: preview.payload.previewDigest, idempotencyKey: randomUUID() } },
  }));
  assert.equal(executed.statusCode, 200, JSON.stringify(executed.payload));
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
      await clearWorkspaceBusinessData(client, workspaceId, { companyProfile: false });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM invoice_job_sources'))).rows[0].count, 0);
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM job_entries'))).rows[0].count, 0);
  assert.equal((await own(() => query('SELECT COUNT(*)::int AS count FROM invoice_history'))).rows[0].count, 0);
});
