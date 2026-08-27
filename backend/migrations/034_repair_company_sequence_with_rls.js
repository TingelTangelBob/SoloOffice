/**
 * Repariert die company-ID-Sequenz auch bei erzwungener Row-Level Security.
 * Ohne Workspace-Kontext ist company für den Laufzeitbenutzer leer, weshalb
 * Migration 033 den tatsächlichen Maximalwert nicht sehen konnte.
 */
export const name = '034_repair_company_sequence_with_rls';

export async function up(client) {
  await client.query('ALTER TABLE company NO FORCE ROW LEVEL SECURITY');
  await client.query(`
    SELECT setval(
      'company_id_seq',
      COALESCE((SELECT MAX(id) FROM company), 0) + 1,
      false
    )
  `);
  await client.query("ALTER TABLE company ALTER COLUMN id SET DEFAULT nextval('company_id_seq')");
  await client.query('ALTER TABLE company FORCE ROW LEVEL SECURITY');
}

export async function down() {
  // Die Sequenz bleibt absichtlich auf einem kollisionsfreien Wert.
}
