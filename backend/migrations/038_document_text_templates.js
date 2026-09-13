/**
 * Migration: shared document text templates
 * Keeps one canonical text record per document type, independent of PDF layouts.
 */

export const name = '038_document_text_templates';

export async function up(client) {
  await client.query(`
    ALTER TABLE company
      ADD COLUMN IF NOT EXISTS document_text_templates JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
}

export async function down(client) {
  await client.query('ALTER TABLE company DROP COLUMN IF EXISTS document_text_templates');
}
