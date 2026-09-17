/**
 * Optional Leistungsdatum on invoices (§ 14 Abs. 4 Nr. 6 UStG).
 * NULL means "Leistungsdatum entspricht Rechnungsdatum".
 */

export const name = '039_invoice_service_date';

export async function up(client) {
  await client.query(`
    ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS service_date DATE
  `);
}

export async function down(client) {
  await client.query('ALTER TABLE invoices DROP COLUMN IF EXISTS service_date');
}
