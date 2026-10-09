export const name = '050_dashboard_preferences';

export async function up(client) {
  await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS dashboard_preferences JSONB NOT NULL DEFAULT \'{}\'::jsonb');
}

export async function down(client) {
  await client.query('ALTER TABLE users DROP COLUMN IF EXISTS dashboard_preferences');
}
