/**
 * Migration: configurable terminology profile for the application UI.
 */

export const name = '012_terminology_profile';

export async function up(client) {
  await client.query(`
    ALTER TABLE company
      ADD COLUMN IF NOT EXISTS terminology_profile VARCHAR(30) NOT NULL DEFAULT 'customers'
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'company_terminology_profile_check'
      ) THEN
        ALTER TABLE company
          ADD CONSTRAINT company_terminology_profile_check
            CHECK (terminology_profile IN ('customers', 'mandants', 'patients', 'students', 'clients'));
      END IF;
    END $$
  `);
}

export async function down(client) {
  await client.query(`
    ALTER TABLE company
      DROP CONSTRAINT IF EXISTS company_terminology_profile_check,
      DROP COLUMN IF EXISTS terminology_profile
  `);
}
