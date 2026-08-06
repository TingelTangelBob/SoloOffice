/**
 * Store the workspace default and course-specific local time zones.
 */

export const name = '028_time_zones';

export async function up(client) {
  await client.query(`
    ALTER TABLE company
      ADD COLUMN IF NOT EXISTS time_zone VARCHAR(64) NOT NULL DEFAULT 'Europe/Berlin'
  `);

  await client.query(`
    ALTER TABLE job_entries
      ADD COLUMN IF NOT EXISTS alternate_location TEXT,
      ADD COLUMN IF NOT EXISTS time_zone VARCHAR(64) NOT NULL DEFAULT 'Europe/Berlin'
  `);
}

export async function down(client) {
  await client.query(`
    ALTER TABLE job_entries
      DROP COLUMN IF EXISTS alternate_location,
      DROP COLUMN IF EXISTS time_zone
  `);

  await client.query(`
    ALTER TABLE company
      DROP COLUMN IF EXISTS time_zone
  `);
}
