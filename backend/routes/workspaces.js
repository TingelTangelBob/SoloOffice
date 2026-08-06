import express from 'express';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../database.js';
import { requireRole, requireWorkspaceFromParam } from '../middleware/auth.js';
import { runWithRequestContext } from '../utils/requestContext.js';
import {
  createOpaqueToken,
  createWorkspaceSlug,
  hashOpaqueToken,
  isValidEmail,
  normaliseEmail,
  publicWorkspace,
} from '../utils/auth.js';
import { sendSystemEmail } from '../services/emailService.js';
import logger from '../utils/logger.js';

const router = express.Router();

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
      subject: 'SoloOffice: Einladung zum Workspace',
      text: `Sie wurden zu einem SoloOffice-Workspace eingeladen. Einladung annehmen: ${inviteLink}`,
      html: `<p>Sie wurden zu einem SoloOffice-Workspace eingeladen.</p><p><a href="${inviteLink}">Einladung annehmen</a></p>`,
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
