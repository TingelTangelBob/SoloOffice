import express from 'express';
import logger from '../utils/logger.js';
import { findAllInvoices, findInvoiceById } from '../queries/invoiceQueries.js';
import { createInvoice, updateInvoice, deleteInvoice } from '../services/invoiceService.js';

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
    } = req.body;
    const invoice = await createInvoice({ customerId, items, notes, attachments, issueDate, dueDate, status, globalDiscountType, globalDiscountValue, globalDiscountAmount, documentType: 'invoice' });
    res.status(201).json(invoice);
  } catch (error) {
    logger.error('Failed to create invoice', {
      error: error.message,
      stack: error.stack,
      customerNumber: req.body.customerNumber,
      method: 'POST',
      endpoint: '/invoices'
    });
    if (error.statusCode === 400) return res.status(400).json({ error: error.message });
    if (error.message === 'Customer not found') return res.status(400).json({ error: error.message });
    res.status(500).json({ error: 'Failed to create invoice' });
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
    if (error.statusCode === 400) return res.status(400).json({ error: error.message });
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
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

export default router;
