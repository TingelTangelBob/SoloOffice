import express from 'express';
import { query } from '../database.js';
import { persistentRateLimit } from '../middleware/rateLimit.js';
import { collectDigestSections, deliverDigest, settingsView, validateSettingsInput } from '../services/notificationDigest.js';
import logger from '../utils/logger.js';

/**
 * E-Mail-Benachrichtigungen des angemeldeten Benutzers für den aktiven
 * Workspace (Benutzerdaten → E-Mail-Benachrichtigungen).
 *
 * Die Zeile gehört genau einem Benutzer in genau einem Workspace; andere
 * Mitglieder sehen sie nicht. Der Versand selbst läuft im Hintergrund
 * (services/notificationDigest.js). `/preview` zeigt, was heute drinstünde,
 * `/send-now` schickt die Zusammenfassung sofort – zum Ausprobieren.
 */

const router = express.Router();

async function loadSettings(userId, workspaceId) {
  const result = await query('SELECT * FROM user_notification_settings WHERE user_id = $1 AND workspace_id = $2', [userId, workspaceId]);
  return result.rows[0] || null;
}

router.get('/', async (req, res, next) => {
  try {
    const row = await loadSettings(req.auth.userId, req.auth.workspaceId);
    return res.json({ settings: settingsView(row), email: req.auth.user.email });
  } catch (error) {
    return next(error);
  }
});

router.put('/', async (req, res, next) => {
  const validated = validateSettingsInput(req.body || {});
  if (!validated.ok) return res.status(400).json({ error: validated.error, code: 'NOTIFICATION_SETTINGS_INVALID' });
  const { value } = validated;
  try {
    const result = await query(`
      INSERT INTO user_notification_settings (user_id, workspace_id, jobs_completed, invoice_drafts, invoice_draft_days, invoices_overdue, digest_hour)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, workspace_id) DO UPDATE SET
        jobs_completed = EXCLUDED.jobs_completed,
        invoice_drafts = EXCLUDED.invoice_drafts,
        invoice_draft_days = EXCLUDED.invoice_draft_days,
        invoices_overdue = EXCLUDED.invoices_overdue,
        digest_hour = EXCLUDED.digest_hour,
        updated_at = NOW()
      RETURNING *
    `, [req.auth.userId, req.auth.workspaceId, value.jobsCompleted, value.invoiceDrafts, value.invoiceDraftDays, value.invoicesOverdue, value.digestHour]);
    return res.json({ settings: settingsView(result.rows[0]), email: req.auth.user.email });
  } catch (error) {
    return next(error);
  }
});

// Vorschau: was stünde heute in der Zusammenfassung? Liest nur.
router.get('/preview', async (req, res, next) => {
  try {
    const row = await loadSettings(req.auth.userId, req.auth.workspaceId);
    const settings = row || { jobs_completed: true, invoice_drafts: true, invoice_draft_days: 3, invoices_overdue: true };
    const appUrl = (process.env.APP_BASE_URL || process.env.CORS_ORIGIN?.split(',')[0] || '').trim().replace(/\/$/, '');
    const { sections, total } = await collectDigestSections({ settings, appUrl });
    return res.json({ total, sections: sections.map(section => ({ key: section.key, title: section.title, count: section.count, items: section.items.map(item => ({ title: item.title, subtitle: item.subtitle, meta: item.meta })) })) });
  } catch (error) {
    return next(error);
  }
});

// Sofort senden – höchstens dreimal je Stunde, damit ein Klicktest kein Relay flutet.
router.post('/send-now', persistentRateLimit({ name: 'digest-send-now', windowMs: 60 * 60 * 1000, max: 3, keyGenerator: req => req.auth?.userId || req.ip }), async (req, res, next) => {
  try {
    const row = await loadSettings(req.auth.userId, req.auth.workspaceId);
    if (!row || !(row.jobs_completed || row.invoice_drafts || row.invoices_overdue)) {
      return res.status(400).json({ error: 'Bitte zuerst mindestens einen Hinweis aktivieren und speichern.', code: 'NOTIFICATIONS_DISABLED' });
    }
    const workspace = await query('SELECT name, suspended_at FROM workspaces WHERE id = $1', [req.auth.workspaceId]);
    const candidate = {
      ...row,
      email: req.auth.user.email,
      first_name: req.auth.user.firstName,
      last_name: req.auth.user.lastName,
      workspace_name: workspace.rows[0]?.name || req.auth.workspace?.name || 'SoloOffice',
      suspended_at: workspace.rows[0]?.suspended_at || null,
    };
    const result = await deliverDigest(candidate, { force: true });
    if (result.status === 'nothing_to_report') return res.json({ sent: false, message: 'Aktuell gibt es keine offenen Punkte – es wurde keine E-Mail gesendet.' });
    return res.json({ sent: true, message: `Zusammenfassung mit ${result.total} ${result.total === 1 ? 'Punkt' : 'Punkten'} an ${req.auth.user.email} gesendet.` });
  } catch (error) {
    logger.warn('Sofortversand der Wiedervorlage fehlgeschlagen', { error: error instanceof Error ? error.message : String(error) });
    return res.status(502).json({ error: `Die E-Mail konnte nicht gesendet werden: ${error instanceof Error ? error.message : 'unbekannter Fehler'}`, code: 'DIGEST_SEND_FAILED' });
  }
});

export default router;
