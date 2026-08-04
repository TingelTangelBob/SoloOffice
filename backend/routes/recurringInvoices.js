import express from 'express';
import { pool } from '../database.js';
import logger from '../utils/logger.js';
import { createInvoice } from '../services/invoiceService.js';

const router = express.Router();
const frequencies = ['monthly', 'quarterly', 'semiannual', 'annual', 'custom'];
const units = ['day', 'week', 'month', 'year'];

function mapRecurring(row) {
  return {
    id: row.id, customerId: row.customer_id, customerName: row.customer_name, name: row.name,
    items: row.items || [], frequency: row.frequency, intervalValue: row.interval_value || 1,
    intervalUnit: row.interval_unit || 'month', startDate: row.start_date, endDate: row.end_date,
    nextRunDate: row.next_run_date, lastRunDate: row.last_run_date, dueDays: row.due_days,
    notes: row.notes, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function nextRunDate(date, recurring) {
  const next = new Date(`${date}T00:00:00Z`);
  let value = recurring.interval_value;
  let unit = recurring.interval_unit;
  if (recurring.frequency === 'monthly') { value = 1; unit = 'month'; }
  if (recurring.frequency === 'quarterly') { value = 3; unit = 'month'; }
  if (recurring.frequency === 'semiannual') { value = 6; unit = 'month'; }
  if (recurring.frequency === 'annual') { value = 1; unit = 'year'; }
  if (unit === 'day') next.setUTCDate(next.getUTCDate() + value);
  if (unit === 'week') next.setUTCDate(next.getUTCDate() + value * 7);
  if (unit === 'month') next.setUTCMonth(next.getUTCMonth() + value);
  if (unit === 'year') next.setUTCFullYear(next.getUTCFullYear() + value);
  return next.toISOString().slice(0, 10);
}

function validateRecurring(body) {
  if (!body.customerId || !body.name || !Array.isArray(body.items) || body.items.length === 0 || !frequencies.includes(body.frequency)) return 'customerId, name, items and a valid frequency are required';
  if (body.frequency === 'custom' && (!Number.isInteger(body.intervalValue) || body.intervalValue <= 0 || !units.includes(body.intervalUnit))) return 'Custom frequency requires a positive intervalValue and valid intervalUnit';
  return null;
}

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`SELECT r.*, c.name AS customer_name FROM recurring_invoices r JOIN customers c ON c.id = r.customer_id ORDER BY r.created_at DESC`);
    res.json(result.rows.map(mapRecurring));
  } catch (error) {
    logger.error('Failed to fetch recurring invoices', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch recurring invoices' });
  }
});

router.get('/:id/runs', async (req, res) => {
  try {
    const result = await pool.query(`SELECT r.id, r.status, r.scheduled_date, r.generated_invoice_id, i.invoice_number, r.error, r.created_at FROM recurring_invoice_runs r LEFT JOIN invoices i ON i.id = r.generated_invoice_id WHERE r.recurring_invoice_id = $1 ORDER BY r.scheduled_date DESC, r.created_at DESC`, [req.params.id]);
    res.json(result.rows.map(row => ({ id: row.id, status: row.status, scheduledDate: row.scheduled_date, generatedInvoiceId: row.generated_invoice_id, invoiceNumber: row.invoice_number, error: row.error, createdAt: row.created_at })));
  } catch (error) {
    logger.error('Failed to fetch recurring invoice runs', { error: error.message, recurringInvoiceId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch recurring invoice runs' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(`SELECT r.*, c.name AS customer_name FROM recurring_invoices r JOIN customers c ON c.id = r.customer_id WHERE r.id = $1`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Recurring invoice not found' });
    res.json(mapRecurring(result.rows[0]));
  } catch (error) {
    logger.error('Failed to fetch recurring invoice', { error: error.message, recurringInvoiceId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch recurring invoice' });
  }
});

router.post('/', async (req, res) => {
  try {
    const validationError = validateRecurring(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    const customer = await pool.query('SELECT id FROM customers WHERE id = $1', [req.body.customerId]);
    if (!customer.rows.length) return res.status(400).json({ error: 'Customer not found' });
    const startDate = req.body.startDate || new Date().toISOString().slice(0, 10);
    const result = await pool.query(`INSERT INTO recurring_invoices (customer_id, name, items, frequency, interval_value, interval_unit, start_date, end_date, next_run_date, due_days, notes, status) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`, [req.body.customerId, req.body.name, JSON.stringify(req.body.items), req.body.frequency, req.body.intervalValue || null, req.body.intervalUnit || null, startDate, req.body.endDate || null, req.body.nextRunDate || startDate, req.body.dueDays ?? 30, req.body.notes || null, req.body.status || 'active']);
    const row = await pool.query(`SELECT r.*, c.name AS customer_name FROM recurring_invoices r JOIN customers c ON c.id = r.customer_id WHERE r.id = $1`, [result.rows[0].id]);
    res.status(201).json(mapRecurring(row.rows[0]));
  } catch (error) {
    logger.error('Failed to create recurring invoice', { error: error.message, stack: error.stack });
    if (error.code === '23503') return res.status(400).json({ error: 'Customer not found' });
    res.status(500).json({ error: 'Failed to create recurring invoice' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const fields = ['customerId', 'name', 'items', 'frequency', 'intervalValue', 'intervalUnit', 'startDate', 'endDate', 'nextRunDate', 'dueDays', 'notes', 'status'];
    const columns = { customerId: 'customer_id', name: 'name', items: 'items', frequency: 'frequency', intervalValue: 'interval_value', intervalUnit: 'interval_unit', startDate: 'start_date', endDate: 'end_date', nextRunDate: 'next_run_date', dueDays: 'due_days', notes: 'notes', status: 'status' };
    const values = fields.filter(field => req.body[field] !== undefined);
    if (!values.length) return res.status(400).json({ error: 'No fields to update' });
    if (req.body.customerId) {
      const customer = await pool.query('SELECT id FROM customers WHERE id = $1', [req.body.customerId]);
      if (!customer.rows.length) return res.status(400).json({ error: 'Customer not found' });
    }
    const params = values.map(field => field === 'items' ? JSON.stringify(req.body[field]) : req.body[field]);
    const set = values.map((field, index) => `${columns[field]} = $${index + 1}${field === 'items' ? '::jsonb' : ''}`).join(', ');
    params.push(req.params.id);
    const result = await pool.query(`UPDATE recurring_invoices SET ${set}, updated_at = NOW() WHERE id = $${params.length} RETURNING id`, params);
    if (!result.rows.length) return res.status(404).json({ error: 'Recurring invoice not found' });
    const row = await pool.query(`SELECT r.*, c.name AS customer_name FROM recurring_invoices r JOIN customers c ON c.id = r.customer_id WHERE r.id = $1`, [req.params.id]);
    res.json(mapRecurring(row.rows[0]));
  } catch (error) {
    logger.error('Failed to update recurring invoice', { error: error.message, recurringInvoiceId: req.params.id });
    res.status(500).json({ error: 'Failed to update recurring invoice' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM recurring_invoices WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Recurring invoice not found' });
    res.json({ message: 'Recurring invoice deleted successfully' });
  } catch (error) {
    logger.error('Failed to delete recurring invoice', { error: error.message, recurringInvoiceId: req.params.id });
    res.status(500).json({ error: 'Failed to delete recurring invoice' });
  }
});

router.post('/:id/generate', async (req, res) => {
  let recurring;
  try {
    const result = await pool.query('SELECT * FROM recurring_invoices WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Recurring invoice not found' });
    recurring = result.rows[0];
    if (recurring.status !== 'active') return res.status(400).json({ error: 'Recurring invoice is not active' });
    if (recurring.end_date && recurring.next_run_date > recurring.end_date) return res.status(400).json({ error: 'Recurring invoice has ended' });

    const scheduledDate = req.body.scheduledDate || recurring.next_run_date;
    const dueDate = new Date(`${scheduledDate}T00:00:00Z`);
    dueDate.setUTCDate(dueDate.getUTCDate() + recurring.due_days);
    const invoice = await createInvoice({ customerId: recurring.customer_id, items: recurring.items, notes: recurring.notes || '', issueDate: scheduledDate, dueDate: dueDate.toISOString().slice(0, 10), status: 'draft', recurringInvoiceId: recurring.id });
    const nextDate = nextRunDate(scheduledDate, recurring);
    const ended = recurring.end_date && nextDate > recurring.end_date;
    await pool.query('UPDATE recurring_invoices SET last_run_date = $1, next_run_date = $2, status = $3, updated_at = NOW() WHERE id = $4', [scheduledDate, nextDate, ended ? 'ended' : 'active', recurring.id]);
    await pool.query('INSERT INTO recurring_invoice_runs (recurring_invoice_id, status, scheduled_date, generated_invoice_id) VALUES ($1, $2, $3, $4)', [recurring.id, 'success', scheduledDate, invoice.id]);
    res.status(201).json(invoice);
  } catch (error) {
    logger.error('Failed to generate recurring invoice', { error: error.message, recurringInvoiceId: req.params.id, stack: error.stack });
    if (recurring) await pool.query('INSERT INTO recurring_invoice_runs (recurring_invoice_id, status, scheduled_date, error) VALUES ($1, $2, $3, $4)', [recurring.id, 'failure', recurring.next_run_date, error.message]).catch(runError => logger.error('Failed to record recurring invoice failure', { error: runError.message }));
    if (error.statusCode === 400 || error.message === 'Customer not found') return res.status(400).json({ error: error.message });
    res.status(500).json({ error: 'Failed to generate recurring invoice' });
  }
});

export default router;
