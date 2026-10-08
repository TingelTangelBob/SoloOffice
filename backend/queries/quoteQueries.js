import { query } from '../database.js';

export async function findAllQuotes() {
  const result = await query(`
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
        GROUP BY quote_id
      ) attachments_subquery ON q.id = attachments_subquery.quote_id
      ORDER BY q.issue_date DESC, q.quote_number DESC, q.created_at DESC
    `);

  return result.rows.map(row => ({
    id: row.id,
    quoteNumber: row.quote_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    issueDate: row.issue_date,
    validUntil: row.valid_until,
    items: row.items || [],
    attachments: row.attachments || [],
    subtotal: parseFloat(row.subtotal),
    taxAmount: parseFloat(row.tax_amount),
    total: parseFloat(row.total),
    status: row.status,
    notes: row.notes,
    globalDiscountType: row.global_discount_type,
    globalDiscountValue: row.global_discount_value ? parseFloat(row.global_discount_value) : null,
    globalDiscountAmount: row.global_discount_amount ? parseFloat(row.global_discount_amount) : null,
    convertedToInvoiceId: row.converted_to_invoice_id,
    createdAt: row.created_at
  }));
}

export async function findQuoteById(id) {
  const result = await query(`
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
    `, [id]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    quoteNumber: row.quote_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    issueDate: row.issue_date,
    validUntil: row.valid_until,
    items: row.items || [],
    attachments: row.attachments || [],
    subtotal: parseFloat(row.subtotal),
    taxAmount: parseFloat(row.tax_amount),
    total: parseFloat(row.total),
    status: row.status,
    notes: row.notes,
    globalDiscountType: row.global_discount_type,
    globalDiscountValue: row.global_discount_value ? parseFloat(row.global_discount_value) : null,
    globalDiscountAmount: row.global_discount_amount ? parseFloat(row.global_discount_amount) : null,
    convertedToInvoiceId: row.converted_to_invoice_id,
    createdAt: row.created_at
  };
}
