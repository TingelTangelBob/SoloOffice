export const name = '062_job_source_quote';

// Ein Auftrag kann aus einem Angebot entstehen. Die Spalte verweist auf das
// Angebot; wird das Angebot gelöscht, bleibt der Auftrag ohne Herkunft bestehen.
// Je Angebot gibt es höchstens einen Auftrag (partieller eindeutiger Index).
// job_entries hat bereits Workspace-RLS; eine zusätzliche Spalte braucht keine
// neue Richtlinie, der Fremdschlüssel wird unter derselben Richtlinie geprüft.
export async function up(client) {
  await client.query('ALTER TABLE job_entries ADD COLUMN IF NOT EXISTS source_quote_id UUID');
  await client.query('ALTER TABLE job_entries DROP CONSTRAINT IF EXISTS job_entries_source_quote_id_fkey');
  await client.query(`
    ALTER TABLE job_entries
      ADD CONSTRAINT job_entries_source_quote_id_fkey
      FOREIGN KEY (source_quote_id) REFERENCES quotes(id) ON DELETE SET NULL
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS job_entries_source_quote_id_idx
      ON job_entries(source_quote_id)
      WHERE source_quote_id IS NOT NULL
  `);
}

export async function down(client) {
  await client.query('DROP INDEX IF EXISTS job_entries_source_quote_id_idx');
  await client.query('ALTER TABLE job_entries DROP CONSTRAINT IF EXISTS job_entries_source_quote_id_fkey');
  await client.query('ALTER TABLE job_entries DROP COLUMN IF EXISTS source_quote_id');
}
