/**
 * Migration: Company number format preference
 * Stores whether displayed numbers use European or American separators.
 */

export const name = '006_number_format';

export async function up(client) {
  await client.query(`
    ALTER TABLE company
    ADD COLUMN IF NOT EXISTS number_format VARCHAR(10) NOT NULL DEFAULT 'european'
  `);

  await client.query(`
    UPDATE company
    SET number_format = CASE
      WHEN locale = 'en-US' THEN 'american'
      ELSE 'european'
    END
    WHERE number_format = 'european'
  `);

  await client.query(`
    ALTER TABLE company
      ADD CONSTRAINT company_number_format_check
      CHECK (number_format IN ('european', 'american'))
  `);
}

export async function down(client) {
  await client.query(`
    ALTER TABLE company
      DROP CONSTRAINT IF EXISTS company_number_format_check,
      DROP COLUMN IF EXISTS number_format
  `);
}
