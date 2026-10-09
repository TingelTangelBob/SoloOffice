export interface DashboardRevenueRecord {
  customerName: string;
  date: Date;
  amount: number;
}

function localDate(value: Date | string | number) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10))) return new Date(`${value.slice(0, 10)}T00:00:00`);
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function buildRevenueRecords({ invoices, euerEntries, customers, includeUnpaidInvoices }: {
  invoices: { id: string; issueDate: Date | string; status: string; total: number; customerName?: string; sourceJobsEligible?: boolean }[];
  euerEntries: { entryType: string; sourceType?: string; sourceId?: string | null; entryDate: Date | string; amount: number; status?: string; customerId?: string | null }[];
  customers: { id: string; name: string }[];
  includeUnpaidInvoices: boolean;
}): DashboardRevenueRecord[] {
  const records: DashboardRevenueRecord[] = [];
  const payments = euerEntries.filter(entry => entry.entryType === 'income' && entry.sourceType === 'invoice_payment'
    && entry.sourceId && entry.status !== 'voided' && Number(entry.amount) > 0);
  const byInvoice = new Map<string, typeof payments>();
  payments.forEach(payment => byInvoice.set(payment.sourceId!, [...(byInvoice.get(payment.sourceId!) || []), payment]));
  invoices.forEach(invoice => {
    if (invoice.sourceJobsEligible === false) return;
    const invoicePayments = byInvoice.get(invoice.id) || [];
    if (invoicePayments.length) invoicePayments.forEach(payment => records.push({
      customerName: invoice.customerName?.trim() || 'Ohne Zuordnung', date: localDate(payment.entryDate), amount: Number(payment.amount),
    }));
    else if (invoice.status === 'paid') records.push({
      customerName: invoice.customerName?.trim() || 'Ohne Zuordnung', date: localDate(invoice.issueDate), amount: Number(invoice.total),
    });
    if (includeUnpaidInvoices && invoice.status !== 'draft' && invoice.status !== 'paid') {
      const openAmount = Math.max(0, Number(invoice.total) - invoicePayments.reduce((sum, payment) => sum + Number(payment.amount), 0));
      if (openAmount > 0) records.push({ customerName: invoice.customerName?.trim() || 'Ohne Zuordnung', date: localDate(invoice.issueDate), amount: openAmount });
    }
  });
  const names = new Map(customers.map(customer => [customer.id, customer.name]));
  euerEntries.filter(entry => entry.entryType === 'income' && (entry.sourceType || 'manual') === 'manual'
    && entry.status !== 'voided' && Number(entry.amount) > 0).forEach(entry => records.push({
    customerName: (entry.customerId && names.get(entry.customerId)) || 'Ohne Zuordnung', date: localDate(entry.entryDate), amount: Number(entry.amount),
  }));
  return records;
}

export function aggregateRevenue(records: DashboardRevenueRecord[], year: number | 'all', locale = 'de-DE') {
  const selected = year === 'all' ? records : records.filter(record => record.date.getFullYear() === year);
  const years = [...new Set(selected.map(record => record.date.getFullYear()))].sort((a, b) => a - b);
  const byYear = year === 'all' && years.length > 1;
  const monthlyYear = typeof year === 'number' ? year : years.length === 1 ? years[0] : null;
  const buckets = new Map<string, { label: string; shortLabel: string; value: number }>();
  selected.forEach(record => {
    const actualYear = record.date.getFullYear();
    const month = record.date.getMonth();
    const key = byYear ? String(actualYear) : `${actualYear}-${String(month + 1).padStart(2, '0')}`;
    const date = new Date(actualYear, byYear ? 0 : month, 1);
    const label = byYear ? String(actualYear) : new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date);
    const shortLabel = byYear ? String(actualYear) : new Intl.DateTimeFormat(locale, { month: 'short' }).format(date).replace('.', '');
    const current = buckets.get(key) || { label, shortLabel, value: 0 };
    current.value += record.amount;
    buckets.set(key, current);
  });
  if (monthlyYear !== null) {
    for (let month = 0; month < 12; month += 1) {
      const date = new Date(monthlyYear, month, 1);
      const key = `${monthlyYear}-${String(month + 1).padStart(2, '0')}`;
      if (!buckets.has(key)) buckets.set(key, {
        label: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date),
        shortLabel: new Intl.DateTimeFormat(locale, { month: 'short' }).format(date).replace('.', ''), value: 0,
      });
    }
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, point]) => ({ key, ...point }));
}

export function sumRevenue(points: { value: number }[]) {
  return points.reduce((sum, point) => sum + point.value, 0);
}

export function compareRevenue(current: number, previous: number) {
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}
