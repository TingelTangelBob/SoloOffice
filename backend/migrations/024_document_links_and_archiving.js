/**
 * Durable document links and safe customer archiving.
 *
 * Job units are linked to the invoice that consumed them. Customer records are
 * archived instead of deleted so historical documents remain intact.
 */

export const name = '024_document_links_and_archiving';

const workspaceExpression = "NULLIF(current_setting('app.workspace_id', true), '')::uuid";

export async function up(client) {
  await client.query(`
    ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE
  `);
  await client.query('CREATE INDEX IF NOT EXISTS customers_workspace_active_idx ON customers(workspace_id, is_active, created_at DESC)');

  // Business documents must survive customer deactivation and must never be
  // removed implicitly by a customer operation.
  for (const table of ['invoices', 'quotes', 'job_entries', 'recurring_invoices']) {
    await client.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_customer_id_fkey`);
    await client.query(`
      ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_customer_id_fkey
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
    `);
  }

  await client.query('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source_quote_id UUID');
  await client.query(`
    UPDATE invoices i
    SET source_quote_id = q.id
    FROM quotes q
    WHERE q.converted_to_invoice_id = i.id
      AND i.source_quote_id IS NULL
  `);
  await client.query('ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_source_quote_id_fkey');
  await client.query(`
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_source_quote_id_fkey
      FOREIGN KEY (source_quote_id) REFERENCES quotes(id) ON DELETE RESTRICT
  `);
  await client.query('CREATE INDEX IF NOT EXISTS invoices_source_quote_id_idx ON invoices(source_quote_id)');

  await client.query(`
    CREATE TABLE IF NOT EXISTS invoice_job_sources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
        DEFAULT (${workspaceExpression}),
      invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      job_id UUID NOT NULL REFERENCES job_entries(id) ON DELETE RESTRICT,
      job_number VARCHAR(50) NOT NULL,
      external_job_number VARCHAR(100),
      title VARCHAR(255) NOT NULL,
      job_date DATE NOT NULL,
      recurrence_index INTEGER,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE (workspace_id, job_id)
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS invoice_job_sources_invoice_idx ON invoice_job_sources(invoice_id)');
  await client.query('CREATE INDEX IF NOT EXISTS invoice_job_sources_job_idx ON invoice_job_sources(job_id)');
  await client.query(`
    WITH duplicate_runs AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY recurring_invoice_id, scheduled_date
               ORDER BY created_at DESC NULLS LAST, id DESC
             ) AS run_rank
      FROM recurring_invoice_runs
      WHERE status = 'success'
    )
    UPDATE recurring_invoice_runs runs
    SET status = 'failure',
        error = COALESCE(runs.error, 'Doppelter historischer Lauf wurde als Fehler archiviert.')
    FROM duplicate_runs duplicates
    WHERE runs.id = duplicates.id
      AND duplicates.run_rank > 1
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS recurring_invoice_runs_success_schedule_idx
      ON recurring_invoice_runs(recurring_invoice_id, scheduled_date)
      WHERE status = 'success'
  `);
  await client.query('DROP POLICY IF EXISTS workspace_access_invoice_job_sources ON invoice_job_sources');
  await client.query(`
    CREATE POLICY workspace_access_invoice_job_sources ON invoice_job_sources
      USING (workspace_id = ${workspaceExpression})
      WITH CHECK (workspace_id = ${workspaceExpression})
  `);
  await client.query('ALTER TABLE invoice_job_sources ENABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE invoice_job_sources FORCE ROW LEVEL SECURITY');
}

export async function down(client) {
  await client.query('DROP POLICY IF EXISTS workspace_access_invoice_job_sources ON invoice_job_sources');
  await client.query('DROP TABLE IF EXISTS invoice_job_sources');
  await client.query('DROP INDEX IF EXISTS recurring_invoice_runs_success_schedule_idx');

  for (const table of ['invoices', 'quotes', 'job_entries', 'recurring_invoices']) {
    await client.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_customer_id_fkey`);
    await client.query(`
      ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_customer_id_fkey
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    `);
  }

  await client.query('DROP INDEX IF EXISTS customers_workspace_active_idx');
  await client.query('DROP INDEX IF EXISTS invoices_source_quote_id_idx');
  await client.query('ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_source_quote_id_fkey');
  await client.query('ALTER TABLE invoices DROP COLUMN IF EXISTS source_quote_id');
  await client.query('ALTER TABLE customers DROP COLUMN IF EXISTS is_active');
}
