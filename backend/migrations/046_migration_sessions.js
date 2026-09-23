/**
 * Einmaliger, workspacegebundener Start der Datenübernahme.
 * Sitzungen und ihr Claim gehören zur Workspace-Identität und werden bei
 * Fachdaten-Restores nicht ersetzt.
 */
import { runWithRequestContext } from '../utils/requestContext.js';

export const name = '046_migration_sessions';

const workspaceExpression = "NULLIF(current_setting('app.workspace_id', true), '')::uuid";

export async function up(client) {
  await client.query(`
    CREATE TABLE migration_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE
        DEFAULT (${workspaceExpression}),
      status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
      started_by UUID REFERENCES users(id) ON DELETE SET NULL,
      started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
      completed_at TIMESTAMP WITH TIME ZONE,
      progress_revision INTEGER NOT NULL DEFAULT 1 CHECK (progress_revision > 0),
      legacy_backfill BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      CHECK (
        (status = 'open' AND completed_at IS NULL AND completed_by IS NULL)
        OR (status = 'completed' AND completed_at IS NOT NULL)
      )
    )
  `);
  await client.query(`
    CREATE POLICY migration_sessions_workspace_access ON migration_sessions
      USING (workspace_id = ${workspaceExpression})
      WITH CHECK (workspace_id = ${workspaceExpression})
  `);
  await client.query('ALTER TABLE migration_sessions ENABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE migration_sessions FORCE ROW LEVEL SECURITY');
  await client.query(`
    CREATE FUNCTION prevent_migration_session_reopen() RETURNS TRIGGER AS $$
    BEGIN
      IF OLD.status = 'completed' AND NEW.status <> 'completed' THEN
        RAISE EXCEPTION 'Abgeschlossene Umzugssitzungen können nicht reaktiviert werden.'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await client.query(`
    CREATE TRIGGER migration_sessions_terminal_status
    BEFORE UPDATE OF status ON migration_sessions
    FOR EACH ROW EXECUTE FUNCTION prevent_migration_session_reopen()
  `);

  // Frühere Importläufe verbrauchen das Startrecht. Ein offener Alt-Lauf
  // beweist keinen fachlichen Umzugsabschluss; Backfills bleiben deshalb
  // als offene, ausdrücklich historische Sitzung markiert.
  const workspaces = await client.query('SELECT id FROM workspaces');
  for (const workspace of workspaces.rows) {
    await runWithRequestContext({ workspaceId: workspace.id }, () => client.query(`
      INSERT INTO migration_sessions (workspace_id, status, started_by, started_at, legacy_backfill)
      SELECT $1, 'open', (array_agg(created_by ORDER BY created_at))[1], MIN(created_at), TRUE
      FROM import_runs
      WHERE workspace_id = $1
      HAVING COUNT(*) > 0
      ON CONFLICT (workspace_id) DO NOTHING
    `, [workspace.id]));
  }

  await client.query(`
    ALTER TABLE import_runs
    ADD COLUMN migration_session_id UUID REFERENCES migration_sessions(id) ON DELETE SET NULL
  `);
  await client.query('CREATE INDEX import_runs_migration_session_idx ON import_runs(migration_session_id) WHERE migration_session_id IS NOT NULL');
  for (const workspace of workspaces.rows) {
    await runWithRequestContext({ workspaceId: workspace.id }, () => client.query(`
      UPDATE import_runs AS run
      SET migration_session_id = session.id
      FROM migration_sessions AS session
      WHERE run.workspace_id = $1
        AND session.workspace_id = run.workspace_id
        AND session.legacy_backfill = TRUE
        AND run.migration_session_id IS NULL
    `, [workspace.id]));
  }
}

export async function down(client) {
  await client.query('DROP INDEX IF EXISTS import_runs_migration_session_idx');
  await client.query('ALTER TABLE import_runs DROP COLUMN IF EXISTS migration_session_id');
  await client.query('DROP TRIGGER IF EXISTS migration_sessions_terminal_status ON migration_sessions');
  await client.query('DROP TABLE IF EXISTS migration_sessions');
  await client.query('DROP FUNCTION IF EXISTS prevent_migration_session_reopen()');
}
