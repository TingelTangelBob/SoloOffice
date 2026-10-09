import { pool } from '../../database.js';
import { runWithRequestContext } from '../../utils/requestContext.js';
import { deleteWorkspaceData } from '../../services/workspaceDeletion.js';

// Gemeinsames Aufräumen der Finanz-Integrationstests: löscht Testworkspaces über
// denselben Pfad wie die echte Workspace-Löschung (FK-sichere Reihenfolge) und
// beendet den Pool immer, damit ein Fehler im Aufräumen den Testlauf nicht hängen lässt.
export async function cleanupFinanceWorkspaces(workspaceIds) {
  try {
    for (const workspaceId of workspaceIds) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.allow_history_purge','true',true), set_config('app.audit_disabled','true',true)");
        await runWithRequestContext({ workspaceId }, () => deleteWorkspaceData(client, workspaceId));
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally { client.release(); }
    }
  } finally {
    await pool.end();
  }
}
