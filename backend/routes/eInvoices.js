import express from 'express';
import { createHash } from 'node:crypto';
import { query } from '../database.js';

const router = express.Router();
const MAX_XML_SIZE = 10 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const invoiceFields = `
  id, filename, content_type, size, sha256, format, validation_status,
  validation_error, invoice_number, issue_date, currency, supplier_name,
  supplier_tax_id, buyer_reference, gross_amount, extracted_data,
  linked_customer_id, received_at, updated_at
`;

function decodeXmlText(value) {
  const codePoint = (raw, radix) => {
    const code = parseInt(raw, radix);
    return Number.isFinite(code) && code >= 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : '';
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => codePoint(code, 16))
    .replace(/&#(\d+);/g, (_, code) => codePoint(code, 10))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

function xmlValue(xml, localNames) {
  for (const localName of localNames) {
    const pattern = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${localName}\\b[^>]*>([^<]*)<\\/`, 'i');
    const match = xml.match(pattern);
    if (match) return decodeXmlText(match[1]);
  }
  return '';
}

function sectionValue(xml, sectionNames, fieldNames) {
  const sectionPattern = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?(?:${sectionNames.join('|')})\\b[^>]*>`, 'i');
  const match = sectionPattern.exec(xml);
  return xmlValue(match ? xml.slice(match.index, match.index + 16000) : xml, fieldNames);
}

function normaliseDate(value) {
  const compact = value.replace(/-/g, '').slice(0, 8);
  if (!/^\d{8}$/.test(compact)) return null;
  const date = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  return Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? null : date;
}

function normaliseAmount(value) {
  if (!value) return null;
  const amount = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(amount) ? amount : null;
}

export function parseIncomingXml(buffer) {
  const xml = buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (!xml.trim() || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    return { error: 'Leere XML-Datei oder unsichere externe XML-Entität.' };
  }

  const rootMatch = xml.match(/<(?:(?:[A-Za-z_][\w.-]*):)?(Invoice|CrossIndustryInvoice)\b/i);
  if (!rootMatch) return { error: 'Das Dokument ist keine unterstützte XRechnung- oder CII-XML-Datei.' };
  const rootName = rootMatch[1];
  const closingRoot = new RegExp(`<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${rootName}>\\s*$`, 'i');
  if (!closingRoot.test(xml) || /&(?!amp;|lt;|gt;|quot;|apos;|#(?:x[0-9a-f]+|\d+);)/i.test(xml)) {
    return { error: 'Die XML-Datei ist nicht wohlgeformt.' };
  }

  const format = rootName.toLowerCase() === 'invoice' ? 'XRechnung' : 'ZUGFeRD';
  const invoiceNumber = xmlValue(xml, ['ID']);
  const issueDate = normaliseDate(xmlValue(xml, ['IssueDate', 'DateTimeString']));
  const currency = xmlValue(xml, ['DocumentCurrencyCode', 'InvoiceCurrencyCode']).toUpperCase().slice(0, 3);
  const supplierName = sectionValue(xml, ['AccountingSupplierParty', 'SellerTradeParty'], ['RegistrationName', 'Name']);
  const supplierTaxId = sectionValue(xml, ['AccountingSupplierParty', 'SellerTradeParty'], ['CompanyID']);
  const buyerReference = xmlValue(xml, ['BuyerReference']);
  const grossAmount = normaliseAmount(xmlValue(xml, ['PayableAmount', 'GrandTotalAmount']));
  const missing = [
    !invoiceNumber && 'Rechnungsnummer',
    !issueDate && 'Rechnungsdatum',
    !currency && 'Währung',
  ].filter(Boolean);
  const validationError = missing.length ? `Pflichtfelder fehlen: ${missing.join(', ')}.` : null;

  return {
    format,
    invoiceNumber: invoiceNumber || null,
    issueDate,
    currency: currency || null,
    supplierName: supplierName || null,
    supplierTaxId: supplierTaxId || null,
    buyerReference: buyerReference || null,
    grossAmount,
    validationError,
    extractedData: {
      invoiceNumber: invoiceNumber || undefined,
      issueDate: issueDate || undefined,
      currency: currency || undefined,
      supplierName: supplierName || undefined,
      supplierTaxId: supplierTaxId || undefined,
      buyerReference: buyerReference || undefined,
      grossAmount: grossAmount ?? undefined,
    },
  };
}

function toIncomingInvoice(row, includeContent = false) {
  return {
    id: row.id,
    filename: row.filename,
    ...(includeContent ? { content: row.content } : {}),
    contentType: row.content_type,
    size: Number(row.size),
    sha256: row.sha256,
    format: row.format,
    validationStatus: row.validation_status,
    validationError: row.validation_error || undefined,
    invoiceNumber: row.invoice_number || undefined,
    issueDate: row.issue_date || undefined,
    currency: row.currency || undefined,
    supplierName: row.supplier_name || undefined,
    supplierTaxId: row.supplier_tax_id || undefined,
    buyerReference: row.buyer_reference || undefined,
    grossAmount: row.gross_amount === null || row.gross_amount === undefined ? undefined : Number(row.gross_amount),
    extractedData: row.extracted_data || {},
    linkedCustomerId: row.linked_customer_id || undefined,
    receivedAt: row.received_at,
    updatedAt: row.updated_at,
  };
}

function decodeBase64(value) {
  const encoded = String(value || '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Die XML-Datei ist nicht korrekt base64-kodiert.');
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > MAX_XML_SIZE) throw new Error('Die XML-Datei darf höchstens 10 MB groß sein.');
  return buffer;
}

router.get('/', async (req, res, next) => {
  try {
    const result = await query(`SELECT ${invoiceFields} FROM incoming_e_invoices ORDER BY received_at DESC`);
    res.json(result.rows.map(row => toIncomingInvoice(row)));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const filename = String(req.body?.filename || '').trim().slice(0, 255);
    const contentType = String(req.body?.contentType || 'application/xml').toLowerCase();
    if (!filename || !/\.xml$/i.test(filename)) return res.status(400).json({ error: 'Bitte eine XML-Datei mit Dateiendung .xml auswählen.' });
    if (!['application/xml', 'text/xml'].includes(contentType)) return res.status(400).json({ error: 'Der E-Rechnungseingang unterstützt derzeit XML-Dateien.' });

    const buffer = decodeBase64(req.body?.content);
    const parsed = parseIncomingXml(buffer);
    if (parsed.error && !parsed.format) return res.status(400).json({ error: parsed.error });
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const result = await query(`
      INSERT INTO incoming_e_invoices (
        workspace_id, filename, content, content_type, size, sha256, format,
        validation_status, validation_error, invoice_number, issue_date, currency,
        supplier_name, supplier_tax_id, buyer_reference, gross_amount, extracted_data
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING ${invoiceFields}
    `, [
      req.auth.workspaceId,
      filename,
      buffer.toString('base64'),
      contentType,
      buffer.length,
      sha256,
      parsed.format,
      parsed.validationError ? 'rejected' : 'validated',
      parsed.validationError,
      parsed.invoiceNumber,
      parsed.issueDate,
      parsed.currency,
      parsed.supplierName,
      parsed.supplierTaxId,
      parsed.buyerReference,
      parsed.grossAmount,
      JSON.stringify(parsed.extractedData),
    ]);
    res.status(201).json(toIncomingInvoice(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(`SELECT content, ${invoiceFields} FROM incoming_e_invoices WHERE id = $1`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'E-Rechnung nicht gefunden.' });
    res.json(toIncomingInvoice(result.rows[0], true));
  } catch (error) {
    next(error);
  }
});

router.post('/:id/link-customer', async (req, res, next) => {
  try {
    const customerId = String(req.body?.customerId || '');
    if (!UUID_PATTERN.test(customerId)) return res.status(400).json({ error: 'Bitte einen gültigen Kunden auswählen.' });
    const customer = await query('SELECT id FROM customers WHERE id = $1', [customerId]);
    if (!customer.rows.length) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
    const result = await query(`
      UPDATE incoming_e_invoices
      SET linked_customer_id = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING ${invoiceFields}
    `, [customerId, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'E-Rechnung nicht gefunden.' });
    res.json(toIncomingInvoice(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

export default router;
