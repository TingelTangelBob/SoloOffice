/** Steuerprofile je Workspace und Steuerjahr. */
export const name = '051_tax_profiles';

const workspaceExpression = "NULLIF(current_setting('app.workspace_id', true), '')::uuid";

export async function up(client) {
  await client.query(`
    CREATE TABLE tax_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
        DEFAULT (${workspaceExpression}),
      year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2200),
      profile JSONB NOT NULL,
      disclaimer_accepted_at TIMESTAMPTZ,
      church_tax_consent_at TIMESTAMPTZ,
      params_version VARCHAR(80) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, year),
      CONSTRAINT tax_profiles_church_consent_check CHECK (
        NOT (profile ? 'churchTaxLiable')
        OR profile->'churchTaxLiable' = 'null'::jsonb
        OR (church_tax_consent_at IS NOT NULL AND jsonb_typeof(profile->'churchTaxLiable') = 'boolean')
      )
    )
  `);
  await client.query('CREATE INDEX tax_profiles_workspace_year_idx ON tax_profiles(workspace_id, year)');
  await client.query(`
    CREATE POLICY tax_profiles_workspace_access ON tax_profiles
      USING (workspace_id = ${workspaceExpression})
      WITH CHECK (workspace_id = ${workspaceExpression})
  `);
  await client.query('ALTER TABLE tax_profiles ENABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE tax_profiles FORCE ROW LEVEL SECURITY');
}

export async function down(client) {
  await client.query('DROP TABLE IF EXISTS tax_profiles');
}
