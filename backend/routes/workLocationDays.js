import express from 'express';
import { query } from '../database.js';
import { hasPermission } from '../middleware/auth.js';
import { assertDateOnly } from '../shared/recurrence.js';

const router = express.Router();
const dayTypes = new Set(['home_majority', 'home_no_other_workspace']);

function parseDate(value, label = 'Datum') {
  try { return assertDateOnly(String(value || ''), label); }
  catch { return null; }
}

function mapDay(row) {
  return {
    date: assertDateOnly(row.work_date),
    dayType: row.day_type,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function todayInTimeZone(timeZone = 'Europe/Berlin') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function workspaceToday() {
  const result = await query('SELECT time_zone FROM company LIMIT 1');
  try { return todayInTimeZone(result.rows[0]?.time_zone || 'Europe/Berlin'); }
  catch { return todayInTimeZone('Europe/Berlin'); }
}

function canWrite(req, res) {
  if (hasPermission(req.auth, 'data.write')) return true;
  res.status(403).json({ error: 'Für diese Aktion fehlt die Schreibberechtigung.', code: 'FORBIDDEN' });
  return false;
}

router.get('/', async (req, res, next) => {
  const fromDate = parseDate(req.query.from, 'Startdatum');
  const toDate = parseDate(req.query.to, 'Enddatum');
  if (!fromDate || !toDate || fromDate > toDate) {
    return res.status(400).json({ error: 'Bitte einen gültigen Zeitraum mit Start- und Enddatum angeben.' });
  }
  const days = (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000 + 1;
  if (days > 400) return res.status(400).json({ error: 'Der angefragte Zeitraum darf höchstens 400 Tage umfassen.' });

  try {
    const result = await query(`
      SELECT work_date, day_type, reviewed_at, created_at, updated_at
      FROM work_location_days
      WHERE work_date >= $1 AND work_date <= $2
      ORDER BY work_date
    `, [fromDate, toDate]);
    return res.json(result.rows.map(mapDay));
  } catch (error) { return next(error); }
});

router.post('/bulk', async (req, res, next) => {
  if (!canWrite(req, res)) return;
  const rawDates = req.body?.dates;
  const dayType = String(req.body?.dayType || '');
  if (!Array.isArray(rawDates) || rawDates.length < 1 || rawDates.length > 400) {
    return res.status(400).json({ error: 'Bitte zwischen 1 und 400 tatsächliche Arbeitstage auswählen.' });
  }
  if (!dayTypes.has(dayType)) return res.status(400).json({ error: 'Ungültige Tagesart.' });
  if (req.body?.reviewed !== true) {
    return res.status(400).json({ error: 'Bitte bestätige, dass du die ausgewählten Tage und die Tagesart geprüft hast.' });
  }

  const workDates = rawDates.map(value => parseDate(value));
  if (workDates.some(date => !date)) return res.status(400).json({ error: 'Die Auswahl enthält ein ungültiges Datum.' });
  if (new Set(workDates).size !== workDates.length) return res.status(400).json({ error: 'Ein Datum wurde mehrfach ausgewählt.' });

  try {
    const today = await workspaceToday();
    if (workDates.some(date => date > today)) {
      return res.status(400).json({ error: 'Zukünftige Arbeitstage können erst nach der tatsächlichen Tätigkeit erfasst werden.' });
    }
    const result = await query(`
      INSERT INTO work_location_days (work_date, day_type, reviewed_at)
      SELECT selected.work_date, $2, NOW()
      FROM unnest($1::date[]) AS selected(work_date)
      ON CONFLICT (workspace_id, work_date) DO NOTHING
      RETURNING work_date, day_type, reviewed_at, created_at, updated_at
    `, [workDates, dayType]);
    return res.json(result.rows.map(mapDay).sort((left, right) => left.date.localeCompare(right.date)));
  } catch (error) { return next(error); }
});

router.put('/:date', async (req, res, next) => {
  if (!canWrite(req, res)) return;
  const workDate = parseDate(req.params.date);
  const dayType = String(req.body?.dayType || '');
  if (!workDate) return res.status(400).json({ error: 'Ungültiges Datum.' });
  if (!dayTypes.has(dayType)) return res.status(400).json({ error: 'Ungültige Tagesart.' });
  if (req.body?.reviewed !== true) return res.status(400).json({ error: 'Bitte bestätige, dass du die tatsächliche Arbeitssituation korrekt erfasst hast.' });

  try {
    if (workDate > await workspaceToday()) return res.status(400).json({ error: 'Ein Arbeitstag kann erst nach der tatsächlichen Tätigkeit erfasst werden.' });
    const result = await query(`
      INSERT INTO work_location_days (work_date, day_type, reviewed_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (workspace_id, work_date)
      DO UPDATE SET day_type = EXCLUDED.day_type, reviewed_at = NOW(), updated_at = NOW()
      RETURNING work_date, day_type, reviewed_at, created_at, updated_at
    `, [workDate, dayType]);
    return res.json(mapDay(result.rows[0]));
  } catch (error) { return next(error); }
});

router.delete('/:date', async (req, res, next) => {
  if (!canWrite(req, res)) return;
  const workDate = parseDate(req.params.date);
  if (!workDate) return res.status(400).json({ error: 'Ungültiges Datum.' });
  try {
    const result = await query('DELETE FROM work_location_days WHERE work_date = $1 RETURNING work_date', [workDate]);
    if (!result.rowCount) return res.status(404).json({ error: 'Für diesen Tag ist kein Arbeitsort-Merkmal gespeichert.' });
    return res.status(204).send();
  } catch (error) { return next(error); }
});

export default router;
