/**
 * Stores the selected execution location of a job/course separately from
 * the legacy customer address field.
 */

export const name = '023_job_location';

export async function up(client) {
  await client.query('ALTER TABLE job_entries ADD COLUMN IF NOT EXISTS location TEXT');
}

export async function down(client) {
  await client.query('ALTER TABLE job_entries DROP COLUMN IF EXISTS location');
}
