/**
 * Recurring jobs/courses are stored as a rule plus concrete job units.
 * Each generated unit keeps its own date, status, time entries and invoice
 * history, so a recurring series remains auditable and billable per unit.
 */

export const name = '022_recurring_jobs';

const workspaceExpression = "NULLIF(current_setting('app.workspace_id', true), '')::uuid";

export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS job_recurrences (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
        DEFAULT (${workspaceExpression}),
      rule JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await client.query('ALTER TABLE job_entries ADD COLUMN IF NOT EXISTS recurrence_id UUID');
  await client.query('ALTER TABLE job_entries ADD COLUMN IF NOT EXISTS recurrence_index INTEGER');
  await client.query('ALTER TABLE job_entries ADD COLUMN IF NOT EXISTS recurrence_total INTEGER');
  await client.query(`
    ALTER TABLE job_entries
      DROP CONSTRAINT IF EXISTS job_entries_recurrence_id_fkey
  `);
  await client.query(`
    ALTER TABLE job_entries
      ADD CONSTRAINT job_entries_recurrence_id_fkey
      FOREIGN KEY (recurrence_id) REFERENCES job_recurrences(id) ON DELETE SET NULL
  `);

  await client.query('CREATE INDEX IF NOT EXISTS job_recurrences_workspace_id_idx ON job_recurrences(workspace_id)');
  await client.query('CREATE INDEX IF NOT EXISTS job_entries_recurrence_id_idx ON job_entries(recurrence_id)');

  await client.query('DROP POLICY IF EXISTS workspace_access_job_recurrences ON job_recurrences');
  await client.query(`
    CREATE POLICY workspace_access_job_recurrences ON job_recurrences
      USING (workspace_id = ${workspaceExpression})
      WITH CHECK (workspace_id = ${workspaceExpression})
  `);
  await client.query('ALTER TABLE job_recurrences ENABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE job_recurrences FORCE ROW LEVEL SECURITY');
}

export async function down(client) {
  await client.query('ALTER TABLE job_entries DROP CONSTRAINT IF EXISTS job_entries_recurrence_id_fkey');
  await client.query('DROP INDEX IF EXISTS job_entries_recurrence_id_idx');
  await client.query('DROP INDEX IF EXISTS job_recurrences_workspace_id_idx');
  await client.query('DROP POLICY IF EXISTS workspace_access_job_recurrences ON job_recurrences');
  await client.query('ALTER TABLE job_entries DROP COLUMN IF EXISTS recurrence_id');
  await client.query('ALTER TABLE job_entries DROP COLUMN IF EXISTS recurrence_index');
  await client.query('ALTER TABLE job_entries DROP COLUMN IF EXISTS recurrence_total');
  await client.query('DROP TABLE IF EXISTS job_recurrences');
}
