/**
 * Repariert die Sequenz für historische company-IDs.
 * Migration 021 setzt den nächsten Wert auf max(id) + 1; bei bereits
 * ausgeführten oder wiederhergestellten Datenbanken kann die Sequenz dennoch
 * auf einem bereits verwendeten Wert stehen.
 */
export const name = '033_repair_company_id_sequence';

export async function up(client) {
  await client.query('CREATE SEQUENCE IF NOT EXISTS company_id_seq');
  await client.query(`
    SELECT setval(
      'company_id_seq',
      COALESCE((SELECT MAX(id) FROM company), 0) + 1,
      false
    )
  `);
  await client.query("ALTER TABLE company ALTER COLUMN id SET DEFAULT nextval('company_id_seq')");
}

export async function down() {
  // Die Sequenz wird bewusst nicht zurückgesetzt, da die Korrektur bestehende
  // Daten schützt und ein Rücksetzen wieder doppelte IDs erzeugen könnte.
}
