export const name = '063_reminder_interest';

// Verzugszinsen (standardmäßig aus) und übliche Gebührenvorbelegung für NEUE Firmendatensätze.
// Bestehende Zeilen behalten ihre Werte: ALTER COLUMN ... SET DEFAULT ändert keine vorhandenen Daten.
export async function up(client) {
  await client.query(`ALTER TABLE company
    ADD COLUMN IF NOT EXISTS reminder_interest_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS reminder_base_interest_rate NUMERIC(5,2) NOT NULL DEFAULT 1.27
      CHECK (reminder_base_interest_rate >= -5 AND reminder_base_interest_rate <= 20)`);
  await client.query('ALTER TABLE company ALTER COLUMN reminder_fee_stage_2 SET DEFAULT 2.50');
  await client.query('ALTER TABLE company ALTER COLUMN reminder_fee_stage_3 SET DEFAULT 5.00');
}

export async function down(client) {
  await client.query('ALTER TABLE company ALTER COLUMN reminder_fee_stage_2 SET DEFAULT 0');
  await client.query('ALTER TABLE company ALTER COLUMN reminder_fee_stage_3 SET DEFAULT 0');
  await client.query('ALTER TABLE company DROP COLUMN IF EXISTS reminder_base_interest_rate, DROP COLUMN IF EXISTS reminder_interest_enabled');
}
