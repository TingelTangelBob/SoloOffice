import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { pool, query } from '../../database.js';
import { findAllCreditNotes, findAllInvoices } from '../../queries/invoiceQueries.js';
import { findAllQuotes } from '../../queries/quoteQueries.js';
import { runWithRequestContext } from '../../utils/requestContext.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Integrationstests dürfen nur gegen eine als Test/Integration benannte Datenbank laufen.');
}

const workspaceId = randomUUID();
const userId = randomUUID();
const suffix = randomUUID().slice(0, 8);
let customerId;

function inWorkspace(callback) {
  return runWithRequestContext({ workspaceId, userId }, callback);
}

before(async () => {
  await query('INSERT INTO workspaces (id, name, slug) VALUES ($1, $2, $3)', [workspaceId, 'Sortierreihenfolge', `list-order-${suffix}`]);
  const customer = await inWorkspace(() => query(`
    INSERT INTO customers (customer_number, name, address, city, postal_code, country)
    VALUES ($1, 'Sortierkunde', 'Teststraße 1', 'Berlin', '10115', 'Deutschland')
    RETURNING id
  `, [`SORT-${suffix}`]));
  customerId = customer.rows[0].id;

  await inWorkspace(async () => {
    for (const [number, issueDate, documentType] of [
      [`RE-${suffix}-ALT`, '2020-01-01', 'invoice'],
      [`RE-${suffix}-NEU`, '2026-01-01', 'invoice'],
      [`GS-${suffix}-ALT`, '2020-01-01', 'credit_note'],
      [`GS-${suffix}-NEU`, '2026-01-01', 'credit_note'],
    ]) {
      await query(`
        INSERT INTO invoices (invoice_number, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total, status, document_type)
        VALUES ($1, $2, 'Sortierkunde', $3, $3, 10, 0, 10, 'draft', $4)
      `, [number, customerId, issueDate, documentType]);
    }
    for (const [number, issueDate] of [
      [`AN-${suffix}-ALT`, '2020-01-01'],
      [`AN-${suffix}-NEU`, '2026-01-01'],
    ]) {
      await query(`
        INSERT INTO quotes (quote_number, customer_id, customer_name, issue_date, valid_until, subtotal, tax_amount, total, status)
        VALUES ($1, $2, 'Sortierkunde', $3, $3, 10, 0, 10, 'draft')
      `, [number, customerId, issueDate]);
    }
  });
});

after(async () => {
  try {
    await inWorkspace(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.audit_disabled','true',true), set_config('app.allow_history_purge','true',true)");
        await client.query('DELETE FROM invoice_history WHERE workspace_id = $1', [workspaceId]);
        await client.query('DELETE FROM quotes WHERE quote_number IN ($1, $2)', [`AN-${suffix}-ALT`, `AN-${suffix}-NEU`]);
        await client.query('DELETE FROM invoices WHERE invoice_number IN ($1, $2, $3, $4)', [
          `RE-${suffix}-ALT`, `RE-${suffix}-NEU`, `GS-${suffix}-ALT`, `GS-${suffix}-NEU`,
        ]);
        await client.query('DELETE FROM customers WHERE id = $1', [customerId]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  } finally {
    await pool.end();
  }
});

test('Rechnungen und Gutschriften kommen nach Belegdatum absteigend zurück', async () => {
  const [invoices, creditNotes] = await inWorkspace(() => Promise.all([findAllInvoices(), findAllCreditNotes()]));
  assert.deepEqual(invoices.filter(item => item.invoiceNumber.startsWith(`RE-${suffix}`)).map(item => item.invoiceNumber), [`RE-${suffix}-NEU`, `RE-${suffix}-ALT`]);
  assert.deepEqual(creditNotes.filter(item => item.invoiceNumber.startsWith(`GS-${suffix}`)).map(item => item.invoiceNumber), [`GS-${suffix}-NEU`, `GS-${suffix}-ALT`]);
});

test('Angebote kommen nach Angebotsdatum absteigend zurück', async () => {
  const quotes = await inWorkspace(() => findAllQuotes());
  assert.deepEqual(quotes.filter(item => item.quoteNumber.startsWith(`AN-${suffix}`)).map(item => item.quoteNumber), [`AN-${suffix}-NEU`, `AN-${suffix}-ALT`]);
});
