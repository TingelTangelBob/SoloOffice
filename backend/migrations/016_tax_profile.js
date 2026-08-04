/**
 * Migration: Tax profile metadata used for preparation and exports
 */

export const name = '016_tax_profile';

export async function up(client) {
  await client.query(`
    ALTER TABLE company
      ADD COLUMN IF NOT EXISTS tax_business_type VARCHAR(30) NOT NULL DEFAULT 'commercial',
      ADD COLUMN IF NOT EXISTS legal_form VARCHAR(30) NOT NULL DEFAULT 'other'
  `);

  await client.query('ALTER TABLE company DROP CONSTRAINT IF EXISTS company_tax_business_type_check');
  await client.query(`
    ALTER TABLE company
      ADD CONSTRAINT company_tax_business_type_check
      CHECK (tax_business_type IN ('freelance', 'commercial', 'agriculture', 'nonprofit', 'other'))
  `);
  await client.query('ALTER TABLE company DROP CONSTRAINT IF EXISTS company_legal_form_check');
  await client.query(`
    ALTER TABLE company
      ADD CONSTRAINT company_legal_form_check
      CHECK (legal_form IN ('sole_proprietorship', 'partnership', 'gbr', 'ug', 'gmbh', 'ag', 'eg', 'nonprofit', 'other'))
  `);
}

export async function down(client) {
  await client.query(`
    ALTER TABLE company
      DROP CONSTRAINT IF EXISTS company_tax_business_type_check,
      DROP CONSTRAINT IF EXISTS company_legal_form_check,
      DROP COLUMN IF EXISTS tax_business_type,
      DROP COLUMN IF EXISTS legal_form
  `);
}
