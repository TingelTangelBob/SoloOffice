/**
 * Links an expense receipt to the outgoing draft invoice used to rebill it.
 * The foreign key prevents dangling links while ON DELETE SET NULL makes an
 * intentionally deleted draft billable again.
 */
export const name = '030_receipt_billing';

export async function up(client) {
  await client.query(`
    ALTER TABLE receipts
      ADD COLUMN IF NOT EXISTS billed_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL
  `);
  await client.query('CREATE INDEX IF NOT EXISTS receipts_billed_invoice_idx ON receipts(billed_invoice_id)');
}

export async function down(client) {
  await client.query('DROP INDEX IF EXISTS receipts_billed_invoice_idx');
  await client.query('ALTER TABLE receipts DROP COLUMN IF EXISTS billed_invoice_id');
}
