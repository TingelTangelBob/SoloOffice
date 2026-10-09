/** Gemappte Kursnamen für den bestätigten Kurs-Nachschritt erhalten. */
export const name = '058_invoice_item_course_names';

export async function up(client) {
  await client.query('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS course_name VARCHAR(255)');
}

export async function down(client) {
  await client.query('ALTER TABLE invoice_items DROP COLUMN IF EXISTS course_name');
}
