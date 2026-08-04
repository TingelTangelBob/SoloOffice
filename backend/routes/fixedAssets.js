import express from 'express';
import { query } from '../database.js';

const router = express.Router();
const statuses = new Set(['active', 'disposed']);

function toAsset(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    acquisitionDate: row.acquisition_date,
    acquisitionCost: Number(row.acquisition_cost),
    usefulLifeYears: Number(row.useful_life_years),
    status: row.status,
    disposalDate: row.disposal_date || undefined,
    notes: row.notes || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateAsset(data) {
  const name = String(data.name || '').trim();
  const category = String(data.category || '').trim();
  const acquisitionDate = String(data.acquisitionDate || '');
  const acquisitionCost = Number(data.acquisitionCost);
  const usefulLifeYears = Number(data.usefulLifeYears);
  const status = String(data.status || 'active');
  const disposalDate = data.disposalDate ? String(data.disposalDate) : '';

  if (!name || name.length > 255) return 'Eine Bezeichnung ist erforderlich und darf höchstens 255 Zeichen enthalten.';
  if (!category || category.length > 80) return 'Eine Kategorie ist erforderlich und darf höchstens 80 Zeichen enthalten.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(acquisitionDate) || Number.isNaN(Date.parse(`${acquisitionDate}T00:00:00Z`))) return 'Ungültiges Anschaffungsdatum.';
  if (!Number.isFinite(acquisitionCost) || acquisitionCost < 0) return 'Die Anschaffungskosten müssen eine positive Zahl sein.';
  if (!Number.isFinite(usefulLifeYears) || usefulLifeYears <= 0 || usefulLifeYears > 100) return 'Die Nutzungsdauer muss zwischen 0 und 100 Jahren liegen.';
  if (!statuses.has(status)) return 'Ungültiger Anlagenstatus.';
  if (disposalDate && (!/^\d{4}-\d{2}-\d{2}$/.test(disposalDate) || disposalDate < acquisitionDate)) return 'Das Abgangsdatum muss nach dem Anschaffungsdatum liegen.';
  if (status === 'disposed' && !disposalDate) return 'Für abgegangene Anlagen ist ein Abgangsdatum erforderlich.';
  return null;
}

const columns = `id, name, category, acquisition_date, acquisition_cost, useful_life_years,
  status, disposal_date, notes, created_at, updated_at`;

router.get('/', async (req, res, next) => {
  try {
    const result = await query(`SELECT ${columns} FROM fixed_assets ORDER BY acquisition_date DESC, created_at DESC`);
    res.json(result.rows.map(toAsset));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const error = validateAsset(req.body);
    if (error) return res.status(400).json({ error });
    const { name, category, acquisitionDate, acquisitionCost, usefulLifeYears, status = 'active', disposalDate, notes } = req.body;
    const result = await query(`
      INSERT INTO fixed_assets (name, category, acquisition_date, acquisition_cost, useful_life_years, status, disposal_date, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING ${columns}
    `, [String(name).trim(), String(category).trim(), acquisitionDate, Number(acquisitionCost), Number(usefulLifeYears), status, disposalDate || null, notes || null]);
    res.status(201).json(toAsset(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const currentResult = await query(`SELECT ${columns} FROM fixed_assets WHERE id = $1`, [req.params.id]);
    if (currentResult.rows.length === 0) return res.status(404).json({ error: 'Anlage nicht gefunden.' });
    const current = toAsset(currentResult.rows[0]);
    const merged = { ...current, ...req.body };
    const error = validateAsset(merged);
    if (error) return res.status(400).json({ error });
    const result = await query(`
      UPDATE fixed_assets
      SET name = $1, category = $2, acquisition_date = $3, acquisition_cost = $4,
          useful_life_years = $5, status = $6, disposal_date = $7, notes = $8, updated_at = NOW()
      WHERE id = $9
      RETURNING ${columns}
    `, [String(merged.name).trim(), String(merged.category).trim(), merged.acquisitionDate, Number(merged.acquisitionCost), Number(merged.usefulLifeYears), merged.status, merged.disposalDate || null, merged.notes || null, req.params.id]);
    res.json(toAsset(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await query('DELETE FROM fixed_assets WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Anlage nicht gefunden.' });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
