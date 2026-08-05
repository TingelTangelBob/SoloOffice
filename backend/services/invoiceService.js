import { pool, query } from '../database.js';
import { findInvoiceById } from '../queries/invoiceQueries.js';
import logger from '../utils/logger.js';
import { validateDiscountFields } from '../utils/validation.js';

export async function generateInvoiceNumber(issueDate, documentType = 'invoice') {
  const client = await pool.connect();
  try {
    // Use the year from the issue date instead of current system year
    const invoiceYear = new Date(issueDate).getFullYear();
    const prefix = documentType === 'credit_note' ? 'GS' : 'RE';
    const yearPattern = `${prefix}-${invoiceYear}-%`;
    const lastInvoiceResult = await client.query(`
      SELECT invoice_number
      FROM invoices
      WHERE invoice_number LIKE $1
      ORDER BY NULLIF(SUBSTRING(invoice_number FROM '[0-9]+$'), '')::INTEGER DESC NULLS LAST
      LIMIT 1
    `, [yearPattern]);

    // Get the year-specific start number, falling back to the company default.
    const yearlyStartResult = await client.query('SELECT start_number FROM yearly_invoice_start_numbers WHERE year = $1', [invoiceYear]);
    const companyStartResult = await client.query("SELECT invoice_start_number FROM company WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid");
    const companyStartNumber = companyStartResult.rows[0]?.invoice_start_number || 1;
    const yearStartNumber = yearlyStartResult.rows.length > 0 ? yearlyStartResult.rows[0].start_number : companyStartNumber;

    let invoiceNumber;
    if (lastInvoiceResult.rows.length === 0) {
      // No invoices for this year found - start with year-specific start number
      invoiceNumber = `${prefix}-${invoiceYear}-${String(yearStartNumber).padStart(3, '0')}`;
    } else {
      const lastInvoiceNumber = lastInvoiceResult.rows[0].invoice_number;
      if (lastInvoiceNumber && lastInvoiceNumber.startsWith(`${prefix}-${invoiceYear}-`)) {
        const numberPart = lastInvoiceNumber.substring(`${prefix}-${invoiceYear}-`.length); // Remove prefix
        const lastNumber = parseInt(numberPart);
        if (!isNaN(lastNumber)) {
          // Continue from last number, but respect year start number as minimum
          const nextNumber = Math.max(lastNumber + 1, yearStartNumber);
          invoiceNumber = `${prefix}-${invoiceYear}-${String(nextNumber).padStart(3, '0')}`;
        } else {
          invoiceNumber = `${prefix}-${invoiceYear}-${String(yearStartNumber).padStart(3, '0')}`;
        }
      } else {
        invoiceNumber = `${prefix}-${invoiceYear}-${String(yearStartNumber).padStart(3, '0')}`;
      }
    }

    return invoiceNumber;
  } finally {
    client.release();
  }
}

export async function createInvoice(data) {
  const discountValidation = validateDiscountFields(data);
  if (!discountValidation.valid) {
    const err = new Error(discountValidation.message);
    err.statusCode = 400;
    throw err;
  }

  const {
    customerId,
    items = [],
    notes = '',
    attachments = [],
    issueDate = new Date().toISOString().split('T')[0],
    dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    status = 'draft',
    globalDiscountType = null,
    globalDiscountValue = null,
    globalDiscountAmount = null,
    documentType = 'invoice',
    referenceInvoiceId = null,
    creditNoteReason = null,
    recurringInvoiceId = null,
  } = data;

  if (!['invoice', 'credit_note'].includes(documentType)) {
    const err = new Error('Invalid document type');
    err.statusCode = 400;
    throw err;
  }

  // Generate invoice number before opening transaction (generateInvoiceNumber uses its own connection)
  const invoiceNumber = await generateInvoiceNumber(issueDate, documentType);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get customer name
    const customerResult = await client.query('SELECT name FROM customers WHERE id = $1', [customerId]);
    if (customerResult.rows.length === 0) {
      throw new Error('Customer not found');
    }
    const customerName = customerResult.rows[0].name;

    // Calculate totals with discounts
    let subtotalBeforeDiscounts = 0;
    let totalItemDiscounts = 0;

    // Gruppiere Items nach Steuersatz für die Steuerberechnung
    const taxBreakdown = {};

    const processedItems = items.map(item => {
      const sign = documentType === 'credit_note' ? -1 : 1;
      const unitPrice = Math.abs(Number(item.unitPrice || 0)) * sign;
      const discountAmount = Math.abs(Number(item.discountAmount || 0)) * sign;
      // Berechne Item-Total vor Rabatt
      const itemTotalBeforeDiscount = item.quantity * unitPrice;
      subtotalBeforeDiscounts += itemTotalBeforeDiscount;

      // Berechne Item-Rabatt
      const itemDiscountAmount = discountAmount;
      totalItemDiscounts += itemDiscountAmount;

      // Item-Total nach Item-Rabatt
      const itemTotalAfterDiscount = itemTotalBeforeDiscount - itemDiscountAmount;

      // Gruppiere nach Steuersatz für spätere Steuerberechnung
      const taxRate = item.taxRate || 0;
      if (!taxBreakdown[taxRate]) {
        taxBreakdown[taxRate] = 0;
      }
      taxBreakdown[taxRate] += itemTotalAfterDiscount;

      return {
        ...item,
        unitPrice,
        discountAmount,
        total: itemTotalAfterDiscount // Item-Total nach Rabatt (ohne Steuer)
      };
    });

    // Subtotal nach Item-Rabatten
    const subtotalAfterItemDiscounts = subtotalBeforeDiscounts - totalItemDiscounts;

    // Global-Rabatt wird auf die bereits rabattierte Subtotal angewendet
    const globalDiscAmount = documentType === 'credit_note'
      ? -Math.abs(Number(globalDiscountAmount || 0))
      : (globalDiscountAmount || 0);
    const subtotalAfterAllDiscounts = subtotalAfterItemDiscounts - globalDiscAmount;

    // Berechne Steuer proportional auf die rabattierte Subtotal
    let taxAmount = 0;
    if (globalDiscAmount > 0 && subtotalAfterItemDiscounts > 0) {
      // Verteile Global-Rabatt proportional auf alle Steuersätze
      const discountRatio = subtotalAfterAllDiscounts / subtotalAfterItemDiscounts;
      Object.keys(taxBreakdown).forEach(rate => {
        const taxableAmount = taxBreakdown[rate] * discountRatio;
        taxAmount += taxableAmount * (parseFloat(rate) / 100);
      });
    } else {
      // Keine Global-Rabatte: normale Steuerberechnung
      Object.keys(taxBreakdown).forEach(rate => {
        taxAmount += taxBreakdown[rate] * (parseFloat(rate) / 100);
      });
    }

    const total = subtotalAfterAllDiscounts + taxAmount;

    // Speichere die ursprüngliche Subtotal (vor Rabatten) in der DB für Reporting-Zwecke
    const subtotal = subtotalBeforeDiscounts;

    // Insert invoice
    const invoiceResult = await client.query(`
      INSERT INTO invoices (invoice_number, document_type, reference_invoice_id, credit_note_reason, recurring_invoice_id, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total, status, notes, global_discount_type, global_discount_value, global_discount_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *
    `, [invoiceNumber, documentType, referenceInvoiceId, creditNoteReason, recurringInvoiceId, customerId, customerName, issueDate, dueDate, subtotal, taxAmount, total, status, notes, globalDiscountType, globalDiscountValue, globalDiscAmount]);

    const invoiceId = invoiceResult.rows[0].id;

    // Insert invoice items
    for (let i = 0; i < processedItems.length; i++) {
      const item = processedItems[i];
      const itemOrder = item.order !== undefined ? item.order : (i + 1);
      await client.query(`
        INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [invoiceId, item.description, item.quantity, item.unitPrice, item.taxRate, item.total, itemOrder, item.discountType || null, item.discountValue || null, item.discountAmount || null]);
    }

    // Insert attachments if provided
    for (const attachment of attachments) {
      await client.query(`
        INSERT INTO invoice_attachments (invoice_id, name, content, content_type, size)
        VALUES ($1, $2, $3, $4, $5)
      `, [invoiceId, attachment.name, attachment.content, attachment.contentType, attachment.size]);
    }

    await client.query('COMMIT');

    return await findInvoiceById(invoiceId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateInvoice(id, data) {
  const discountValidation = validateDiscountFields(data);
  if (!discountValidation.valid) {
    const err = new Error(discountValidation.message);
    err.statusCode = 400;
    throw err;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updateData = data;

    // First, get the current invoice to preserve existing values
    const currentInvoice = await client.query('SELECT * FROM invoices WHERE id = $1', [id]);

    if (currentInvoice.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const current = currentInvoice.rows[0];

    // Recalculate totals if items are provided
    let calculatedSubtotal = updateData.subtotal ?? current.subtotal;
    let calculatedTaxAmount = updateData.taxAmount ?? current.tax_amount;
    let calculatedTotal = updateData.total ?? current.total;

    if (updateData.items && Array.isArray(updateData.items)) {
      // Recalculate totals with discounts
      let subtotalBeforeDiscounts = 0;
      let totalItemDiscounts = 0;

      // Gruppiere Items nach Steuersatz für die Steuerberechnung
      const taxBreakdown = {};

      updateData.items.forEach(item => {
        // Berechne Item-Total vor Rabatt
        const itemTotalBeforeDiscount = item.quantity * item.unitPrice;
        subtotalBeforeDiscounts += itemTotalBeforeDiscount;

        // Berechne Item-Rabatt
        const itemDiscountAmount = item.discountAmount || 0;
        totalItemDiscounts += itemDiscountAmount;

        // Item-Total nach Item-Rabatt
        const itemTotalAfterDiscount = itemTotalBeforeDiscount - itemDiscountAmount;

        // Gruppiere nach Steuersatz für spätere Steuerberechnung
        const taxRate = item.taxRate || 0;
        if (!taxBreakdown[taxRate]) {
          taxBreakdown[taxRate] = 0;
        }
        taxBreakdown[taxRate] += itemTotalAfterDiscount;
      });

      // Subtotal nach Item-Rabatten
      const subtotalAfterItemDiscounts = subtotalBeforeDiscounts - totalItemDiscounts;

      // Global-Rabatt wird auf die bereits rabattierte Subtotal angewendet
      const globalDiscAmount = updateData.globalDiscountAmount ?? current.global_discount_amount ?? 0;
      const subtotalAfterAllDiscounts = subtotalAfterItemDiscounts - globalDiscAmount;

      // Berechne Steuer proportional auf die rabattierte Subtotal
      let taxAmount = 0;
      if (globalDiscAmount > 0 && subtotalAfterItemDiscounts > 0) {
        // Verteile Global-Rabatt proportional auf alle Steuersätze
        const discountRatio = subtotalAfterAllDiscounts / subtotalAfterItemDiscounts;
        Object.keys(taxBreakdown).forEach(rate => {
          const taxableAmount = taxBreakdown[rate] * discountRatio;
          taxAmount += taxableAmount * (parseFloat(rate) / 100);
        });
      } else {
        // Keine Global-Rabatte: normale Steuerberechnung
        Object.keys(taxBreakdown).forEach(rate => {
          taxAmount += taxBreakdown[rate] * (parseFloat(rate) / 100);
        });
      }

      calculatedTotal = subtotalAfterAllDiscounts + taxAmount;
      calculatedSubtotal = subtotalBeforeDiscounts;
      calculatedTaxAmount = taxAmount;
    }

    // Merge current values with updates (but preserve invoice number)
    const mergedData = {
      invoiceNumber: current.invoice_number, // Always preserve existing invoice number
      customerId: updateData.customerId ?? current.customer_id,
      customerName: updateData.customerName ?? current.customer_name,
      issueDate: updateData.issueDate ?? current.issue_date,
      dueDate: updateData.dueDate ?? current.due_date,
      subtotal: calculatedSubtotal,
      taxAmount: calculatedTaxAmount,
      total: calculatedTotal,
      status: updateData.status ?? current.status,
      notes: updateData.notes ?? current.notes,
      globalDiscountType: updateData.globalDiscountType ?? current.global_discount_type,
      globalDiscountValue: updateData.globalDiscountValue ?? current.global_discount_value,
      globalDiscountAmount: updateData.globalDiscountAmount ?? current.global_discount_amount,
      referenceInvoiceId: updateData.referenceInvoiceId !== undefined ? updateData.referenceInvoiceId : current.reference_invoice_id,
      creditNoteReason: updateData.creditNoteReason !== undefined ? updateData.creditNoteReason : current.credit_note_reason,
      recurringInvoiceId: updateData.recurringInvoiceId !== undefined ? updateData.recurringInvoiceId : current.recurring_invoice_id,
      items: updateData.items // items are handled separately
    };

    // Update invoice
    await client.query(`
      UPDATE invoices
      SET invoice_number = $1, customer_id = $2, customer_name = $3, issue_date = $4,
          due_date = $5, subtotal = $6, tax_amount = $7, total = $8, status = $9, notes = $10,
          global_discount_type = $11, global_discount_value = $12, global_discount_amount = $13,
          reference_invoice_id = $14, credit_note_reason = $15, recurring_invoice_id = $16
      WHERE id = $17
      RETURNING *
    `, [
      mergedData.invoiceNumber,
      mergedData.customerId,
      mergedData.customerName,
      mergedData.issueDate,
      mergedData.dueDate,
      mergedData.subtotal,
      mergedData.taxAmount,
      mergedData.total,
      mergedData.status,
      mergedData.notes,
      mergedData.globalDiscountType,
      mergedData.globalDiscountValue,
      mergedData.globalDiscountAmount,
      mergedData.referenceInvoiceId,
      mergedData.creditNoteReason,
      mergedData.recurringInvoiceId,
      id
    ]);

    // Only update items if they are provided
    if (updateData.items) {
      // Delete existing items
      await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [id]);

      // Insert new items
      for (let i = 0; i < updateData.items.length; i++) {
        const item = updateData.items[i];
        const itemOrder = item.order !== undefined ? item.order : (i + 1);

        // Berechne Item-Total nach Rabatt (ohne Steuer)
        const itemTotalBeforeDiscount = item.quantity * item.unitPrice;
        const itemDiscountAmount = item.discountAmount || 0;
        const itemTotal = itemTotalBeforeDiscount - itemDiscountAmount;

        await client.query(`
          INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [id, item.description, item.quantity, item.unitPrice, item.taxRate, itemTotal, itemOrder, item.discountType || null, item.discountValue || null, item.discountAmount || null]);
      }
    }

    // Update attachments if provided
    if (updateData.attachments) {
      // Delete existing attachments
      await client.query('DELETE FROM invoice_attachments WHERE invoice_id = $1', [id]);

      // Insert new attachments
      for (const attachment of updateData.attachments) {
        await client.query(`
          INSERT INTO invoice_attachments (invoice_id, name, content, content_type, size)
          VALUES ($1, $2, $3, $4, $5)
        `, [id, attachment.name, attachment.content, attachment.contentType, attachment.size]);
      }
    }

    await client.query('COMMIT');

    return await findInvoiceById(id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteInvoice(id) {
  const result = await query('DELETE FROM invoices WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}
