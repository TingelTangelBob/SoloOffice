import { pool } from '../database.js';
import { findInvoiceById } from '../queries/invoiceQueries.js';
import logger from '../utils/logger.js';
import { validateDiscountFields } from '../utils/validation.js';
import { counterMatcher, formatNumberPattern, invoiceDateParts, numberPatternError } from '../utils/invoiceNumberPattern.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateInvoiceNumber(issueDate, documentType = 'invoice', clientOverride = null) {
  const client = clientOverride || await pool.connect();
  try {
    // Use the year from the issue date instead of current system year
    const date = invoiceDateParts(issueDate);
    if (!date) {
      const error = new Error('Ungültiges Rechnungsdatum.');
      error.statusCode = 400;
      throw error;
    }
    const invoiceYear = date.year;
    const workspaceResult = await client.query("SELECT COALESCE(NULLIF(current_setting('app.workspace_id', true), ''), 'global') AS workspace_id");
    const workspaceId = workspaceResult.rows[0]?.workspace_id || 'global';
    // The number is derived from the current maximum, so concurrent requests
    // must share a transaction-scoped advisory lock.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`solooffice:invoice-number:${workspaceId}:${invoiceYear}:${documentType}`]
    );

    // Get the year-specific start number, falling back to the company default.
    const yearlyStartResult = await client.query('SELECT start_number FROM yearly_invoice_start_numbers WHERE year = $1', [invoiceYear]);
    const companyStartResult = await client.query(`
      SELECT invoice_start_number, invoice_number_pattern, credit_note_number_pattern
      FROM company
      WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    `);
    const companyStartNumber = companyStartResult.rows[0]?.invoice_start_number || 1;
    const yearStartNumber = yearlyStartResult.rows.length > 0 ? yearlyStartResult.rows[0].start_number : companyStartNumber;
    const defaultPattern = documentType === 'credit_note' ? 'GS-{YYYY}-{NNN}' : 'RE-{YYYY}-{NNN}';
    const configuredPattern = documentType === 'credit_note'
      ? companyStartResult.rows[0]?.credit_note_number_pattern
      : companyStartResult.rows[0]?.invoice_number_pattern;
    const pattern = numberPatternError(configuredPattern) ? defaultPattern : configuredPattern.trim();

    // Auch gelöschte Entwürfe bleiben durch die Historie reserviert. Dadurch
    // wird eine einmal vergebene Nummer nicht später erneut verwendet.
    const reservedResult = await client.query(`
      SELECT invoice_number
      FROM invoices
      WHERE EXTRACT(YEAR FROM issue_date) = $1
        AND COALESCE(document_type, 'invoice') = $2
      UNION
      SELECT invoice_number
      FROM invoice_history
      WHERE record_type = 'invoice'
        AND COALESCE(new_data->>'issue_date', old_data->>'issue_date', '') LIKE $3
        AND COALESCE(new_data->>'document_type', old_data->>'document_type', 'invoice') = $2
    `, [invoiceYear, documentType, `${invoiceYear}-%`]);
    const reserved = new Set(reservedResult.rows.map(row => String(row.invoice_number || '')).filter(Boolean));
    const matcher = counterMatcher(pattern, date);
    let highestCounter = Number(yearStartNumber) - 1;
    for (const number of reserved) {
      const currentPatternMatch = number.match(matcher);
      if (currentPatternMatch) {
        highestCounter = Math.max(highestCounter, Number(currentPatternMatch[1]));
        continue;
      }
      // Kompatibilität mit dem bisherigen Format bei einem Musterwechsel.
      const legacyCounter = number.match(/(\d+)$/);
      if (legacyCounter) highestCounter = Math.max(highestCounter, Number(legacyCounter[1]));
    }

    let counter = highestCounter + 1;
    let invoiceNumber = formatNumberPattern(pattern, date, counter);
    while (reserved.has(invoiceNumber)) {
      counter += 1;
      invoiceNumber = formatNumberPattern(pattern, date, counter);
    }
    if (invoiceNumber.length > 50) {
      const error = new Error('Das Rechnungsnummern-Muster erzeugt mehr als 50 Zeichen.');
      error.statusCode = 400;
      throw error;
    }
    return invoiceNumber;
  } finally {
    if (!clientOverride) client.release();
  }
}

export async function createInvoice(data, transactionHook) {
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
    sourceQuoteId = null,
    sourceJobIds = [],
  } = data;

  if (!['invoice', 'credit_note'].includes(documentType)) {
    const err = new Error('Invalid document type');
    err.statusCode = 400;
    throw err;
  }

  if (!Array.isArray(sourceJobIds) || sourceJobIds.some(id => !UUID_PATTERN.test(String(id)))) {
    const err = new Error('Ungültige Auftragsreferenz.');
    err.statusCode = 400;
    throw err;
  }
  if (sourceJobIds.length > 0 && documentType !== 'invoice') {
    const err = new Error('Auftragsreferenzen sind nur für Rechnungen zulässig.');
    err.statusCode = 400;
    throw err;
  }
  if (new Set(sourceJobIds).size !== sourceJobIds.length) {
    const err = new Error('Eine Auftragseinheit wurde mehrfach ausgewählt.');
    err.statusCode = 400;
    throw err;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (recurringInvoiceId) {
      const recurringResult = await client.query(`
        SELECT id
        FROM recurring_invoices
        WHERE id = $1
        FOR UPDATE
      `, [recurringInvoiceId]);
      if (!recurringResult.rows.length) {
        const error = new Error('Die wiederkehrende Rechnung wurde nicht gefunden.');
        error.statusCode = 400;
        throw error;
      }
      const existingRun = await client.query(`
        SELECT generated_invoice_id
        FROM recurring_invoice_runs
        WHERE recurring_invoice_id = $1 AND scheduled_date = $2 AND status = 'success'
        LIMIT 1
      `, [recurringInvoiceId, issueDate]);
      if (existingRun.rows[0]?.generated_invoice_id) {
        const error = new Error('Für dieses Ausführungsdatum wurde bereits eine Rechnung erzeugt.');
        error.statusCode = 409;
        error.code = 'RECURRING_ALREADY_GENERATED';
        error.existingInvoiceId = existingRun.rows[0].generated_invoice_id;
        throw error;
      }
    }

    // Generate the number only after a recurring template has been locked.
    const invoiceNumber = await generateInvoiceNumber(issueDate, documentType, client);

    // Get customer name
    const customerResult = await client.query('SELECT name FROM customers WHERE id = $1', [customerId]);
    if (customerResult.rows.length === 0) {
      throw new Error('Customer not found');
    }
    const customerName = customerResult.rows[0].name;

    let sourceQuote = null;
    if (sourceQuoteId) {
      if (documentType !== 'invoice' || !UUID_PATTERN.test(String(sourceQuoteId))) {
        const error = new Error('Ungültige Angebotsreferenz.');
        error.statusCode = 400;
        throw error;
      }
      const sourceQuoteResult = await client.query(`
        SELECT id, customer_id, status, converted_to_invoice_id
        FROM quotes
        WHERE id = $1
        FOR UPDATE
      `, [sourceQuoteId]);
      sourceQuote = sourceQuoteResult.rows[0];
      if (!sourceQuote || sourceQuote.customer_id !== customerId) {
        const error = new Error('Das Angebot wurde nicht gefunden oder gehört zu einem anderen Kunden.');
        error.statusCode = 400;
        throw error;
      }
      if (sourceQuote.converted_to_invoice_id) {
        const error = new Error('Das Angebot wurde bereits in eine Rechnung umgewandelt.');
        error.statusCode = 409;
        throw error;
      }
      if (sourceQuote.status !== 'accepted') {
        const error = new Error('Nur angenommene Angebote können in Rechnungen umgewandelt werden.');
        error.statusCode = 400;
        throw error;
      }
    }

    let sourceJobs = [];
    if (sourceJobIds.length > 0) {
      const sourceJobResult = await client.query(`
        SELECT id, customer_id, status, job_number, external_job_number, title, date, recurrence_index
        FROM job_entries
        WHERE id = ANY($1::uuid[])
        FOR UPDATE
      `, [sourceJobIds]);

      if (sourceJobResult.rows.length !== sourceJobIds.length) {
        const err = new Error('Mindestens eine Auftragseinheit wurde nicht gefunden.');
        err.statusCode = 400;
        throw err;
      }
      if (sourceJobResult.rows.some(job => job.customer_id !== customerId)) {
        const err = new Error('Alle Auftragseinheiten müssen zum selben Kunden gehören.');
        err.statusCode = 400;
        throw err;
      }
      if (sourceJobResult.rows.some(job => job.status !== 'completed')) {
        const err = new Error('Nur abgeschlossene Auftragseinheiten können abgerechnet werden.');
        err.statusCode = 400;
        throw err;
      }

      const existingSourceResult = await client.query(`
        SELECT job_id
        FROM invoice_job_sources
        WHERE job_id = ANY($1::uuid[])
        FOR UPDATE
      `, [sourceJobIds]);
      if (existingSourceResult.rows.length > 0) {
        const err = new Error('Mindestens eine Auftragseinheit wurde bereits abgerechnet.');
        err.statusCode = 409;
        throw err;
      }
      sourceJobs = sourceJobResult.rows;
    }

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
      INSERT INTO invoices (invoice_number, document_type, reference_invoice_id, credit_note_reason, recurring_invoice_id, source_quote_id, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total, status, notes, global_discount_type, global_discount_value, global_discount_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *
    `, [invoiceNumber, documentType, referenceInvoiceId, creditNoteReason, recurringInvoiceId, sourceQuoteId, customerId, customerName, issueDate, dueDate, subtotal, taxAmount, total, status, notes, globalDiscountType, globalDiscountValue, globalDiscAmount]);

    const invoiceId = invoiceResult.rows[0].id;

    if (sourceQuote) {
      await client.query(`
        UPDATE quotes
        SET converted_to_invoice_id = $1, status = 'billed'
        WHERE id = $2
      `, [invoiceId, sourceQuote.id]);
    }

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

    if (sourceJobs.length > 0) {
      for (const sourceJob of sourceJobs) {
        await client.query(`
          INSERT INTO invoice_job_sources (
            invoice_id, job_id, job_number, external_job_number, title, job_date, recurrence_index
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          invoiceId,
          sourceJob.id,
          sourceJob.job_number,
          sourceJob.external_job_number || null,
          sourceJob.title,
          sourceJob.date,
          sourceJob.recurrence_index || null,
        ]);
      }
      await client.query(
        `UPDATE job_entries SET status = 'invoiced', updated_at = NOW() WHERE id = ANY($1::uuid[])`,
        [sourceJobIds]
      );
    }

    if (transactionHook) {
      await transactionHook(client, invoiceResult.rows[0]);
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
    const currentInvoice = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id]);

    if (currentInvoice.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const current = currentInvoice.rows[0];

    if (updateData.sourceQuoteId !== undefined && updateData.sourceQuoteId !== current.source_quote_id) {
      const error = new Error('Die Herkunft einer Rechnung kann nach dem Anlegen nicht geändert werden.');
      error.statusCode = 409;
      throw error;
    }

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
      sourceQuoteId: current.source_quote_id,
      items: updateData.items // items are handled separately
    };

    const paymentResult = await client.query(`
      SELECT COALESCE(SUM(amount), 0) AS amount
      FROM euer_entries
      WHERE source_type = 'invoice_payment' AND source_id = $1 AND status = 'active'
    `, [id]);
    const activePaymentAmount = Number(paymentResult.rows[0]?.amount || 0);
    if (mergedData.status === 'paid' && current.status !== 'paid' && activePaymentAmount < Number(mergedData.total) - 0.005) {
        const error = new Error('Bitte den Zahlungseingang an der Rechnung erfassen. Der Status wird nach vollständiger Zahlung automatisch gesetzt.');
        error.statusCode = 409;
        throw error;
    }
    if (activePaymentAmount > 0) {
      if (activePaymentAmount >= Number(mergedData.total) - 0.005) mergedData.status = 'paid';
      else if (current.status === 'paid') {
        const dueDate = new Date(`${String(mergedData.dueDate).slice(0, 10)}T00:00:00Z`);
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        mergedData.status = dueDate < today ? 'overdue' : 'sent';
      }
    }

    // Update invoice
    await client.query(`
      UPDATE invoices
      SET invoice_number = $1, customer_id = $2, customer_name = $3, issue_date = $4,
          due_date = $5, subtotal = $6, tax_amount = $7, total = $8, status = $9, notes = $10,
          global_discount_type = $11, global_discount_value = $12, global_discount_amount = $13,
          reference_invoice_id = $14, credit_note_reason = $15, recurring_invoice_id = $16, source_quote_id = $17
      WHERE id = $18
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
      mergedData.sourceQuoteId,
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const invoiceResult = await client.query(`
      SELECT id, status, recurring_invoice_id, source_quote_id,
             EXISTS (SELECT 1 FROM quotes WHERE converted_to_invoice_id = invoices.id) AS has_source_quote
      FROM invoices
      WHERE id = $1
      FOR UPDATE
    `, [id]);
    if (!invoiceResult.rows.length) {
      await client.query('ROLLBACK');
      return false;
    }
    const invoice = invoiceResult.rows[0];
    if (invoice.status !== 'draft' || invoice.recurring_invoice_id || invoice.source_quote_id || invoice.has_source_quote) {
      const error = new Error('Nur unabhängige Entwürfe ohne Dokumentquelle können gelöscht werden.');
      error.statusCode = 409;
      throw error;
    }

    const sourceJobs = await client.query('SELECT job_id FROM invoice_job_sources WHERE invoice_id = $1 FOR UPDATE', [id]);
    if (sourceJobs.rows.length > 0) {
      const jobIds = sourceJobs.rows.map(row => row.job_id);
      await client.query('DELETE FROM invoice_job_sources WHERE invoice_id = $1', [id]);
      await client.query(`UPDATE job_entries SET status = 'completed', updated_at = NOW() WHERE id = ANY($1::uuid[]) AND status = 'invoiced'`, [jobIds]);
    }
    await client.query('DELETE FROM invoices WHERE id = $1', [id]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
