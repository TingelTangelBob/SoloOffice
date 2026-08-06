import { query } from '../database.js';

function mapInvoice(row) {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    documentType: row.document_type || 'invoice',
    referenceInvoiceId: row.reference_invoice_id,
    referenceInvoiceNumber: row.reference_invoice_number,
    sourceQuoteId: row.source_quote_id,
    sourceQuoteNumber: row.source_quote_number,
    creditNoteReason: row.credit_note_reason,
    recurringInvoiceId: row.recurring_invoice_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    items: row.items || [],
    attachments: row.attachments || [],
    sourceJobs: row.source_jobs || [],
    subtotal: parseFloat(row.subtotal),
    taxAmount: parseFloat(row.tax_amount),
    total: parseFloat(row.total),
    status: row.status,
    notes: row.notes,
    globalDiscountType: row.global_discount_type,
    globalDiscountValue: row.global_discount_value !== null ? parseFloat(row.global_discount_value) : null,
    globalDiscountAmount: row.global_discount_amount !== null ? parseFloat(row.global_discount_amount) : null,
    createdAt: row.created_at,
  };
}

const itemSelect = `
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', ii.id, 'description', ii.description, 'quantity', ii.quantity,
    'unitPrice', ii.unit_price, 'taxRate', ii.tax_rate, 'total', ii.total,
    'order', ii.item_order, 'discountType', ii.discount_type,
    'discountValue', ii.discount_value, 'discountAmount', ii.discount_amount
  ) ORDER BY ii.item_order) FROM invoice_items ii WHERE ii.invoice_id = i.id), '[]'::jsonb) AS items,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', ia.id, 'name', ia.name, 'content', ia.content, 'contentType', ia.content_type,
    'size', ia.size, 'uploadedAt', ia.uploaded_at
  ) ORDER BY ia.uploaded_at) FROM invoice_attachments ia WHERE ia.invoice_id = i.id), '[]'::jsonb) AS attachments
  , COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', ijs.id, 'jobId', ijs.job_id, 'jobNumber', ijs.job_number,
    'externalJobNumber', ijs.external_job_number, 'title', ijs.title,
    'jobDate', ijs.job_date, 'recurrenceIndex', ijs.recurrence_index
  ) ORDER BY ijs.job_date, ijs.job_number) FROM invoice_job_sources ijs WHERE ijs.invoice_id = i.id), '[]'::jsonb) AS source_jobs
`;

export async function findAllInvoices() {
  const result = await query(`SELECT i.*, referenced.invoice_number AS reference_invoice_number, source_quote.quote_number AS source_quote_number, ${itemSelect} FROM invoices i LEFT JOIN invoices referenced ON referenced.id = i.reference_invoice_id LEFT JOIN quotes source_quote ON source_quote.id = i.source_quote_id WHERE COALESCE(i.document_type, 'invoice') = 'invoice' ORDER BY i.created_at DESC`);
  return result.rows.map(mapInvoice);
}

export async function findAllCreditNotes() {
  const result = await query(`SELECT i.*, referenced.invoice_number AS reference_invoice_number, source_quote.quote_number AS source_quote_number, ${itemSelect} FROM invoices i LEFT JOIN invoices referenced ON referenced.id = i.reference_invoice_id LEFT JOIN quotes source_quote ON source_quote.id = i.source_quote_id WHERE i.document_type = 'credit_note' ORDER BY i.created_at DESC`);
  return result.rows.map(mapInvoice);
}

export async function findInvoiceById(id) {
  const result = await query(`SELECT i.*, referenced.invoice_number AS reference_invoice_number, source_quote.quote_number AS source_quote_number, ${itemSelect} FROM invoices i LEFT JOIN invoices referenced ON referenced.id = i.reference_invoice_id LEFT JOIN quotes source_quote ON source_quote.id = i.source_quote_id WHERE i.id = $1`, [id]);
  return result.rows.length ? mapInvoice(result.rows[0]) : null;
}
