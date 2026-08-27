import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { pool, query } from '../../database.js';
import { getMigrationStatus } from '../../migrations/index.js';
import { generateInvoiceNumber } from '../../services/invoiceService.js';
import { runWithRequestContext } from '../../utils/requestContext.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Integrationstests dürfen nur gegen eine als Test/Integration benannte Datenbank laufen.');
}

const workspaceA = randomUUID();
const workspaceB = randomUUID();
const userA = randomUUID();
const userB = randomUUID();
const suffix = randomUUID().slice(0, 8);
let customerAId;
let customerBId;

function inWorkspace(workspaceId, userId, callback) {
  return runWithRequestContext({ workspaceId, userId }, callback);
}

async function removeWorkspaceCustomers(workspaceId, userId) {
  await inWorkspace(workspaceId, userId, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.audit_disabled', 'true', true)");
      await client.query("SELECT set_config('app.allow_history_purge', 'true', true)");
      await client.query("DELETE FROM invoices WHERE invoice_number LIKE 'RE-2099-%'");
      await client.query("DELETE FROM invoice_history WHERE invoice_number LIKE 'RE-2099-%'");
      await client.query('DELETE FROM customers WHERE customer_number = $1', [`RLS-${suffix}`]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}

before(async () => {
  await pool.query(`
    INSERT INTO workspaces (id, name, slug)
    VALUES ($1, 'Integration A', $2), ($3, 'Integration B', $4)
  `, [workspaceA, `integration-a-${suffix}`, workspaceB, `integration-b-${suffix}`]);

  const insertedA = await inWorkspace(workspaceA, userA, () => query(`
    INSERT INTO customers (customer_number, name, address, city, postal_code, country)
    VALUES ($1, 'Kunde A', 'A-Straße 1', 'Berlin', '10115', 'Deutschland')
    RETURNING id
  `, [`RLS-${suffix}`]));
  const insertedB = await inWorkspace(workspaceB, userB, () => query(`
    INSERT INTO customers (customer_number, name, address, city, postal_code, country)
    VALUES ($1, 'Kunde B', 'B-Straße 2', 'Hamburg', '20095', 'Deutschland')
    RETURNING id
  `, [`RLS-${suffix}`]));
  customerAId = insertedA.rows[0].id;
  customerBId = insertedB.rows[0].id;
});

after(async () => {
  await removeWorkspaceCustomers(workspaceA, userA);
  await removeWorkspaceCustomers(workspaceB, userB);
  await pool.query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [[workspaceA, workspaceB]]);
  await pool.end();
});

test('alle Migrationen sind auf einer frischen PostgreSQL-Datenbank ausgeführt', async () => {
  const client = await pool.connect();
  try {
    const status = await getMigrationStatus(client);
    assert.equal(status.pending.length, 0);
    assert.ok(status.executed.length >= 34);
  } finally {
    client.release();
  }
});

test('der Laufzeitbenutzer kann Row-Level Security nicht umgehen', async () => {
  const result = await pool.query(`
    SELECT rolsuper, rolbypassrls
    FROM pg_roles
    WHERE rolname = current_user
  `);
  assert.deepEqual(result.rows[0], { rolsuper: false, rolbypassrls: false });
});

test('jede RLS-Tabelle erzwingt ihre Richtlinien auch für den Tabellenbesitzer', async () => {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE table_class.relrowsecurity)::integer AS protected_count,
      COUNT(*) FILTER (
        WHERE table_class.relrowsecurity AND NOT table_class.relforcerowsecurity
      )::integer AS unforced_count
    FROM pg_class AS table_class
    JOIN pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
    WHERE table_class.relkind IN ('r', 'p')
      AND namespace.nspname = 'public'
  `);
  assert.ok(result.rows[0].protected_count >= 30);
  assert.equal(result.rows[0].unforced_count, 0);
});

test('zwei Workspace-Kontexte sehen ausschließlich ihre eigenen Kunden', async () => {
  const customersA = await inWorkspace(workspaceA, userA, () => query(
    'SELECT name, workspace_id FROM customers WHERE customer_number = $1',
    [`RLS-${suffix}`],
  ));
  const customersB = await inWorkspace(workspaceB, userB, () => query(
    'SELECT name, workspace_id FROM customers WHERE customer_number = $1',
    [`RLS-${suffix}`],
  ));

  assert.deepEqual(customersA.rows, [{ name: 'Kunde A', workspace_id: workspaceA }]);
  assert.deepEqual(customersB.rows, [{ name: 'Kunde B', workspace_id: workspaceB }]);
});

test('ein leerer Request-Kontext erhält keine Workspace-Daten', async () => {
  const result = await query(
    'SELECT name FROM customers WHERE customer_number = $1',
    [`RLS-${suffix}`],
  );
  assert.deepEqual(result.rows, []);
});

test('ein Workspace kann keine Zeile mit fremder Workspace-ID schreiben', async () => {
  await assert.rejects(
    inWorkspace(workspaceA, userA, () => query(`
      INSERT INTO customers (
        customer_number, name, address, city, postal_code, country, workspace_id
      ) VALUES ($1, 'Fremdversuch', 'C-Straße 3', 'Köln', '50667', 'Deutschland', $2)
    `, [`FREMD-${suffix}`, workspaceB])),
    error => error?.code === '42501',
  );
});

test('parallele Transaktionen vergeben unterschiedliche Rechnungsnummern', async () => {
  async function reserveInvoiceNumber() {
    return inWorkspace(workspaceA, userA, async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const invoiceNumber = await generateInvoiceNumber('2099-01-15', 'invoice', client);
        await client.query(`
          INSERT INTO invoices (
            invoice_number, customer_id, customer_name, issue_date, due_date,
            subtotal, tax_amount, total, status, document_type
          ) VALUES ($1, $2, 'Kunde A', '2099-01-15', '2099-02-14', 100, 19, 119, 'draft', 'invoice')
        `, [invoiceNumber, customerAId]);
        await client.query('COMMIT');
        return invoiceNumber;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }

  const numbers = await Promise.all([reserveInvoiceNumber(), reserveInvoiceNumber()]);
  assert.deepEqual(numbers.sort(), ['RE-2099-001', 'RE-2099-002']);
  assert.notEqual(customerAId, customerBId);
});
