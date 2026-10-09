import express from 'express';
import { query } from '../database.js';
import { hasPermission } from '../middleware/auth.js';
import { requireExtension } from '../middleware/extensions.js';
import { assertDateOnly } from '../shared/recurrence.js';

const router = express.Router();
const types = new Set(['kv','pv','rv','av','ksk','est_vz','gewst_vz','ust']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function access(req, res) {
  if (!hasPermission(req.auth, 'workspace.settings')) {
    res.status(403).json({ error: 'Nur Administratoren dürfen private Abgaben öffnen.', code: 'FORBIDDEN' });
    return false;
  }
  return true;
}

export function mapPayment(row) {
  const date = value => value == null ? null : value instanceof Date ? assertDateOnly(value) : String(value).slice(0, 10);
  const periodStart = date(row.period_start);
  return { id: row.id, kind: row.levy_type, year: Number(periodStart.slice(0, 4)), period: periodStart.slice(0, 7),
    dueDate: date(row.due_date) || '', paidOn: date(row.paid_on), amount: Number(row.amount), source: row.source,
    expenseRunId: row.recurring_expense_run_id || null, notes: row.notes || '' };
}

export function validate(body) {
  const levyType = body.kind || body.levyType;
  if (!types.has(String(levyType))) return 'Ungültige Abgabenart.';
  if (levyType === 'ust') return 'Umsatzsteuer-Zahlungen werden über den Bereich Umsatzsteuer erfasst.';
  if (body.source === 'recurring_expense') return 'Fixkostenläufe werden ausschließlich über die Laufbestätigung verknüpft.';
  if (body.source !== undefined && !['notice','manual'].includes(body.source)) return 'Ungültige Zahlungsquelle.';
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) return 'Der Betrag muss mindestens 0 € betragen.';
  try {
    const year = Number(body.year);
    const period = String(body.period || '');
    let periodStartValue = body.periodStart;
    if (!periodStartValue) {
      if (!Number.isInteger(year) || year < 2000 || year > 2200) return 'Ungültiges Jahr.';
      const periodMatch = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(period);
      if (periodMatch && Number(periodMatch[1]) !== year) return 'Jahr und Zeitraum passen nicht zusammen.';
      if (periodMatch?.[3]) assertDateOnly(period, 'Zeitraum');
      const month = periodMatch?.[2] || (/^(0?[1-9]|1[0-2])$/.test(period) ? period.padStart(2,'0') : null);
      if (!month) return 'Der Zeitraum muss als Monat im Format JJJJ-MM angegeben werden.';
      periodStartValue = `${year}-${month}-01`;
    }
    const periodStart = assertDateOnly(periodStartValue, 'Zeitraumbeginn');
    if (body.year !== undefined && Number(periodStart.slice(0, 4)) !== year) return 'Jahr und Zeitraum passen nicht zusammen.';
    const periodEnd = body.periodEnd ? assertDateOnly(body.periodEnd, 'Zeitraumende') : null;
    const dueDate = body.dueDate ? assertDateOnly(body.dueDate, 'Fälligkeit') : null;
    const paidOn = body.paidOn ? assertDateOnly(body.paidOn, 'Zahlungsdatum') : null;
    if (periodEnd && periodEnd < periodStart) return 'Das Zeitraumende darf nicht vor dem Beginn liegen.';
    if (body.recurringExpenseRunId) return 'Fixkostenläufe werden ausschließlich über die Laufbestätigung verknüpft.';
    return { levyType, periodStart, periodEnd, dueDate, paidOn, amount, source: ['notice','manual'].includes(body.source) ? body.source : 'manual', recurringExpenseRunId: null, notes: String(body.notes || '').trim() || null };
  } catch (error) { return error.message; }
}

router.use(requireExtension('taxes'));
router.use(async (req, res, next) => {
  try { if (await access(req, res)) next(); } catch (error) { next(error); }
});

router.get('/', async (req, res, next) => {
  try {
    const values = [];
    let where = '';
    if (req.query.year !== undefined) {
      const year = Number(req.query.year);
      if (!Number.isInteger(year) || year < 2000 || year > 2200) return res.status(400).json({ error: 'Ungültiges Jahr.' });
      values.push(year);
      where = 'WHERE period_start >= make_date($1,1,1) AND period_start < make_date($1+1,1,1)';
    }
    const result = await query(`SELECT * FROM levy_payments ${where} ORDER BY due_date NULLS LAST,period_start`, values);
    res.json(result.rows.map(mapPayment));
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const value = validate(req.body || {});
    if (typeof value === 'string') return res.status(400).json({ error: value });
    const result = await query(`INSERT INTO levy_payments (levy_type,period_start,period_end,due_date,paid_on,amount,source,recurring_expense_run_id,notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [value.levyType,value.periodStart,value.periodEnd,value.dueDate,value.paidOn,value.amount,value.source,value.recurringExpenseRunId,value.notes]);
    res.status(201).json(mapPayment(result.rows[0]));
  } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => {
  try {
    if (!uuidPattern.test(String(req.params.id || ''))) return res.status(400).json({ error: 'Ungültige Abgaben-ID.' });
    const current = await query('SELECT * FROM levy_payments WHERE id=$1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Abgabenzahlung nicht gefunden.' });
    const old = current.rows[0];
    if (old.levy_type === 'ust') return res.status(400).json({ error: 'Umsatzsteuer-Zahlungen werden über den Bereich Umsatzsteuer bearbeitet.' });
    if (old.recurring_expense_run_id) return res.status(409).json({ error: 'Zahlungen aus Fixkostenläufen werden an der Vorlage verwaltet.' });
    const canonicalPeriodChanged = req.body?.period !== undefined || req.body?.year !== undefined;
    const oldPeriod = mapPayment(old);
    const value = validate({ kind: req.body?.kind ?? old.levy_type,
      year: req.body?.year ?? oldPeriod.year,
      period: canonicalPeriodChanged ? (req.body?.period ?? `${req.body.year}-${oldPeriod.period.slice(5, 7)}`) : undefined,
      periodStart: req.body?.periodStart ?? (canonicalPeriodChanged ? undefined : oldPeriod.period + '-01'),
      periodEnd: req.body?.periodEnd !== undefined ? req.body.periodEnd : old.period_end, dueDate: req.body?.dueDate !== undefined ? req.body.dueDate : old.due_date,
      paidOn: req.body?.paidOn !== undefined ? req.body.paidOn : old.paid_on, amount: req.body?.amount ?? old.amount,
      source: req.body?.source ?? old.source, notes: req.body?.notes !== undefined ? req.body.notes : old.notes });
    if (typeof value === 'string') return res.status(400).json({ error: value });
    const result = await query(`UPDATE levy_payments SET levy_type=$1,period_start=$2,period_end=$3,due_date=$4,paid_on=$5,amount=$6,source=$7,notes=$8,updated_at=NOW() WHERE id=$9 RETURNING *`, [value.levyType,value.periodStart,value.periodEnd,value.dueDate,value.paidOn,value.amount,value.source,value.notes,req.params.id]);
    res.json(mapPayment(result.rows[0]));
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!uuidPattern.test(String(req.params.id || ''))) return res.status(400).json({ error: 'Ungültige Abgaben-ID.' });
    const result = await query('DELETE FROM levy_payments WHERE id=$1 AND recurring_expense_run_id IS NULL RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Abgabenzahlung nicht gefunden oder aus einem Fixkostenlauf erstellt.' });
    res.json({ deleted: true });
  } catch (error) { next(error); }
});

export default router;
