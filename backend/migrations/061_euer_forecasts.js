const workspaceExpression = "NULLIF(current_setting('app.workspace_id', true), '')::uuid";
export const name = '061_euer_forecasts';

export async function up(client) {
  await client.query(`CREATE TABLE euer_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFAULT (${workspaceExpression}),
    entry_type VARCHAR(10) NOT NULL CHECK (entry_type IN ('income','expense')),
    forecast_date DATE NOT NULL,
    description VARCHAR(255) NOT NULL,
    category VARCHAR(40),
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (category IS NULL OR category IN ('other_income','materials','office','software','telecommunications','travel','vehicle','marketing','professional_services','insurance','bank_fees','rent','memberships','allowance','other_expense'))
  )`);
  await client.query('CREATE INDEX euer_forecasts_workspace_date_idx ON euer_forecasts(workspace_id, forecast_date)');
  await client.query(`CREATE POLICY workspace_access_euer_forecasts ON euer_forecasts USING (workspace_id = ${workspaceExpression}) WITH CHECK (workspace_id = ${workspaceExpression})`);
  await client.query('ALTER TABLE euer_forecasts ENABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE euer_forecasts FORCE ROW LEVEL SECURITY');
}

export async function down(client) { await client.query('DROP TABLE IF EXISTS euer_forecasts'); }
