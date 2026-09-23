import express from 'express';
import { pool } from '../database.js';
import { hasPermission } from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { isTakeoverAlreadyUsedError } from '../utils/migrationSessions.js';

const router = express.Router();

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    startedBy: row.started_by,
    startedAt: row.started_at,
    completedBy: row.completed_by,
    completedAt: row.completed_at,
    progressRevision: row.progress_revision,
    legacyBackfill: row.legacy_backfill,
  };
}

function canManage(req, res) {
  if (hasPermission(req.auth, 'workspace.settings')) return true;
  res.status(403).json({ error: 'Nur Inhaber und Administratoren dürfen den Umzug starten oder abschließen.', code: 'FORBIDDEN' });
  return false;
}

router.get('/status', async (_req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT id, status, started_by, started_at, completed_by, completed_at,
             progress_revision, legacy_backfill
      FROM migration_sessions
      WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
      LIMIT 1
    `);
    const session = mapSession(result.rows[0]);
    return res.json({ takeoverUsed: Boolean(session), session });
  } finally {
    client.release();
  }
});

router.post('/start', async (req, res) => {
  if (!canManage(req, res)) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      INSERT INTO migration_sessions (workspace_id, started_by)
      VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1)
      RETURNING id, status, started_by, started_at, completed_by, completed_at,
                progress_revision, legacy_backfill
    `, [req.auth.userId]);
    await client.query('COMMIT');
    return res.status(201).json({ takeoverUsed: true, session: mapSession(result.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (isTakeoverAlreadyUsedError(error)) {
      return res.status(409).json({ error: 'Der einmalige Umzug-Start wurde für diesen Workspace bereits verwendet.', code: 'TAKEOVER_ALREADY_USED' });
    }
    logger.error('Umzug konnte nicht gestartet werden', { error: error.message });
    return res.status(500).json({ error: 'Der Umzug konnte nicht gestartet werden.' });
  } finally {
    client.release();
  }
});

router.post('/:sessionId/complete', async (req, res) => {
  if (!canManage(req, res)) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const openSession = await client.query(`
      SELECT id, legacy_backfill FROM migration_sessions
      WHERE id = $1
        AND workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
        AND status = 'open'
      FOR UPDATE
    `, [req.params.sessionId]);
    if (!openSession.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Die Sitzung ist nicht offen oder wurde bereits abgeschlossen.', code: 'TAKEOVER_NOT_OPEN' });
    }
    if (openSession.rows[0].legacy_backfill) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Der Altbestand belegt den einmaligen Start; ein neuer Sitzungsabschluss ist hier nicht verfügbar.', code: 'TAKEOVER_LEGACY_BACKFILL' });
    }
    // Bestehende Importläufe bleiben bis zum Umzugsabschluss rückgängig zu
    // machen. Der Sessionabschluss finalisiert sie in derselben Transaktion.
    await client.query(`
      UPDATE import_runs
      SET status = 'confirmed', confirmed_at = NOW()
      WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
        AND status = 'pending'
    `);
    const result = await client.query(`
      UPDATE migration_sessions
      SET status = 'completed', completed_by = $2, completed_at = NOW(),
          progress_revision = progress_revision + 1, updated_at = NOW()
      WHERE id = $1
        AND workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
        AND status = 'open'
      RETURNING id, status, started_by, started_at, completed_by, completed_at,
                progress_revision, legacy_backfill
    `, [req.params.sessionId, req.auth.userId]);
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Die Sitzung ist nicht offen oder wurde bereits abgeschlossen.', code: 'TAKEOVER_NOT_OPEN' });
    }
    await client.query('COMMIT');
    return res.json({ takeoverUsed: true, session: mapSession(result.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error('Umzug konnte nicht abgeschlossen werden', { error: error.message });
    return res.status(500).json({ error: 'Der Umzug konnte nicht abgeschlossen werden.' });
  } finally {
    client.release();
  }
});

export default router;
