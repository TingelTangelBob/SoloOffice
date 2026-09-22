/**
 * Keep tax-profile choices empty until the user selects them during setup.
 * Existing non-empty company data is intentionally preserved.
 */

export const name = '043_onboarding_tax_profile_defaults';

export async function up(client) {
  await client.query(`
    ALTER TABLE company
      ALTER COLUMN tax_business_type DROP NOT NULL,
      ALTER COLUMN tax_business_type DROP DEFAULT,
      ALTER COLUMN legal_form DROP NOT NULL,
      ALTER COLUMN legal_form DROP DEFAULT
  `);

  // The seed row used for a new installation used the old column defaults.
  // Clear only rows that are still recognisably unconfigured.
  await client.query(`
    UPDATE company
    SET tax_business_type = NULL,
        legal_form = NULL
    WHERE NULLIF(BTRIM(name), '') IS NULL
      AND NULLIF(BTRIM(address), '') IS NULL
      AND NULLIF(BTRIM(email), '') IS NULL
      AND NULLIF(BTRIM(tax_id), '') IS NULL
  `);
}

export async function down(client) {
  await client.query(`
    UPDATE company
    SET tax_business_type = COALESCE(tax_business_type, 'commercial'),
        legal_form = COALESCE(legal_form, 'other')
  `);
  await client.query(`
    ALTER TABLE company
      ALTER COLUMN tax_business_type SET DEFAULT 'commercial',
      ALTER COLUMN tax_business_type SET NOT NULL,
      ALTER COLUMN legal_form SET DEFAULT 'other',
      ALTER COLUMN legal_form SET NOT NULL
  `);
}
