/**
 * Migration: Configurable label for receipts/document evidence
 */

export const name = '014_receipt_label';

export async function up(client) {
  await client.query(`
    ALTER TABLE company
      ADD COLUMN IF NOT EXISTS receipt_label VARCHAR(40) NOT NULL DEFAULT 'Belege'
  `);
}

export async function down(client) {
  await client.query('ALTER TABLE company DROP COLUMN IF EXISTS receipt_label');
}
