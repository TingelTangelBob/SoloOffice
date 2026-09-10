import { pool } from '../database.js';
import { findInvoiceById } from '../queries/invoiceQueries.js';
import { calculateDocumentMoney } from '../utils/documentMoney.js';
import { captureInvoiceSnapshot } from './invoiceSnapshot.js';
import { invoiceError, validateInvoiceHeader, validateInvoiceUpdate, INVOICE_CONTENT_FIELDS } from '../utils/invoicePolicy.js';
import { counterMatcher, formatNumberPattern, invoiceDateParts, numberPatternError } from '../utils/invoiceNumberPattern.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REQUIRED_COMPANY_FIELDS = [
  ['name', 'Firmenname'],
  ['address', 'Straße und Hausnummer'],
  ['postal_code', 'PLZ'],
  ['city', 'Ort'],
  ['email', 'E-Mail-Adresse'],
  ['tax_id', 'USt-IdNr.'],
  ['bank_account', 'IBAN'],
];

export async function validateCompanyForInvoice(client) {
  const result = await client.query(`
    SELECT name, address, postal_code, city, email, tax_id, COALESCE(NULLIF(bank_account, ''), payment_bank_account) AS bank_account
    FROM company
    WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    LIMIT 1
  `);
  const company = result.rows[0];
  const missingFields = REQUIRED_COMPANY_FIELDS
    .filter(([field]) => !String(company?.[field] || '').trim())
    .map(([, label]) => label);

  if (missingFields.length > 0) {
    const error = new Error(`Bitte vervollständigen Sie vor dem Erstellen einer Rechnung die Firmendaten: ${missingFields.join(', ')}.`);
    error.statusCode = 400;
    error.code = 'COMPANY_DATA_INCOMPLETE';
    throw error;
  }
}

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
  const {
    customerId,
    items = [],
    notes = '',
    attachments = [],
    issueDate = new Date().toISOString().split('T')[0],
    dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    status = 'draft',
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

  const money = calculateDocumentMoney({ ...data, items }, { documentType });
  validateInvoiceHeader({ status, issueDate, dueDate, customerId, items: money.items });
  if (status === 'paid' && documentType === 'invoice') {
    throw invoiceError('Bitte die Rechnung zunächst anlegen und anschließend den Zahlungseingang erfassen.', 409);
  }
  if (!Array.isArray(attachments)) throw invoiceError('Anhänge müssen als Liste übergeben werden.');

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

    await validateCompanyForInvoice(client);

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

    // Get customer name
    const customerResult = await client.query('SELECT name FROM customers WHERE id = $1', [customerId]);
    if (customerResult.rows.length === 0) {
      throw new Error('Customer not found');
    }

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

    // Quellbelege werden vor dem Nummernkreis gesperrt (gleiche Reihenfolge wie Angebotsumwandlung).
    const invoiceNumber = await generateInvoiceNumber(issueDate, documentType, client);

    const { items: processedItems, subtotal, taxAmount, total, globalDiscountType, globalDiscountValue, globalDiscountAmount: globalDiscAmount } = money;
    const documentSnapshot = await captureInvoiceSnapshot(client, customerId);

    // Insert invoice
    const invoiceResult = await client.query(`
      INSERT INTO invoices (invoice_number, document_type, reference_invoice_id, credit_note_reason, recurring_invoice_id, source_quote_id, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total, status, notes, global_discount_type, global_discount_value, global_discount_amount, document_snapshot)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *
    `, [invoiceNumber, documentType, referenceInvoiceId, creditNoteReason, recurringInvoiceId, sourceQuoteId, customerId, documentSnapshot.customer.name, issueDate, dueDate, subtotal, taxAmount, total, 'draft', notes, globalDiscountType, globalDiscountValue, globalDiscAmount, JSON.stringify(documentSnapshot)]);

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
      `, [invoiceId, item.description, item.quantity, item.unitPrice, item.taxRate, item.total, itemOrder, item.discountType || null, item.discountValue ?? null, item.discountAmount ?? null]);
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

    // Positionen sind vollständig vorhanden, bevor der Entwurf ausgestellt wird.
    if (status !== 'draft') await client.query('UPDATE invoices SET status = $1 WHERE id = $2', [status, invoiceId]);

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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id]);
    if (!currentResult.rows.length) {
      await client.query('ROLLBACK');
      return null;
    }
    const current = currentResult.rows[0];
    validateInvoiceUpdate(current, data);
    if (data.sourceQuoteId !== undefined && data.sourceQuoteId !== current.source_quote_id) {
      throw invoiceError('Die Herkunft einer Rechnung kann nach dem Anlegen nicht geändert werden.', 409);
    }
    const value = (key, column) => data[key] !== undefined ? data[key] : current[column];
    const itemRows = await client.query('SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY item_order', [id]);
    const storedItems = itemRows.rows.map(row => ({
      description: row.description, quantity: Number(row.quantity), unitPrice: Number(row.unit_price),
      taxRate: Number(row.tax_rate), total: Number(row.total), order: row.item_order,
      discountType: row.discount_type, discountValue: row.discount_value, discountAmount: row.discount_amount,
    }));
    const financialChange = ['items', 'globalDiscountType', 'globalDiscountValue', 'globalDiscountAmount']
      .some(key => data[key] !== undefined);
    const contentChange = INVOICE_CONTENT_FIELDS.some(key => data[key] !== undefined);
    // Statuswechsel verändern keine historischen Centbeträge. Aus dem Request
    // übergebene Summen werden in keinem Fall als Rechnungsbetrag übernommen.
    const money = financialChange ? calculateDocumentMoney({
      items: data.items !== undefined ? data.items : storedItems,
      globalDiscountType: value('globalDiscountType', 'global_discount_type'),
      globalDiscountValue: value('globalDiscountValue', 'global_discount_value'),
      globalDiscountAmount: data.globalDiscountType === null ? 0 : value('globalDiscountAmount', 'global_discount_amount'),
    }, { documentType: current.document_type || 'invoice' }) : null;
    const merged = {
      customerId: value('customerId', 'customer_id'), customerName: current.customer_name,
      issueDate: value('issueDate', 'issue_date'), dueDate: value('dueDate', 'due_date'),
      status: value('status', 'status'), notes: value('notes', 'notes'),
      referenceInvoiceId: value('referenceInvoiceId', 'reference_invoice_id'),
      creditNoteReason: value('creditNoteReason', 'credit_note_reason'),
      recurringInvoiceId: current.recurring_invoice_id,
      subtotal: money?.subtotal ?? current.subtotal,
      taxAmount: money?.taxAmount ?? current.tax_amount,
      total: money?.total ?? current.total,
      globalDiscountType: money ? money.globalDiscountType : current.global_discount_type,
      globalDiscountValue: money ? money.globalDiscountValue : current.global_discount_value,
      globalDiscountAmount: money ? money.globalDiscountAmount : current.global_discount_amount,
      documentSnapshot: current.document_snapshot,
    };
    if (data.recurringInvoiceId !== undefined && data.recurringInvoiceId !== current.recurring_invoice_id) {
      throw invoiceError('Die Herkunft einer Rechnung kann nach dem Anlegen nicht geändert werden.', 409);
    }
    validateInvoiceHeader({ ...merged, items: money?.items || storedItems });
    if (current.status === 'draft' && (contentChange || !current.document_snapshot)) {
      merged.documentSnapshot = await captureInvoiceSnapshot(client, merged.customerId);
      merged.customerName = merged.documentSnapshot.customer.name;
    }
    if (data.attachments !== undefined && !Array.isArray(data.attachments)) throw invoiceError('Anhänge müssen als Liste übergeben werden.');

    const paymentResult = await client.query(`SELECT COALESCE(SUM(amount), 0) AS amount
      FROM euer_entries WHERE source_type = 'invoice_payment' AND source_id = $1 AND status = 'active'`, [id]);
    const activePaymentAmount = Number(paymentResult.rows[0]?.amount || 0);
    if (merged.status === 'paid' && current.status !== 'paid' && activePaymentAmount < Number(merged.total) - 0.005) {
      throw invoiceError('Bitte den Zahlungseingang an der Rechnung erfassen. Der Status wird nach vollständiger Zahlung automatisch gesetzt.', 409);
    }
    if (activePaymentAmount > 0) {
      if (activePaymentAmount >= Number(merged.total) - 0.005) merged.status = 'paid';
      else if (current.status === 'paid') {
        merged.status = String(merged.dueDate).slice(0, 10) < new Date().toISOString().slice(0, 10) ? 'overdue' : 'sent';
      }
    }

    // Positionen vor dem Statuswechsel schreiben, damit das Ausstellen die
    // fertig berechnete Fassung sperrt. Alle Schritte teilen eine Transaktion.
    if (money) {
      await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [id]);
      for (let i = 0; i < money.items.length; i++) {
        const item = money.items[i];
        await client.query(`INSERT INTO invoice_items
          (invoice_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, item.description, item.quantity, item.unitPrice, item.taxRate, item.total, i + 1,
          item.discountType, item.discountValue, item.discountAmount]);
      }
    }
    if (data.attachments !== undefined) {
      await client.query('DELETE FROM invoice_attachments WHERE invoice_id = $1', [id]);
      for (const attachment of data.attachments) {
        await client.query(`INSERT INTO invoice_attachments (invoice_id, name, content, content_type, size)
          VALUES ($1,$2,$3,$4,$5)`, [id, attachment.name, attachment.content, attachment.contentType, attachment.size]);
      }
    }
    await client.query(`UPDATE invoices SET customer_id=$1, customer_name=$2, issue_date=$3, due_date=$4,
      subtotal=$5, tax_amount=$6, total=$7, status=$8, notes=$9, global_discount_type=$10,
      global_discount_value=$11, global_discount_amount=$12, reference_invoice_id=$13,
      credit_note_reason=$14, document_snapshot=$15 WHERE id=$16`,
    [merged.customerId, merged.customerName, merged.issueDate, merged.dueDate, merged.subtotal,
      merged.taxAmount, merged.total, merged.status, merged.notes, merged.globalDiscountType,
      merged.globalDiscountValue, merged.globalDiscountAmount, merged.referenceInvoiceId,
      merged.creditNoteReason, merged.documentSnapshot ? JSON.stringify(merged.documentSnapshot) : null, id]);
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
