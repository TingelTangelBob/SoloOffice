import express from 'express';
import { query } from '../database.js';
import { decodeBase64Content, runLocalOcr } from '../services/ocrService.js';

const router = express.Router();
const MAX_RECEIPT_SIZE = 25 * 1024 * 1024;
const SUPPORTED_CONTENT_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const receiptFields = `
  id, name, content_type, size, ocr_status, ocr_text, ocr_confidence,
  ocr_error, extracted_data, linked_euer_entry_id, created_at, updated_at
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
  if (!SUPPORTED_CONTENT_TYPES.has(contentType)) return { error: 'Für die lokale OCR werden JPG-, PNG- oder WEBP-Bilder unterstützt.' };
  if (!Number.isInteger(size) || size <= 0 || size > MAX_RECEIPT_SIZE) return { error: 'Der Beleg darf höchstens 25 MB groß sein.' };

  let buffer;
  try {
    buffer = decodeBase64Content(data?.content);
  } catch (error) {
    return { error: error.message };
  }
  if (buffer.length > MAX_RECEIPT_SIZE) return { error: 'Der Beleg darf höchstens 25 MB groß sein.' };
  return { name, contentType, size: buffer.length, buffer };
}

async function findReceipt(id, includeContent = false) {
  const result = await query(`SELECT ${includeContent ? 'content,' : ''} ${receiptFields} FROM receipts WHERE id = $1`, [id]);
  return result.rows[0];
}

async function ensureEuerEntryExists(id) {
  if (!id) return true;
  if (!UUID_PATTERN.test(String(id))) return false;
  const result = await query('SELECT id FROM euer_entries WHERE id = $1', [id]);
  return result.rows.length > 0;
}

async function saveOcrResult(receipt, ocrResult) {
  return query(`
    UPDATE receipts
    SET ocr_status = $1,
        ocr_text = $2,
        ocr_confidence = $3,
        ocr_error = $4,
        extracted_data = $5,
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
        ocr_confidence, ocr_error, extracted_data
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
    if (req.body.linkedEuerEntryId !== undefined) {
      if (req.body.linkedEuerEntryId !== null && !(await ensureEuerEntryExists(req.body.linkedEuerEntryId))) {
        return res.status(400).json({ error: 'Die EÜR-Buchung wurde nicht gefunden.' });
      }
      updates.push(`linked_euer_entry_id = $${parameterIndex++}`);
      values.push(req.body.linkedEuerEntryId);
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

router.post('/:id/link-euer', async (req, res, next) => {
  try {
    const receipt = await findReceipt(req.params.id);
    if (!receipt) return res.status(404).json({ error: 'Beleg nicht gefunden.' });
    const euerEntryId = req.body?.euerEntryId;
    if (!euerEntryId || !(await ensureEuerEntryExists(euerEntryId))) {
      return res.status(400).json({ error: 'Eine gültige EÜR-Buchung ist erforderlich.' });
    }

    const result = await query(`
      UPDATE receipts
      SET linked_euer_entry_id = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING ${receiptFields}
    `, [euerEntryId, req.params.id]);
    res.json(toReceipt(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await query('DELETE FROM receipts WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Beleg nicht gefunden.' });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
