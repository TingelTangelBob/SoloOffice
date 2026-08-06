import { pool } from '../database.js';
import { findQuoteById } from '../queries/quoteQueries.js';
import { findInvoiceById } from '../queries/invoiceQueries.js';
import { generateInvoiceNumber } from './invoiceService.js';
import { validateDiscountFields } from '../utils/validation.js';

export async function createQuote(data) {
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
    validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    status = 'draft',
    globalDiscountType = null,
    globalDiscountValue = null,
    globalDiscountAmount = null,
  } = data;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get customer name
    const customerResult = await client.query('SELECT name FROM customers WHERE id = $1', [customerId]);
    if (customerResult.rows.length === 0) {
      throw new Error('Customer not found');
    }
    const customerName = customerResult.rows[0].name;

    // Generate quote number - format: AN-YYYY-XXX
    const quoteYear = new Date(issueDate).getFullYear();
    const yearPattern = `AN-${quoteYear}-%`;
    const lastQuoteResult = await client.query('SELECT quote_number FROM quotes WHERE quote_number LIKE $1 ORDER BY created_at DESC LIMIT 1', [yearPattern]);

    let quoteNumber;
    if (lastQuoteResult.rows.length === 0) {
      quoteNumber = `AN-${quoteYear}-001`;
    } else {
      const lastQuoteNumber = lastQuoteResult.rows[0].quote_number;
      if (lastQuoteNumber && lastQuoteNumber.startsWith(`AN-${quoteYear}-`)) {
        const numberPart = lastQuoteNumber.substring(`AN-${quoteYear}-`.length);
        const lastNumber = parseInt(numberPart);
        if (!isNaN(lastNumber)) {
          quoteNumber = `AN-${quoteYear}-${String(lastNumber + 1).padStart(3, '0')}`;
        } else {
          quoteNumber = `AN-${quoteYear}-001`;
        }
      } else {
        quoteNumber = `AN-${quoteYear}-001`;
      }
    }

    // Calculate totals with discount support
    let subtotal = 0;
    let totalItemDiscounts = 0;

    // Group items by tax rate for proper tax calculation
    const taxBreakdown = {};

    const processedItems = items.map(item => {
      const itemTotal = item.quantity * item.unitPrice;
      const itemDiscount = item.discountAmount || 0;
      const discountedItemTotal = itemTotal - itemDiscount;
      const taxRate = item.taxRate || 0;

      subtotal += itemTotal;
      totalItemDiscounts += itemDiscount;

      // Group by tax rate for later tax calculation
      if (!taxBreakdown[taxRate]) {
        taxBreakdown[taxRate] = { taxableAmount: 0, taxAmount: 0 };
      }
      taxBreakdown[taxRate].taxableAmount += discountedItemTotal;

      return {
        ...item,
        total: discountedItemTotal // Store without tax for now
      };
    });

    // Calculate subtotal after item discounts
    const subtotalAfterItemDiscounts = subtotal - totalItemDiscounts;

    // Apply global discount
    let globalDiscountApplied = 0;

    if (globalDiscountType && globalDiscountValue) {
      if (globalDiscountType === 'percentage') {
        globalDiscountApplied = (subtotalAfterItemDiscounts * globalDiscountValue) / 100;
      } else if (globalDiscountType === 'fixed') {
        globalDiscountApplied = Math.min(globalDiscountValue, subtotalAfterItemDiscounts);
      }
    }

    // Use provided globalDiscountAmount if available, otherwise use calculated
    const finalGlobalDiscountAmount = globalDiscountAmount !== null ? globalDiscountAmount : globalDiscountApplied;

    // Calculate final subtotal after all discounts
    const discountedSubtotal = subtotalAfterItemDiscounts - finalGlobalDiscountAmount;

    // Recalculate taxes based on global discount
    // The global discount is proportionally distributed across all tax rates
    let taxAmount = 0;

    if (finalGlobalDiscountAmount > 0 && subtotalAfterItemDiscounts > 0) {
      // Proportional distribution of global discount
      const discountRatio = finalGlobalDiscountAmount / subtotalAfterItemDiscounts;

      Object.keys(taxBreakdown).forEach(taxRateStr => {
        const taxRate = Number(taxRateStr);
        const breakdown = taxBreakdown[taxRate];

        // Reduce taxable amount proportionally
        const reducedTaxableAmount = breakdown.taxableAmount * (1 - discountRatio);
        const reducedTaxAmount = (reducedTaxableAmount * taxRate) / 100;

        breakdown.taxableAmount = reducedTaxableAmount;
        breakdown.taxAmount = reducedTaxAmount;
        taxAmount += reducedTaxAmount;
      });
    } else {
      // No global discount, calculate tax normally
      Object.keys(taxBreakdown).forEach(taxRateStr => {
        const taxRate = Number(taxRateStr);
        const breakdown = taxBreakdown[taxRate];
        const itemTaxAmount = (breakdown.taxableAmount * taxRate) / 100;
        breakdown.taxAmount = itemTaxAmount;
        taxAmount += itemTaxAmount;
      });
    }

    const total = discountedSubtotal + taxAmount;

    // Insert quote - use subtotalAfterItemDiscounts as the stored subtotal
    const quoteResult = await client.query(`
      INSERT INTO quotes (quote_number, customer_id, customer_name, issue_date, valid_until, subtotal, tax_amount, total, status, notes, global_discount_type, global_discount_value, global_discount_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [quoteNumber, customerId, customerName, issueDate, validUntil, subtotalAfterItemDiscounts, taxAmount, total, status, notes, globalDiscountType, globalDiscountValue, finalGlobalDiscountAmount]);

    const quoteId = quoteResult.rows[0].id;

    // Insert quote items
    for (let i = 0; i < processedItems.length; i++) {
      const item = processedItems[i];
      const itemOrder = item.order !== undefined ? item.order : (i + 1);
      await client.query(`
        INSERT INTO quote_items (quote_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [quoteId, item.description, item.quantity, item.unitPrice, item.taxRate, item.total, itemOrder, item.discountType || null, item.discountValue || null, item.discountAmount || null]);
    }

    // Insert attachments if provided
    for (const attachment of attachments) {
      await client.query(`
        INSERT INTO quote_attachments (quote_id, name, content, content_type, size)
        VALUES ($1, $2, $3, $4, $5)
      `, [quoteId, attachment.name, attachment.content, attachment.contentType, attachment.size]);
    }

    await client.query('COMMIT');

    return await findQuoteById(quoteId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateQuote(id, data) {
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

    // First, get the current quote to preserve existing values
    const currentQuote = await client.query('SELECT * FROM quotes WHERE id = $1 FOR UPDATE', [id]);

    if (currentQuote.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const current = currentQuote.rows[0];

    if (current.converted_to_invoice_id || current.status === 'billed') {
      const error = new Error('Ein bereits abgerechnetes Angebot kann nicht mehr geändert werden.');
      error.statusCode = 409;
      throw error;
    }

    // Merge current values with updates (but preserve quote number)
    const mergedData = {
      quoteNumber: current.quote_number,
      customerId: updateData.customerId ?? current.customer_id,
      customerName: updateData.customerName ?? current.customer_name,
      issueDate: updateData.issueDate ?? current.issue_date,
      validUntil: updateData.validUntil ?? current.valid_until,
      subtotal: updateData.subtotal ?? current.subtotal,
      taxAmount: updateData.taxAmount ?? current.tax_amount,
      total: updateData.total ?? current.total,
      status: updateData.status ?? current.status,
      notes: updateData.notes ?? current.notes,
      globalDiscountType: updateData.globalDiscountType ?? current.global_discount_type,
      globalDiscountValue: updateData.globalDiscountValue ?? current.global_discount_value,
      globalDiscountAmount: updateData.globalDiscountAmount ?? current.global_discount_amount,
      items: updateData.items
    };

    // Update quote
    await client.query(`
      UPDATE quotes
      SET quote_number = $1, customer_id = $2, customer_name = $3, issue_date = $4,
          valid_until = $5, subtotal = $6, tax_amount = $7, total = $8, status = $9, notes = $10,
          global_discount_type = $11, global_discount_value = $12, global_discount_amount = $13
      WHERE id = $14
      RETURNING *
    `, [
      mergedData.quoteNumber,
      mergedData.customerId,
      mergedData.customerName,
      mergedData.issueDate,
      mergedData.validUntil,
      mergedData.subtotal,
      mergedData.taxAmount,
      mergedData.total,
      mergedData.status,
      mergedData.notes,
      mergedData.globalDiscountType,
      mergedData.globalDiscountValue,
      mergedData.globalDiscountAmount,
      id
    ]);

    // Only update items if they are provided
    if (updateData.items) {
      // Delete existing items
      await client.query('DELETE FROM quote_items WHERE quote_id = $1', [id]);

      // Insert new items
      for (let i = 0; i < updateData.items.length; i++) {
        const item = updateData.items[i];
        const itemOrder = item.order !== undefined ? item.order : (i + 1);
        await client.query(`
          INSERT INTO quote_items (quote_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [id, item.description, item.quantity, item.unitPrice, item.taxRate, item.total, itemOrder, item.discountType || null, item.discountValue || null, item.discountAmount || null]);
      }
    }

    // Update attachments if provided
    if (updateData.attachments) {
      // Delete existing attachments
      await client.query('DELETE FROM quote_attachments WHERE quote_id = $1', [id]);

      // Insert new attachments
      for (const attachment of updateData.attachments) {
        await client.query(`
          INSERT INTO quote_attachments (quote_id, name, content, content_type, size)
          VALUES ($1, $2, $3, $4, $5)
        `, [id, attachment.name, attachment.content, attachment.contentType, attachment.size]);
      }
    }

    await client.query('COMMIT');

    return await findQuoteById(id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteQuote(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(`
      SELECT id, status, converted_to_invoice_id,
             EXISTS (SELECT 1 FROM invoices WHERE source_quote_id = quotes.id) AS has_source_invoice
      FROM quotes
      WHERE id = $1
      FOR UPDATE
    `, [id]);
    if (!current.rows.length) {
      await client.query('ROLLBACK');
      return false;
    }
    const quote = current.rows[0];
    if (quote.status !== 'draft' || quote.converted_to_invoice_id || quote.has_source_invoice) {
      const error = new Error('Nur unabhängige Angebotsentwürfe können gelöscht werden.');
      error.statusCode = 409;
      throw error;
    }
    const result = await client.query('DELETE FROM quotes WHERE id = $1 RETURNING id', [id]);
    await client.query('COMMIT');
    return result.rows.length > 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function convertQuoteToInvoice(id) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get the quote
    const quoteResult = await client.query(`
      SELECT q.*,
             COALESCE(items_subquery.items, '{}'::jsonb[]) as items,
             COALESCE(attachments_subquery.attachments, '[]'::jsonb) as attachments
      FROM quotes q
      LEFT JOIN (
        SELECT quote_id,
               array_agg(
                 jsonb_build_object(
                   'id', id,
                   'description', description,
                   'quantity', quantity,
                   'unitPrice', unit_price,
                   'taxRate', tax_rate,
                   'total', total,
                   'order', item_order,
                   'discountType', discount_type,
                   'discountValue', discount_value,
                   'discountAmount', discount_amount
                 ) ORDER BY item_order
               ) as items
        FROM quote_items
        WHERE quote_id = $1
        GROUP BY quote_id
      ) items_subquery ON q.id = items_subquery.quote_id
      LEFT JOIN (
        SELECT quote_id,
               jsonb_agg(
                 jsonb_build_object(
                   'id', id,
                   'name', name,
                   'content', content,
                   'contentType', content_type,
                   'size', size,
                   'uploadedAt', uploaded_at
                 )
               ) as attachments
        FROM quote_attachments
        WHERE quote_id = $1
        GROUP BY quote_id
      ) attachments_subquery ON q.id = attachments_subquery.quote_id
      WHERE q.id = $1
      FOR UPDATE OF q
    `, [id]);

    if (quoteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { error: 'Quote not found', status: 404 };
    }

    const quote = quoteResult.rows[0];

    // Check if quote is already converted
    if (quote.converted_to_invoice_id) {
      await client.query('ROLLBACK');
      return { error: 'Quote has already been converted to an invoice', status: 400 };
    }

    // Check if quote is accepted
    if (quote.status !== 'accepted') {
      await client.query('ROLLBACK');
      return { error: 'Only accepted quotes can be converted to invoices', status: 400 };
    }

    // Generate invoice number after all validation has passed
    const issueDate = new Date().toISOString().split('T')[0];
    const invoiceNumber = await generateInvoiceNumber(issueDate, 'invoice', client);

    // Create invoice
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const invoiceResult = await client.query(`
      INSERT INTO invoices (invoice_number, source_quote_id, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total, status, notes, global_discount_type, global_discount_value, global_discount_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `, [
      invoiceNumber,
      id,
      quote.customer_id,
      quote.customer_name,
      issueDate,
      dueDate,
      quote.subtotal,
      quote.tax_amount,
      quote.total,
      'draft',
      quote.notes ? `Erstellt aus Angebot ${quote.quote_number}\n\n${quote.notes}` : `Erstellt aus Angebot ${quote.quote_number}`,
      quote.global_discount_type,
      quote.global_discount_value,
      quote.global_discount_amount
    ]);

    const invoiceId = invoiceResult.rows[0].id;

    // Copy items
    const items = quote.items || [];
    for (const item of items) {
      await client.query(`
        INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        invoiceId,
        item.description,
        item.quantity,
        item.unitPrice,
        item.taxRate,
        item.total,
        item.order,
        item.discountType || null,
        item.discountValue || null,
        item.discountAmount || null
      ]);
    }

    // Copy attachments
    const attachments = quote.attachments || [];
    for (const attachment of attachments) {
      await client.query(`
        INSERT INTO invoice_attachments (invoice_id, name, content, content_type, size)
        VALUES ($1, $2, $3, $4, $5)
      `, [invoiceId, attachment.name, attachment.content, attachment.contentType, attachment.size]);
    }

    // Update quote to mark as converted
    await client.query(`
      UPDATE quotes
      SET converted_to_invoice_id = $1, status = 'billed'
      WHERE id = $2
    `, [invoiceId, id]);

    await client.query('COMMIT');

    return { invoice: await findInvoiceById(invoiceId) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
