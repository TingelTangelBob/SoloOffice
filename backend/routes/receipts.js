import express from 'express';
import { pool, query } from '../database.js';
import { decodeBase64Content, runLocalOcr } from '../services/ocrService.js';

const router = express.Router();
const MAX_RECEIPT_SIZE = 25 * 1024 * 1024;
const SUPPORTED_CONTENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const receiptFields = `
  id, name, content_type, size, ocr_status, ocr_text, ocr_confidence,
  ocr_error, extracted_data, ocr_extracted_data, linked_euer_entry_id, created_at, updated_at
`;

function toReceipt(row, includeContent = false) {
  return {
    id: row.id,
    name: row.name,
    ...(includeContent ? { content: row.content } : {}),
    contentType: row.content_type,
    size: Number(row.size),
    ocrStatus: row.ocr_status,
    ocrText: row.ocr_text || undefined,
    ocrConfidence: row.ocr_confidence === null || row.ocr_confidence === undefined ? undefined : Number(row.ocr_confidence),
    ocrError: row.ocr_error || undefined,
    extractedData: row.extracted_data || {},
    ocrExtractedData: row.ocr_extracted_data || row.extracted_data || {},
    linkedEuerEntryId: row.linked_euer_entry_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateUpload(data) {
  const name = String(data?.name || '').trim();
  const contentType = String(data?.contentType || '').toLowerCase();
  const size = Number(data?.size);

  if (!name || name.length > 255) return { error: 'Der Dateiname ist erforderlich und darf höchstens 255 Zeichen enthalten.' };
  if (!SUPPORTED_CONTENT_TYPES.has(contentType)) return { error: 'Für die lokale Belegerkennung werden PDF-, JPG-, PNG- oder WEBP-Dateien unterstützt.' };
  if (!Number.isInteger(size) || size <= 0 || size > MAX_RECEIPT_SIZE) return { error: 'Der Beleg darf höchstens 25 MB groß sein.' };

  let buffer;
  try {
    buffer = decodeBase64Content(data?.content);
  } catch (error) {
    return { error: error.message };
  }
  if (buffer.length > MAX_RECEIPT_SIZE) return { error: 'Der Beleg darf höchstens 25 MB groß sein.' };
  if (contentType === 'application/pdf' && buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    return { error: 'Die ausgewählte PDF-Datei ist ungültig.' };
  }
  return { name, contentType, size: buffer.length, buffer };
}

async function findReceipt(id, includeContent = false) {
  const result = await query(`SELECT ${includeContent ? 'content,' : ''} ${receiptFields} FROM receipts WHERE id = $1`, [id]);
  return result.rows[0];
}

async function saveOcrResult(receipt, ocrResult) {
  return query(`
    UPDATE receipts
    SET ocr_status = $1,
        ocr_text = $2,
        ocr_confidence = $3,
        ocr_error = $4,
        extracted_data = $5,
        ocr_extracted_data = $5,
        updated_at = NOW()
    WHERE id = $6
    RETURNING ${receiptFields}
  `, [
    ocrResult.status,
    ocrResult.text || null,
    ocrResult.confidence ?? null,
    ocrResult.error || null,
    JSON.stringify(ocrResult.extractedData || {}),
    receipt.id,
  ]);
}

router.get('/', async (req, res, next) => {
  try {
    const result = await query(`SELECT ${receiptFields} FROM receipts ORDER BY created_at DESC`);
    res.json(result.rows.map(row => toReceipt(row)));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const validated = validateUpload(req.body);
    if (validated.error) return res.status(400).json({ error: validated.error });

    let ocrResult;
    try {
      const result = await runLocalOcr({
        content: req.body.content,
        contentType: validated.contentType,
        name: validated.name,
      });
      ocrResult = { ...result, status: 'completed' };
    } catch (error) {
      ocrResult = {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Lokales OCR ist fehlgeschlagen.',
        extractedData: {},
      };
    }

    const result = await query(`
      INSERT INTO receipts (
        name, content, content_type, size, ocr_status, ocr_text,
        ocr_confidence, ocr_error, extracted_data, ocr_extracted_data
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
      RETURNING ${receiptFields}
    `, [
      validated.name,
      req.body.content.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, ''),
      validated.contentType,
      validated.size,
      ocrResult.status,
      ocrResult.text || null,
      ocrResult.confidence ?? null,
      ocrResult.error || null,
      JSON.stringify(ocrResult.extractedData || {}),
    ]);

    res.status(201).json(toReceipt(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const receipt = await findReceipt(req.params.id, true);
    if (!receipt) return res.status(404).json({ error: 'Beleg nicht gefunden.' });
    res.json(toReceipt(receipt, true));
  } catch (error) {
    next(error);
  }
});

router.post('/:id/ocr', async (req, res, next) => {
  try {
    const receipt = await findReceipt(req.params.id, true);
    if (!receipt) return res.status(404).json({ error: 'Beleg nicht gefunden.' });

    try {
      const result = await runLocalOcr({ content: receipt.content, contentType: receipt.content_type, name: receipt.name });
      const updated = await saveOcrResult(receipt, { ...result, status: 'completed' });
      return res.json(toReceipt(updated.rows[0]));
    } catch (error) {
      const updated = await saveOcrResult(receipt, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Lokales OCR ist fehlgeschlagen.',
        extractedData: {},
      });
      return res.json(toReceipt(updated.rows[0]));
    }
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const current = await findReceipt(req.params.id);
    if (!current) return res.status(404).json({ error: 'Beleg nicht gefunden.' });

    const updates = [];
    const values = [];
    let parameterIndex = 1;

    if (req.body.extractedData !== undefined) {
      if (!req.body.extractedData || typeof req.body.extractedData !== 'object' || Array.isArray(req.body.extractedData)) {
        return res.status(400).json({ error: 'extractedData muss ein Objekt sein.' });
      }
      updates.push(`extracted_data = $${parameterIndex++}`);
      values.push(JSON.stringify(req.body.extractedData));
    }
    if (req.body.ocrText !== undefined) {
      if (typeof req.body.ocrText !== 'string' || req.body.ocrText.length > 8 * 1024 * 1024) {
        return res.status(400).json({ error: 'Der OCR-Text ist ungültig oder zu groß.' });
      }
      updates.push(`ocr_text = $${parameterIndex++}`);
      values.push(req.body.ocrText);
    }
    if (req.body.linkedEuerEntryId !== undefined && req.body.linkedEuerEntryId !== current.linked_euer_entry_id) {
      return res.status(409).json({ error: 'EÜR-Verknüpfungen werden über den EÜR-/Beleg-Workflow geändert.' });
    }

    if (!updates.length) return res.json(toReceipt(current));
    values.push(req.params.id);
    const result = await query(`
      UPDATE receipts
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${parameterIndex}
      RETURNING ${receiptFields}
    `, values);
    res.json(toReceipt(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.post('/:id/create-euer', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const receiptResult = await client.query(`SELECT ${receiptFields} FROM receipts WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!receiptResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Beleg nicht gefunden.' });
    }
    const receipt = receiptResult.rows[0];
    if (receipt.linked_euer_entry_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Der Beleg ist bereits mit einer EÜR-Buchung verknüpft.' });
    }
    const existingEntryResult = await client.query(`
      SELECT id
      FROM euer_entries
      WHERE source_type = 'receipt' AND source_id = $1 AND status = 'active'
      LIMIT 1
    `, [req.params.id]);
    if (existingEntryResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Der Beleg ist bereits mit einer aktiven EÜR-Buchung verknüpft.' });
    }

    const entryType = String(req.body?.entryType || 'expense');
    const entryDate = String(req.body?.entryDate || '');
    const description = String(req.body?.description || '').trim();
    const category = String(req.body?.category || 'other_expense');
    const amount = Number(req.body?.amount);
    const taxRate = req.body?.taxRate === undefined || req.body?.taxRate === null || req.body?.taxRate === '' ? 0 : Number(req.body.taxRate);
    const validCategories = new Set([
      'other_income', 'materials', 'office', 'software', 'telecommunications',
      'travel', 'vehicle', 'marketing', 'professional_services', 'insurance',
      'bank_fees', 'other_expense',
    ]);
    if (entryType !== 'expense' || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || Number.isNaN(Date.parse(`${entryDate}T00:00:00Z`))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ungültige EÜR-Buchungsdaten.' });
    }
    if (!description || description.length > 255 || !validCategories.has(category) || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Bitte Beschreibung, Kategorie, Betrag und MwSt.-Satz prüfen.' });
    }

    const entryResult = await client.query(`
      INSERT INTO euer_entries
        (entry_type, entry_date, description, category, amount, tax_rate, notes, source_type, source_id, correction_reason)
      VALUES ('expense', $1, $2, $3, $4, $5, $6, 'receipt', $7, NULL)
      RETURNING id, entry_type, entry_date, description, category, amount, tax_rate, notes, source_type, source_id, status, correction_reason, created_at, updated_at
    `, [
      entryDate,
      description,
      category,
      amount,
      taxRate,
      req.body?.notes ? String(req.body.notes).slice(0, 2000) : null,
      req.params.id,
    ]);
    const entry = entryResult.rows[0];
    const linkedReceiptResult = await client.query(`
      UPDATE receipts
      SET linked_euer_entry_id = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING ${receiptFields}
    `, [entry.id, req.params.id]);
    await client.query('COMMIT');

    res.status(201).json({
      entry: {
        id: entry.id,
        entryType: entry.entry_type,
        entryDate: entry.entry_date,
        description: entry.description,
        category: entry.category,
        amount: Number(entry.amount),
        taxRate: Number(entry.tax_rate),
        notes: entry.notes || undefined,
        sourceType: entry.source_type,
        sourceId: entry.source_id || undefined,
        status: entry.status,
        correctionReason: entry.correction_reason || undefined,
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
      },
      receipt: toReceipt(linkedReceiptResult.rows[0]),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.post('/:id/link-euer', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const receiptResult = await client.query(`SELECT ${receiptFields} FROM receipts WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!receiptResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Beleg nicht gefunden.' });
    }
    const receipt = receiptResult.rows[0];
    const euerEntryId = req.body?.euerEntryId;
    if (!euerEntryId || !UUID_PATTERN.test(String(euerEntryId))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Eine gültige EÜR-Buchung ist erforderlich.' });
    }

    const entryResult = await client.query('SELECT source_type, source_id, status FROM euer_entries WHERE id = $1', [euerEntryId]);
    const entry = entryResult.rows[0];
    if (!entry || entry.status !== 'active' || entry.source_type !== 'receipt' || entry.source_id !== req.params.id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Die EÜR-Buchung gehört nicht zu diesem Beleg.' });
    }
    if (receipt.linked_euer_entry_id && receipt.linked_euer_entry_id !== euerEntryId) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Der Beleg ist bereits mit einer anderen EÜR-Buchung verknüpft.' });
    }

    const result = await client.query(`
      UPDATE receipts
      SET linked_euer_entry_id = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING ${receiptFields}
    `, [euerEntryId, req.params.id]);
    await client.query('COMMIT');
    res.json(toReceipt(result.rows[0]));
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const linked = await query('SELECT linked_euer_entry_id FROM receipts WHERE id = $1', [req.params.id]);
    if (linked.rows[0]?.linked_euer_entry_id) {
      return res.status(409).json({ error: 'Der Beleg ist mit einer EÜR-Buchung verknüpft. Bitte die Buchung zuerst stornieren.' });
    }
    const result = await query('DELETE FROM receipts WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Beleg nicht gefunden.' });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
