import { pool, query } from '../database.js';
import { runWithRequestContext } from '../utils/requestContext.js';
import { sendSystemEmail } from './emailService.js';
import { systemMails } from './emailTemplates.js';
import logger from '../utils/logger.js';

/**
 * Tägliche Wiedervorlage per E-Mail (Benutzerdaten → E-Mail-Benachrichtigungen).
 *
 * Ein Hintergrundlauf (server.js, alle 15 Minuten) prüft je Benutzer und
 * Workspace, ob die eingestellte Uhrzeit in der Zeitzone des Unternehmens
 * erreicht ist und heute noch keine Zusammenfassung ging. Dann werden die
 * offenen Punkte gesammelt:
 * - abgeschlossene Aufträge, für die noch keine Rechnung erstellt wurde
 * - Rechnungsentwürfe, die seit N Tagen nicht versendet wurden
 * - überfällige Rechnungen
 *
 * Grundsätze:
 * - Höchstens eine Mail je Tag, Benutzer und Workspace (`last_digest_day`).
 * - Ohne offene Punkte keine Mail – der Tag gilt trotzdem als erledigt.
 * - Fachdaten werden nur im Kontext des jeweiligen Workspace gelesen (RLS).
 * - Ein Advisory-Lock verhindert Doppelversand bei mehreren Backend-Prozessen.
 */

export const DIGEST_INTERVAL_MS = 15 * 60 * 1000;
export const MAX_ITEMS_PER_SECTION = 15;
const LOCK_NAMESPACE = 0x534f; // 'SO'
const LOCK_ID = 0x4d41494c; // 'MAIL'
const DEFAULT_TIME_ZONE = 'Europe/Berlin';

export const DEFAULT_SETTINGS = Object.freeze({
  jobsCompleted: false,
  invoiceDrafts: false,
  invoiceDraftDays: 3,
  invoicesOverdue: false,
  digestHour: 8,
});

export function settingsView(row) {
  if (!row) return { ...DEFAULT_SETTINGS, lastDigestAt: null, lastDigestError: null };
  return {
    jobsCompleted: Boolean(row.jobs_completed),
    invoiceDrafts: Boolean(row.invoice_drafts),
    invoiceDraftDays: Number(row.invoice_draft_days ?? DEFAULT_SETTINGS.invoiceDraftDays),
    invoicesOverdue: Boolean(row.invoices_overdue),
    digestHour: Number(row.digest_hour ?? DEFAULT_SETTINGS.digestHour),
    lastDigestAt: row.last_digest_at || null,
    lastDigestError: row.last_digest_error || null,
  };
}

/** Prüft und normalisiert Eingaben der Einstellungsroute. Reine Funktion. */
export function validateSettingsInput(input = {}) {
  const errors = [];
  const bool = (value, fallback) => (value === undefined ? fallback : value === true);
  const draftDays = input.invoiceDraftDays === undefined ? DEFAULT_SETTINGS.invoiceDraftDays : Number(input.invoiceDraftDays);
  const digestHour = input.digestHour === undefined ? DEFAULT_SETTINGS.digestHour : Number(input.digestHour);
  if (!Number.isInteger(draftDays) || draftDays < 1 || draftDays > 60) errors.push('Die Wartezeit für Entwürfe muss zwischen 1 und 60 Tagen liegen.');
  if (!Number.isInteger(digestHour) || digestHour < 0 || digestHour > 23) errors.push('Die Uhrzeit muss zwischen 0 und 23 Uhr liegen.');
  if (errors.length) return { ok: false, error: errors.join(' ') };
  return {
    ok: true,
    value: {
      jobsCompleted: bool(input.jobsCompleted, DEFAULT_SETTINGS.jobsCompleted),
      invoiceDrafts: bool(input.invoiceDrafts, DEFAULT_SETTINGS.invoiceDrafts),
      invoiceDraftDays: draftDays,
      invoicesOverdue: bool(input.invoicesOverdue, DEFAULT_SETTINGS.invoicesOverdue),
      digestHour,
    },
  };
}

/** Lokales Datum (YYYY-MM-DD) und Stunde in einer Zeitzone. Reine Funktion. */
export function localClock(now, timeZone) {
  let zone = timeZone || DEFAULT_TIME_ZONE;
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(now);
  } catch {
    zone = DEFAULT_TIME_ZONE;
    parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(now);
  }
  const get = type => parts.find(part => part.type === type)?.value || '00';
  const hour = Number(get('hour')) % 24;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour, timeZone: zone };
}

/**
 * Entscheidet, ob für eine Einstellungszeile jetzt gesendet wird. Reine Funktion.
 * @returns {'send'|'too_early'|'already_sent'|'disabled'}
 */
export function digestDecision(settings, { day, hour }) {
  const active = settings.jobs_completed || settings.invoice_drafts || settings.invoices_overdue;
  if (!active) return 'disabled';
  const lastDay = settings.last_digest_day ? String(settings.last_digest_day).slice(0, 10) : null;
  if (lastDay === day) return 'already_sent';
  if (hour < Number(settings.digest_hour)) return 'too_early';
  return 'send';
}

function formatAmount(value, locale = 'de-DE', currency = 'EUR') {
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(value) || 0); } catch { return `${Number(value).toFixed(2)} ${currency}`; }
}

function formatDay(value, locale = 'de-DE', timeZone = DEFAULT_TIME_ZONE) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  try { return new Intl.DateTimeFormat(locale, { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(date); } catch { return date.toISOString().slice(0, 10); }
}

function daysSince(value, now) {
  const date = value instanceof Date ? value : new Date(value);
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}

/**
 * Sammelt die offenen Punkte eines Workspace. Muss im Workspace-Kontext laufen.
 * @returns {Promise<{sections: object[], total: number}>}
 */
export async function collectDigestSections({ settings, appUrl, now = new Date(), locale = 'de-DE', currency = 'EUR', timeZone = DEFAULT_TIME_ZONE }) {
  const sections = [];
  const link = hash => `${appUrl}/#${hash}`;

  if (settings.jobs_completed) {
    const [rows, count] = await Promise.all([
      query(`
        SELECT j.id, j.job_number, j.title, j.date, j.hours_worked, c.name AS customer_name
        FROM job_entries j LEFT JOIN customers c ON c.id = j.customer_id
        WHERE j.status = 'completed'
        ORDER BY j.date ASC, j.created_at ASC
        LIMIT $1
      `, [MAX_ITEMS_PER_SECTION]),
      query("SELECT COUNT(*)::int AS count FROM job_entries WHERE status = 'completed'"),
    ]);
    const total = Number(count.rows[0]?.count || 0);
    if (total > 0) {
      sections.push({
        key: 'jobs_completed',
        title: 'Abgeschlossene Aufträge ohne Rechnung',
        count: total,
        intro: 'Diese Aufträge sind erledigt – die Rechnung kann erstellt werden.',
        items: rows.rows.map(job => ({
          title: [job.job_number, job.title].filter(Boolean).join(' · ') || 'Auftrag',
          subtitle: [job.customer_name, job.date ? `vom ${formatDay(job.date, locale, timeZone)}` : null].filter(Boolean).join(' · '),
          meta: Number(job.hours_worked) > 0 ? `${Number(job.hours_worked).toLocaleString(locale, { maximumFractionDigits: 2 })} Std.` : undefined,
          url: link('jobs'),
        })),
        more: total > rows.rows.length ? `… und ${total - rows.rows.length} weitere. Alle Aufträge: ${link('jobs')}` : undefined,
      });
    }
  }

  if (settings.invoice_drafts) {
    const days = Number(settings.invoice_draft_days || DEFAULT_SETTINGS.invoiceDraftDays);
    const [rows, count] = await Promise.all([
      query(`
        SELECT id, invoice_number, customer_name, total, created_at
        FROM invoices
        WHERE document_type = 'invoice' AND status = 'draft' AND created_at <= NOW() - ($1::int * INTERVAL '1 day')
        ORDER BY created_at ASC
        LIMIT $2
      `, [days, MAX_ITEMS_PER_SECTION]),
      query("SELECT COUNT(*)::int AS count FROM invoices WHERE document_type = 'invoice' AND status = 'draft' AND created_at <= NOW() - ($1::int * INTERVAL '1 day')", [days]),
    ]);
    const total = Number(count.rows[0]?.count || 0);
    if (total > 0) {
      sections.push({
        key: 'invoice_drafts',
        title: 'Rechnungsentwürfe, die noch nicht versendet wurden',
        count: total,
        intro: `Seit mindestens ${days} ${days === 1 ? 'Tag' : 'Tagen'} als Entwurf gespeichert.`,
        items: rows.rows.map(invoice => ({
          title: invoice.invoice_number || 'Entwurf',
          subtitle: `${invoice.customer_name || 'Kunde'} · erstellt vor ${daysSince(invoice.created_at, now)} Tagen`,
          meta: formatAmount(invoice.total, locale, currency),
          url: link(`invoices/draft//${invoice.id}`),
        })),
        more: total > rows.rows.length ? `… und ${total - rows.rows.length} weitere. Alle Entwürfe: ${link('invoices/draft')}` : undefined,
      });
    }
  }

  if (settings.invoices_overdue) {
    const [rows, count] = await Promise.all([
      query(`
        SELECT id, invoice_number, customer_name, total, due_date, status
        FROM invoices
        WHERE document_type = 'invoice' AND status IN ('sent','overdue','reminded_1x','reminded_2x','reminded_3x') AND due_date < CURRENT_DATE
        ORDER BY due_date ASC
        LIMIT $1
      `, [MAX_ITEMS_PER_SECTION]),
      query("SELECT COUNT(*)::int AS count FROM invoices WHERE document_type = 'invoice' AND status IN ('sent','overdue','reminded_1x','reminded_2x','reminded_3x') AND due_date < CURRENT_DATE"),
    ]);
    const total = Number(count.rows[0]?.count || 0);
    if (total > 0) {
      sections.push({
        key: 'invoices_overdue',
        title: 'Überfällige Rechnungen',
        count: total,
        intro: 'Zahlungsziel überschritten – Zahlungseingang prüfen oder Erinnerung senden.',
        items: rows.rows.map(invoice => ({
          title: invoice.invoice_number || 'Rechnung',
          subtitle: `${invoice.customer_name || 'Kunde'} · fällig seit ${formatDay(invoice.due_date, locale, timeZone)}${invoice.status.startsWith('reminded') ? ` · ${invoice.status.replace('reminded_', '')} gemahnt` : ''}`,
          meta: formatAmount(invoice.total, locale, currency),
          url: link(`invoices/not-paid//${invoice.id}`),
        })),
        more: total > rows.rows.length ? `… und ${total - rows.rows.length} weitere. Offene Rechnungen: ${link('invoices/not-paid')}` : undefined,
      });
    }
  }

  return { sections, total: sections.reduce((sum, section) => sum + section.count, 0) };
}

function appBaseUrl(env = process.env) {
  return (env.APP_BASE_URL || env.CORS_ORIGIN?.split(',')[0] || '').trim().replace(/\/$/, '');
}

async function loadCandidates() {
  const result = await query(`
    SELECT s.*, u.email, u.first_name, u.last_name, w.name AS workspace_name, w.suspended_at
    FROM user_notification_settings s
    JOIN users u ON u.id = s.user_id AND u.is_active = TRUE
    JOIN workspaces w ON w.id = s.workspace_id
    JOIN workspace_members wm ON wm.workspace_id = s.workspace_id AND wm.user_id = s.user_id
    WHERE (s.jobs_completed OR s.invoice_drafts OR s.invoices_overdue)
    ORDER BY s.workspace_id, s.user_id
  `);
  return result.rows;
}

async function companyContext(workspaceId) {
  return runWithRequestContext({ workspaceId }, async () => {
    const result = await query('SELECT time_zone, locale, currency FROM company LIMIT 1').catch(() => ({ rows: [] }));
    const row = result.rows[0] || {};
    return { timeZone: row.time_zone || DEFAULT_TIME_ZONE, locale: row.locale || 'de-DE', currency: row.currency || 'EUR' };
  });
}

async function markDigest({ userId, workspaceId, day, sent, error }) {
  await query(`
    UPDATE user_notification_settings
    SET last_digest_day = $3::date,
        last_digest_at = CASE WHEN $4::boolean THEN NOW() ELSE last_digest_at END,
        last_digest_error = $5,
        updated_at = NOW()
    WHERE user_id = $1 AND workspace_id = $2
  `, [userId, workspaceId, day, sent, error || null]);
}

/**
 * Baut und sendet die Zusammenfassung für eine Einstellungszeile.
 * @param {object} candidate Zeile aus loadCandidates()
 * @param {{now?: Date, force?: boolean, sendEmail?: Function}} options
 * @returns {Promise<{status: string, total?: number}>}
 */
export async function deliverDigest(candidate, { now = new Date(), force = false, sendEmail = sendSystemEmail, env = process.env } = {}) {
  const context = await companyContext(candidate.workspace_id);
  const clock = localClock(now, context.timeZone);
  const decision = force ? 'send' : digestDecision(candidate, clock);
  if (decision !== 'send') return { status: decision };
  if (candidate.suspended_at) {
    await markDigest({ userId: candidate.user_id, workspaceId: candidate.workspace_id, day: clock.day, sent: false, error: null });
    return { status: 'workspace_suspended' };
  }

  const appUrl = appBaseUrl(env);
  const { sections, total } = await runWithRequestContext({ workspaceId: candidate.workspace_id, userId: candidate.user_id }, () =>
    collectDigestSections({ settings: candidate, appUrl: appUrl || '', now, locale: context.locale, currency: context.currency, timeZone: context.timeZone }));

  if (total === 0) {
    if (!force) await markDigest({ userId: candidate.user_id, workspaceId: candidate.workspace_id, day: clock.day, sent: false, error: null });
    return { status: 'nothing_to_report', total: 0 };
  }

  const name = [candidate.first_name, candidate.last_name].filter(Boolean).join(' ');
  const mail = systemMails.digest({
    email: candidate.email,
    name,
    workspaceName: candidate.workspace_name,
    appUrl: appUrl || 'SoloOffice',
    sections,
    settingsUrl: `${appUrl}/#profile`,
    dateLabel: formatDay(now, context.locale, context.timeZone),
  });
  try {
    await sendEmail({ workspaceId: candidate.workspace_id, to: candidate.email, ...mail });
    if (!force) await markDigest({ userId: candidate.user_id, workspaceId: candidate.workspace_id, day: clock.day, sent: true, error: null });
    return { status: 'sent', total };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Wiedervorlage konnte nicht gesendet werden', { workspaceId: candidate.workspace_id, error: message });
    // Der Tag gilt als versucht; sonst würde jede Viertelstunde ein neuer
    // Versand scheitern und das Postfach-Relay fluten.
    if (!force) await markDigest({ userId: candidate.user_id, workspaceId: candidate.workspace_id, day: clock.day, sent: false, error: message.slice(0, 500) });
    throw error;
  }
}

/** Ein kompletter Lauf über alle aktiven Einstellungen. Wird vom Scheduler aufgerufen. */
export async function runNotificationDigest({ now = new Date(), sendEmail = sendSystemEmail } = {}) {
  const client = await pool.connect();
  const summary = { sent: 0, skipped: 0, failed: 0, locked: false };
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1::integer, $2::integer) AS locked', [LOCK_NAMESPACE, LOCK_ID]);
    if (!lock.rows[0]?.locked) { summary.locked = true; return summary; }
    let candidates = [];
    try { candidates = await loadCandidates(); } catch (error) {
      // Vor der Migration 041 existiert die Tabelle noch nicht – kein Grund, den Server zu stören.
      logger.warn('Benachrichtigungs-Einstellungen nicht lesbar', { error: error instanceof Error ? error.message : String(error) });
      return summary;
    }
    for (const candidate of candidates) {
      try {
        const result = await deliverDigest(candidate, { now, sendEmail });
        if (result.status === 'sent') summary.sent += 1; else summary.skipped += 1;
      } catch {
        summary.failed += 1;
      }
    }
    if (summary.sent || summary.failed) logger.info('Wiedervorlage-Lauf abgeschlossen', summary);
    return summary;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::integer, $2::integer)', [LOCK_NAMESPACE, LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
