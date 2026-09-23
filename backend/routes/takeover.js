import express from 'express';
import { pool } from '../database.js';
import { hasPermission } from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { isTakeoverAlreadyUsedError } from '../utils/migrationSessions.js';
import { persistentRateLimit } from '../middleware/rateLimit.js';
import { MAX_IMPORT_CELL_LENGTH, MAX_IMPORT_ROWS } from '../utils/importPlanner.js';

const router = express.Router();
const scanRateLimit = persistentRateLimit({ name: 'takeover-scan', windowMs: 60 * 1000, max: 12, keyGenerator: req => `${req.auth?.userId || req.ip}:${req.auth?.workspaceId || ''}`, failClosed: true });

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

// Der Scan nimmt ausschließlich normalisierte, flüchtige Daten entgegen.
// Es gibt hier weder Datei- noch Fachdatenpersistenz.
router.post('/scan', scanRateLimit, async (req, res) => {
  const { fileName, format, fileSize, hash, headers, rows, rowNumbers, warnings, sheets, sheet } = req.body || {};
  const supportedFormats = new Set(['csv', 'tsv', 'json', 'xlsx']);
  if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 255 || !supportedFormats.has(format)) {
    return res.status(400).json({ error: 'Dateiname oder Dateiformat ist ungültig.', code: 'SCAN_INVALID_FILE' });
  }
  if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > 10 * 1024 * 1024) {
    return res.status(413).json({ error: 'Die Importdatei darf höchstens 10 MB groß sein.', code: 'SCAN_FILE_TOO_LARGE' });
  }
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) {
    return res.status(400).json({ error: 'Der Datei-Hash ist ungültig.', code: 'SCAN_INVALID_HASH' });
  }
  if (!Array.isArray(headers) || headers.length < 1 || headers.length > 100 || new Set(headers).size !== headers.length || headers.some(header => typeof header !== 'string' || !header.trim() || header.length > 500)) {
    return res.status(400).json({ error: 'Die Kopfzeile hat eine ungültige Struktur.', code: 'SCAN_INVALID_HEADERS' });
  }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_IMPORT_ROWS) {
    return res.status(rows?.length > MAX_IMPORT_ROWS ? 413 : 400).json({ error: `Die Datei muss zwischen 1 und ${MAX_IMPORT_ROWS.toLocaleString('de-DE')} Datenzeilen enthalten.`, code: 'SCAN_INVALID_ROWS' });
  }
  if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row)
    || Object.keys(row).length !== headers.length
    || headers.some(header => !Object.hasOwn(row, header) || (typeof row[header] !== 'string' && typeof row[header] !== 'number') || String(row[header]).length > MAX_IMPORT_CELL_LENGTH))) {
    return res.status(400).json({ error: 'Die normalisierten Importzeilen passen nicht zur Kopfzeile oder enthalten ungültige Zellen.', code: 'SCAN_INVALID_STRUCTURE' });
  }
  if (format === 'xlsx') {
    if (!Array.isArray(sheets) || !sheets.length || sheets.length > 100 || sheets.some(name => typeof name !== 'string' || !name.trim())
      || typeof sheet !== 'string' || !sheets.includes(sheet)) {
      return res.status(400).json({ error: 'Das ausgewählte Tabellenblatt ist unbekannt oder ungültig.', code: 'SCAN_UNKNOWN_SHEET' });
    }
  } else if (sheet != null || (sheets != null && (!Array.isArray(sheets) || sheets.length))) {
    return res.status(400).json({ error: 'Für dieses Dateiformat ist keine Tabellenblattauswahl zulässig.', code: 'SCAN_UNKNOWN_SHEET' });
  }
  if (rowNumbers != null && (!Array.isArray(rowNumbers) || rowNumbers.length !== rows.length || rowNumbers.some(number => !Number.isInteger(number) || number < 1))) {
    return res.status(400).json({ error: 'Die Zeilennummern sind ungültig.', code: 'SCAN_INVALID_ROWS' });
  }
  if (warnings != null && (!Array.isArray(warnings) || warnings.length > 100 || warnings.some(warning => typeof warning !== 'string' || warning.length > 1000))) {
    return res.status(400).json({ error: 'Die Scan-Hinweise haben ein ungültiges Format.', code: 'SCAN_INVALID_WARNINGS' });
  }
  return res.json({ accepted: true, fileName: fileName.trim(), format, fileSize, hash: hash.toLowerCase(), sheet: sheet || null, headerCount: headers.length, rowCount: rows.length, warnings: warnings || [] });
});

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
