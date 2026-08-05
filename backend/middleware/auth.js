import { query } from '../database.js';
import { runWithRequestContext } from '../utils/requestContext.js';
import {
  AUTH_ROLES,
  CSRF_COOKIE,
  SESSION_COOKIE,
  hashOpaqueToken,
  parseCookies,
} from '../utils/auth.js';

const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const settingsPrefixes = ['/company', '/hourly-rates', '/material-templates', '/email-management', '/backup', '/yearly-invoice-start-numbers'];
const sensitivePrefixes = ['/email-management', '/backup'];

function getSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];

  const authorization = req.headers.authorization || '';
  if (authorization.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim();
  return null;
}

export async function loadSession(token) {
  if (!token) return null;

  const result = await query(`
    SELECT
      s.id AS session_id,
      s.user_id,
      s.workspace_id,
      u.email,
      u.first_name,
      u.last_name,
      u.is_active,
      w.name AS workspace_name,
      w.slug AS workspace_slug,
      w.created_at AS workspace_created_at,
      wm.role,
      wm.permissions
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN workspaces w ON w.id = s.workspace_id
    JOIN workspace_members wm ON wm.workspace_id = s.workspace_id AND wm.user_id = s.user_id
    WHERE s.token_hash = $1
      AND s.expires_at > NOW()
      AND s.revoked_at IS NULL
      AND u.is_active = TRUE
  `, [hashOpaqueToken(token)]);

  const row = result.rows[0];
  if (!row || !AUTH_ROLES.has(row.role)) return null;

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    role: row.role,
    permissions: row.permissions || {},
    user: {
      id: row.user_id,
      email: row.email,
      firstName: row.first_name || '',
      lastName: row.last_name || '',
      displayName: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email,
    },
    workspace: {
      id: row.workspace_id,
      name: row.workspace_name,
      slug: row.workspace_slug,
      createdAt: row.workspace_created_at,
    },
  };
}

export async function requireAuth(req, res, next) {
  try {
    const token = getSessionToken(req);
    const auth = await loadSession(token);
    if (!auth) {
      return res.status(401).json({ error: 'Authentifizierung erforderlich', code: 'AUTH_REQUIRED' });
    }

    req.auth = auth;
    await query('UPDATE sessions SET last_seen_at = NOW() WHERE id = $1', [auth.sessionId]);

    return runWithRequestContext({
      userId: auth.userId,
      workspaceId: auth.workspaceId,
      sessionId: auth.sessionId,
    }, () => next());
  } catch (error) {
    return res.status(401).json({ error: 'Sitzung konnte nicht geprüft werden', code: 'AUTH_INVALID' });
  }
}

export function csrfProtection(req, res, next) {
  if (!writeMethods.has(req.method)) return next();
  if (req.path === '/auth/login' || req.path === '/auth/register' || req.path === '/auth/accept-invitation') return next();

  const cookies = parseCookies(req.headers.cookie || '');
  const cookieToken = cookies[CSRF_COOKIE];
  const headerToken = req.get('x-csrf-token');
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'Ungültige Anfrage-Sicherheitsprüfung', code: 'CSRF_INVALID' });
  }
  return next();
}

export function hasPermission(auth, permission) {
  if (!auth) return false;
  if (auth.role === 'owner' || auth.role === 'admin') return true;
  if (auth.permissions && auth.permissions[permission] === true) return true;
  if (permission === 'data.read') return true;
  return auth.role === 'member' && permission === 'data.write';
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.auth, permission)) {
      return res.status(403).json({ error: 'Keine Berechtigung für diese Aktion', code: 'FORBIDDEN' });
    }
    return next();
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'Keine Berechtigung für diese Aktion', code: 'FORBIDDEN' });
    }
    return next();
  };
}

export function requireWorkspaceFromParam(param = 'id') {
  return (req, res, next) => {
    if (req.params[param] !== req.auth?.workspaceId) {
      return res.status(404).json({ error: 'Workspace nicht gefunden' });
    }
    return next();
  };
}

/**
 * Coarse default policy for the legacy modules: viewers can read, members can
 * operate business data, and only admins/owners can change company settings.
 */
export function authorizeLegacyRequest(req, res, next) {
  if (sensitivePrefixes.some(prefix => req.path.startsWith(prefix)) && !hasPermission(req.auth, 'workspace.settings')) {
    return res.status(403).json({ error: 'Nur Administratoren dürfen diesen Bereich öffnen', code: 'FORBIDDEN' });
  }

  if (writeMethods.has(req.method) && !hasPermission(req.auth, 'data.write')) {
    return res.status(403).json({ error: 'Dieser Benutzer darf keine Daten ändern', code: 'FORBIDDEN' });
  }

  if (writeMethods.has(req.method) && settingsPrefixes.some(prefix => req.path.startsWith(prefix)) && !hasPermission(req.auth, 'workspace.settings')) {
    return res.status(403).json({ error: 'Nur Administratoren dürfen Einstellungen ändern', code: 'FORBIDDEN' });
  }

  return next();
}

export function clearAuthCookies(res) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: process.env.COOKIE_SAME_SITE || 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/' });
  res.clearCookie(CSRF_COOKIE, { sameSite: process.env.COOKIE_SAME_SITE || 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/' });
}
