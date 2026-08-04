import express from 'express';
import { query } from '../database.js';

const router = express.Router();

const entryTypes = new Set(['income', 'expense']);
const categories = new Set([
  'other_income', 'materials', 'office', 'software', 'telecommunications',
  'travel', 'vehicle', 'marketing', 'professional_services', 'insurance',
  'bank_fees', 'other_expense',
]);

function toEntry(row) {
  return {
    id: row.id,
    entryType: row.entry_type,
    entryDate: row.entry_date,
    description: row.description,
    category: row.category,
    amount: Number(row.amount),
    taxRate: Number(row.tax_rate),
    notes: row.notes || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateEntry(data) {
  const entryType = String(data.entryType || '');
  const entryDate = String(data.entryDate || '');
  const description = String(data.description || '').trim();
  const category = String(data.category || '');
  const amount = Number(data.amount);
  const taxRate = data.taxRate === undefined || data.taxRate === null || data.taxRate === '' ? 0 : Number(data.taxRate);

  if (!entryTypes.has(entryType)) return 'Ungültiger Buchungstyp.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || Number.isNaN(Date.parse(`${entryDate}T00:00:00Z`))) return 'Ungültiges Datum.';
  if (!description || description.length > 255) return 'Eine Beschreibung ist erforderlich und darf höchstens 255 Zeichen enthalten.';
  if (!categories.has(category)) return 'Ungültige Kategorie.';
  if (!Number.isFinite(amount) || amount < 0) return 'Der Betrag muss eine positive Zahl sein.';
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) return 'Der MwSt.-Satz muss zwischen 0 und 100 liegen.';

  return null;
}

router.get('/', async (req, res, next) => {
  try {
    const year = req.query.year ? Number(req.query.year) : null;
    const params = [];
    let where = '';
    if (year) {
      if (!Number.isInteger(year) || year < 2000 || year > 2100) return res.status(400).json({ error: 'Ungültiges Jahr.' });
      params.push(year);
      where = 'WHERE entry_date >= make_date($1, 1, 1) AND entry_date < make_date($1 + 1, 1, 1)';
    }

    const result = await query(`
      SELECT id, entry_type, entry_date, description, category, amount, tax_rate, notes, created_at, updated_at
      FROM euer_entries
      ${where}
      ORDER BY entry_date DESC, created_at DESC
    `, params);
    res.json(result.rows.map(toEntry));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const error = validateEntry(req.body);
    if (error) return res.status(400).json({ error });

    const { entryType, entryDate, description, category, amount, taxRate = 0, notes } = req.body;
    const result = await query(`
      INSERT INTO euer_entries (entry_type, entry_date, description, category, amount, tax_rate, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, entry_type, entry_date, description, category, amount, tax_rate, notes, created_at, updated_at
    `, [entryType, entryDate, String(description).trim(), category, Number(amount), Number(taxRate), notes || null]);
    res.status(201).json(toEntry(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const currentResult = await query('SELECT * FROM euer_entries WHERE id = $1', [req.params.id]);
    if (currentResult.rows.length === 0) return res.status(404).json({ error: 'EÜR-Buchung nicht gefunden.' });

    const current = toEntry(currentResult.rows[0]);
    const merged = { ...current, ...req.body, entryDate: req.body.entryDate || String(current.entryDate).slice(0, 10) };
    const error = validateEntry(merged);
    if (error) return res.status(400).json({ error });

    const result = await query(`
      UPDATE euer_entries
      SET entry_type = $1, entry_date = $2, description = $3, category = $4, amount = $5, tax_rate = $6, notes = $7, updated_at = NOW()
      WHERE id = $8
      RETURNING id, entry_type, entry_date, description, category, amount, tax_rate, notes, created_at, updated_at
    `, [merged.entryType, merged.entryDate, String(merged.description).trim(), merged.category, Number(merged.amount), Number(merged.taxRate || 0), merged.notes || null, req.params.id]);
    res.json(toEntry(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await query('DELETE FROM euer_entries WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'EÜR-Buchung nicht gefunden.' });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
