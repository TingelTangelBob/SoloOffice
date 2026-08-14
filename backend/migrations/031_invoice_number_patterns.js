/** Configurable, validated number patterns for invoices and credit notes. */
export const name = '031_invoice_number_patterns';

export async function up(client) {
  await client.query(`
    ALTER TABLE company
      ADD COLUMN IF NOT EXISTS invoice_number_pattern VARCHAR(50) NOT NULL DEFAULT 'RE-{YYYY}-{NNN}',
      ADD COLUMN IF NOT EXISTS credit_note_number_pattern VARCHAR(50) NOT NULL DEFAULT 'GS-{YYYY}-{NNN}'
  `);
}

export async function down(client) {
  await client.query(`
    ALTER TABLE company
      DROP COLUMN IF EXISTS credit_note_number_pattern,
      DROP COLUMN IF EXISTS invoice_number_pattern
  `);
}
