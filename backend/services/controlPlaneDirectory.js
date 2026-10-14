import { pool } from '../database.js';
import { runWithRequestContext } from '../utils/requestContext.js';

export function directoryPage(input = {}) {
  const integer = (value, fallback) => Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback;
  return { limit: Math.min(200, Math.max(1, integer(input.limit, 50))), offset: Math.max(0, integer(input.offset, 0)), q: String(input.q || '').trim().slice(0, 120) };
}

/** Ausschließlich Identitäts- und Betriebsmetadaten; keine Fachinhalte. */
export async function platformOverview(db = pool) {
  const result = await db.query(`SELECT
    (SELECT COUNT(*)::int FROM users) AS users,
    (SELECT COUNT(*)::int FROM users WHERE is_active) AS active_users,
    (SELECT COUNT(DISTINCT user_id)::int FROM sessions WHERE last_seen_at > NOW()-INTERVAL '30 days') AS active_users_30d,
    (SELECT COUNT(*)::int FROM workspaces) AS workspaces,
    (SELECT COUNT(*)::int FROM workspaces WHERE suspended_at IS NULL) AS active_workspaces,
    (SELECT COUNT(*)::int FROM workspaces WHERE suspended_at IS NOT NULL) AS suspended_workspaces`);
  const row = result.rows[0];
  return { checkedAt: new Date().toISOString(), overview: { users: row.users, activeUsers: row.active_users, activeUsers30d: row.active_users_30d, workspaces: row.workspaces, activeWorkspaces: row.active_workspaces, suspendedWorkspaces: row.suspended_workspaces } };
}

export async function platformUsers(input, db = pool) {
  const { limit, offset, q } = directoryPage(input);
  const params = q ? [`%${q}%`] : [];
  const where = q ? 'WHERE u.email ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1' : '';
  const [result, count] = await Promise.all([
    db.query(`SELECT u.id,u.email,u.first_name,u.last_name,u.is_active,u.last_login_at,u.created_at,
      (SELECT COUNT(*)::int FROM workspace_members m WHERE m.user_id=u.id) AS workspace_count
      FROM users u ${where} ORDER BY u.created_at DESC,u.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
    db.query(`SELECT COUNT(*)::int AS total FROM users u ${where}`, params),
  ]);
  return { users: result.rows.map(row => ({ id: row.id, email: row.email, firstName: row.first_name, lastName: row.last_name, active: row.is_active, lastLoginAt: row.last_login_at, createdAt: row.created_at, workspaceCount: row.workspace_count })), total: count.rows[0].total, limit, offset };
}

export async function platformWorkspaces(input, db = pool) {
  const { limit, offset, q } = directoryPage(input);
  const params = q ? [`%${q}%`] : [];
  const where = q ? 'WHERE w.name ILIKE $1 OR w.slug ILIKE $1' : '';
  const [result, count] = await Promise.all([
    db.query(`SELECT w.id,w.name,w.slug,w.suspended_at,w.created_at,
      (SELECT COUNT(*)::int FROM workspace_members m WHERE m.workspace_id=w.id) AS member_count
      FROM workspaces w ${where} ORDER BY w.created_at DESC,w.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
    db.query(`SELECT COUNT(*)::int AS total FROM workspaces w ${where}`, params),
  ]);
  return { workspaces: result.rows.map(row => ({ id: row.id, name: row.name, slug: row.slug, status: row.suspended_at ? 'suspended' : 'active', memberCount: row.member_count, createdAt: row.created_at })), total: count.rows[0].total, limit, offset };
}

export async function workspaceInsight(workspaceId, db = pool) {
  const workspace = (await db.query('SELECT id,name,slug,suspended_at,created_at FROM workspaces WHERE id=$1', [workspaceId])).rows[0];
  if (!workspace) return null;
  const [members, activity, storage] = await Promise.all([
    db.query('SELECT u.id,u.email,u.is_active,m.role,m.created_at FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY m.role,u.email', [workspaceId]),
    db.query('SELECT MAX(last_seen_at) AS last FROM sessions WHERE workspace_id=$1', [workspaceId]),
    // Der Workspacekontext bleibt für die RLS-Tabelle gesetzt; RLS wird nie deaktiviert.
    runWithRequestContext({ workspaceId }, () => db.query('SELECT COALESCE(SUM(size),0)::bigint AS bytes FROM receipts WHERE workspace_id=$1', [workspaceId])),
  ]);
  return { workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug, status: workspace.suspended_at ? 'suspended' : 'active', createdAt: workspace.created_at }, members: members.rows.map(row => ({ id: row.id, email: row.email, active: row.is_active, role: row.role, joinedAt: row.created_at })), storageBytes: Number(storage.rows[0].bytes), storageScope: 'receipt-files', lastActivityAt: activity.rows[0]?.last || null };
}
