export const name = '048_user_motion_preference';

export async function up(client) {
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS animations_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
}

export async function down(client) {
  await client.query(`ALTER TABLE users DROP COLUMN IF EXISTS animations_enabled`);
}
