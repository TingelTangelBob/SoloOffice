/**
 * Migration: Persist reusable invoice position templates with company settings.
 */

export const name = '008_invoice_templates';

export async function up(client) {
  await client.query(`
    ALTER TABLE company
      ADD COLUMN IF NOT EXISTS invoice_templates JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
}

export async function down(client) {
  await client.query(`
    ALTER TABLE company
      DROP COLUMN IF EXISTS invoice_templates
  `);
}
