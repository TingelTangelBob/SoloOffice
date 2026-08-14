import express from 'express';
import logger from '../utils/logger.js';
import { findAllInvoices, findInvoiceById } from '../queries/invoiceQueries.js';
import { createInvoice, updateInvoice, deleteInvoice } from '../services/invoiceService.js';
import { pool, query } from '../database.js';

const router = express.Router();

// Get all invoices
router.get('/', async (req, res) => {
  try {
    const invoices = await findAllInvoices();
    res.json(invoices);
  } catch (error) {
    logger.error('Failed to fetch invoices', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// Änderungsverlauf einer Rechnung. Muss vor '/:id' stehen, sonst greift die
// allgemeine Route.
router.get('/:id/history', async (req, res) => {
  try {
    const result = await query(`
      SELECT id, invoice_id, invoice_number, record_type, action, old_data, new_data, changed_at, changed_by
      FROM invoice_history
      WHERE invoice_id = $1
      ORDER BY changed_at DESC, id DESC
    `, [req.params.id]);

    res.json(result.rows.map(row => ({
      id: row.id,
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      recordType: row.record_type,
      action: row.action,
      oldData: row.old_data,
      newData: row.new_data,
      changedAt: row.changed_at,
      changedBy: row.changed_by,
    })));
  } catch (error) {
    logger.error('Failed to fetch invoice history', { error: error.message, invoiceId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch invoice history' });
  }
});

// Get invoice by ID
router.get('/:id', async (req, res) => {
  try {
    const invoice = await findInvoiceById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (error) {
    logger.error('Failed to fetch invoice', { error: error.message, invoiceId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// Create new invoice
router.post('/', async (req, res) => {
  try {
    const {
      customerId,
      items = [],
      notes = '',
      attachments = [],
      issueDate,
      dueDate,
      status = 'draft',
      globalDiscountType,
      globalDiscountValue,
      globalDiscountAmount,
      sourceQuoteId,
    } = req.body;
    const invoice = await createInvoice({ customerId, items, notes, attachments, issueDate, dueDate, status, globalDiscountType, globalDiscountValue, globalDiscountAmount, sourceQuoteId, documentType: 'invoice' });
    res.status(201).json(invoice);
  } catch (error) {
    logger.error('Failed to create invoice', {
      error: error.message,
      stack: error.stack,
      customerNumber: req.body.customerNumber,
      method: 'POST',
      endpoint: '/invoices'
    });
    if (error.statusCode === 400 || error.statusCode === 409) return res.status(error.statusCode).json({ error: error.message });
    if (error.message === 'Customer not found') return res.status(400).json({ error: error.message });
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// Create an invoice from completed job units in one transaction. The service
// stores the source relation and marks the units as invoiced before commit.
router.post('/from-jobs', async (req, res) => {
  try {
    const { sourceJobIds, ...invoiceData } = req.body || {};
    const invoice = await createInvoice({
      ...invoiceData,
      sourceJobIds,
      documentType: 'invoice',
    });
    res.status(201).json(invoice);
  } catch (error) {
    logger.error('Failed to create invoice from jobs', {
      error: error.message,
      stack: error.stack,
      sourceJobIds: req.body?.sourceJobIds,
      method: 'POST',
      endpoint: '/invoices/from-jobs',
    });
    if (error.statusCode === 400 || error.statusCode === 409) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    if (error.message === 'Customer not found') return res.status(400).json({ error: error.message });
    res.status(500).json({ error: 'Failed to create invoice from jobs' });
  }
});

// Zahlungseingang erfassen und die Rechnung bei vollständiger Zahlung
// innerhalb derselben Transaktion auf "bezahlt" setzen.
router.post('/:id/payments', async (req, res) => {
  const client = await pool.connect();
  try {
    const amount = Number(req.body?.amount);
    const entryDate = String(req.body?.entryDate || '');
    const notes = String(req.body?.notes || '').trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Der Zahlungsbetrag muss größer als 0 sein.' });
    }
    const parsedEntryDate = new Date(`${entryDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || Number.isNaN(parsedEntryDate.getTime()) || parsedEntryDate.toISOString().slice(0, 10) !== entryDate) {
      return res.status(400).json({ error: 'Ungültiges Zahlungsdatum.' });
    }
    if (notes.length > 500) {
      return res.status(400).json({ error: 'Die Notiz darf höchstens 500 Zeichen enthalten.' });
    }

    await client.query('BEGIN');
    const invoiceResult = await client.query(`
      SELECT id, invoice_number, document_type, status, subtotal, tax_amount, total
      FROM invoices
      WHERE id = $1
      FOR UPDATE
    `, [req.params.id]);
    const invoice = invoiceResult.rows[0];
    if (!invoice || (invoice.document_type && invoice.document_type !== 'invoice')) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Rechnung nicht gefunden.' });
    }
    if (invoice.status === 'draft') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Für einen Entwurf kann noch kein Zahlungseingang erfasst werden.' });
    }

    const paymentResult = await client.query(`
      SELECT COALESCE(SUM(amount), 0) AS amount
      FROM euer_entries
      WHERE source_type = 'invoice_payment' AND source_id = $1 AND status = 'active'
    `, [invoice.id]);
    const alreadyPaid = Number(paymentResult.rows[0]?.amount || 0);
    const remaining = Math.max(0, Number(invoice.total) - alreadyPaid);
    if (invoice.status === 'paid' || remaining < 0.005) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Die Rechnung ist bereits vollständig bezahlt.' });
    }
    if (amount > remaining + 0.005) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Der Zahlungsbetrag überschreitet den offenen Betrag von ${remaining.toFixed(2)} €.` });
    }

    const subtotal = Number(invoice.subtotal || 0);
    const taxRate = subtotal > 0 ? Number(invoice.tax_amount || 0) / subtotal * 100 : 0;
    const inserted = await client.query(`
      INSERT INTO euer_entries
        (entry_type, entry_date, description, category, amount, tax_rate, notes, source_type, source_id)
      VALUES ('income', $1, $2, 'other_income', $3, $4, $5, 'invoice_payment', $6)
      RETURNING id, entry_type, entry_date, description, category, amount, tax_rate, notes,
        source_type, source_id, status, correction_reason, created_at, updated_at
    `, [entryDate, `Zahlung Rechnung ${invoice.invoice_number}`, amount, taxRate, notes || null, invoice.id]);

    if (remaining - amount < 0.005) {
      await client.query("UPDATE invoices SET status = 'paid' WHERE id = $1", [invoice.id]);
    }
    await client.query('COMMIT');

    const row = inserted.rows[0];
    const updatedInvoice = await findInvoiceById(invoice.id);
    res.status(201).json({
      payment: {
        id: row.id,
        entryType: row.entry_type,
        entryDate: row.entry_date,
        description: row.description,
        category: row.category,
        amount: Number(row.amount),
        taxRate: Number(row.tax_rate),
        notes: row.notes || undefined,
        sourceType: row.source_type,
        sourceId: row.source_id,
        status: row.status,
        correctionReason: row.correction_reason || undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      invoice: updatedInvoice,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Failed to record invoice payment', { error: error.message, invoiceId: req.params.id });
    res.status(500).json({ error: 'Zahlungseingang konnte nicht erfasst werden.' });
  } finally {
    client.release();
  }
});

// Update invoice
router.put('/:id', async (req, res) => {
  try {
    const invoice = await updateInvoice(req.params.id, req.body);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (error) {
    logger.error('Failed to update invoice', {
      error: error.message,
      stack: error.stack,
      invoiceId: req.params.id,
      method: 'PUT',
      endpoint: '/invoices/:id'
    });
    if (error.statusCode === 400 || error.statusCode === 409) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// Delete invoice
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await deleteInvoice(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    logger.error('Failed to delete invoice', {
      error: error.message,
      stack: error.stack,
      invoiceId: req.params.id,
      method: 'DELETE',
      endpoint: '/invoices/:id'
    });
    if (error.statusCode === 409) return res.status(409).json({ error: error.message });
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

export default router;
