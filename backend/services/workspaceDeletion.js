import { clearWorkspaceBusinessData } from './workspaceData.js';

// Fachdaten-Reset und Workspace-Löschung teilen die Fachdatentabelle-Reihenfolge.
// Nur die Workspace-Löschung darf den Umzugs-Claim per FK-Kaskade entfernen.

export async function deleteWorkspaceData(client, workspaceId) {
  await clearWorkspaceBusinessData(client, workspaceId);
  // Die gespeicherten Control-Plane-Antworten enthalten die Eigentümeradresse.
  // Sie dürfen eine Workspace-Löschung nicht überdauern. Die Audit-Ereignisse
  // bleiben bewusst erhalten: sie halten nur Vorgang, Kennung und Grund fest.
  await client.query('DELETE FROM control_plane_requests WHERE workspace_id = $1', [workspaceId]);
  await client.query('DELETE FROM workspace_invitations WHERE workspace_id = $1', [workspaceId]);
  await client.query('DELETE FROM sessions WHERE workspace_id = $1', [workspaceId]);
  await client.query('DELETE FROM workspace_members WHERE workspace_id = $1', [workspaceId]);
  await client.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
}
