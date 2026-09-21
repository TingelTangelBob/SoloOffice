/**
 * Migration: stable references for imported invoice payments
 */

export const name = '042_invoice_payment_import_references';

export async function up(client) {
  await client.query(`
    ALTER TABLE euer_entries
    ADD COLUMN IF NOT EXISTS external_reference VARCHAR(255)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS euer_invoice_payment_reference_idx
    ON euer_entries(source_type, external_reference)
    WHERE source_type = 'invoice_payment' AND external_reference IS NOT NULL
  `);
}

export async function down(client) {
  await client.query('DROP INDEX IF EXISTS euer_invoice_payment_reference_idx');
  await client.query('ALTER TABLE euer_entries DROP COLUMN IF EXISTS external_reference');
}
