import { lockRegistrationBootstrap } from './registrationBootstrap.js';

const DEFAULT_MAX_WORKSPACES = 0;

export class WorkspaceLimitError extends Error {
  constructor() {
    super('Die maximale Zahl an Workspaces wurde erreicht. Bitte wenden Sie sich an den Administrator.');
    this.name = 'WorkspaceLimitError';
    this.status = 429;
    this.code = 'WORKSPACE_LIMIT_REACHED';
  }
}

export function configuredWorkspaceLimit(env = process.env) {
  const raw = env.REGISTRATION_MAX_WORKSPACES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_WORKSPACES;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('REGISTRATION_MAX_WORKSPACES muss eine ganze Zahl ab 0 sein.');
  }
  return value;
}

export async function getWorkspaceCapacity(db) {
  const limit = configuredWorkspaceLimit();
  const result = await db.query(`
    SELECT COUNT(*)::integer AS used
    FROM workspaces w
    WHERE EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = w.id)
       OR EXISTS (SELECT 1 FROM control_plane_workspaces cpw WHERE cpw.workspace_id = w.id)
  `);
  const used = result.rows[0]?.used ?? 0;
  return { used, limit: limit > 0 ? limit : null, remaining: limit > 0 ? Math.max(0, limit - used) : null };
}

/** Prüft und reserviert im selben Transaktions-Lock einen globalen Workspace-Platz. */
export async function assertWorkspaceCapacity(client) {
  const limit = configuredWorkspaceLimit();
  if (limit === 0) return;
  await lockRegistrationBootstrap(client);
  const result = await client.query(`
    SELECT COUNT(*)::integer AS used
    FROM workspaces w
    WHERE EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = w.id)
       OR EXISTS (SELECT 1 FROM control_plane_workspaces cpw WHERE cpw.workspace_id = w.id)
  `);
  if ((result.rows[0]?.used ?? 0) >= limit) throw new WorkspaceLimitError();
}
