import express from 'express';
import logger from '../utils/logger.js';
import { findAllInvoices, findInvoiceById } from '../queries/invoiceQueries.js';
import { createInvoice, updateInvoice, deleteInvoice } from '../services/invoiceService.js';
import { pool, query } from '../database.js';

const router = express.Router();
const INVOICE_STATUSES = new Set(['draft', 'sent', 'paid', 'overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVOICE_STATUS_BATCH_SIZE = 100;

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
      invoiceNumber,
      items = [],
      notes = '',
      attachments = [],
      issueDate,
      dueDate,
      serviceDate,
      status = 'draft',
      globalDiscountType,
      globalDiscountValue,
      globalDiscountAmount,
      sourceQuoteId,
    } = req.body;
    const invoice = await createInvoice({ invoiceNumber, customerId, items, notes, attachments, issueDate, dueDate, serviceDate, status, globalDiscountType, globalDiscountValue, globalDiscountAmount, sourceQuoteId, documentType: 'invoice' });
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

// Mehrere Rechnungsstatus in wenigen, kurzen Transaktionen ändern. Die
// Vorprüfung bleibt fachlich vollständig; die eigentliche Änderung läuft in
// Batches, damit große Auswahlen weder ein einzelnes Lock-/Timeout-Fenster
// noch hunderte API-Anfragen erzeugen.
router.patch('/bulk-status', async (req, res) => {
  const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = [...new Set(rawIds.filter((id) => typeof id === 'string').map((id) => id.trim()))];
  const status = typeof req.body?.status === 'string' ? req.body.status : '';

  if (ids.length === 0 || ids.length > 1000 || ids.some((id) => !UUID_PATTERN.test(id))) {
    return res.status(400).json({ error: 'Ungültige Rechnungsauswahl.' });
  }
  if (!INVOICE_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Ungültiger Rechnungsstatus.' });
  }

  const client = await pool.connect();
  try {
    // Vorprüfung ohne Sperre/Transaktion — Batches bekommen eigene kurze Transaktionen.
    const currentResult = await client.query(
      `SELECT id, status, document_type
       FROM invoices
       WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    const currentInvoices = currentResult.rows;
    const currentIds = new Set(currentInvoices.map((invoice) => invoice.id));
    const missingIds = ids.filter((id) => !currentIds.has(id));
    if (missingIds.length > 0) {
      return res.status(404).json({ error: 'Mindestens eine Rechnung wurde nicht gefunden.', missingIds });
    }

    const creditNoteIds = currentInvoices
      .filter((invoice) => invoice.document_type === 'credit_note')
      .map((invoice) => invoice.id);
    if (creditNoteIds.length > 0) {
      return res.status(400).json({ error: 'Gutschriften müssen separat verwaltet werden.', creditNoteIds });
    }

    const draftDowngradeIds = currentInvoices
      .filter((invoice) => invoice.status !== 'draft' && status === 'draft')
      .map((invoice) => invoice.id);
    if (draftDowngradeIds.length > 0) {
      return res.status(409).json({
        error: 'Ausgestellte Rechnungen können nicht wieder zu Entwürfen zurückgesetzt werden.',
        draftDowngradeIds,
      });
    }

    const updatedIds = [];
    const failedIds = [];
    const failures = [];
    for (let offset = 0; offset < ids.length; offset += INVOICE_STATUS_BATCH_SIZE) {
      const batchIds = ids.slice(offset, offset + INVOICE_STATUS_BATCH_SIZE);
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `UPDATE invoices
           SET status = $1
           WHERE id = ANY($2::uuid[])
           RETURNING id`,
          [status, batchIds],
        );
        await client.query('COMMIT');
        updatedIds.push(...result.rows.map((row) => row.id));
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        failedIds.push(...batchIds);
        failures.push({ ids: batchIds, message: 'Dieser Teil der Auswahl konnte nicht aktualisiert werden.' });
        logger.error('Invoice status batch failed', {
          error: error.message,
          count: batchIds.length,
          offset,
        });
      }
    }

    const partial = failedIds.length > 0;
    res.status(partial ? 207 : 200).json({
      message: partial
        ? `${updatedIds.length} Rechnungen aktualisiert, ${failedIds.length} konnten nicht aktualisiert werden.`
        : `${updatedIds.length} Rechnungen erfolgreich aktualisiert.`,
      updatedIds,
      failedIds,
      failures,
      partial,
      updatedAt: null,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error('Error updating invoice statuses in bulk:', error);
    res.status(500).json({ error: 'Die Statusänderung konnte nicht abgeschlossen werden.' });
  } finally {
    client.release();
  }
});

// Mehrere Zahlungseingänge in einer Transaktion erfassen. Die Bündelung ist
// wichtig, damit eine größere Auswahl nicht in hunderten Einzelanfragen an
// das Rate-Limit läuft und die Rechnungsliste nicht nach jedem Eintrag neu
// geladen werden muss.
router.post('/bulk-payments', async (req, res) => {
  const rawPayments = Array.isArray(req.body?.payments) ? req.body.payments : [];
  if (rawPayments.length === 0 || rawPayments.length > 1000) {
    return res.status(400).json({ error: 'Bitte zwischen 1 und 1000 Zahlungen auswählen.' });
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const seenIds = new Set();
  const payments = [];
  for (const item of rawPayments) {
    const invoiceId = typeof item?.invoiceId === 'string' ? item.invoiceId.trim() : '';
    const amount = Number(item?.amount);
    const amountCents = Math.round(amount * 100);
    const entryDate = typeof item?.entryDate === 'string' ? item.entryDate : '';
    const notes = typeof item?.notes === 'string' ? item.notes.trim() : '';
    const parsedEntryDate = new Date(`${entryDate}T00:00:00Z`);

    if (!uuidPattern.test(invoiceId) || seenIds.has(invoiceId)) {
      return res.status(400).json({ error: 'Die Rechnungsauswahl enthält ungültige oder doppelte Einträge.' });
    }
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(amountCents) || Math.abs(amount * 100 - amountCents) > 0.00001) {
      return res.status(400).json({ error: 'Der Zahlungsbetrag muss größer als 0 sein und darf höchstens zwei Nachkommastellen haben.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || Number.isNaN(parsedEntryDate.getTime()) || parsedEntryDate.toISOString().slice(0, 10) !== entryDate) {
      return res.status(400).json({ error: 'Mindestens ein Zahlungsdatum ist ungültig.' });
    }
    if (notes.length > 500) {
      return res.status(400).json({ error: 'Die Notiz darf höchstens 500 Zeichen enthalten.' });
    }

    seenIds.add(invoiceId);
    payments.push({ invoiceId, amount, amountCents, entryDate, notes });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invoiceResult = await client.query(`
      SELECT id, invoice_number, document_type, status, subtotal, tax_amount, total
      FROM invoices
      WHERE id = ANY($1::uuid[])
      FOR UPDATE
    `, [[...seenIds]]);
    const invoicesById = new Map(invoiceResult.rows.map(invoice => [invoice.id, invoice]));
    const missingId = payments.find(payment => !invoicesById.has(payment.invoiceId));
    if (missingId) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Mindestens eine Rechnung wurde nicht gefunden.' });
    }

    const paidResult = await client.query(`
      SELECT source_id, COALESCE(SUM(amount), 0) AS amount
      FROM euer_entries
      WHERE source_type = 'invoice_payment' AND source_id = ANY($1::uuid[]) AND status = 'active'
      GROUP BY source_id
    `, [[...seenIds]]);
    const paidByInvoice = new Map(paidResult.rows.map(row => [row.source_id, Number(row.amount || 0)]));
    const prepared = [];

    for (const payment of payments) {
      const invoice = invoicesById.get(payment.invoiceId);
      if (invoice.document_type && invoice.document_type !== 'invoice') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Die Auswahl enthält keine normale Rechnung (${invoice.invoice_number}).` });
      }
      if (invoice.status === 'draft') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Für den Entwurf ${invoice.invoice_number} kann noch kein Zahlungseingang erfasst werden.` });
      }

      const alreadyPaidCents = Math.round((paidByInvoice.get(payment.invoiceId) || 0) * 100);
      const remainingCents = Math.max(0, Math.round(Number(invoice.total) * 100) - alreadyPaidCents);
      if (invoice.status === 'paid' || remainingCents === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Die Rechnung ${invoice.invoice_number} ist bereits vollständig bezahlt.` });
      }
      if (payment.amountCents > remainingCents) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Der Zahlungsbetrag für ${invoice.invoice_number} überschreitet den offenen Betrag von ${(remainingCents / 100).toFixed(2)} €.` });
      }

      const taxableNet = Number(invoice.total) - Number(invoice.tax_amount || 0);
      const taxRate = taxableNet > 0 ? Number(invoice.tax_amount || 0) / taxableNet * 100 : 0;
      prepared.push({
        ...payment,
        invoiceNumber: invoice.invoice_number,
        taxRate,
        isFullyPaid: payment.amountCents === remainingCents,
      });
    }

    const values = [];
    const parameters = [];
    prepared.forEach((payment, index) => {
      const offset = index * 6;
      values.push(`($${offset + 1}, $${offset + 2}, 'income', $${offset + 3}, 'other_income', $${offset + 4}, $${offset + 5}, 'invoice_payment', $${offset + 6})`);
      parameters.push(
        payment.entryDate,
        `Zahlung Rechnung ${payment.invoiceNumber}`,
        payment.amountCents / 100,
        payment.taxRate,
        payment.notes || null,
        payment.invoiceId,
      );
    });
    await client.query(`
      INSERT INTO euer_entries
        (entry_date, description, entry_type, amount, category, tax_rate, notes, source_type, source_id)
      VALUES ${values.join(', ')}
    `, parameters);

    const paidIds = prepared.filter(payment => payment.isFullyPaid).map(payment => payment.invoiceId);
    if (paidIds.length > 0) {
      await client.query("UPDATE invoices SET status = 'paid' WHERE id = ANY($1::uuid[])", [paidIds]);
    }
    await client.query('COMMIT');

    res.status(201).json({
      processed: prepared.length,
      totalAmount: prepared.reduce((sum, payment) => sum + payment.amountCents / 100, 0),
      invoiceIds: prepared.map(payment => payment.invoiceId),
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Failed to record bulk invoice payments', { error: error.message, count: payments.length });
    res.status(500).json({ error: 'Zahlungseingänge konnten nicht gesammelt erfasst werden.' });
  } finally {
    client.release();
  }
});

// Zahlungseingang erfassen und die Rechnung bei vollständiger Zahlung
// innerhalb derselben Transaktion auf "bezahlt" setzen.
router.post('/:id/payments', async (req, res) => {
  const client = await pool.connect();
  try {
    const amount = Number(req.body?.amount);
    const amountCents = Math.round(amount * 100);
    const entryDate = String(req.body?.entryDate || '');
    const notes = String(req.body?.notes || '').trim();

    if (!['number', 'string'].includes(typeof req.body?.amount) || !Number.isFinite(amount) || amount <= 0
        || !Number.isSafeInteger(amountCents) || Math.abs(amount * 100 - amountCents) > 0.00001) {
      return res.status(400).json({ error: 'Der Zahlungsbetrag muss größer als 0 sein und darf höchstens zwei Nachkommastellen haben.' });
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
    const remainingCents = Math.max(0, Math.round(Number(invoice.total) * 100) - Math.round(alreadyPaid * 100));
    const remaining = remainingCents / 100;
    if (invoice.status === 'paid' || remainingCents === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Die Rechnung ist bereits vollständig bezahlt.' });
    }
    if (amountCents > remainingCents) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Der Zahlungsbetrag überschreitet den offenen Betrag von ${remaining.toFixed(2)} €.` });
    }

    const taxableNet = Number(invoice.total) - Number(invoice.tax_amount || 0);
    const taxRate = taxableNet > 0 ? Number(invoice.tax_amount || 0) / taxableNet * 100 : 0;
    const inserted = await client.query(`
      INSERT INTO euer_entries
        (entry_type, entry_date, description, category, amount, tax_rate, notes, source_type, source_id)
      VALUES ('income', $1, $2, 'other_income', $3, $4, $5, 'invoice_payment', $6)
      RETURNING id, entry_type, entry_date, description, category, amount, tax_rate, notes,
        source_type, source_id, status, correction_reason, created_at, updated_at
    `, [entryDate, `Zahlung Rechnung ${invoice.invoice_number}`, amountCents / 100, taxRate, notes || null, invoice.id]);

    if (remainingCents === amountCents) {
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
