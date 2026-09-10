// Der frühere Erststart-Seed schrieb id=1 erst nach den Sequenzmigrationen.
// Dadurch konnte der nächste Workspace erneut die bereits belegte ID erhalten.
export const name = '036_repair_seeded_company_sequence';

export async function up(client) {
  await client.query('BEGIN');
  try {
    await client.query('LOCK TABLE company IN SHARE ROW EXCLUSIVE MODE');
    await client.query('ALTER TABLE company NO FORCE ROW LEVEL SECURITY');
    await client.query(`
      SELECT setval('company_id_seq', GREATEST(
        COALESCE((SELECT MAX(id) FROM company), 0) + 1,
        (SELECT last_value + CASE WHEN is_called THEN 1 ELSE 0 END FROM company_id_seq)
      ), false)
    `);
    await client.query('ALTER TABLE company FORCE ROW LEVEL SECURITY');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function down() {
  // Vergebene IDs bleiben erhalten; die Sequenz wird nicht zurückgesetzt.
}
