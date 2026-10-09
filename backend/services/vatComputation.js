import { query } from '../database.js';
import { getTaxProfile } from './taxProfiles.js';
import { computeVat } from '../shared/vat/index.js';
import { assertDateOnly } from '../shared/recurrence.js';
import { VAT_PAYMENT_SELECT } from './vatPayments.js';

const dateOnly = (value, label) => value == null ? null : assertDateOnly(value, label);

function mapInvoice(row, itemRows) {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    documentType: row.document_type || 'invoice',
    status: row.status,
    issueDate: dateOnly(row.issue_date, 'Rechnungsdatum'),
    serviceDate: dateOnly(row.service_date, 'Leistungsdatum'),
    total: Number(row.total),
    taxAmount: Number(row.tax_amount),
    items: itemRows.map(item => ({
      id: item.id,
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      taxRate: Number(item.tax_rate),
      discountType: item.discount_type,
      discountValue: item.discount_value == null ? null : Number(item.discount_value),
      discountAmount: item.discount_amount == null ? null : Number(item.discount_amount),
      order: item.item_order,
    })),
    globalDiscountType: row.global_discount_type,
    globalDiscountValue: row.global_discount_value == null ? null : Number(row.global_discount_value),
    globalDiscountAmount: row.global_discount_amount == null ? null : Number(row.global_discount_amount),
  };
}

function mapEntry(row) {
  return {
    id: row.id,
    entryType: row.entry_type,
    entryDate: dateOnly(row.entry_date, 'Zahlungsdatum'),
    documentDate: dateOnly(row.document_date, 'Belegdatum'),
    description: row.description,
    category: row.category,
    amount: Number(row.amount),
    taxRate: row.tax_rate == null ? null : Number(row.tax_rate),
    vatTreatment: row.vat_treatment || null,
    netAmount: row.net_amount == null ? null : Number(row.net_amount),
    vatAmount: row.vat_amount == null ? null : Number(row.vat_amount),
    inputTaxDeductible: row.input_tax_deductible ?? null,
    sourceType: row.source_type,
    sourceId: row.source_id,
    status: row.status,
    euerYear: row.euer_year == null ? null : Number(row.euer_year),
  };
}

function mapPayment(row) {
  return {
    id: row.id,
    kind: row.kind,
    taxYear: Number(row.tax_year),
    periodKey: row.period_key || null,
    dueDate: dateOnly(row.due_date, 'Fälligkeit'),
    paidOn: dateOnly(row.paid_on, 'Zahlungsdatum'),
    amount: Number(row.amount),
    euerEntryId: row.euer_entry_id || null,
    // Gebuchte Zahlungen behalten das EÜR-Jahr ihrer Buchung, auch wenn sich das Profil später ändert.
    euerYear: row.euer_year != null ? Number(row.euer_year)
      : row.euer_entry_id && row.paid_on ? Number(dateOnly(row.paid_on, 'Zahlungsdatum').slice(0, 4)) : null,
    source: row.source,
    notes: row.notes || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadVatData(year, queryFn) {
  const [profile, invoiceResult, paymentEntryResult, entryResult, paymentsResult] = await Promise.all([
    getTaxProfile(year, queryFn),
    queryFn(`SELECT i.id,i.invoice_number,i.document_type,i.status,i.issue_date,i.service_date,i.total,i.tax_amount,
        i.global_discount_type,i.global_discount_value,i.global_discount_amount
      FROM invoices i
      WHERE i.status <> 'draft' AND COALESCE(i.document_type,'invoice') IN ('invoice','credit_note')
        AND (
          (COALESCE(i.service_date,i.issue_date) >= make_date($1,1,1) AND COALESCE(i.service_date,i.issue_date) < make_date($1+1,1,1))
          OR EXISTS (SELECT 1 FROM euer_entries ep WHERE ep.source_type='invoice_payment' AND ep.source_id=i.id
            AND ep.status='active' AND ep.entry_date >= make_date($1,1,1) AND ep.entry_date < make_date($1+1,1,1))
        )`, [year]),
    queryFn(`SELECT DISTINCT i.id
      FROM invoices i JOIN euer_entries ep ON ep.source_type='invoice_payment' AND ep.source_id=i.id
      WHERE i.status <> 'draft' AND COALESCE(i.document_type,'invoice') IN ('invoice','credit_note')
        AND ep.status='active' AND ep.entry_date >= make_date($1,1,1) AND ep.entry_date < make_date($1+1,1,1)`, [year]),
    queryFn(`SELECT id,entry_type,entry_date,document_date,description,category,amount,tax_rate,vat_treatment,
        net_amount,vat_amount,input_tax_deductible,source_type,source_id,status,euer_year
      FROM euer_entries WHERE status='active' AND (
        (entry_date >= make_date($1,1,1) AND entry_date < make_date($1+1,1,1)) OR
        (document_date >= make_date($1,1,1) AND document_date < make_date($1+1,1,1))
      )`, [year]),
    queryFn(`${VAT_PAYMENT_SELECT} WHERE vp.tax_year BETWEEN $1 AND $2 ORDER BY vp.tax_year,vp.period_key,vp.due_date`, [year - 1, year + 1]),
  ]);

  const invoiceIds = invoiceResult.rows.map(row => row.id);
  const itemResult = invoiceIds.length ? await queryFn(`SELECT invoice_id,id,description,quantity,unit_price,tax_rate,discount_type,discount_value,discount_amount,item_order
    FROM invoice_items WHERE invoice_id = ANY($1::uuid[]) ORDER BY invoice_id,item_order,id`, [invoiceIds]) : { rows: [] };
  const byInvoice = new Map();
  for (const item of itemResult.rows) {
    if (!byInvoice.has(item.invoice_id)) byInvoice.set(item.invoice_id, []);
    byInvoice.get(item.invoice_id).push(item);
  }
  const paidIds = new Set(paymentEntryResult.rows.map(row => row.id));
  return {
    profile,
    invoices: invoiceResult.rows.map(row => ({ ...mapInvoice(row, byInvoice.get(row.id) || []), hasPaymentInYear: paidIds.has(row.id) })),
    entries: entryResult.rows.map(mapEntry),
    payments: paymentsResult.rows.map(mapPayment),
  };
}

function engineProfile(profile) {
  return {
    year: profile.year,
    vatStatus: profile.vatStatus || null,
    vatAccounting: profile.vatAccounting ?? null,
    vatPeriod: profile.vatPeriod || 'quarterly',
    vatPermanentExtension: profile.vatPermanentExtension === true,
    vatSpecialPrepayment: profile.vatSpecialPrepayment ?? null,
    previousYearVatLiability: profile.previousYearVatLiability ?? null,
    businessKind: profile.businessKind || null,
    educationCertificateUntil: profile.educationCertificateUntil || null,
    startedOn: profile.startedOn || null,
  };
}

function toInput(year, data, now, previousYearAdvanceTotal = null) {
  return {
    year,
    profile: engineProfile(data.profile),
    invoices: data.invoices,
    entries: data.entries,
    payments: data.payments,
    previousYearAdvanceTotal,
    now,
  };
}

/** Lädt und berechnet die Umsatzsteuerübersicht für ein Jahr im aktuellen Workspace. */
export async function computeVatForYear(year, { queryFn = query, now = new Date() } = {}) {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new RangeError('Ungültiges Steuerjahr.');
  const current = await loadVatData(year, queryFn);
  let previousYearAdvanceTotal = null;
  if (year > 2000) {
    const previous = await loadVatData(year - 1, queryFn);
    const hasPriorData = previous.invoices.length > 0 || previous.entries.length > 0;
    if (hasPriorData) {
      const previousResult = computeVat(toInput(year - 1, previous, now, null));
      previousYearAdvanceTotal = Number(previousResult.periods.reduce((sum, period) =>
        sum + period.kennzahlen.kz83 + period.kennzahlen.kz39, 0).toFixed(2));
    }
  }
  const result = computeVat(toInput(year, current, now, previousYearAdvanceTotal));
  return { ...result, payments: current.payments };
}

export { mapPayment as mapVatPayment };
