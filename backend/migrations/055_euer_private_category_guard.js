/** Private Abgaben dürfen unabhängig von ihrer Quelle keine EÜR-Kategorie sein. */
export const name = '055_euer_private_category_guard';

export async function up(client) {
  // NOT VALID bewahrt mögliche Altbestände. Neue und geänderte Zeilen werden
  // trotzdem geprüft; diese Migration verändert oder löscht keine Fachdaten.
  await client.query(`ALTER TABLE euer_entries ADD CONSTRAINT euer_private_category_guard
    CHECK (category NOT IN ('kv','pv','rv','av','ksk','est_vz','gewst_vz','ust')) NOT VALID`);
}

export async function down(client) {
  await client.query('ALTER TABLE euer_entries DROP CONSTRAINT IF EXISTS euer_private_category_guard');
}
