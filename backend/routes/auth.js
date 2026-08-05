import express from 'express';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../database.js';
import { runWithRequestContext } from '../utils/requestContext.js';
import { requireAuth, loadSession, clearAuthCookies } from '../middleware/auth.js';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  cookieOptions,
  createOpaqueToken,
  createWorkspaceSlug,
  hashOpaqueToken,
  hashPassword,
  isValidEmail,
  normaliseEmail,
  publicUser,
  publicWorkspace,
  validatePassword,
  verifyPassword,
} from '../utils/auth.js';

const router = express.Router();
const failedLoginAttempts = new Map();

function csrfCookieOptions() {
  return {
    httpOnly: false,
    sameSite: process.env.COOKIE_SAME_SITE || 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  };
}

function setAuthCookies(res, token) {
  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_MAX_AGE_MS));
  res.cookie(CSRF_COOKIE, createOpaqueToken(), csrfCookieOptions());
}

function getClientMetadata(req) {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || null,
    userAgent: req.get('user-agent')?.slice(0, 1000) || null,
  };
}

async function createSession(client, userId, workspaceId, req) {
  const token = createOpaqueToken();
  const metadata = getClientMetadata(req);
  await client.query(`
    INSERT INTO sessions (token_hash, user_id, workspace_id, expires_at, ip_address, user_agent)
    VALUES ($1, $2, $3, NOW() + INTERVAL '30 days', $4, $5)
  `, [hashOpaqueToken(token), userId, workspaceId, metadata.ipAddress, metadata.userAgent]);
  return token;
}

async function getMemberships(userId) {
  const result = await query(`
    SELECT w.*, wm.role, wm.permissions
    FROM workspaces w
    JOIN workspace_members wm ON wm.workspace_id = w.id
    WHERE wm.user_id = $1
    ORDER BY w.created_at ASC
  `, [userId]);
  return result.rows.map(row => ({
    ...publicWorkspace(row, row.role),
    permissions: row.permissions || {},
  }));
}

async function getAuthResponse(token) {
  const auth = await loadSession(token);
  if (!auth) return null;
  const userResult = await query('SELECT * FROM users WHERE id = $1', [auth.userId]);
  const currentWorkspace = {
    ...publicWorkspace({
      id: auth.workspace.id,
      name: auth.workspace.name,
      slug: auth.workspace.slug,
      created_at: auth.workspace.createdAt,
    }, auth.role),
    permissions: auth.permissions,
  };
  return {
    user: userResult.rows[0] ? publicUser(userResult.rows[0]) : auth.user,
    workspace: currentWorkspace,
    workspaces: await getMemberships(auth.userId),
  };
}

function validateIdentityPayload(body) {
  const email = normaliseEmail(body.email);
  if (!isValidEmail(email)) return { error: 'Bitte eine gültige E-Mail-Adresse eingeben.' };
  const passwordError = validatePassword(body.password);
  if (passwordError) return { error: passwordError };
  return { email };
}

function loginKey(req, email) {
  return `${req.ip || 'unknown'}:${email}`;
}

function isLoginBlocked(key) {
  const entry = failedLoginAttempts.get(key);
  return entry && entry.until > Date.now();
}

function registerFailedLogin(key) {
  const current = failedLoginAttempts.get(key) || { count: 0, until: 0 };
  const count = current.count + 1;
  failedLoginAttempts.set(key, {
    count,
    until: count >= 5 ? Date.now() + 15 * 60 * 1000 : 0,
  });
}

function clearFailedLogin(key) {
  failedLoginAttempts.delete(key);
}

router.post('/register', async (req, res) => {
  const identity = validateIdentityPayload(req.body || {});
  if (identity.error) return res.status(400).json({ error: identity.error });

  const firstName = typeof req.body.firstName === 'string' ? req.body.firstName.trim().slice(0, 100) : '';
  const lastName = typeof req.body.lastName === 'string' ? req.body.lastName.trim().slice(0, 100) : '';
  const workspaceName = typeof req.body.workspaceName === 'string' && req.body.workspaceName.trim()
    ? req.body.workspaceName.trim().slice(0, 255)
    : 'Mein Workspace';
  const passwordHash = await hashPassword(req.body.password);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const existingUser = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [identity.email]);
    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Für diese E-Mail-Adresse existiert bereits ein Konto.' });
    }

    const userResult = await client.query(`
      INSERT INTO users (email, password_hash, first_name, last_name)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [identity.email, passwordHash, firstName, lastName]);
    const user = userResult.rows[0];
    const userCount = await client.query('SELECT COUNT(*)::integer AS count FROM users');
    const isFirstUser = userCount.rows[0].count === 1;
    let workspaceId;

    if (isFirstUser) {
      const workspaceResult = await client.query('SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1');
      workspaceId = workspaceResult.rows[0]?.id;
      if (!workspaceId) throw new Error('Initial workspace is missing');
      await client.query('UPDATE workspaces SET name = $1, updated_at = NOW() WHERE id = $2', [workspaceName, workspaceId]);
    } else {
      workspaceId = randomUUID();
      await client.query(`
        INSERT INTO workspaces (id, name, slug, created_by)
        VALUES ($1, $2, $3, $4)
      `, [workspaceId, workspaceName, createWorkspaceSlug(workspaceName), user.id]);

      await runWithRequestContext({ userId: user.id, workspaceId }, async () => {
        await client.query(`
          INSERT INTO company (name, address, city, postal_code, country, phone, email, tax_id, invoice_start_number, workspace_id)
          VALUES ($1, '', '', '', 'Deutschland', '', $2, '', 1, $3)
        `, [workspaceName, identity.email, workspaceId]);
        await client.query(`
          INSERT INTO hourly_rates (name, description, rate, tax_rate, is_default)
          VALUES ('Standard', 'Normale Arbeitszeit', 75, 19, TRUE)
        `);
        await client.query(`
          INSERT INTO material_templates (name, description, unit_price, unit, tax_rate, is_default)
          VALUES ('Kleinmaterial', 'Diverses Kleinmaterial', 15, 'Pauschale', 19, TRUE)
        `);
      });
    }

    await client.query(`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, $2, 'owner')
    `, [workspaceId, user.id]);
    const token = await createSession(client, user.id, workspaceId, req);
    await client.query('COMMIT');

    setAuthCookies(res, token);
    const payload = await getAuthResponse(token);
    return res.status(201).json(payload);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return res.status(500).json({ error: 'Registrierung konnte nicht abgeschlossen werden' });
  } finally {
    client.release();
  }
});

router.post('/login', async (req, res) => {
  const identity = validateIdentityPayload(req.body || {});
  if (identity.error) return res.status(400).json({ error: identity.error });
  const key = loginKey(req, identity.email);
  if (isLoginBlocked(key)) return res.status(429).json({ error: 'Zu viele fehlgeschlagene Versuche. Bitte später erneut versuchen.' });

  const userResult = await query('SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_active = TRUE', [identity.email]);
  const user = userResult.rows[0];
  if (!user || !(await verifyPassword(req.body.password, user.password_hash))) {
    registerFailedLogin(key);
    return res.status(401).json({ error: 'E-Mail-Adresse oder Passwort ist nicht korrekt.' });
  }

  const memberships = await query(`
    SELECT workspace_id, role FROM workspace_members WHERE user_id = $1 ORDER BY created_at ASC
  `, [user.id]);
  if (memberships.rows.length === 0) return res.status(403).json({ error: 'Für dieses Konto ist kein Workspace freigeschaltet.' });

  const requestedWorkspaceId = typeof req.body.workspaceId === 'string' ? req.body.workspaceId : null;
  const membership = memberships.rows.find(row => row.workspace_id === requestedWorkspaceId) || memberships.rows[0];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const token = await createSession(client, user.id, membership.workspace_id, req);
    await client.query('UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [user.id]);
    await client.query('COMMIT');
    clearFailedLogin(key);
    setAuthCookies(res, token);
    return res.json(await getAuthResponse(token));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return res.status(500).json({ error: 'Anmeldung konnte nicht abgeschlossen werden' });
  } finally {
    client.release();
  }
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({
    user: req.auth.user,
    workspace: {
      ...req.auth.workspace,
      role: req.auth.role,
      permissions: req.auth.permissions,
    },
    workspaces: await getMemberships(req.auth.userId),
  });
});

router.post('/logout', requireAuth, async (req, res) => {
  await query('UPDATE sessions SET revoked_at = NOW() WHERE id = $1', [req.auth.sessionId]);
  clearAuthCookies(res);
  res.status(204).send();
});

router.post('/logout-all', requireAuth, async (req, res) => {
  await query('UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1', [req.auth.userId]);
  clearAuthCookies(res);
  res.status(204).send();
});

router.post('/switch-workspace/:workspaceId', requireAuth, async (req, res) => {
  const membership = await query(`
    SELECT workspace_id FROM workspace_members WHERE user_id = $1 AND workspace_id = $2
  `, [req.auth.userId, req.params.workspaceId]);
  if (membership.rows.length === 0) return res.status(404).json({ error: 'Workspace nicht gefunden' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE sessions SET revoked_at = NOW() WHERE id = $1', [req.auth.sessionId]);
    const token = await createSession(client, req.auth.userId, req.params.workspaceId, req);
    await client.query('COMMIT');
    setAuthCookies(res, token);
    return res.json(await getAuthResponse(token));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return res.status(500).json({ error: 'Workspace konnte nicht gewechselt werden' });
  } finally {
    client.release();
  }
});

router.patch('/profile', requireAuth, async (req, res) => {
  const firstName = typeof req.body.firstName === 'string' ? req.body.firstName.trim().slice(0, 100) : '';
  const lastName = typeof req.body.lastName === 'string' ? req.body.lastName.trim().slice(0, 100) : '';
  const result = await query(`
    UPDATE users SET first_name = $1, last_name = $2, updated_at = NOW()
    WHERE id = $3
    RETURNING *
  `, [firstName, lastName, req.auth.userId]);
  res.json({ user: publicUser(result.rows[0]) });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const passwordError = validatePassword(req.body.password);
  if (passwordError) return res.status(400).json({ error: passwordError });
  const userResult = await query('SELECT password_hash FROM users WHERE id = $1', [req.auth.userId]);
  if (!userResult.rows[0] || !(await verifyPassword(req.body.currentPassword, userResult.rows[0].password_hash))) {
    return res.status(400).json({ error: 'Das bisherige Passwort ist nicht korrekt.' });
  }
  const passwordHash = await hashPassword(req.body.password);
  await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, req.auth.userId]);
  await query('UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL', [req.auth.userId, req.auth.sessionId]);
  res.status(204).send();
});

router.post('/accept-invitation', async (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
  const identity = validateIdentityPayload(req.body || {});
  if (!token || identity.error) return res.status(400).json({ error: identity.error || 'Einladungstoken fehlt.' });

  const invitationResult = await query(`
    SELECT * FROM workspace_invitations
    WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > NOW()
  `, [hashOpaqueToken(token)]);
  const invitation = invitationResult.rows[0];
  if (!invitation || invitation.email !== identity.email) return res.status(400).json({ error: 'Die Einladung ist ungültig oder abgelaufen.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let userResult = await client.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [identity.email]);
    let user = userResult.rows[0];
    if (user) {
      if (!(await verifyPassword(req.body.password, user.password_hash))) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: 'Für dieses Konto ist das bestehende Passwort erforderlich.' });
      }
    } else {
      const passwordHash = await hashPassword(req.body.password);
      userResult = await client.query(`
        INSERT INTO users (email, password_hash, first_name, last_name)
        VALUES ($1, $2, $3, $4) RETURNING *
      `, [identity.email, passwordHash, req.body.firstName?.trim() || '', req.body.lastName?.trim() || '']);
      user = userResult.rows[0];
    }
    await client.query(`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()
    `, [invitation.workspace_id, user.id, invitation.role]);
    await client.query('UPDATE workspace_invitations SET accepted_at = NOW() WHERE id = $1', [invitation.id]);
    const sessionToken = await createSession(client, user.id, invitation.workspace_id, req);
    await client.query('COMMIT');
    setAuthCookies(res, sessionToken);
    return res.status(201).json(await getAuthResponse(sessionToken));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return res.status(500).json({ error: 'Einladung konnte nicht angenommen werden' });
  } finally {
    client.release();
  }
});

export default router;
