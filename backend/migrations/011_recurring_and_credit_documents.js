/**
 * Migration: Invoice document types and recurring invoices
 */

export const name = '011_recurring_and_credit_documents';

export async function up(client) {
  await client.query(`
    ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS document_type VARCHAR(20) NOT NULL DEFAULT 'invoice',
      ADD COLUMN IF NOT EXISTS reference_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS credit_note_reason TEXT,
      ADD COLUMN IF NOT EXISTS recurring_invoice_id UUID
  `);

  await client.query(`
    ALTER TABLE invoices
      DROP CONSTRAINT IF EXISTS invoices_document_type_check
  `);
  await client.query(`
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_document_type_check CHECK (document_type IN ('invoice', 'credit_note'))
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS recurring_invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'semiannual', 'annual', 'custom')),
      interval_value INTEGER,
      interval_unit VARCHAR(20),
      start_date DATE NOT NULL,
      end_date DATE,
      next_run_date DATE NOT NULL,
      last_run_date DATE,
      due_days INTEGER NOT NULL DEFAULT 30,
      notes TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CHECK (end_date IS NULL OR end_date >= start_date),
      CHECK (frequency <> 'custom' OR (interval_value IS NOT NULL AND interval_value > 0 AND interval_unit IN ('day', 'week', 'month', 'year')))
    )
  `);

  await client.query(`
    ALTER TABLE invoices
      DROP CONSTRAINT IF EXISTS invoices_recurring_invoice_id_fkey
  `);
  await client.query(`
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_recurring_invoice_id_fkey
      FOREIGN KEY (recurring_invoice_id) REFERENCES recurring_invoices(id) ON DELETE SET NULL
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS recurring_invoice_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      recurring_invoice_id UUID NOT NULL REFERENCES recurring_invoices(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failure')),
      scheduled_date DATE NOT NULL,
      generated_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
      error TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await client.query('CREATE INDEX IF NOT EXISTS invoices_document_type_idx ON invoices(document_type)');
  await client.query('CREATE INDEX IF NOT EXISTS invoices_reference_invoice_id_idx ON invoices(reference_invoice_id)');
  await client.query('CREATE INDEX IF NOT EXISTS invoices_recurring_invoice_id_idx ON invoices(recurring_invoice_id)');
  await client.query('CREATE INDEX IF NOT EXISTS recurring_invoices_customer_id_idx ON recurring_invoices(customer_id)');
  await client.query('CREATE INDEX IF NOT EXISTS recurring_invoices_status_next_run_idx ON recurring_invoices(status, next_run_date)');
  await client.query('CREATE INDEX IF NOT EXISTS recurring_invoice_runs_recurring_id_idx ON recurring_invoice_runs(recurring_invoice_id, scheduled_date DESC)');
}

export async function down(client) {
  await client.query('DROP TABLE IF EXISTS recurring_invoice_runs');
  await client.query('ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_recurring_invoice_id_fkey');
  await client.query('DROP TABLE IF EXISTS recurring_invoices');
  await client.query('ALTER TABLE invoices DROP COLUMN IF EXISTS recurring_invoice_id, DROP COLUMN IF EXISTS credit_note_reason, DROP COLUMN IF EXISTS reference_invoice_id, DROP COLUMN IF EXISTS document_type');
}
