import express from 'express';
import { pool } from '../database.js';
import logger from '../utils/logger.js';
import { createInvoice } from '../services/invoiceService.js';
import { findInvoiceById } from '../queries/invoiceQueries.js';

const router = express.Router();
const frequencies = ['monthly', 'quarterly', 'semiannual', 'annual', 'custom'];
const units = ['day', 'week', 'month', 'year'];
const statuses = ['active', 'paused', 'ended'];

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
  if (unit === 'month' || unit === 'year') {
    const day = next.getUTCDate();
    const sourceLastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    const preserveEndOfMonth = day === sourceLastDay;
    const targetMonth = next.getUTCMonth() + (unit === 'month' ? value : value * 12);
    next.setUTCDate(1);
    next.setUTCMonth(targetMonth);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(preserveEndOfMonth ? lastDay : Math.min(day, lastDay));
  }
  return next.toISOString().slice(0, 10);
}

function assertDateOnly(value, label) {
  const date = String(value || '');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    const error = new Error(`${label} ist ungültig.`);
    error.statusCode = 400;
    throw error;
  }
  return date;
}

function dateInput(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
}

function validateRecurring(body) {
  if (!body.customerId || !String(body.name || '').trim()) return 'Kunde und Name sind erforderlich.';
  if (!Array.isArray(body.items) || body.items.length === 0) return 'Mindestens eine Position ist erforderlich.';
  if (!frequencies.includes(body.frequency)) return 'Ungültige Häufigkeit.';
  if (!statuses.includes(body.status)) return 'Ungültiger Status.';

  const invalidItem = body.items.some(item => (
    !String(item?.description || '').trim()
    || !Number.isFinite(Number(item?.quantity))
    || Number(item.quantity) <= 0
    || !Number.isFinite(Number(item?.unitPrice))
    || Number(item.unitPrice) < 0
    || !Number.isFinite(Number(item?.taxRate))
    || Number(item.taxRate) < 0
    || Number(item.taxRate) > 100
  ));
  if (invalidItem) return 'Bitte prüfen Sie Beschreibung, Menge, Preis und MwSt.-Satz der Positionen.';

  if (body.frequency === 'custom' && (!Number.isInteger(Number(body.intervalValue)) || Number(body.intervalValue) <= 0 || !units.includes(body.intervalUnit))) {
    return 'Für ein benutzerdefiniertes Intervall sind eine positive Zahl und eine gültige Einheit erforderlich.';
  }

  const startDate = assertDateOnly(dateInput(body.startDate), 'Das Startdatum');
  const endDate = body.endDate ? assertDateOnly(dateInput(body.endDate), 'Das Enddatum') : null;
  const nextRunDate = assertDateOnly(dateInput(body.nextRunDate), 'Das nächste Ausführungsdatum');
  const dueDays = Number(body.dueDays);
  if (endDate && endDate < startDate) return 'Das Enddatum darf nicht vor dem Startdatum liegen.';
  if (nextRunDate < startDate) return 'Die nächste Ausführung darf nicht vor dem Startdatum liegen.';
  if (!Number.isInteger(dueDays) || dueDays < 0) return 'Das Zahlungsziel muss eine ganze Zahl ab 0 sein.';
  return { startDate, endDate, nextRunDate, dueDays };
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
    const body = req.body || {};
    const normalizedBody = {
      ...body,
      startDate: body.startDate || new Date().toISOString().slice(0, 10),
      nextRunDate: body.nextRunDate || body.startDate || new Date().toISOString().slice(0, 10),
      dueDays: body.dueDays ?? 30,
      status: body.status || 'active',
    };
    const validation = validateRecurring(normalizedBody);
    if (typeof validation === 'string') return res.status(400).json({ error: validation });
    const customer = await pool.query('SELECT id FROM customers WHERE id = $1', [normalizedBody.customerId]);
    if (!customer.rows.length) return res.status(400).json({ error: 'Customer not found' });
    const { startDate, endDate, nextRunDate, dueDays } = validation;
    const result = await pool.query(`INSERT INTO recurring_invoices (customer_id, name, items, frequency, interval_value, interval_unit, start_date, end_date, next_run_date, due_days, notes, status) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`, [normalizedBody.customerId, normalizedBody.name.trim(), JSON.stringify(normalizedBody.items), normalizedBody.frequency, normalizedBody.intervalValue || null, normalizedBody.intervalUnit || null, startDate, endDate, nextRunDate, dueDays, normalizedBody.notes || null, normalizedBody.status]);
    const row = await pool.query(`SELECT r.*, c.name AS customer_name FROM recurring_invoices r JOIN customers c ON c.id = r.customer_id WHERE r.id = $1`, [result.rows[0].id]);
    res.status(201).json(mapRecurring(row.rows[0]));
  } catch (error) {
    logger.error('Failed to create recurring invoice', { error: error.message, stack: error.stack });
    if (error.statusCode === 400) return res.status(400).json({ error: error.message });
    if (error.code === '23503') return res.status(400).json({ error: 'Customer not found' });
    res.status(500).json({ error: 'Failed to create recurring invoice' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const fields = ['customerId', 'name', 'items', 'frequency', 'intervalValue', 'intervalUnit', 'startDate', 'endDate', 'nextRunDate', 'dueDays', 'notes', 'status'];
    const columns = { customerId: 'customer_id', name: 'name', items: 'items', frequency: 'frequency', intervalValue: 'interval_value', intervalUnit: 'interval_unit', startDate: 'start_date', endDate: 'end_date', nextRunDate: 'next_run_date', dueDays: 'due_days', notes: 'notes', status: 'status' };
    const values = fields.filter(field => body[field] !== undefined);
    if (!values.length) return res.status(400).json({ error: 'No fields to update' });
    const currentResult = await pool.query('SELECT * FROM recurring_invoices WHERE id = $1', [req.params.id]);
    if (!currentResult.rows.length) return res.status(404).json({ error: 'Recurring invoice not found' });
    const current = currentResult.rows[0];
    const merged = {
      customerId: body.customerId ?? current.customer_id,
      name: body.name ?? current.name,
      items: body.items ?? current.items,
      frequency: body.frequency ?? current.frequency,
      intervalValue: body.intervalValue ?? current.interval_value,
      intervalUnit: body.intervalUnit ?? current.interval_unit,
      startDate: body.startDate ?? current.start_date,
      endDate: body.endDate !== undefined ? body.endDate : current.end_date,
      nextRunDate: body.nextRunDate ?? current.next_run_date,
      dueDays: body.dueDays ?? current.due_days,
      status: body.status ?? current.status,
    };
    const validation = validateRecurring(merged);
    if (typeof validation === 'string') return res.status(400).json({ error: validation });
    if (body.customerId) {
      const customer = await pool.query('SELECT id FROM customers WHERE id = $1', [body.customerId]);
      if (!customer.rows.length) return res.status(400).json({ error: 'Customer not found' });
    }
    const params = values.map(field => {
      if (field === 'items') return JSON.stringify(body[field]);
      if (field === 'startDate' || field === 'nextRunDate') return dateInput(body[field]);
      if (field === 'endDate') return body[field] ? dateInput(body[field]) : null;
      if (field === 'dueDays') return Number(body[field]);
      return field === 'name' ? String(body[field]).trim() : body[field];
    });
    const set = values.map((field, index) => `${columns[field]} = $${index + 1}${field === 'items' ? '::jsonb' : ''}`).join(', ');
    params.push(req.params.id);
    const result = await pool.query(`UPDATE recurring_invoices SET ${set}, updated_at = NOW() WHERE id = $${params.length} RETURNING id`, params);
    if (!result.rows.length) return res.status(404).json({ error: 'Recurring invoice not found' });
    const row = await pool.query(`SELECT r.*, c.name AS customer_name FROM recurring_invoices r JOIN customers c ON c.id = r.customer_id WHERE r.id = $1`, [req.params.id]);
    res.json(mapRecurring(row.rows[0]));
  } catch (error) {
    logger.error('Failed to update recurring invoice', { error: error.message, recurringInvoiceId: req.params.id });
    if (error.statusCode === 400) return res.status(400).json({ error: error.message });
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
  let scheduledDateForRun;
  try {
    const body = req.body || {};
    const result = await pool.query('SELECT * FROM recurring_invoices WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Recurring invoice not found' });
    recurring = result.rows[0];
    if (recurring.status !== 'active') return res.status(400).json({ error: 'Recurring invoice is not active' });
    if (recurring.end_date && recurring.next_run_date > recurring.end_date) return res.status(400).json({ error: 'Recurring invoice has ended' });

    const scheduledDate = assertDateOnly(body.scheduledDate || recurring.next_run_date, 'Das Ausführungsdatum');
    scheduledDateForRun = scheduledDate;
    const dueDate = new Date(`${scheduledDate}T00:00:00Z`);
    dueDate.setUTCDate(dueDate.getUTCDate() + recurring.due_days);
    const invoice = await createInvoice(
      { customerId: recurring.customer_id, items: recurring.items, notes: recurring.notes || '', issueDate: scheduledDate, dueDate: dueDate.toISOString().slice(0, 10), status: 'draft', recurringInvoiceId: recurring.id },
      async (client, createdInvoice) => {
        const lockedResult = await client.query('SELECT * FROM recurring_invoices WHERE id = $1 FOR UPDATE', [recurring.id]);
        const lockedRecurring = lockedResult.rows[0];
        if (!lockedRecurring || lockedRecurring.status !== 'active') {
          const error = new Error('Die wiederkehrende Rechnung ist nicht mehr aktiv.');
          error.statusCode = 409;
          throw error;
        }
        if (lockedRecurring.end_date && scheduledDate > lockedRecurring.end_date) {
          const error = new Error('Die wiederkehrende Rechnung ist bereits beendet.');
          error.statusCode = 400;
          throw error;
        }
        const nextDate = nextRunDate(scheduledDate, lockedRecurring);
        const ended = lockedRecurring.end_date && nextDate > lockedRecurring.end_date;
        await client.query(`
          INSERT INTO recurring_invoice_runs (recurring_invoice_id, status, scheduled_date, generated_invoice_id)
          VALUES ($1, 'success', $2, $3)
        `, [lockedRecurring.id, scheduledDate, createdInvoice.id]);
        await client.query(`
          UPDATE recurring_invoices
          SET last_run_date = $1, next_run_date = $2, status = $3, updated_at = NOW()
          WHERE id = $4
        `, [scheduledDate, nextDate, ended ? 'ended' : 'active', lockedRecurring.id]);
      }
    );
    res.status(201).json(invoice);
  } catch (error) {
    logger.error('Failed to generate recurring invoice', { error: error.message, recurringInvoiceId: req.params.id, stack: error.stack });
    if (error.code === 'RECURRING_ALREADY_GENERATED' && error.existingInvoiceId) {
      const existingInvoice = await findInvoiceById(error.existingInvoiceId);
      if (existingInvoice) return res.status(200).json(existingInvoice);
    }
    if (recurring && error.statusCode !== 409) await pool.query('INSERT INTO recurring_invoice_runs (recurring_invoice_id, status, scheduled_date, error) VALUES ($1, $2, $3, $4)', [recurring.id, 'failure', scheduledDateForRun || recurring.next_run_date, error.message]).catch(runError => logger.error('Failed to record recurring invoice failure', { error: runError.message }));
    if (error.statusCode === 400 || error.statusCode === 409 || error.message === 'Customer not found') return res.status(error.statusCode || 400).json({ error: error.message });
    res.status(500).json({ error: 'Failed to generate recurring invoice' });
  }
});

export default router;
