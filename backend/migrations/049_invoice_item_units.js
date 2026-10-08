/** Einheiten importierter Rechnungspositionen für spätere Kursableitungen erhalten. */
export async function up(client) {
  await client.query('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS unit VARCHAR(100)');
}

export async function down(client) {
  await client.query('ALTER TABLE invoice_items DROP COLUMN IF EXISTS unit');
}
