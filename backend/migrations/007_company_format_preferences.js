/**
 * Migration: Company language and format preferences
 * Stores currency, date format and time format for company-wide display settings.
 */

export const name = '007_company_format_preferences';

export async function up(client) {
  await client.query(`
    ALTER TABLE company
      ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
      ADD COLUMN IF NOT EXISTS date_format VARCHAR(20) NOT NULL DEFAULT 'DD.MM.YYYY',
      ADD COLUMN IF NOT EXISTS time_format VARCHAR(5) NOT NULL DEFAULT '24h'
  `);

  await client.query(`
    ALTER TABLE company
      ADD CONSTRAINT company_currency_check
        CHECK (currency ~ '^[A-Z]{3}$'),
      ADD CONSTRAINT company_date_format_check
        CHECK (date_format IN ('DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD')),
      ADD CONSTRAINT company_time_format_check
        CHECK (time_format IN ('24h', '12h'))
  `);
}

export async function down(client) {
  await client.query(`
    ALTER TABLE company
      DROP CONSTRAINT IF EXISTS company_currency_check,
      DROP CONSTRAINT IF EXISTS company_date_format_check,
      DROP CONSTRAINT IF EXISTS company_time_format_check,
      DROP COLUMN IF EXISTS currency,
      DROP COLUMN IF EXISTS date_format,
      DROP COLUMN IF EXISTS time_format
  `);
}
