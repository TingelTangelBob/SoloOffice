/**
 * Migration: App theme and reusable document templates.
 */

export const name = '009_theme_and_document_templates';

export async function up(client) {
  await client.query(`
    ALTER TABLE company
      ADD COLUMN IF NOT EXISTS theme_mode VARCHAR(10) NOT NULL DEFAULT 'system',
      ADD COLUMN IF NOT EXISTS document_templates JSONB NOT NULL DEFAULT '[]'::jsonb
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'company_theme_mode_check'
      ) THEN
        ALTER TABLE company
          ADD CONSTRAINT company_theme_mode_check
            CHECK (theme_mode IN ('system', 'light', 'dark'));
      END IF;
    END $$
  `);
}

export async function down(client) {
  await client.query(`
    ALTER TABLE company
      DROP CONSTRAINT IF EXISTS company_theme_mode_check,
      DROP COLUMN IF EXISTS theme_mode,
      DROP COLUMN IF EXISTS document_templates
  `);
}
