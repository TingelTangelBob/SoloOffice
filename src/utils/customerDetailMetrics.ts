type InvoiceLike = {
  customerId?: string | null;
  status?: string | null;
  documentType?: string | null;
  issueDate?: Date | string | null;
  invoiceNumber?: string | null;
  total?: number | string | null;
  totalAmount?: number | string | null;
  grossAmount?: number | string | null;
  gross?: number | string | null;
  subtotal?: number | string | null;
  taxAmount?: number | string | null;
};

function invoiceAmount(invoice: InvoiceLike): number {
  const candidates = [invoice.total, invoice.totalAmount, invoice.grossAmount, invoice.gross];
  const amount = candidates.find(value => value !== undefined && value !== null && value !== '');
  if (amount !== undefined) {
    const parsed = Number(amount);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const subtotal = Number(invoice.subtotal);
  const tax = Number(invoice.taxAmount);
  return Number.isFinite(subtotal + tax) ? subtotal + tax : 0;
}

function invoiceYear(value: Date | string | null | undefined): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getFullYear();
  const match = /^(\d{4})/.exec(String(value ?? ''));
  return match ? Number(match[1]) : null;
}

function invoiceTime(value: Date | string | null | undefined): number {
  const date = value instanceof Date ? value : new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function calculateCustomerInvoiceMetrics<T extends InvoiceLike>(
  invoices: T[], customerId: string | undefined, currentYear: number,
) {
  const issuedInvoices = invoices.filter(invoice => invoice.customerId === customerId
    && invoice.documentType !== 'credit_note'
    && !['draft', 'voided', 'cancelled', 'canceled'].includes(String(invoice.status || '').toLowerCase()));
  const revenue = issuedInvoices.reduce((sum, invoice) => sum + invoiceAmount(invoice), 0);
  const revenueThisYear = issuedInvoices
    .filter(invoice => invoiceYear(invoice.issueDate) === currentYear)
    .reduce((sum, invoice) => sum + invoiceAmount(invoice), 0);
  const openAmount = issuedInvoices.reduce((sum, invoice) => {
    const total = invoiceAmount(invoice);
    const outstandingRaw = (invoice as T & { outstandingAmount?: number | string | null }).outstandingAmount;
    const outstanding = outstandingRaw === null || outstandingRaw === undefined ? Number.NaN : Number(outstandingRaw);
    const paid = Number((invoice as T & { paidAmount?: number | string | null }).paidAmount || 0);
    const balance = Number.isFinite(outstanding) ? outstanding : total - (Number.isFinite(paid) ? paid : 0);
    return sum + (String(invoice.status).toLowerCase() === 'paid' ? 0 : Math.max(0, balance));
  }, 0);
  const lastInvoice = [...issuedInvoices].sort((left, right) => invoiceTime(right.issueDate) - invoiceTime(left.issueDate))[0] ?? null;
  return { issuedInvoices, revenue, revenueThisYear, openAmount, lastInvoice };
}

function dateKey(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function upcomingCustomerJobs<T extends { customerId?: string; date: Date | string; startTime?: string; status?: string }>(
  jobs: T[], customerId: string | undefined, today: Date, limit = 5,
): T[] {
  const todayKey = dateKey(today);
  return jobs.filter(job => job.customerId === customerId
    && !['completed', 'cancelled', 'canceled'].includes(String(job.status || '').toLowerCase())
    && dateKey(job.date) >= todayKey)
    .sort((left, right) => dateKey(left.date).localeCompare(dateKey(right.date))
      || (left.startTime || '').localeCompare(right.startTime || ''))
    .slice(0, limit);
}
