/**
 * Migration: choose whether the account holder follows the company name.
 */

export const name = '010_payment_information_mode';

export async function up(client) {
  await client.query(`
    ALTER TABLE company
      ADD COLUMN IF NOT EXISTS payment_information_mode VARCHAR(10) NOT NULL DEFAULT 'separate'
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'company_payment_information_mode_check'
      ) THEN
        ALTER TABLE company
          ADD CONSTRAINT company_payment_information_mode_check
            CHECK (payment_information_mode IN ('separate', 'company'));
      END IF;
    END $$
  `);
}

export async function down(client) {
  await client.query(`
    ALTER TABLE company
      DROP CONSTRAINT IF EXISTS company_payment_information_mode_check,
      DROP COLUMN IF EXISTS payment_information_mode
  `);
}
