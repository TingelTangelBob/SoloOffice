/**
 * Identity, sessions and workspace ownership.
 *
 * Existing data is assigned to one initial workspace. All business tables
 * receive a workspace_id and PostgreSQL row-level security keeps every
 * request inside its active workspace.
 */

export const name = '021_identity_and_workspace_ownership';

const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

const workspaceTables = [
  'company',
  'customers',
  'customer_emails',
  'invoices',
  'invoice_items',
  'invoice_attachments',
  'quotes',
  'quote_items',
  'quote_attachments',
  'job_entries',
  'job_attachments',
  'hourly_rates',
  'material_templates',
  'job_time_entries',
  'yearly_invoice_start_numbers',
  'email_history',
  'smtp_settings',
  'customer_hourly_rates',
  'customer_specific_hourly_rates',
  'customer_specific_materials',
  'calendar_events',
  'recurring_invoices',
  'recurring_invoice_runs',
  'euer_entries',
  'euer_entry_history',
  'receipts',
  'fixed_assets',
];

const workspaceExpression = "NULLIF(current_setting('app.workspace_id', true), '')::uuid";

async function addWorkspaceColumn(client, table) {
  await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id)`);
  await client.query(`UPDATE ${table} SET workspace_id = $1 WHERE workspace_id IS NULL`, [DEFAULT_WORKSPACE_ID]);
  await client.query(`ALTER TABLE ${table} ALTER COLUMN workspace_id SET DEFAULT (${workspaceExpression})`);
  await client.query(`ALTER TABLE ${table} ALTER COLUMN workspace_id SET NOT NULL`);
  await client.query(`CREATE INDEX IF NOT EXISTS ${table}_workspace_id_idx ON ${table}(workspace_id)`);
}

async function enableWorkspaceRls(client, table, index) {
  const policyName = `workspace_access_${index}`;
  await client.query(`DROP POLICY IF EXISTS ${policyName} ON ${table}`);
  await client.query(`
    CREATE POLICY ${policyName} ON ${table}
      USING (workspace_id = ${workspaceExpression})
      WITH CHECK (workspace_id = ${workspaceExpression})
  `);
  await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
}

export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id UUID PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(80) UNIQUE NOT NULL,
      created_by UUID,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await client.query(`
    INSERT INTO workspaces (id, name, slug)
    VALUES ($1, 'Meine Firma GmbH', 'default')
    ON CONFLICT (id) DO NOTHING
  `, [DEFAULT_WORKSPACE_ID]);

  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL,
      password_hash TEXT NOT NULL,
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_login_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email))');

  await client.query(`
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
      permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      PRIMARY KEY (workspace_id, user_id)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      token_hash CHAR(64) UNIQUE NOT NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      revoked_at TIMESTAMP WITH TIME ZONE,
      ip_address VARCHAR(100),
      user_agent TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)');
  await client.query('CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)');

  await client.query(`
    CREATE TABLE IF NOT EXISTS workspace_invitations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
      token_hash CHAR(64) UNIQUE NOT NULL,
      invited_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      accepted_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS workspace_invitations_workspace_idx ON workspace_invitations(workspace_id)');

  for (const table of workspaceTables) {
    await addWorkspaceColumn(client, table);
  }

  // Company IDs were historically fixed to 1. Keep old references working,
  // but allow a distinct company row for every new workspace.
  await client.query('CREATE SEQUENCE IF NOT EXISTS company_id_seq');
  await client.query(`
    SELECT setval('company_id_seq', COALESCE((SELECT MAX(id) FROM company), 0) + 1, false)
  `);
  await client.query("ALTER TABLE company ALTER COLUMN id SET DEFAULT nextval('company_id_seq')");
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS company_workspace_unique_idx ON company(workspace_id)');

  await client.query(`
    CREATE OR REPLACE FUNCTION current_workspace_company_id()
    RETURNS INTEGER
    LANGUAGE SQL
    STABLE
    AS $$
      SELECT id FROM company
      WHERE workspace_id = ${workspaceExpression}
      ORDER BY id
      LIMIT 1
    $$
  `);
  // The defaults above are resolved when used; recreate them after the
  // function exists on PostgreSQL versions that validate defaults eagerly.
  await client.query('ALTER TABLE hourly_rates ALTER COLUMN company_id SET DEFAULT current_workspace_company_id()');
  await client.query('ALTER TABLE material_templates ALTER COLUMN company_id SET DEFAULT current_workspace_company_id()');

  await client.query('ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_customer_number_key');
  await client.query('ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_number_key');
  await client.query('ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_quote_number_key');
  await client.query('ALTER TABLE job_entries DROP CONSTRAINT IF EXISTS job_entries_job_number_key');
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS customers_workspace_number_idx ON customers(workspace_id, customer_number)');
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS invoices_workspace_number_idx ON invoices(workspace_id, invoice_number)');
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS quotes_workspace_number_idx ON quotes(workspace_id, quote_number)');
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS jobs_workspace_number_idx ON job_entries(workspace_id, job_number)');

  await client.query('ALTER TABLE yearly_invoice_start_numbers DROP CONSTRAINT IF EXISTS yearly_invoice_start_numbers_year_key');
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS yearly_numbers_workspace_year_idx ON yearly_invoice_start_numbers(workspace_id, year)');

  // SMTP settings intentionally retain id = 1 per workspace, so their
  // primary key must include the workspace after this migration.
  await client.query('ALTER TABLE smtp_settings DROP CONSTRAINT IF EXISTS smtp_settings_pkey');
  await client.query('ALTER TABLE smtp_settings ADD PRIMARY KEY (workspace_id, id)');

  for (const [index, table] of workspaceTables.entries()) {
    await enableWorkspaceRls(client, table, index);
  }
}

export async function down(client) {
  await client.query('ALTER TABLE smtp_settings DROP CONSTRAINT IF EXISTS smtp_settings_pkey');
  await client.query('ALTER TABLE smtp_settings ADD PRIMARY KEY (id)');
  await client.query('ALTER TABLE hourly_rates ALTER COLUMN company_id SET DEFAULT 1');
  await client.query('ALTER TABLE material_templates ALTER COLUMN company_id SET DEFAULT 1');
  for (const table of workspaceTables) {
    await client.query(`DROP INDEX IF EXISTS ${table}_workspace_id_idx`);
  }
  await client.query('DROP INDEX IF EXISTS company_workspace_unique_idx');
  await client.query('DROP INDEX IF EXISTS customers_workspace_number_idx');
  await client.query('DROP INDEX IF EXISTS invoices_workspace_number_idx');
  await client.query('DROP INDEX IF EXISTS quotes_workspace_number_idx');
  await client.query('DROP INDEX IF EXISTS jobs_workspace_number_idx');
  await client.query('DROP INDEX IF EXISTS yearly_numbers_workspace_year_idx');
  for (const [index, table] of workspaceTables.entries()) {
    await client.query(`DROP POLICY IF EXISTS workspace_access_${index} ON ${table}`);
    await client.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS workspace_id`);
  }
  await client.query('DROP FUNCTION IF EXISTS current_workspace_company_id()');
  await client.query('ALTER TABLE customers ADD CONSTRAINT customers_customer_number_key UNIQUE (customer_number)');
  await client.query('ALTER TABLE invoices ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number)');
  await client.query('ALTER TABLE quotes ADD CONSTRAINT quotes_quote_number_key UNIQUE (quote_number)');
  await client.query('ALTER TABLE job_entries ADD CONSTRAINT job_entries_job_number_key UNIQUE (job_number)');
  await client.query('ALTER TABLE yearly_invoice_start_numbers ADD CONSTRAINT yearly_invoice_start_numbers_year_key UNIQUE (year)');
  await client.query('DROP TABLE IF EXISTS workspace_invitations');
  await client.query('DROP TABLE IF EXISTS sessions');
  await client.query('DROP TABLE IF EXISTS workspace_members');
  await client.query('DROP TABLE IF EXISTS users');
  await client.query('DROP TABLE IF EXISTS workspaces');
}
