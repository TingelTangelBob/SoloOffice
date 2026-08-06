/**
 * Draft jobs may be stored before all fields required for an active job are
 * complete. Promotion to a non-draft status remains validated by the API.
 */

export const name = '027_draft_jobs';

export async function up(client) {
  await client.query('ALTER TABLE job_entries ALTER COLUMN customer_id DROP NOT NULL');
  await client.query('ALTER TABLE job_entries ALTER COLUMN title DROP NOT NULL');
}

export async function down(client) {
  await client.query('ALTER TABLE job_entries ALTER COLUMN title SET NOT NULL');
  await client.query('ALTER TABLE job_entries ALTER COLUMN customer_id SET NOT NULL');
}
