/**
 * Incoming electronic invoices with immutable source content and validation
 * metadata. The payload is intentionally kept in the application database so
 * the existing backup/restore and workspace isolation mechanisms cover it.
 */

export const name = '026_incoming_e_invoices';

const workspaceExpression = "NULLIF(current_setting('app.workspace_id', true), '')::uuid";

export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS incoming_e_invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      content_type VARCHAR(100) NOT NULL,
      size INTEGER NOT NULL CHECK (size > 0),
      sha256 CHAR(64) NOT NULL,
      format VARCHAR(20) NOT NULL CHECK (format IN ('XRechnung', 'ZUGFeRD')),
      validation_status VARCHAR(20) NOT NULL CHECK (validation_status IN ('validated', 'rejected')),
      validation_error TEXT,
      invoice_number VARCHAR(255),
      issue_date DATE,
      currency VARCHAR(3),
      supplier_name VARCHAR(255),
      supplier_tax_id VARCHAR(100),
      buyer_reference VARCHAR(255),
      gross_amount NUMERIC(14, 2),
      extracted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      linked_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS incoming_e_invoices_workspace_idx ON incoming_e_invoices(workspace_id, received_at DESC)');
  await client.query('CREATE INDEX IF NOT EXISTS incoming_e_invoices_customer_idx ON incoming_e_invoices(linked_customer_id)');
  await client.query('DROP POLICY IF EXISTS incoming_e_invoices_workspace_access ON incoming_e_invoices');
  await client.query(`
    CREATE POLICY incoming_e_invoices_workspace_access ON incoming_e_invoices
      USING (workspace_id = ${workspaceExpression})
      WITH CHECK (workspace_id = ${workspaceExpression})
  `);
  await client.query('ALTER TABLE incoming_e_invoices ENABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE incoming_e_invoices FORCE ROW LEVEL SECURITY');
  await client.query(`
    CREATE OR REPLACE FUNCTION protect_incoming_e_invoice_source()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF OLD.content IS DISTINCT FROM NEW.content
         OR OLD.sha256 IS DISTINCT FROM NEW.sha256
         OR OLD.filename IS DISTINCT FROM NEW.filename
         OR OLD.format IS DISTINCT FROM NEW.format
         OR OLD.size IS DISTINCT FROM NEW.size
         OR OLD.content_type IS DISTINCT FROM NEW.content_type THEN
        RAISE EXCEPTION 'Der Originalinhalt einer eingegangenen E-Rechnung ist unveränderlich.';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await client.query('DROP TRIGGER IF EXISTS incoming_e_invoices_source_immutable ON incoming_e_invoices');
  await client.query(`
    CREATE TRIGGER incoming_e_invoices_source_immutable
    BEFORE UPDATE ON incoming_e_invoices
    FOR EACH ROW EXECUTE FUNCTION protect_incoming_e_invoice_source()
  `);
}

export async function down(client) {
  await client.query('DROP TRIGGER IF EXISTS incoming_e_invoices_source_immutable ON incoming_e_invoices');
  await client.query('DROP FUNCTION IF EXISTS protect_incoming_e_invoice_source()');
  await client.query('DROP TABLE IF EXISTS incoming_e_invoices');
}
