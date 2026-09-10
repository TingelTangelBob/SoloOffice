import { invoiceDateParts } from './invoiceNumberPattern.js';

const statuses = new Set(['draft', 'sent', 'paid', 'overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x']);
export const INVOICE_CONTENT_FIELDS = [
  'customerId', 'customerName', 'issueDate', 'dueDate', 'items', 'attachments', 'notes',
  'globalDiscountType', 'globalDiscountValue', 'globalDiscountAmount',
  'referenceInvoiceId', 'creditNoteReason', 'recurringInvoiceId',
  'subtotal', 'taxAmount', 'total', 'documentType', 'documentSnapshot', 'invoiceNumber',
];

export function invoiceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function validateInvoiceUpdate(current, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invoiceError('Ungültige Rechnungsdaten.');
  if (data.documentType !== undefined && data.documentType !== (current.document_type || 'invoice')) {
    throw invoiceError('Die Dokumentart kann nach dem Anlegen nicht geändert werden.', 409);
  }
  if (current.status !== 'draft' && (data.status === 'draft' || INVOICE_CONTENT_FIELDS.some(key => data[key] !== undefined))) {
    throw invoiceError('Diese Rechnung ist bereits ausgestellt. Für inhaltliche Korrekturen bitte eine Gutschrift und bei Bedarf eine neue Rechnung erstellen.', 409);
  }
}

export function validateInvoiceHeader({ status, issueDate, dueDate, customerId, items }) {
  if (!statuses.has(status)) throw invoiceError('Ungültiger Rechnungsstatus.');
  if (!invoiceDateParts(issueDate) || !invoiceDateParts(dueDate)) throw invoiceError('Rechnungs- und Fälligkeitsdatum müssen gültige Datumswerte sein.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(customerId))) throw invoiceError('Bitte einen gültigen Kunden auswählen.');
  if (status !== 'draft' && items.length === 0) throw invoiceError('Zum Ausstellen muss die Rechnung mindestens eine Position enthalten.');
}
