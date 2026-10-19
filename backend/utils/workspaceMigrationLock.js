/**
 * Serializes operations that mutate a workspace and its data-takeover state.
 * Keep this order before touching import_runs so restore and import undo cannot
 * wait on each other's row locks.
 */
export async function lockWorkspaceMigrationState(client, workspaceId) {
  if (!workspaceId) throw new Error('Workspace-ID zum Sperren fehlt.');

  const workspace = await client.query(
    'SELECT id FROM workspaces WHERE id = $1 FOR UPDATE',
    [workspaceId],
  );
  if (workspace.rowCount === 0) throw new Error('Workspace zum Sperren wurde nicht gefunden.');

  await client.query(
    'SELECT id FROM migration_sessions WHERE workspace_id = $1 ORDER BY id FOR UPDATE',
    [workspaceId],
  );
}
