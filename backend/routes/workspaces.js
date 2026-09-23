import express from 'express';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../database.js';
import { clearAuthCookies, requireRole, requireWorkspaceFromParam } from '../middleware/auth.js';
import { runWithRequestContext } from '../utils/requestContext.js';
import {
  createOpaqueToken,
  createWorkspaceSlug,
  hashOpaqueToken,
  isValidEmail,
  normaliseEmail,
  publicWorkspace,
  verifyPassword,
} from '../utils/auth.js';
import { sendSystemEmail } from '../services/emailService.js';
import { systemMails } from '../services/emailTemplates.js';
import logger from '../utils/logger.js';
import { clearWorkspaceBusinessData } from '../services/workspaceData.js';
import { deleteWorkspaceData } from '../services/workspaceDeletion.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function verifyDestructiveAction(req, res) {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const confirmedName = typeof req.body?.workspaceName === 'string' ? req.body.workspaceName.trim() : '';
  if (confirmedName !== req.auth.workspace.name) {
    res.status(400).json({ error: 'Der Workspace-Name stimmt nicht überein.', code: 'WORKSPACE_NAME_MISMATCH' });
    return false;
  }
  const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.auth.userId]);
  if (!result.rows[0] || !(await verifyPassword(currentPassword, result.rows[0].password_hash))) {
    res.status(400).json({ error: 'Das aktuelle Passwort ist nicht korrekt.', code: 'PASSWORD_INVALID' });
    return false;
  }
  return true;
}

async function removeWorkspaceBackupFiles(workspaceId) {
  const backupDir = path.join(__dirname, '../../backups');
  let filenames;
  try {
    filenames = await fs.readdir(backupDir);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const prefixes = [`backup_${workspaceId}_`, `vollbackup_${workspaceId}_`];
  await Promise.all(filenames
    .filter(filename => prefixes.some(prefix => filename.startsWith(prefix)))
    .map(filename => fs.unlink(path.join(backupDir, filename))));
}

function publicAppUrl(req) {
  return (process.env.APP_BASE_URL || process.env.CORS_ORIGIN?.split(',')[0] || `${req.protocol}://${req.get('host') || 'localhost:8080'}`).replace(/\/$/, '');
}

router.get('/', async (req, res) => {
  const result = await query(`
    SELECT w.*, wm.role, wm.permissions
    FROM workspaces w
    JOIN workspace_members wm ON wm.workspace_id = w.id
    WHERE wm.user_id = $1
    ORDER BY w.created_at ASC
  `, [req.auth.userId]);
  res.json(result.rows.map(row => ({
    ...publicWorkspace(row, row.role),
    permissions: row.permissions || {},
  })));
});

router.post('/', async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 255) : '';
  if (!name) return res.status(400).json({ error: 'Bitte einen Workspace-Namen eingeben.' });

  const workspaceId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO workspaces (id, name, slug, created_by)
      VALUES ($1, $2, $3, $4)
    `, [workspaceId, name, createWorkspaceSlug(name), req.auth.userId]);
    await runWithRequestContext({ userId: req.auth.userId, workspaceId }, async () => {
      await client.query(`
        INSERT INTO company (name, address, city, postal_code, country, phone, email, tax_id, invoice_start_number, workspace_id)
        VALUES ($1, '', '', '', 'Deutschland', '', '', '', 1, $2)
      `, [name, workspaceId]);
      await client.query('INSERT INTO workspace_setup (workspace_id) VALUES ($1)', [workspaceId]);
      await client.query(`
        INSERT INTO hourly_rates (name, description, rate, tax_rate, is_default)
        VALUES ('Standard', 'Normale Arbeitszeit', 75, 19, TRUE)
      `);
      await client.query(`
        INSERT INTO material_templates (name, description, unit_price, unit, tax_rate, is_default)
        VALUES ('Kleinmaterial', 'Diverses Kleinmaterial', 15, 'Pauschale', 19, TRUE)
      `);
    });
    await client.query(`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, $2, 'owner')
    `, [workspaceId, req.auth.userId]);
    await client.query('COMMIT');
    const result = await query('SELECT * FROM workspaces WHERE id = $1', [workspaceId]);
    return res.status(201).json({ ...publicWorkspace(result.rows[0], 'owner'), permissions: {} });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return res.status(500).json({ error: 'Workspace konnte nicht angelegt werden' });
  } finally {
    client.release();
  }
});

router.patch('/:workspaceId', requireWorkspaceFromParam('workspaceId'), requireRole('owner', 'admin'), async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 255) : '';
  if (!name) return res.status(400).json({ error: 'Bitte einen Workspace-Namen eingeben.' });

  const result = await query(`
    UPDATE workspaces
    SET name = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `, [name, req.params.workspaceId]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Workspace nicht gefunden.' });

  return res.json({
    ...publicWorkspace(result.rows[0], req.auth.role),
    permissions: req.auth.permissions || {},
  });
});

router.post('/:workspaceId/reset', requireWorkspaceFromParam('workspaceId'), requireRole('owner'), async (req, res) => {
  if (!(await verifyDestructiveAction(req, res))) return;
  const workspaceId = req.params.workspaceId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lockedWorkspace = await client.query('SELECT id, name FROM workspaces WHERE id = $1 FOR UPDATE', [workspaceId]);
    if (!lockedWorkspace.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Workspace nicht gefunden.' });
    }
    if (String(req.body.workspaceName || '').trim() !== lockedWorkspace.rows[0].name) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Der Workspace-Name stimmt nicht überein.', code: 'WORKSPACE_NAME_MISMATCH' });
    }
    const sessionResult = await client.query('SELECT id, status FROM migration_sessions WHERE workspace_id = $1 FOR UPDATE', [workspaceId]);
    if (sessionResult.rows[0]?.status === 'open') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Der Workspace kann erst zurückgesetzt werden, wenn die offene Umzugssitzung unter „Datenübernahme“ abgeschlossen oder der historische Marker dort geschlossen wurde.',
        code: 'TAKEOVER_OPEN',
      });
    }
    await runWithRequestContext({ userId: req.auth.userId, workspaceId }, async () => {
      await clearWorkspaceBusinessData(client, workspaceId);
      await client.query('DELETE FROM workspace_invitations WHERE workspace_id = $1', [workspaceId]);
      await client.query('DELETE FROM user_notification_settings WHERE workspace_id = $1', [workspaceId]);
      await client.query("UPDATE sessions SET revoked_at = NOW() WHERE workspace_id = $1 AND id <> $2 AND revoked_at IS NULL", [workspaceId, req.auth.sessionId]);
      // Ein zurückgesetzter Workspace bleibt direkt benutzbar und erhält die
      // gleichen neutralen Startwerte wie ein neu angelegter Workspace.
      await client.query(`
        INSERT INTO company (name, address, city, postal_code, country, phone, email, tax_id, invoice_start_number, workspace_id)
        VALUES ($1, '', '', '', 'Deutschland', '', '', '', 1, $2)
      `, [lockedWorkspace.rows[0].name, workspaceId]);
      await client.query(`
        INSERT INTO hourly_rates (name, description, rate, tax_rate, is_default)
        VALUES ('Standard', 'Normale Arbeitszeit', 75, 19, TRUE)
      `);
      await client.query(`
        INSERT INTO material_templates (name, description, unit_price, unit, tax_rate, is_default)
        VALUES ('Kleinmaterial', 'Diverses Kleinmaterial', 15, 'Pauschale', 19, TRUE)
      `);
      await client.query(`
        UPDATE workspace_setup SET current_step = 1, completed_at = NULL,
          migration_choice = 'undecided', setup_required = TRUE, updated_at = NOW()
        WHERE workspace_id = $1
      `, [workspaceId]);
    });
    await client.query('COMMIT');
    try {
      await removeWorkspaceBackupFiles(workspaceId);
    } catch (error) {
      logger.error('Workspace-Sicherungen konnten nach dem Reset nicht entfernt werden', { workspaceId, error: error.message });
    }
    return res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error('Workspace-Reset fehlgeschlagen', { workspaceId, error: error.message });
    return res.status(500).json({ error: 'Workspace konnte nicht zurückgesetzt werden.' });
  } finally {
    client.release();
  }
});

router.delete('/:workspaceId', requireWorkspaceFromParam('workspaceId'), requireRole('owner'), async (req, res) => {
  if (!(await verifyDestructiveAction(req, res))) return;
  const workspaceId = req.params.workspaceId;
  const client = await pool.connect();
  let nextWorkspaceId = null;
  try {
    await client.query('BEGIN');
    const lockedWorkspace = await client.query('SELECT id, name FROM workspaces WHERE id = $1 FOR UPDATE', [workspaceId]);
    if (!lockedWorkspace.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Workspace nicht gefunden.' });
    }
    if (String(req.body.workspaceName || '').trim() !== lockedWorkspace.rows[0].name) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Der Workspace-Name stimmt nicht überein.', code: 'WORKSPACE_NAME_MISMATCH' });
    }
    const membershipResult = await client.query('SELECT user_id FROM workspace_members WHERE workspace_id = $1 FOR UPDATE', [workspaceId]);
    if (membershipResult.rows.length > 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Der Workspace hat weitere Mitglieder. Entfernen oder übertragen Sie diese zuerst.', code: 'WORKSPACE_HAS_MEMBERS' });
    }
    const alternatives = await client.query(`
      SELECT w.id FROM workspaces w
      JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE wm.user_id = $1 AND w.id <> $2
      ORDER BY w.created_at ASC LIMIT 1 FOR UPDATE OF w
    `, [req.auth.userId, workspaceId]);
    nextWorkspaceId = alternatives.rows[0]?.id || null;
    if (!nextWorkspaceId) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Lege zuerst einen Ersatz-Workspace an. Danach kannst du diesen Workspace löschen und wirst in den Ersatz gewechselt.', code: 'LAST_WORKSPACE' });
    }
    await client.query('UPDATE sessions SET workspace_id = $1 WHERE id = $2 AND user_id = $3', [nextWorkspaceId, req.auth.sessionId, req.auth.userId]);
    await runWithRequestContext({ userId: req.auth.userId, workspaceId }, () => deleteWorkspaceData(client, workspaceId));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error('Workspace-Löschung fehlgeschlagen', { workspaceId, error: error.message });
    return res.status(500).json({ error: 'Workspace konnte nicht gelöscht werden.' });
  } finally {
    client.release();
  }

  try {
    await removeWorkspaceBackupFiles(workspaceId);
  } catch (error) {
    logger.error('Workspace-Backups konnten nach der Löschung nicht entfernt werden', { workspaceId, error: error.message });
  }

  if (!nextWorkspaceId) {
    clearAuthCookies(res);
    return res.json({ signedOut: true, workspace: null, workspaces: [] });
  }
  const { active, remaining } = await runWithRequestContext({ userId: req.auth.userId, workspaceId: nextWorkspaceId }, async () => {
    const [activeResult, remainingResult] = await Promise.all([
      query(`
        SELECT w.*, wm.role, wm.permissions FROM workspaces w
        JOIN workspace_members wm ON wm.workspace_id = w.id
        WHERE w.id = $1 AND wm.user_id = $2
      `, [nextWorkspaceId, req.auth.userId]),
      query(`
        SELECT w.*, wm.role, wm.permissions FROM workspaces w
        JOIN workspace_members wm ON wm.workspace_id = w.id WHERE wm.user_id = $1
        ORDER BY w.created_at ASC
      `, [req.auth.userId]),
    ]);
    return { active: activeResult, remaining: remainingResult };
  });
  return res.json({
    signedOut: false,
    workspace: { ...publicWorkspace(active.rows[0], active.rows[0].role), permissions: active.rows[0].permissions || {} },
    workspaces: remaining.rows.map(row => ({ ...publicWorkspace(row, row.role), permissions: row.permissions || {} })),
  });
});

router.get('/:workspaceId/members', requireWorkspaceFromParam('workspaceId'), requireRole('owner', 'admin'), async (req, res) => {
  const result = await query(`
    SELECT u.id, u.email, u.first_name, u.last_name, u.created_at, wm.role, wm.permissions, wm.created_at AS joined_at
    FROM workspace_members wm
    JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = $1
    ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.email
  `, [req.params.workspaceId]);
  res.json(result.rows.map(row => ({
    id: row.id,
    email: row.email,
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    role: row.role,
    permissions: row.permissions || {},
    joinedAt: row.joined_at,
  })));
});

router.get('/:workspaceId/invitations', requireWorkspaceFromParam('workspaceId'), requireRole('owner', 'admin'), async (req, res) => {
  const result = await query(`
    SELECT id, email, role, expires_at, accepted_at, created_at
    FROM workspace_invitations
    WHERE workspace_id = $1
    ORDER BY created_at DESC
  `, [req.params.workspaceId]);
  res.json(result.rows.map(row => ({
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
  })));
});

router.post('/:workspaceId/invitations', requireWorkspaceFromParam('workspaceId'), requireRole('owner', 'admin'), async (req, res) => {
  const email = normaliseEmail(req.body.email);
  const role = ['admin', 'member', 'viewer'].includes(req.body.role) ? req.body.role : 'member';
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse eingeben.' });
  if (req.auth.role !== 'owner' && role === 'admin') {
    return res.status(403).json({ error: 'Nur der Workspace-Eigentümer darf Administratoren einladen.' });
  }

  const existingMember = await query(`
    SELECT 1 FROM workspace_members wm JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = $1 AND LOWER(u.email) = LOWER($2)
  `, [req.params.workspaceId, email]);
  if (existingMember.rows.length > 0) return res.status(409).json({ error: 'Diese Person ist bereits Mitglied.' });

  const token = createOpaqueToken();
  const result = await query(`
    INSERT INTO workspace_invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
    VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days')
    RETURNING id, email, role, expires_at, created_at
  `, [req.params.workspaceId, email, role, hashOpaqueToken(token), req.auth.userId]);
  const row = result.rows[0];
  const inviteLink = `${publicAppUrl(req)}?invite=${encodeURIComponent(token)}`;
  try {
    await sendSystemEmail({
      workspaceId: req.params.workspaceId,
      to: email,
      ...systemMails.workspaceInvitation({
        email,
        link: inviteLink,
        workspaceName: req.auth.workspace?.name || 'SoloOffice',
        invitedBy: req.auth.user?.displayName || req.auth.user?.email || '',
        role,
        expiresInDays: 7,
      }),
    });
  } catch (emailError) {
    logger.warn('Workspace-Einladung konnte nicht per E-Mail versendet werden', { error: emailError.message });
  }
  res.status(201).json({
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    ...(process.env.EXPOSE_INVITATION_TOKENS === 'true' ? { inviteToken: token, inviteLink } : {}),
  });
});

router.patch('/:workspaceId/members/:userId', requireWorkspaceFromParam('workspaceId'), requireRole('owner', 'admin'), async (req, res) => {
  const role = req.body.role;
  if (!['admin', 'member', 'viewer'].includes(role)) return res.status(400).json({ error: 'Ungültige Rolle.' });
  if (req.params.userId === req.auth.userId) return res.status(400).json({ error: 'Die eigene Rolle kann hier nicht geändert werden.' });
  if (req.auth.role !== 'owner' && role === 'admin') return res.status(403).json({ error: 'Nur der Workspace-Eigentümer darf Administratoren ernennen.' });

  const result = await query(`
    UPDATE workspace_members
    SET role = $1, updated_at = NOW()
    WHERE workspace_id = $2 AND user_id = $3 AND role <> 'owner'
    RETURNING workspace_id, user_id, role, permissions
  `, [role, req.params.workspaceId, req.params.userId]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Mitglied nicht gefunden.' });
  res.json(result.rows[0]);
});

router.delete('/:workspaceId/members/:userId', requireWorkspaceFromParam('workspaceId'), requireRole('owner', 'admin'), async (req, res) => {
  if (req.params.userId === req.auth.userId) return res.status(400).json({ error: 'Du kannst dich nicht selbst entfernen.' });
  const result = await query(`
    DELETE FROM workspace_members
    WHERE workspace_id = $1 AND user_id = $2 AND role <> 'owner'
    RETURNING user_id
  `, [req.params.workspaceId, req.params.userId]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Mitglied nicht gefunden.' });
  res.status(204).send();
});

router.delete('/:workspaceId/invitations/:invitationId', requireWorkspaceFromParam('workspaceId'), requireRole('owner', 'admin'), async (req, res) => {
  const result = await query(`
    DELETE FROM workspace_invitations WHERE id = $1 AND workspace_id = $2 RETURNING id
  `, [req.params.invitationId, req.params.workspaceId]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Einladung nicht gefunden.' });
  res.status(204).send();
});

export default router;
