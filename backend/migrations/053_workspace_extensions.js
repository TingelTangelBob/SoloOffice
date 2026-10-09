export const name = '053_workspace_extensions';

const workspaceExpression = "NULLIF(current_setting('app.workspace_id', true), '')::uuid";

export async function up(client) {
  await client.query(`
    CREATE TABLE workspace_extensions (
      workspace_id UUID NOT NULL DEFAULT (${workspaceExpression})
        REFERENCES workspaces(id) ON DELETE CASCADE,
      extension_id VARCHAR(80) NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      accepted_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, extension_id)
    )
  `);
  await client.query(`
    CREATE POLICY workspace_extensions_workspace_access ON workspace_extensions
      USING (workspace_id = ${workspaceExpression})
      WITH CHECK (workspace_id = ${workspaceExpression})
  `);
  await client.query('ALTER TABLE workspace_extensions ENABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE workspace_extensions FORCE ROW LEVEL SECURITY');
}

export async function down(client) {
  await client.query('DROP TABLE IF EXISTS workspace_extensions');
}
