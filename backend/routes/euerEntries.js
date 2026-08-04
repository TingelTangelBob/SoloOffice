import express from 'express';
import { query } from '../database.js';

const router = express.Router();

const entryTypes = new Set(['income', 'expense']);
const sourceTypes = new Set(['manual', 'invoice_payment', 'receipt', 'correction']);
const categories = new Set([
  'other_income', 'materials', 'office', 'software', 'telecommunications',
  'travel', 'vehicle', 'marketing', 'professional_services', 'insurance',
  'bank_fees', 'other_expense',
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    sourceType: row.source_type || 'manual',
    sourceId: row.source_id || undefined,
    status: row.status || 'active',
    correctionReason: row.correction_reason || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toHistory(row) {
  return {
    id: row.id,
    euerEntryId: row.euer_entry_id || undefined,
    action: row.action,
    reason: row.reason || undefined,
    oldData: row.old_data || undefined,
    newData: row.new_data || undefined,
    changedAt: row.changed_at,
  };
}

function validateEntry(data) {
  const entryType = String(data.entryType || '');
  const entryDate = String(data.entryDate || '');
  const description = String(data.description || '').trim();
  const category = String(data.category || '');
  const sourceType = String(data.sourceType || 'manual');
  const sourceId = data.sourceId ? String(data.sourceId) : '';
  const amount = Number(data.amount);
  const taxRate = data.taxRate === undefined || data.taxRate === null || data.taxRate === '' ? 0 : Number(data.taxRate);

  if (!entryTypes.has(entryType)) return 'Ungültiger Buchungstyp.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || Number.isNaN(Date.parse(`${entryDate}T00:00:00Z`))) return 'Ungültiges Datum.';
  if (!description || description.length > 255) return 'Eine Beschreibung ist erforderlich und darf höchstens 255 Zeichen enthalten.';
  if (!categories.has(category)) return 'Ungültige Kategorie.';
  if (!Number.isFinite(amount) || amount < 0) return 'Der Betrag muss eine positive Zahl sein.';
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) return 'Der MwSt.-Satz muss zwischen 0 und 100 liegen.';
  if (!sourceTypes.has(sourceType)) return 'Ungültige Buchungsquelle.';
  if (sourceId && !uuidPattern.test(sourceId)) return 'Ungültige Quellenreferenz.';
  if (data.correctionReason && String(data.correctionReason).length > 500) return 'Der Korrekturgrund darf höchstens 500 Zeichen enthalten.';

  return null;
}

const entryColumns = `id, entry_type, entry_date, description, category, amount, tax_rate, notes,
  source_type, source_id, status, correction_reason, created_at, updated_at`;

router.get('/', async (req, res, next) => {
  try {
    const year = req.query.year ? Number(req.query.year) : null;
    const params = [];
    const conditions = ["status = 'active'"];
    if (year) {
      if (!Number.isInteger(year) || year < 2000 || year > 2100) return res.status(400).json({ error: 'Ungültiges Jahr.' });
      params.push(year);
      conditions.push('entry_date >= make_date($1, 1, 1) AND entry_date < make_date($1 + 1, 1, 1)');
    }

    const result = await query(`
      SELECT ${entryColumns}
      FROM euer_entries
      WHERE ${conditions.join(' AND ')}
      ORDER BY entry_date DESC, created_at DESC
    `, params);
    res.json(result.rows.map(toEntry));
  } catch (error) {
    next(error);
  }
});

router.get('/:id/history', async (req, res, next) => {
  try {
    const entryResult = await query('SELECT id FROM euer_entries WHERE id = $1', [req.params.id]);
    if (entryResult.rows.length === 0) return res.status(404).json({ error: 'EÜR-Buchung nicht gefunden.' });
    const result = await query(`
      SELECT id, euer_entry_id, action, reason, old_data, new_data, changed_at
      FROM euer_entry_history
      WHERE euer_entry_id = $1
      ORDER BY changed_at DESC
    `, [req.params.id]);
    res.json(result.rows.map(toHistory));
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(`SELECT ${entryColumns} FROM euer_entries WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'EÜR-Buchung nicht gefunden.' });
    res.json(toEntry(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const error = validateEntry(req.body);
    if (error) return res.status(400).json({ error });

    const {
      entryType, entryDate, description, category, amount, taxRate = 0, notes,
      sourceType = 'manual', sourceId, correctionReason,
    } = req.body;
    const result = await query(`
      INSERT INTO euer_entries
        (entry_type, entry_date, description, category, amount, tax_rate, notes, source_type, source_id, correction_reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING ${entryColumns}
    `, [
      entryType, entryDate, String(description).trim(), category, Number(amount), Number(taxRate),
      notes || null, sourceType, sourceId || null, correctionReason || null,
    ]);
    res.status(201).json(toEntry(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const currentResult = await query('SELECT * FROM euer_entries WHERE id = $1', [req.params.id]);
    if (currentResult.rows.length === 0) return res.status(404).json({ error: 'EÜR-Buchung nicht gefunden.' });
    const currentRow = currentResult.rows[0];
    if (currentRow.status === 'voided') return res.status(409).json({ error: 'Eine stornierte Buchung kann nicht bearbeitet werden.' });

    const current = toEntry(currentRow);
    const merged = {
      ...current,
      ...req.body,
      entryDate: req.body.entryDate || String(current.entryDate).slice(0, 10),
      sourceType: req.body.sourceType || current.sourceType || 'manual',
      sourceId: req.body.sourceId === '' ? undefined : (req.body.sourceId ?? current.sourceId),
    };
    const error = validateEntry(merged);
    if (error) return res.status(400).json({ error });

    const result = await query(`
      UPDATE euer_entries
      SET entry_type = $1, entry_date = $2, description = $3, category = $4, amount = $5,
          tax_rate = $6, notes = $7, source_type = $8, source_id = $9,
          correction_reason = $10, updated_at = NOW()
      WHERE id = $11 AND status = 'active'
      RETURNING ${entryColumns}
    `, [
      merged.entryType, merged.entryDate, String(merged.description).trim(), merged.category,
      Number(merged.amount), Number(merged.taxRate || 0), merged.notes || null,
      merged.sourceType, merged.sourceId || null, merged.correctionReason || null, req.params.id,
    ]);
    if (result.rows.length === 0) return res.status(409).json({ error: 'Die Buchung ist nicht mehr aktiv.' });
    res.json(toEntry(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const reason = String(req.body?.correctionReason || 'Stornierung').trim().slice(0, 500);
    const result = await query(`
      UPDATE euer_entries
      SET status = 'voided', correction_reason = $1, updated_at = NOW()
      WHERE id = $2 AND status = 'active'
    `, [reason || 'Stornierung', req.params.id]);
    if (result.rowCount === 0) {
      const existing = await query('SELECT id FROM euer_entries WHERE id = $1', [req.params.id]);
      return res.status(existing.rows.length ? 409 : 404).json({ error: existing.rows.length ? 'Die Buchung wurde bereits storniert.' : 'EÜR-Buchung nicht gefunden.' });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
