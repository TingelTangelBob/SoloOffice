import express from 'express';
import logger from '../utils/logger.js';
import { pool } from '../database.js';
import { findAllCreditNotes, findInvoiceById } from '../queries/invoiceQueries.js';
import { createInvoice, updateInvoice } from '../services/invoiceService.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    res.json(await findAllCreditNotes());
  } catch (error) {
    logger.error('Failed to fetch credit notes', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch credit notes' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const creditNote = await findInvoiceById(req.params.id);
    if (!creditNote || creditNote.documentType !== 'credit_note') return res.status(404).json({ error: 'Credit note not found' });
    res.json(creditNote);
  } catch (error) {
    logger.error('Failed to fetch credit note', { error: error.message, creditNoteId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch credit note' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { customerId, referenceInvoiceId, creditNoteReason, ...data } = req.body;
    if (!customerId) return res.status(400).json({ error: 'customerId is required' });
    if (!creditNoteReason || !String(creditNoteReason).trim()) return res.status(400).json({ error: 'creditNoteReason is required' });
    if (!Array.isArray(data.items) || data.items.length === 0 || data.items.some(item => !item.description || Number(item.quantity) <= 0 || Number(item.unitPrice) <= 0 || Number(item.taxRate) < 0)) {
      return res.status(400).json({ error: 'At least one valid credit note item is required' });
    }

    if (referenceInvoiceId) {
      const reference = await findInvoiceById(referenceInvoiceId);
      if (!reference || reference.documentType !== 'invoice') return res.status(400).json({ error: 'Reference invoice not found' });
      if (reference.customerId !== customerId) return res.status(400).json({ error: 'Reference invoice belongs to another customer' });
    }

    const creditNote = await createInvoice({ ...data, customerId, referenceInvoiceId, creditNoteReason, documentType: 'credit_note' });
    res.status(201).json(creditNote);
  } catch (error) {
    logger.error('Failed to create credit note', { error: error.message, stack: error.stack });
    if (error.statusCode === 400 || error.message === 'Customer not found') return res.status(400).json({ error: error.message });
    res.status(500).json({ error: 'Failed to create credit note' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const existing = await findInvoiceById(req.params.id);
    if (!existing || existing.documentType !== 'credit_note') return res.status(404).json({ error: 'Credit note not found' });
    const editableFields = ['customerId', 'referenceInvoiceId', 'creditNoteReason', 'issueDate', 'dueDate', 'items', 'notes', 'status'];
    const hasUnexpectedField = Object.keys(req.body).some(field => !editableFields.includes(field));
    if (hasUnexpectedField) return res.status(400).json({ error: 'Unsupported credit note field' });
    const isContentUpdate = ['customerId', 'referenceInvoiceId', 'creditNoteReason', 'issueDate', 'dueDate', 'items'].some(field => req.body[field] !== undefined);
    if (isContentUpdate && existing.status !== 'draft') return res.status(400).json({ error: 'Only draft credit notes can be edited' });

    let referenceInvoiceId = req.body.referenceInvoiceId !== undefined ? req.body.referenceInvoiceId : existing.referenceInvoiceId;
    if (referenceInvoiceId) {
      const reference = await findInvoiceById(referenceInvoiceId);
      if (!reference || reference.documentType !== 'invoice') return res.status(400).json({ error: 'Reference invoice not found' });
      const customerId = req.body.customerId || existing.customerId;
      if (reference.customerId !== customerId) return res.status(400).json({ error: 'Reference invoice belongs to another customer' });
    } else {
      referenceInvoiceId = null;
    }

    const creditNoteReason = req.body.creditNoteReason !== undefined ? String(req.body.creditNoteReason).trim() : existing.creditNoteReason;
    if (isContentUpdate && !creditNoteReason) return res.status(400).json({ error: 'creditNoteReason is required' });
    const items = req.body.items;
    if (req.body.items !== undefined && (!Array.isArray(items) || items.length === 0 || items.some(item => !item.description || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 || !Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) <= 0 || !Number.isFinite(Number(item.taxRate)) || Number(item.taxRate) < 0))) {
      return res.status(400).json({ error: 'At least one valid credit note item is required' });
    }

    const normalizedItems = Array.isArray(items) ? items.map(item => ({
      ...item,
      unitPrice: -Math.abs(Number(item.unitPrice)),
      discountAmount: item.discountAmount === undefined ? item.discountAmount : -Math.abs(Number(item.discountAmount)),
    })) : undefined;
    const updated = await updateInvoice(req.params.id, {
      customerId: req.body.customerId,
      referenceInvoiceId,
      creditNoteReason,
      issueDate: req.body.issueDate,
      dueDate: req.body.dueDate,
      items: normalizedItems,
      status: req.body.status,
      notes: req.body.notes,
    });
    res.json(updated);
  } catch (error) {
    logger.error('Failed to update credit note', { error: error.message, creditNoteId: req.params.id });
    if (error.statusCode === 400) return res.status(400).json({ error: error.message });
    res.status(500).json({ error: 'Failed to update credit note' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM invoices WHERE id = $1 AND document_type = 'credit_note' AND status = 'draft' RETURNING id", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Credit note not found' });
    res.json({ message: 'Credit note deleted successfully' });
  } catch (error) {
    logger.error('Failed to delete credit note', { error: error.message, creditNoteId: req.params.id });
    res.status(500).json({ error: 'Failed to delete credit note' });
  }
});

export default router;
