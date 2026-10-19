/** Tagesbezogene, vom Nutzer geprüfte Arbeitsort-Erfassung für die EÜR. */
export const name = '059_work_location_days';

const workspaceExpression = "NULLIF(current_setting('app.workspace_id', true), '')::uuid";

export async function up(client) {
  await client.query(`
    CREATE TABLE work_location_days (
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
        DEFAULT (${workspaceExpression}),
      work_date DATE NOT NULL,
      day_type VARCHAR(40) NOT NULL CHECK (day_type IN ('home_majority', 'home_no_other_workspace')),
      reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, work_date)
    )
  `);
  await client.query(`
    CREATE POLICY work_location_days_workspace_access ON work_location_days
      USING (workspace_id = ${workspaceExpression})
      WITH CHECK (workspace_id = ${workspaceExpression})
  `);
  await client.query('ALTER TABLE work_location_days ENABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE work_location_days FORCE ROW LEVEL SECURITY');
}

export async function down(client) {
  await client.query('DROP TABLE IF EXISTS work_location_days');
}
