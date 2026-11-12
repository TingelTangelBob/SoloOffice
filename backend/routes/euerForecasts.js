import express from 'express';
import { pool, query } from '../database.js';
import { hasPermission } from '../middleware/auth.js';
import { assertDateOnly } from '../shared/recurrence.js';

const router = express.Router();
const categories = new Set(['operating_income','other_income','materials','office','software','telecommunications','travel','vehicle','marketing','professional_services','insurance','bank_fees','rent','memberships','allowance','other_expense']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const mapForecast = row => ({ id: row.id, entryType: row.entry_type, date: assertDateOnly(row.forecast_date), description: row.description,
  category: row.category || null, amount: Number(row.amount), createdAt: row.created_at, updatedAt: row.updated_at });
export function validateForecast(data) {
  const entryType = String(data.entryType || ''), description = String(data.description || '').trim();
  const category = data.category ? String(data.category) : null, amount = Number(data.amount);
  try { assertDateOnly(String(data.date || ''), 'Prognosedatum'); } catch (error) { return error.message; }
  if (!['income','expense'].includes(entryType)) return 'Ungültige Prognoseart.';
  if (!description || description.length > 255) return 'Eine Bezeichnung ist erforderlich und darf höchstens 255 Zeichen enthalten.';
  if (category !== null && !categories.has(category)) return 'Ungültige Kategorie.';
  if (!Number.isFinite(amount) || amount < 0) return 'Der Betrag muss eine positive Zahl sein.';
  return { entryType, date: String(data.date), description, category, amount };
}
function allowed(req, res) { if (hasPermission(req.auth, 'data.write')) return true; res.status(403).json({ error: 'Dafür fehlt die Berechtigung.', code: 'FORBIDDEN' }); return false; }

router.get('/', async (req, res, next) => {
  try {
    const year = Number(req.query.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2200) return res.status(400).json({ error: 'Ungültiges Jahr.' });
    const result = await query('SELECT * FROM euer_forecasts WHERE forecast_date >= make_date($1,1,1) AND forecast_date < make_date($1+1,1,1) ORDER BY forecast_date,description', [year]);
    res.json(result.rows.map(mapForecast));
  } catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  if (!allowed(req, res)) return;
  const value = validateForecast(req.body || {}); if (typeof value === 'string') return res.status(400).json({ error: value });
  try { const result = await query('INSERT INTO euer_forecasts (entry_type,forecast_date,description,category,amount) VALUES ($1,$2,$3,$4,$5) RETURNING *', [value.entryType,value.date,value.description,value.category,value.amount]); res.status(201).json(mapForecast(result.rows[0])); }
  catch (error) { next(error); }
});
router.put('/:id', async (req, res, next) => {
  if (!allowed(req, res)) return;
  if (!uuid.test(req.params.id)) return res.status(400).json({ error: 'Ungültige Prognose-ID.' });
  const value = validateForecast(req.body || {}); if (typeof value === 'string') return res.status(400).json({ error: value });
  try { const result = await query('UPDATE euer_forecasts SET entry_type=$1,forecast_date=$2,description=$3,category=$4,amount=$5,updated_at=NOW() WHERE id=$6 RETURNING *', [value.entryType,value.date,value.description,value.category,value.amount,req.params.id]); if (!result.rows.length) return res.status(404).json({ error: 'Prognose nicht gefunden.' }); res.json(mapForecast(result.rows[0])); }
  catch (error) { next(error); }
});
router.delete('/:id', async (req, res, next) => {
  if (!allowed(req, res)) return;
  if (!uuid.test(req.params.id)) return res.status(400).json({ error: 'Ungültige Prognose-ID.' });
  const client = await pool.connect();
  try { const result = await client.query('DELETE FROM euer_forecasts WHERE id=$1 RETURNING id', [req.params.id]); if (!result.rowCount) return res.status(404).json({ error: 'Prognose nicht gefunden.' }); res.json({ deleted: true }); }
  catch (error) { next(error); } finally { client.release(); }
});
export default router;
