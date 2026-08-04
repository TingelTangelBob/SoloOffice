/**
 * Migration: choose whether terminology profiles control the app color scheme.
 */

export const name = '019_terminology_color_source';

export async function up(client) {
  await client.query(`
    ALTER TABLE company
      ADD COLUMN IF NOT EXISTS terminology_color_source VARCHAR(20) NOT NULL DEFAULT 'profile'
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'company_terminology_color_source_check'
      ) THEN
        ALTER TABLE company
          ADD CONSTRAINT company_terminology_color_source_check
            CHECK (terminology_color_source IN ('appearance', 'profile'));
      END IF;
    END $$
  `);
}

export async function down(client) {
  await client.query(`
    ALTER TABLE company
      DROP CONSTRAINT IF EXISTS company_terminology_color_source_check,
      DROP COLUMN IF EXISTS terminology_color_source
  `);
}
