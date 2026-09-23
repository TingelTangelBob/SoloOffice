import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { pool, query } from '../../database.js';
import importsRouter from '../../routes/imports.js';
import { findInvoiceById } from '../../queries/invoiceQueries.js';
import { runWithRequestContext } from '../../utils/requestContext.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Integrationstests dürfen nur gegen eine als Test/Integration benannte Datenbank laufen.');
}

// Prüft den vollständigen Datenbankpfad der Datenübernahme: Planung und
// Schreiben, übernommene Rechnungen samt Zahlungen, Originaldokumente und das
// Rückgängigmachen in umgekehrter Reihenfolge einschließlich Trigger-Ausnahme.
const workspaceId = randomUUID();
const suffix = randomUUID().slice(0, 8);
const auth = { role: 'owner', workspaceId };
const inWorkspace = callback => runWithRequestContext({ workspaceId, userId: randomUUID() }, callback);

function handler(path, method) {
  const layer = importsRouter.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.equal(typeof layer?.route?.stack?.[0]?.handle, 'function', `${method.toUpperCase()} ${path} fehlt`);
  return layer.route.stack[0].handle;
}

function invoke(path, method, req) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ statusCode: this.statusCode, payload }); },
    };
    Promise.resolve(handler(path, method)({ auth, params: {}, body: {}, ...req }, response, reject)).catch(reject);
  });
}

const importRows = (resource, rows, extra = {}) => inWorkspace(() => invoke('/:resource', 'post', {
  params: { resource },
  body: { rows, dryRun: false, ...extra },
}));
const revert = runId => inWorkspace(() => invoke('/runs/:id/revert', 'post', { params: { id: runId } }));

before(async () => {
  await query('INSERT INTO workspaces (id, name, slug) VALUES ($1, $2, $3)', [workspaceId, 'Datenübernahme', `data-import-${suffix}`]);
  await inWorkspace(() => query(`INSERT INTO company (name, address, city, postal_code, country, email, tax_id)
    VALUES ('Nachhilfe Test', 'Weg 1', 'Köln', '50667', 'Deutschland', 'test@example.invalid', 'DE123456789')`));
});

after(async () => {
  try {
    await inWorkspace(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.audit_disabled','true',true), set_config('app.allow_history_purge','true',true)");
        for (const table of ['import_run_items', 'import_runs', 'euer_entry_history', 'euer_entries', 'invoice_history', 'invoices', 'job_entries', 'customers', 'company']) {
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
    await query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  } finally {
    await pool.end();
  }
});

const lessons = [
  ['2021-09-15', 5], ['2021-10-10', 10], ['2021-10-21', 10], ['2021-10-31', 10], ['2021-11-11', 10],
].map(([entryDate, unitPrice], index) => ({
  _rowNumber: index + 2, entryDate, customerName: 'Anna', quantity: 1, unitPrice, entryType: 'income', taxRate: 0, description: 'Unterricht',
}));

let lessonRun;
let invoiceRun;
let moneyRun;

test('Unterrichtsstunden werden als Einnahmen mit neuem Schüler übernommen und protokolliert', async () => {
  const preview = await inWorkspace(() => invoke('/:resource', 'post', { params: { resource: 'euerEntries' }, body: { rows: lessons, createMissingCustomers: true } }));
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.payload.dryRun, true);
  assert.equal(preview.payload.totals.income, 45);
  assert.equal((await inWorkspace(() => query('SELECT COUNT(*)::int AS count FROM euer_entries'))).rows[0].count, 0, 'die Vorschau schreibt nichts');

  const result = await importRows('euerEntries', lessons, { createMissingCustomers: true, file: { name: 'Unterricht 2021.xlsx', headers: ['Datum', 'Schüler'] } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.summary.imported, 5);
  lessonRun = result.payload.runId;
  assert.ok(lessonRun);

  const customers = (await inWorkspace(() => query('SELECT id, customer_number, name FROM customers'))).rows;
  assert.deepEqual(customers.map(row => [row.customer_number, row.name]), [['0001', 'Anna']]);
  const entries = (await inWorkspace(() => query("SELECT amount, customer_id, notes FROM euer_entries WHERE status = 'active' ORDER BY entry_date"))).rows;
  assert.equal(entries.length, 5);
  assert.ok(entries.every(row => row.customer_id === customers[0].id));
  assert.match(entries[0].notes, /Datenübernahme: Unterricht 2021\.xlsx, Zeile 2/);

  const again = await importRows('euerEntries', lessons, { createMissingCustomers: true });
  assert.equal(again.statusCode, 400, 'eine erneut importierte Datei enthält nur Duplikate');
});

test('übernommene Rechnungen werden ausgestellt, bezahlt bzw. offen angelegt und Einnahmen zugeordnet', async () => {
  const result = await importRows('invoices', [
    { _rowNumber: 2, invoiceNumber: 'ALT-2024-017', issueDate: '2024-03-01', customerName: 'Anna', total: 119, taxRate: 19, paidDate: '2024-03-10' },
    { _rowNumber: 3, invoiceNumber: 'ALT-2024-018', issueDate: '2024-03-02', customerName: 'Anna', total: 50, taxRate: 0 },
  ], { file: { name: 'Rechnungen.csv', headers: [] } });
  assert.equal(result.statusCode, 200, JSON.stringify(result.payload));
  invoiceRun = result.payload.runId;

  const invoices = (await inWorkspace(() => query("SELECT id, invoice_number, status, origin, total FROM invoices ORDER BY invoice_number"))).rows;
  assert.deepEqual(invoices.map(row => [row.invoice_number, row.status, row.origin, Number(row.total)]), [
    ['ALT-2024-017', 'paid', 'imported', 119],
    ['ALT-2024-018', 'overdue', 'imported', 50],
  ]);
  const paid = await inWorkspace(() => findInvoiceById(invoices[0].id));
  assert.equal(paid.paidAmount, 119);
  assert.equal(paid.origin, 'imported');
  assert.equal(paid.hasOriginalDocument, false);

  await assert.rejects(
    inWorkspace(() => query("UPDATE invoices SET notes = 'geändert' WHERE id = $1", [invoices[0].id])),
    /unveränderbar/,
    'übernommene Rechnungen sind wie ausgestellte Rechnungen geschützt',
  );

  const pdf = Buffer.from('%PDF-1.4\n%%EOF').toString('base64');
  const upload = await inWorkspace(() => invoke('/original-documents/:invoiceId', 'put', {
    params: { invoiceId: invoices[0].id },
    body: { name: 'ALT-2024-017.pdf', contentType: 'application/pdf', content: pdf },
  }));
  assert.equal(upload.statusCode, 200, JSON.stringify(upload.payload));
  assert.equal((await inWorkspace(() => findInvoiceById(invoices[0].id))).hasOriginalDocument, true);

  const money = await importRows('euerEntries', [
    { _rowNumber: 2, entryDate: '2024-03-15', entryType: 'income', customerName: 'Anna', amount: 50, description: 'Überweisung' },
  ], { file: { name: 'Kasse.csv', headers: [] } });
  assert.equal(money.statusCode, 200);
  moneyRun = money.payload.runId;
  assert.match(money.payload.rows[0].message, /Zahlung zu Rechnung ALT-2024-018/);
  const status = (await inWorkspace(() => query("SELECT status FROM invoices WHERE invoice_number = 'ALT-2024-018'"))).rows[0].status;
  assert.equal(status, 'paid');
});

test('Rückgängigmachen ist blockiert, solange spätere Importe darauf aufbauen, und funktioniert rückwärts', async () => {
  const blocked = await revert(invoiceRun);
  assert.equal(blocked.statusCode, 409);
  assert.match(blocked.payload.error, /ALT-2024-018/);

  assert.equal((await revert(moneyRun)).statusCode, 200);
  assert.equal((await inWorkspace(() => query("SELECT status FROM invoices WHERE invoice_number = 'ALT-2024-018'"))).rows[0].status, 'overdue');

  const invoiceRevert = await revert(invoiceRun);
  assert.equal(invoiceRevert.statusCode, 200, JSON.stringify(invoiceRevert.payload));
  assert.equal((await inWorkspace(() => query('SELECT COUNT(*)::int AS count FROM invoices'))).rows[0].count, 0);
  assert.equal((await inWorkspace(() => query('SELECT COUNT(*)::int AS count FROM invoice_original_documents'))).rows[0].count, 0);
  const history = (await inWorkspace(() => query("SELECT COUNT(*)::int AS count FROM invoice_history WHERE action = 'deleted' AND record_type = 'invoice'"))).rows[0].count;
  assert.equal(history, 2, 'das Entfernen bleibt in der Rechnungshistorie nachvollziehbar');

  assert.equal((await revert(lessonRun)).statusCode, 200);
  assert.equal((await inWorkspace(() => query('SELECT COUNT(*)::int AS count FROM customers'))).rows[0].count, 0);
  const voided = (await inWorkspace(() => query("SELECT COUNT(*)::int AS count FROM euer_entries WHERE status = 'voided' AND correction_reason = 'Import rückgängig gemacht'"))).rows[0].count;
  assert.equal(voided, 7, '5 Unterrichtsstunden und 2 Rechnungszahlungen');

  const again = await revert(lessonRun);
  assert.equal(again.statusCode, 409, 'ein Lauf wird nur einmal rückgängig gemacht');
});

test('ohne ausdrückliche Freigabe löscht niemand eine übernommene Rechnung', async () => {
  const result = await importRows('invoices', [
    { _rowNumber: 2, invoiceNumber: 'ALT-2024-099', issueDate: '2024-04-01', customerName: 'Berta', total: 10, taxRate: 0 },
  ], { createMissingCustomers: true });
  assert.equal(result.statusCode, 200);
  await assert.rejects(
    inWorkspace(() => query("DELETE FROM invoices WHERE invoice_number = 'ALT-2024-099'")),
    /können nicht gelöscht werden/,
  );
  const confirm = await inWorkspace(() => invoke('/runs/:id/confirm', 'post', { params: { id: result.payload.runId } }));
  assert.equal(confirm.statusCode, 200);
  const late = await revert(result.payload.runId);
  assert.equal(late.statusCode, 409);
  assert.match(late.payload.error, /abgeschlossen/);
});
