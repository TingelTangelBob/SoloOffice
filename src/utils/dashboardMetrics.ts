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

/* ------------------------------------------------------------------------
 * Zusätzliche Kacheln. Alle Funktionen arbeiten nur mit Daten, die die
 * Übersicht ohnehin lädt (Rechnungen, EÜR-Buchungen, Aufträge, Angebote).
 * ---------------------------------------------------------------------- */

type InvoiceLike = {
  id: string;
  invoiceNumber?: string;
  customerId?: string;
  customerName?: string;
  issueDate: Date | string;
  dueDate?: Date | string;
  status: string;
  total: number;
  outstandingAmount?: number;
  documentType?: string;
};
type EuerLike = { entryType: string; sourceType?: string; sourceId?: string | null; entryDate: Date | string; amount: number; status?: string };

const isRegularInvoice = (invoice: InvoiceLike) => invoice.documentType !== 'credit_note';
const inYear = (date: Date, year: number | 'all') => year === 'all' || date.getFullYear() === year;
const roundCents = (value: number) => Math.round(value * 100) / 100;

function paymentsByInvoice(euerEntries: EuerLike[]) {
  const totals = new Map<string, number>();
  euerEntries.forEach(entry => {
    if (entry.entryType !== 'income' || entry.sourceType !== 'invoice_payment' || !entry.sourceId || entry.status === 'voided') return;
    totals.set(entry.sourceId, (totals.get(entry.sourceId) || 0) + Number(entry.amount || 0));
  });
  return totals;
}

export interface OpenInvoiceItem<T extends InvoiceLike = InvoiceLike> { invoice: T; outstanding: number; overdue: boolean; dueDate: Date }

/**
 * Offene Posten zum heutigen Tag – bewusst ohne Jahresfilter, weil eine
 * offene Forderung aus dem Vorjahr heute genauso offen ist.
 */
export function summarizeOpenInvoices<T extends InvoiceLike>(invoices: T[], euerEntries: EuerLike[], today: Date) {
  const payments = paymentsByInvoice(euerEntries);
  const day = localDate(today);
  const items: OpenInvoiceItem<T>[] = invoices
    .filter(invoice => isRegularInvoice(invoice) && invoice.status !== 'draft' && invoice.status !== 'paid')
    .map(invoice => {
      const outstanding = typeof invoice.outstandingAmount === 'number' && Number.isFinite(invoice.outstandingAmount)
        ? invoice.outstandingAmount
        : Math.max(0, Number(invoice.total || 0) - (payments.get(invoice.id) || 0));
      const dueDate = localDate(invoice.dueDate ?? invoice.issueDate);
      return { invoice, outstanding: roundCents(outstanding), overdue: dueDate < day, dueDate };
    })
    .filter(item => item.outstanding > 0)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const overdue = items.filter(item => item.overdue);
  return {
    items,
    total: roundCents(items.reduce((sum, item) => sum + item.outstanding, 0)),
    overdueCount: overdue.length,
    overdueTotal: roundCents(overdue.reduce((sum, item) => sum + item.outstanding, 0)),
  };
}

export interface IncomeExpensePoint { key: string; label: string; shortLabel: string; income: number; expenses: number }

/**
 * Einnahmen und Ausgaben wie in der EÜR: aktive Buchungen nach Buchungsdatum,
 * dazu bezahlte Rechnungen ohne erfassten Zahlungseingang nach
 * Rechnungsdatum. Stornierte Buchungen zählen nicht.
 */
export function summarizeIncomeExpense({ invoices, euerEntries, year, locale = 'de-DE' }: {
  invoices: InvoiceLike[];
  euerEntries: EuerLike[];
  year: number | 'all';
  locale?: string;
}) {
  const linked = new Set(euerEntries.filter(entry => entry.sourceType === 'invoice_payment' && entry.sourceId).map(entry => entry.sourceId));
  const rows: { date: Date; income: number; expenses: number }[] = [];
  invoices.forEach(invoice => {
    if (!isRegularInvoice(invoice) || invoice.status !== 'paid' || linked.has(invoice.id)) return;
    rows.push({ date: localDate(invoice.issueDate), income: Number(invoice.total || 0), expenses: 0 });
  });
  euerEntries.forEach(entry => {
    if (entry.status === 'voided') return;
    const amount = Number(entry.amount || 0);
    if (entry.entryType === 'income') rows.push({ date: localDate(entry.entryDate), income: amount, expenses: 0 });
    else if (entry.entryType === 'expense') rows.push({ date: localDate(entry.entryDate), income: 0, expenses: amount });
  });
  const selected = rows.filter(row => inYear(row.date, year));
  const years = [...new Set(selected.map(row => row.date.getFullYear()))].sort((a, b) => a - b);
  const byYear = year === 'all' && years.length > 1;
  const monthlyYear = typeof year === 'number' ? year : years.length === 1 ? years[0] : null;
  const buckets = new Map<string, IncomeExpensePoint>();
  const bucket = (actualYear: number, month: number) => {
    const key = byYear ? String(actualYear) : `${actualYear}-${String(month + 1).padStart(2, '0')}`;
    if (!buckets.has(key)) {
      const date = new Date(actualYear, byYear ? 0 : month, 1);
      buckets.set(key, {
        key,
        label: byYear ? String(actualYear) : new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date),
        shortLabel: byYear ? String(actualYear) : new Intl.DateTimeFormat(locale, { month: 'short' }).format(date).replace('.', ''),
        income: 0,
        expenses: 0,
      });
    }
    return buckets.get(key)!;
  };
  if (monthlyYear !== null && !byYear) for (let month = 0; month < 12; month += 1) bucket(monthlyYear, month);
  selected.forEach(row => {
    const point = bucket(row.date.getFullYear(), row.date.getMonth());
    point.income += row.income;
    point.expenses += row.expenses;
  });
  const points = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key))
    .map(point => ({ ...point, income: roundCents(point.income), expenses: roundCents(point.expenses) }));
  const income = roundCents(points.reduce((sum, point) => sum + point.income, 0));
  const expenses = roundCents(points.reduce((sum, point) => sum + point.expenses, 0));
  return { points, income, expenses, result: roundCents(income - expenses) };
}

/**
 * Durchschnittlicher Rechnungsbetrag nach Rechnungsdatum. Mit „Nur bezahlte
 * Rechnungen“ zählen nur bezahlte, sonst alle festgeschriebenen (keine Entwürfe).
 */
export function averageInvoiceAmount(invoices: InvoiceLike[], year: number | 'all', paidOnly: boolean) {
  const selected = invoices.filter(invoice => isRegularInvoice(invoice) && invoice.status !== 'draft'
    && (!paidOnly || invoice.status === 'paid') && inYear(localDate(invoice.issueDate), year));
  const total = selected.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  return { count: selected.length, average: selected.length ? roundCents(total / selected.length) : 0, total: roundCents(total) };
}

/** Kunden mit mindestens einer festgeschriebenen Rechnung oder einem Termin im Zeitraum. */
export function countActiveCustomers({ invoices, jobs, year }: {
  invoices: InvoiceLike[];
  jobs: { customerId?: string; date: Date | string }[];
  year: number | 'all';
}) {
  const ids = new Set<string>();
  invoices.forEach(invoice => {
    if (invoice.customerId && isRegularInvoice(invoice) && invoice.status !== 'draft' && inYear(localDate(invoice.issueDate), year)) ids.add(invoice.customerId);
  });
  jobs.forEach(job => {
    if (job.customerId && inYear(localDate(job.date), year)) ids.add(job.customerId);
  });
  return ids.size;
}

/** Nächste Termine ab heute, chronologisch, inklusive heute. */
export function upcomingJobs<T extends { date: Date | string; startTime?: string; status?: string }>(jobs: T[], today: Date, limit = 5) {
  const day = localDate(today);
  return jobs
    .map(job => ({ job, date: localDate(job.date) }))
    .filter(({ date }) => date >= day)
    .sort((a, b) => a.date.getTime() - b.date.getTime() || (a.job.startTime || '').localeCompare(b.job.startTime || ''))
    .slice(0, limit);
}

/** Versendete Angebote ohne Antwort, nach Gültigkeit sortiert. */
export function summarizeOpenQuotes<T extends { status: string; validUntil: Date | string; total: number }>(quotes: T[], today: Date) {
  const day = localDate(today);
  const items = quotes
    .filter(quote => quote.status === 'sent')
    .map(quote => ({ quote, validUntil: localDate(quote.validUntil), expired: localDate(quote.validUntil) < day }))
    .sort((a, b) => a.validUntil.getTime() - b.validUntil.getTime());
  return { items, total: roundCents(items.reduce((sum, item) => sum + Number(item.quote.total || 0), 0)) };
}
