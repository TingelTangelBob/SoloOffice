/**
 * Migration: Customer type and notes
 * Distinguishes private persons from organisations and keeps customer notes.
 */

export const name = '037_customer_type_and_notes';

export async function up(client) {
  await client.query(`
    ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS customer_type VARCHAR(20) NOT NULL DEFAULT 'person',
      ADD COLUMN IF NOT EXISTS notes TEXT
  `);

  await client.query('ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_customer_type_check');
  await client.query(`
    ALTER TABLE customers
      ADD CONSTRAINT customers_customer_type_check
      CHECK (customer_type IN ('person', 'organization'))
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_customers_workspace_customer_type ON customers(workspace_id, customer_type)');
}

export async function down(client) {
  await client.query('DROP INDEX IF EXISTS idx_customers_workspace_customer_type');
  await client.query('ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_customer_type_check');
  await client.query('ALTER TABLE customers DROP COLUMN IF EXISTS notes');
  await client.query('ALTER TABLE customers DROP COLUMN IF EXISTS customer_type');
}
