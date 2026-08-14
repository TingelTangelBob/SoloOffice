import express from 'express';
import { pool } from '../database.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Get invoices eligible for reminders
router.get('/eligible', async (req, res) => {
  const client = await pool.connect();
  
  try {
    // Get company reminder settings
    const companyResult = await client.query("SELECT * FROM company WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid");
    const company = companyResult.rows[0];
    
    if (!company.reminders_enabled) {
      return res.json([]);
    }
    
    // Use nullish coalescing to handle 0 correctly (0 is a valid value!)
    const daysAfterDue = company.reminder_days_after_due !== null && company.reminder_days_after_due !== undefined 
      ? company.reminder_days_after_due 
      : 7;
    const daysBetween = company.reminder_days_between !== null && company.reminder_days_between !== undefined 
      ? company.reminder_days_between 
      : 7;
    
    // Get all invoices that could be eligible for reminders
    const invoicesResult = await client.query(`
      SELECT 
        i.*,
        c.name as customer_name,
        c.email as customer_email,
        COALESCE((SELECT SUM(ee.amount) FROM euer_entries ee
          WHERE ee.source_type = 'invoice_payment' AND ee.source_id = i.id AND ee.status = 'active'), 0) AS paid_amount,
        GREATEST(i.total - COALESCE((SELECT SUM(ee.amount) FROM euer_entries ee
          WHERE ee.source_type = 'invoice_payment' AND ee.source_id = i.id AND ee.status = 'active'), 0), 0) AS outstanding_amount
      FROM invoices i
      JOIN customers c ON i.customer_id = c.id
      WHERE COALESCE(i.document_type, 'invoice') = 'invoice'
        AND i.status IN ('sent', 'overdue', 'reminded_1x', 'reminded_2x')
        AND i.total > COALESCE((SELECT SUM(ee.amount) FROM euer_entries ee
          WHERE ee.source_type = 'invoice_payment' AND ee.source_id = i.id AND ee.status = 'active'), 0)
      ORDER BY i.due_date ASC
    `);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const eligibleInvoices = invoicesResult.rows.map(invoice => {
      const dueDate = new Date(invoice.due_date);
      dueDate.setHours(0, 0, 0, 0);
      
      const daysSinceDue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
      
      let nextStage = 1;
      let isEligible = false;
      let daysSinceLastReminder = null;
      let nextEligibleDate = null;
      
      // Determine eligibility based on current status
      if (invoice.status === 'sent' || invoice.status === 'overdue') {
        // Eligible for first reminder if X days after due date
        nextStage = 1;
        isEligible = daysSinceDue >= daysAfterDue;
        if (!isEligible) {
          const eligibleDateCalc = new Date(dueDate);
          eligibleDateCalc.setDate(eligibleDateCalc.getDate() + daysAfterDue);
          nextEligibleDate = eligibleDateCalc.toISOString();
        }
      } else if (invoice.status === 'reminded_1x') {
        // Eligible for second reminder if X days after last reminder
        nextStage = 2;
        if (invoice.last_reminder_date) {
          const lastReminderDate = new Date(invoice.last_reminder_date);
          lastReminderDate.setHours(0, 0, 0, 0);
          daysSinceLastReminder = Math.floor((today - lastReminderDate) / (1000 * 60 * 60 * 24));
          isEligible = daysSinceLastReminder >= daysBetween;
          if (!isEligible) {
            const eligibleDateCalc = new Date(lastReminderDate);
            eligibleDateCalc.setDate(eligibleDateCalc.getDate() + daysBetween);
            nextEligibleDate = eligibleDateCalc.toISOString();
          }
        }
      } else if (invoice.status === 'reminded_2x') {
        // Eligible for third reminder if X days after last reminder
        nextStage = 3;
        if (invoice.last_reminder_date) {
          const lastReminderDate = new Date(invoice.last_reminder_date);
          lastReminderDate.setHours(0, 0, 0, 0);
          daysSinceLastReminder = Math.floor((today - lastReminderDate) / (1000 * 60 * 60 * 24));
          isEligible = daysSinceLastReminder >= daysBetween;
          if (!isEligible) {
            const eligibleDateCalc = new Date(lastReminderDate);
            eligibleDateCalc.setDate(eligibleDateCalc.getDate() + daysBetween);
            nextEligibleDate = eligibleDateCalc.toISOString();
          }
        }
      }
      
      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        customerId: invoice.customer_id,
        customerName: invoice.customer_name,
        dueDate: invoice.due_date,
        total: parseFloat(invoice.total),
        paidAmount: parseFloat(invoice.paid_amount || 0),
        outstandingAmount: parseFloat(invoice.outstanding_amount),
        currentStatus: invoice.status,
        nextStage,
        daysSinceDue,
        daysSinceLastReminder,
        isEligible,
        nextEligibleDate
      };
    });
    
    res.json(eligibleInvoices);
  } catch (error) {
    logger.error('Error fetching eligible reminders:', error);
    res.status(500).json({ error: 'Failed to fetch eligible reminders' });
  } finally {
    client.release();
  }
});

// Get reminder history (all invoices that have been reminded)
router.get('/history', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const invoicesResult = await client.query(`
      SELECT 
        i.*,
        c.name as customer_name,
        c.email as customer_email,
        COALESCE((SELECT SUM(ee.amount) FROM euer_entries ee
          WHERE ee.source_type = 'invoice_payment' AND ee.source_id = i.id AND ee.status = 'active'), 0) AS paid_amount,
        CASE WHEN i.status = 'paid' THEN 0 ELSE GREATEST(i.total - COALESCE((SELECT SUM(ee.amount) FROM euer_entries ee
          WHERE ee.source_type = 'invoice_payment' AND ee.source_id = i.id AND ee.status = 'active'), 0), 0) END AS outstanding_amount,
        ARRAY_AGG(
          json_build_object(
            'id', ii.id,
            'description', ii.description,
            'quantity', ii.quantity,
            'unitPrice', ii.unit_price,
            'taxRate', ii.tax_rate,
            'total', ii.total,
            'order', ii.item_order,
            'discountType', ii.discount_type,
            'discountValue', ii.discount_value,
            'discountAmount', ii.discount_amount
          ) ORDER BY ii.item_order
        ) as items
      FROM invoices i
      JOIN customers c ON i.customer_id = c.id
      LEFT JOIN invoice_items ii ON i.id = ii.invoice_id
      WHERE COALESCE(i.document_type, 'invoice') = 'invoice'
        AND i.last_reminder_date IS NOT NULL
      GROUP BY i.id, c.name, c.email
      ORDER BY i.last_reminder_sent_at DESC NULLS LAST, i.created_at DESC
    `);
    
    const invoices = invoicesResult.rows.map(row => ({
      id: row.id,
      invoiceNumber: row.invoice_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      items: row.items || [],
      subtotal: parseFloat(row.subtotal),
      taxAmount: parseFloat(row.tax_amount),
      total: parseFloat(row.total),
      paidAmount: parseFloat(row.paid_amount || 0),
      outstandingAmount: parseFloat(row.outstanding_amount),
      status: row.status,
      notes: row.notes,
      globalDiscountType: row.global_discount_type,
      globalDiscountValue: row.global_discount_value ? parseFloat(row.global_discount_value) : null,
      globalDiscountAmount: row.global_discount_amount ? parseFloat(row.global_discount_amount) : null,
      createdAt: row.created_at,
      lastReminderDate: row.last_reminder_date,
      lastReminderSentAt: row.last_reminder_sent_at,
      maxReminderStage: row.max_reminder_stage || 0
    }));
    
    res.json(invoices);
  } catch (error) {
    logger.error('Error fetching reminder history:', error);
    res.status(500).json({ error: 'Failed to fetch reminder history' });
  } finally {
    client.release();
  }
});

// Send/update reminder status for an invoice
router.post('/send/:invoiceId', async (req, res) => {
  const client = await pool.connect();
  const { invoiceId } = req.params;
  const { stage, updateStatus } = req.body;
  
  try {
    if (!stage || ![1, 2, 3].includes(stage)) {
      return res.status(400).json({ error: 'Invalid stage. Must be 1, 2, or 3.' });
    }
    
    // Get the invoice
    const invoiceResult = await client.query(`
      SELECT i.*,
        GREATEST(i.total - COALESCE((SELECT SUM(ee.amount) FROM euer_entries ee
          WHERE ee.source_type = 'invoice_payment' AND ee.source_id = i.id AND ee.status = 'active'), 0), 0) AS outstanding_amount
      FROM invoices i
      WHERE i.id = $1 AND COALESCE(i.document_type, 'invoice') = 'invoice'
    `, [invoiceId]);
    
    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    const invoice = invoiceResult.rows[0];
    if (Number(invoice.outstanding_amount || 0) < 0.005) {
      return res.status(409).json({ error: 'Die Rechnung ist bereits vollständig bezahlt.' });
    }
    
    // Validate stage transition
    if (stage === 1 && !['sent', 'overdue'].includes(invoice.status)) {
      return res.status(400).json({ error: 'Invoice must be sent or overdue for first reminder' });
    }
    if (stage === 2 && invoice.status !== 'reminded_1x') {
      return res.status(400).json({ error: 'Invoice must have first reminder for second reminder' });
    }
    if (stage === 3 && invoice.status !== 'reminded_2x') {
      return res.status(400).json({ error: 'Invoice must have second reminder for third reminder' });
    }
    
    // Update invoice if status update is requested
    if (updateStatus) {
      const newStatus = `reminded_${stage}x`;
      await client.query(
        `UPDATE invoices 
         SET status = $1, last_reminder_date = CURRENT_DATE, last_reminder_sent_at = NOW(),
             max_reminder_stage = GREATEST(COALESCE(max_reminder_stage, 0), $3)
         WHERE id = $2`,
        [newStatus, invoiceId, stage]
      );
    } else {
      // Even if status is not updated, track the max reminder stage
      await client.query(
        `UPDATE invoices 
         SET max_reminder_stage = GREATEST(COALESCE(max_reminder_stage, 0), $2),
             last_reminder_date = CURRENT_DATE, last_reminder_sent_at = NOW()
         WHERE id = $1`,
        [invoiceId, stage]
      );
    }
    
    res.json({ 
      success: true, 
      message: 'Reminder status updated successfully',
      invoiceId 
    });
  } catch (error) {
    logger.error('Error sending reminder:', error);
    res.status(500).json({ error: 'Failed to send reminder' });
  } finally {
    client.release();
  }
});

export default router;
