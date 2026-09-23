import { runWithRequestContext } from '../utils/requestContext.js';

/** Persistierter Einrichtungsfortschritt je Workspace. */
export const name = '045_workspace_setup';

const workspaceExpression = "NULLIF(current_setting('app.workspace_id', true), '')::uuid";

export async function up(client) {
  await client.query(`
    CREATE TABLE workspace_setup (
      workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      current_step SMALLINT NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 5),
      completed_at TIMESTAMP WITH TIME ZONE,
      migration_choice VARCHAR(24) NOT NULL DEFAULT 'undecided'
        CHECK (migration_choice IN ('undecided', 'takeover', 'no_legacy_data')),
      setup_required BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      CHECK (completed_at IS NULL OR current_step = 5)
    )
  `);
  await client.query(`
    CREATE POLICY workspace_setup_workspace_access ON workspace_setup
      USING (workspace_id = ${workspaceExpression})
      WITH CHECK (workspace_id = ${workspaceExpression})
  `);
  await client.query('ALTER TABLE workspace_setup ENABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE workspace_setup FORCE ROW LEVEL SECURITY');
  // Bestehende Workspaces erhalten einen nachholbaren Review-Zustand. Sie
  // werden weder als frisch gestartet noch als fachlich abgeschlossen markiert.
  const workspaces = await client.query('SELECT id FROM workspaces');
  for (const workspace of workspaces.rows) {
    await runWithRequestContext({ workspaceId: workspace.id }, () => client.query(`
      INSERT INTO workspace_setup (workspace_id, current_step, setup_required)
      VALUES ($1, 1, FALSE)
      ON CONFLICT (workspace_id) DO NOTHING
    `, [workspace.id]));
  }
}

export async function down(client) {
  await client.query('DROP TABLE IF EXISTS workspace_setup');
}
