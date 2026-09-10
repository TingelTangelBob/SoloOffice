/**
 * Serialize allocation of a workspace-scoped document number until the
 * surrounding transaction ends.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} documentType
 * @param {number} year
 */
export async function lockDocumentNumber(client, documentType, year) {
  const workspaceResult = await client.query(
    "SELECT COALESCE(NULLIF(current_setting('app.workspace_id', true), ''), 'global') AS workspace_id",
  );
  const workspaceId = workspaceResult.rows[0]?.workspace_id || 'global';
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`solooffice:document-number:${workspaceId}:${year}:${documentType}`],
  );
}
