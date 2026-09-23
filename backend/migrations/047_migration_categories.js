/** Kategorien werden innerhalb einer Umzugssitzung einzeln freigegeben. */
export const name = '047_migration_categories';

export async function up(client) {
  await client.query(`
    CREATE TABLE migration_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      session_id UUID NOT NULL REFERENCES migration_sessions(id) ON DELETE CASCADE,
      resource VARCHAR(40) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
      preview_digest CHAR(64),
      idempotency_key UUID,
      completed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE (session_id, resource),
      UNIQUE (id, workspace_id),
      CHECK ((status = 'open' AND completed_at IS NULL) OR (status = 'completed' AND completed_at IS NOT NULL))
    )
  `);
  await client.query(`
    CREATE POLICY migration_categories_workspace_access ON migration_categories
      USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  `);
  await client.query('ALTER TABLE migration_categories ENABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE migration_categories FORCE ROW LEVEL SECURITY');
  await client.query('CREATE INDEX migration_categories_session_idx ON migration_categories(session_id)');
  await client.query(`
    ALTER TABLE import_runs
      ADD COLUMN migration_category_id UUID,
      ADD CONSTRAINT import_runs_migration_category_fk
        FOREIGN KEY (migration_category_id)
        REFERENCES migration_categories(id) ON DELETE SET NULL
  `);
  await client.query('CREATE INDEX import_runs_migration_category_idx ON import_runs(migration_category_id) WHERE migration_category_id IS NOT NULL');
}

export async function down(client) {
  await client.query('DROP INDEX IF EXISTS import_runs_migration_category_idx');
  await client.query('ALTER TABLE import_runs DROP CONSTRAINT IF EXISTS import_runs_migration_category_fk');
  await client.query('ALTER TABLE import_runs DROP COLUMN IF EXISTS migration_category_id');
  await client.query('DROP INDEX IF EXISTS migration_categories_session_idx');
  await client.query('DROP TABLE IF EXISTS migration_categories');
}
