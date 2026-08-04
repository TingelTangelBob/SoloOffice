import { generateUUID } from '../utils/uuid';

type DemoRecord = Record<string, unknown> & { id: string };

interface DemoState {
  customers: DemoRecord[];
  invoices: DemoRecord[];
  recurringInvoices: DemoRecord[];
  quotes: DemoRecord[];
  jobs: DemoRecord[];
  materialTemplates: DemoRecord[];
  hourlyRates: DemoRecord[];
  yearlyInvoiceStartNumbers: DemoRecord[];
  calendarEvents: DemoRecord[];
  euerEntries: DemoRecord[];
  company: DemoRecord;
}

const STORAGE_KEY = 'solooffice-demo-data-v1';

export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

const isoDate = (daysFromToday = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString();
};

function createInitialState(): DemoState {
  const customers: DemoRecord[] = [
    {
      id: generateUUID(), customerNumber: '1001', name: 'Musterkunde GmbH', email: 'kontakt@musterkunde.de',
      address: 'Hauptstraße 12', city: 'Berlin', postalCode: '10115', country: 'Deutschland', phone: '+49 30 123456', createdAt: isoDate(-30),
    },
    {
      id: generateUUID(), customerNumber: '1002', name: 'Kolkman & Partner', email: 'office@kolkman.de',
      address: 'Marktplatz 4', city: 'Hamburg', postalCode: '20095', country: 'Deutschland', phone: '+49 40 987654', createdAt: isoDate(-20),
    },
    {
      id: generateUUID(), customerNumber: '1003', name: 'Beispiel Handwerk', email: 'info@beispiel-handwerk.de',
      address: 'Werkstraße 8', city: 'München', postalCode: '80331', country: 'Deutschland', phone: '+49 89 456789', createdAt: isoDate(-10),
    },
  ];

  const customer = (index: number) => customers[index];
  const item = (description: string, unitPrice: number): DemoRecord => ({
    id: generateUUID(), description, quantity: 1, unitPrice, taxRate: 19, total: unitPrice, order: 0,
  });

  const invoices: DemoRecord[] = [0, 1, 2].map((index) => {
    const lineItem = item(index === 0 ? 'Beratung und Konzeption' : index === 1 ? 'Wartung und Support' : 'Materiallieferung', 450 + index * 125);
    const lineItemPrice = Number(lineItem.unitPrice || 0);
    return {
      id: generateUUID(), invoiceNumber: `RE-2026-${String(index + 1).padStart(3, '0')}`,
      customerId: customer(index).id, customerName: customer(index).name, issueDate: isoDate(-index * 7), dueDate: isoDate(14 - index * 7),
      items: [lineItem], subtotal: lineItemPrice, taxAmount: lineItemPrice * 0.19, total: lineItemPrice * 1.19,
      status: index === 0 ? 'draft' : index === 1 ? 'sent' : 'paid', notes: '', createdAt: isoDate(-index * 7),
    };
  });

  const jobs: DemoRecord[] = [0, 1, 2].map((index) => ({
    id: generateUUID(), jobNumber: `AU-2026-${String(index + 1).padStart(3, '0')}`, customerId: customer(index).id,
    customerName: customer(index).name, customerAddress: customer(index).address, title: ['Website-Relaunch', 'Elektroinstallation', 'Wartungsvertrag'][index],
    description: 'Beispielauftrag für den lokalen Frontend-Test', date: isoDate(index - 1),
    startTime: ['08:00', '10:30', '14:00'][index], endTime: ['10:00', '13:30', '18:00'][index],
    hoursWorked: 2 + index, hourlyRate: 75,
    status: index === 0 ? 'draft' : index === 1 ? 'in-progress' : 'completed', priority: index === 2 ? 'high' : 'medium',
    timeEntries: [], materials: [], createdAt: isoDate(-index * 5), updatedAt: isoDate(-index * 2),
  }));

  return {
    customers, invoices, recurringInvoices: [], jobs, quotes: [], materialTemplates: [],
    hourlyRates: [{ id: generateUUID(), name: 'Standard', description: 'Lokaler Demo-Stundensatz', rate: 75, isDefault: true, createdAt: isoDate() }],
    yearlyInvoiceStartNumbers: [],
    calendarEvents: [],
    euerEntries: [],
    company: {
      id: 'demo-company', name: 'Demo-Firma', address: 'Beispielstraße 1', city: 'Berlin', postalCode: '10115', country: 'Deutschland',
      email: 'demo@example.com', primaryColor: '#2563eb', secondaryColor: '#64748b', jobTrackingEnabled: true, quotesEnabled: true,
      reportingEnabled: true, remindersEnabled: true, defaultPaymentDays: 30, isSmallBusiness: false, invoiceStartNumber: 1,
      locale: 'de-DE', numberFormat: 'european', currency: 'EUR', dateFormat: 'DD.MM.YYYY', timeFormat: '24h', themeMode: 'system', terminologyProfile: 'customers',
      invoiceTemplates: [], createdAt: isoDate(),
    },
  };
}

function readState(): DemoState {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    const initial = createInitialState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }
  try {
    const parsed = JSON.parse(saved) as Partial<DemoState>;
    return {
      ...parsed,
      yearlyInvoiceStartNumbers: parsed.yearlyInvoiceStartNumbers || [],
      calendarEvents: parsed.calendarEvents || [],
      recurringInvoices: parsed.recurringInvoices || [],
      euerEntries: parsed.euerEntries || [],
    } as DemoState;
  } catch {
    const initial = createInitialState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }
}

function saveState(state: DemoState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function dateOnly(value: unknown): string {
  return new Date(String(value)).toISOString().split('T')[0];
}

function addScheduleInterval(value: string, frequency: string, intervalValue = 1, intervalUnit = 'month'): string {
  const date = new Date(`${value}T00:00:00`);
  if (frequency === 'daily') date.setDate(date.getDate() + 1);
  else if (frequency === 'weekly') date.setDate(date.getDate() + 7);
  else if (frequency === 'monthly') date.setMonth(date.getMonth() + 1);
  else if (frequency === 'quarterly') date.setMonth(date.getMonth() + 3);
  else if (frequency === 'semiannual') date.setMonth(date.getMonth() + 6);
  else if (frequency === 'annual') date.setFullYear(date.getFullYear() + 1);
  else if (intervalUnit === 'day') date.setDate(date.getDate() + Math.max(1, intervalValue));
  else if (intervalUnit === 'week') date.setDate(date.getDate() + Math.max(1, intervalValue) * 7);
  else if (intervalUnit === 'year') date.setFullYear(date.getFullYear() + Math.max(1, intervalValue));
  else date.setMonth(date.getMonth() + Math.max(1, intervalValue));
  return date.toISOString().split('T')[0];
}

function calculateItems(items: DemoRecord[]) {
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
  const taxAmount = items.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unitPrice || 0) * Number(item.taxRate || 0)) / 100, 0);
  return { subtotal, taxAmount, total: subtotal + taxAmount };
}

function payload(options: RequestInit): DemoRecord {
  return options.body ? JSON.parse(String(options.body)) as DemoRecord : {} as DemoRecord;
}

function collectionResponse<T>(items: DemoRecord[]): T {
  return items as unknown as T;
}

export async function demoRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const state = readState();
  const method = options.method || 'GET';
  const path = endpoint.split('?')[0];
  const queryParams = new URLSearchParams(endpoint.split('?')[1] || '');
  const parts = path.split('/').filter(Boolean);
  const resource = parts[0];
  const id = parts[1];
  const data = payload(options);

  if (resource === 'reporting') {
    if (path.includes('invoice-journal')) {
      const reportableInvoices = state.invoices.filter((invoice) => invoice.documentType !== 'credit_note');
      const invoices = reportableInvoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customerName,
        customerNumber: state.customers.find((customer) => customer.id === invoice.customerId)?.customerNumber,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        subtotal: invoice.subtotal,
        taxAmount: invoice.taxAmount,
        total: invoice.total,
        status: invoice.status,
        paidAmount: invoice.status === 'paid' ? invoice.total : 0,
        overdueAmount: invoice.status === 'overdue' ? invoice.total : 0,
        outstandingAmount: ['draft', 'sent'].includes(String(invoice.status)) ? invoice.total : 0,
        createdAt: invoice.createdAt,
      }));

      return {
        invoices,
        summary: {
          totalInvoices: invoices.length,
          totalAmount: invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
          paidAmount: invoices.reduce((sum, invoice) => sum + Number(invoice.paidAmount || 0), 0),
          overdueAmount: invoices.reduce((sum, invoice) => sum + Number(invoice.overdueAmount || 0), 0),
          outstandingAmount: invoices.reduce((sum, invoice) => sum + Number(invoice.outstandingAmount || 0), 0),
          subtotalSum: invoices.reduce((sum, invoice) => sum + Number(invoice.subtotal || 0), 0),
          taxSum: invoices.reduce((sum, invoice) => sum + Number(invoice.taxAmount || 0), 0),
        },
        dateRange: { startDate: null, endDate: null },
      } as T;
    }

    return {
      year: new Date().getFullYear(),
      monthlyRevenue: [],
      topCustomers: [],
      statusDistribution: [],
      yearOverview: {
        totalInvoices: state.invoices.filter((invoice) => invoice.documentType !== 'credit_note').length,
        totalSubtotal: state.invoices.filter((invoice) => invoice.documentType !== 'credit_note').reduce((sum, invoice) => sum + Number(invoice.subtotal || 0), 0),
        totalTax: state.invoices.filter((invoice) => invoice.documentType !== 'credit_note').reduce((sum, invoice) => sum + Number(invoice.taxAmount || 0), 0),
        totalAmount: state.invoices.filter((invoice) => invoice.documentType !== 'credit_note').reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
        paidAmount: state.invoices.filter((invoice) => invoice.documentType !== 'credit_note' && invoice.status === 'paid').reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
        overdueAmount: state.invoices.filter((invoice) => invoice.documentType !== 'credit_note' && invoice.status === 'overdue').reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
        avgInvoiceAmount: state.invoices.filter((invoice) => invoice.documentType !== 'credit_note').length ? state.invoices.filter((invoice) => invoice.documentType !== 'credit_note').reduce((sum, invoice) => sum + Number(invoice.total || 0), 0) / state.invoices.filter((invoice) => invoice.documentType !== 'credit_note').length : 0,
      },
    } as T;
  }

  if (resource === 'company') {
    if (method === 'PUT') state.company = { ...state.company, ...data };
    saveState(state);
    return state.company as unknown as T;
  }

  if (resource === 'euer-entries') {
    const entries = state.euerEntries;
    if (method === 'GET' && !id) {
      const year = queryParams.get('year');
      return (year ? entries.filter(entry => String(entry.entryDate).startsWith(`${year}-`)) : entries) as unknown as T;
    }
    if (method === 'POST' && !id) {
      const amount = Number(data.amount);
      const taxRate = Number(data.taxRate || 0);
      if (!['income', 'expense'].includes(String(data.entryType))) throw new Error('Ungültiger Buchungstyp.');
      if (!String(data.entryDate || '').match(/^\d{4}-\d{2}-\d{2}$/)) throw new Error('Ungültiges Datum.');
      if (!String(data.description || '').trim()) throw new Error('Eine Beschreibung ist erforderlich.');
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Der Betrag muss eine positive Zahl sein.');
      if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new Error('Der MwSt.-Satz muss zwischen 0 und 100 liegen.');
      const record: DemoRecord = {
        ...data,
        id: generateUUID(),
        entryDate: dateOnly(data.entryDate),
        description: String(data.description).trim(),
        amount,
        taxRate,
        notes: data.notes || '',
        createdAt: isoDate(),
        updatedAt: isoDate(),
      };
      entries.push(record);
      saveState(state);
      return record as unknown as T;
    }
    if (id) {
      const index = entries.findIndex(entry => entry.id === id);
      if (index < 0) throw new Error('EÜR-Buchung nicht gefunden.');
      if (method === 'GET') return entries[index] as unknown as T;
      if (method === 'PUT') {
        const updated = { ...entries[index], ...data, id, updatedAt: isoDate() };
        entries[index] = updated;
        saveState(state);
        return updated as unknown as T;
      }
      if (method === 'DELETE') {
        state.euerEntries = entries.filter(entry => entry.id !== id);
        saveState(state);
        return undefined as T;
      }
    }
  }

  if (resource === 'recurring-invoices') {
    const recurringItems = state.recurringInvoices;

    if (parts[2] === 'runs' && id) {
      const recurring = recurringItems.find(item => item.id === id);
      return (recurring?.runs || []) as unknown as T;
    }

    if (parts[2] === 'generate' && id && method === 'POST') {
      const recurring = recurringItems.find(item => item.id === id);
      if (!recurring) throw new Error('Wiederkehrende Rechnung nicht gefunden');
      if (recurring.status !== 'active') throw new Error('Die Vorlage ist nicht aktiv');

      const runDate = dateOnly(data.scheduledDate || recurring.nextRunDate);
      const invoiceItems = (Array.isArray(recurring.items) ? recurring.items : []).map(item => ({
        ...item,
        id: generateUUID(),
        order: Number(item.order || 0),
      }));
      const totals = calculateItems(invoiceItems);
      const invoiceYear = new Date(`${runDate}T00:00:00`).getFullYear();
      const invoice: DemoRecord = {
        id: generateUUID(),
        invoiceNumber: `RE-${invoiceYear}-${String(state.invoices.length + 1).padStart(3, '0')}`,
        customerId: recurring.customerId,
        customerName: recurring.customerName,
        issueDate: runDate,
        dueDate: dateOnly(new Date(new Date(`${runDate}T00:00:00`).getTime() + Number(recurring.dueDays || 30) * 86400000)),
        items: invoiceItems,
        ...totals,
        status: 'draft',
        notes: recurring.notes || '',
        recurringInvoiceId: recurring.id,
        documentType: 'invoice',
        createdAt: isoDate(),
      };

      const nextRunDate = addScheduleInterval(runDate, String(recurring.frequency), Number(recurring.intervalValue || 1), String(recurring.intervalUnit || 'month'));
      const hasEnded = Boolean(recurring.endDate && nextRunDate > dateOnly(recurring.endDate));
      const run = {
        id: generateUUID(),
        recurringInvoiceId: recurring.id,
        invoiceId: invoice.id,
        generatedInvoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        scheduledDate: runDate,
        status: 'success',
        createdAt: isoDate(),
      };

      state.invoices.push(invoice);
      recurring.lastRunDate = runDate;
      recurring.nextRunDate = nextRunDate;
      if (hasEnded) recurring.status = 'ended';
      recurring.runs = [...((recurring.runs as DemoRecord[] | undefined) || []), run];
      recurring.updatedAt = isoDate();
      saveState(state);
      return invoice as unknown as T;
    }

    if (method === 'GET' && !id) return collectionResponse<T>(recurringItems);
    if (method === 'POST' && !id) {
      const customer = state.customers.find(item => item.id === String(data.customerId));
      if (!customer) throw new Error('Kunde nicht gefunden');
      const record: DemoRecord = {
        ...data,
        id: generateUUID(),
        customerName: customer.name,
        items: Array.isArray(data.items) ? data.items : [],
        frequency: data.frequency || 'monthly',
        intervalValue: Number(data.intervalValue || 1),
        intervalUnit: data.intervalUnit || 'month',
        startDate: dateOnly(data.startDate || isoDate()),
        nextRunDate: dateOnly(data.nextRunDate || data.startDate || isoDate()),
        status: data.status || 'active',
        dueDays: Number(data.dueDays ?? 30),
        runs: [],
        createdAt: isoDate(),
        updatedAt: isoDate(),
      };
      recurringItems.push(record);
      saveState(state);
      return record as unknown as T;
    }
    if (id) {
      const index = recurringItems.findIndex(item => item.id === id);
      if (index < 0) throw new Error('Wiederkehrende Rechnung nicht gefunden');
      if (method === 'GET') return recurringItems[index] as unknown as T;
      if (method === 'PUT') {
        const customer = data.customerId ? state.customers.find(item => item.id === String(data.customerId)) : undefined;
        const updated = {
          ...recurringItems[index],
          ...data,
          ...(customer ? { customerName: customer.name } : {}),
          updatedAt: isoDate(),
        };
        recurringItems[index] = updated;
        saveState(state);
        return updated as unknown as T;
      }
      if (method === 'DELETE') {
        state.recurringInvoices = recurringItems.filter(item => item.id !== id);
        saveState(state);
        return undefined as T;
      }
    }
  }

  if (resource === 'credit-notes') {
    const creditNotes = state.invoices.filter(item => item.documentType === 'credit_note');
    if (method === 'GET' && !id) return creditNotes as unknown as T;
    if (method === 'POST' && !id) {
      const customer = state.customers.find(item => item.id === String(data.customerId));
      if (!customer) throw new Error('Kunde nicht gefunden');
      if (!String(data.creditNoteReason || '').trim()) throw new Error('Ein Grund ist erforderlich');
      if (!Array.isArray(data.items) || data.items.length === 0 || data.items.some(item => Number(item.quantity) <= 0 || Number(item.unitPrice) <= 0 || Number(item.taxRate) < 0)) throw new Error('Mindestens eine gültige Position ist erforderlich');
      if (data.referenceInvoiceId) {
        const reference = state.invoices.find(item => item.id === String(data.referenceInvoiceId));
        if (!reference || reference.documentType === 'credit_note') throw new Error('Ursprungsrechnung nicht gefunden');
        if (reference.customerId !== customer.id) throw new Error('Die Ursprungsrechnung gehört zu einem anderen Kunden');
      }
      const items = (Array.isArray(data.items) ? data.items : []).map(item => {
        const quantity = Number(item.quantity || 0);
        const unitPrice = -Math.abs(Number(item.unitPrice || 0));
        return { ...item, id: generateUUID(), quantity, unitPrice, total: quantity * unitPrice, order: Number(item.order || 0) };
      });
      const totals = calculateItems(items);
      const year = new Date(String(data.issueDate || isoDate())).getFullYear();
      const record: DemoRecord = {
        ...data,
        id: generateUUID(),
        invoiceNumber: `GS-${year}-${String(creditNotes.length + 1).padStart(3, '0')}`,
        customerId: customer.id,
        customerName: customer.name,
        issueDate: dateOnly(data.issueDate || isoDate()),
        dueDate: dateOnly(data.dueDate || data.issueDate || isoDate()),
        items,
        ...totals,
        status: data.status || 'draft',
        documentType: 'credit_note',
        referenceInvoiceNumber: state.invoices.find(item => item.id === data.referenceInvoiceId)?.invoiceNumber,
        createdAt: isoDate(),
      };
      state.invoices.push(record);
      saveState(state);
      return record as unknown as T;
    }
    if (id) {
      const index = state.invoices.findIndex(item => item.id === id && item.documentType === 'credit_note');
      if (index < 0) throw new Error('Gutschrift nicht gefunden');
      if (method === 'GET') return state.invoices[index] as unknown as T;
      if (method === 'PUT') {
        const current = state.invoices[index];
        const contentUpdate = ['customerId', 'referenceInvoiceId', 'creditNoteReason', 'issueDate', 'dueDate', 'items'].some(field => data[field] !== undefined);
        if (contentUpdate && current.status !== 'draft') throw new Error('Nur Entwürfe können bearbeitet werden');
        const customer = data.customerId ? state.customers.find(item => item.id === String(data.customerId)) : undefined;
        if (data.customerId && !customer) throw new Error('Kunde nicht gefunden');
        if (data.referenceInvoiceId) {
          const reference = state.invoices.find(item => item.id === String(data.referenceInvoiceId));
          if (!reference || reference.documentType === 'credit_note') throw new Error('Ursprungsrechnung nicht gefunden');
          if (reference.customerId !== (customer?.id || current.customerId)) throw new Error('Die Ursprungsrechnung gehört zu einem anderen Kunden');
        }
        if (contentUpdate && data.creditNoteReason !== undefined && !String(data.creditNoteReason).trim()) throw new Error('Ein Grund ist erforderlich');
        if (data.items !== undefined && (!Array.isArray(data.items) || data.items.length === 0 || data.items.some(item => Number(item.quantity) <= 0 || Number(item.unitPrice) <= 0 || Number(item.taxRate) < 0))) throw new Error('Mindestens eine gültige Position ist erforderlich');
        const items = Array.isArray(data.items) ? data.items.map(item => ({
          ...item,
          id: generateUUID(),
          unitPrice: -Math.abs(Number(item.unitPrice || 0)),
          total: Number(item.quantity || 0) * -Math.abs(Number(item.unitPrice || 0)),
          order: Number(item.order || 0),
        })) : current.items;
        const totals = Array.isArray(data.items) ? calculateItems(items as DemoRecord[]) : {};
        const updated = {
          ...current,
          ...data,
          ...(customer ? { customerId: customer.id, customerName: customer.name } : {}),
          ...(data.referenceInvoiceId === null ? { referenceInvoiceNumber: undefined } : data.referenceInvoiceId ? { referenceInvoiceNumber: state.invoices.find(item => item.id === data.referenceInvoiceId)?.invoiceNumber } : {}),
          items,
          ...totals,
          documentType: 'credit_note',
          updatedAt: isoDate(),
        };
        state.invoices[index] = updated;
        saveState(state);
        return updated as unknown as T;
      }
      if (method === 'DELETE') {
        if (state.invoices[index].status !== 'draft') throw new Error('Nur Entwürfe können gelöscht werden');
        state.invoices = state.invoices.filter(item => item.id !== id);
        saveState(state);
        return undefined as T;
      }
    }
  }

  type DemoCollectionKey = Exclude<keyof DemoState, 'company'>;
  const resourceMap: Record<string, DemoCollectionKey> = {
    customers: 'customers', invoices: 'invoices', quotes: 'quotes', jobs: 'jobs',
    'material-templates': 'materialTemplates', 'hourly-rates': 'hourlyRates',
    'yearly-invoice-start-numbers': 'yearlyInvoiceStartNumbers',
    'calendar-events': 'calendarEvents',
  };
  const key = resourceMap[resource];
  if (!key) {
    if (path.startsWith('/reminders/')) {
      const regularInvoices = state.invoices.filter(item => item.documentType !== 'credit_note');
      return (path.includes('history') ? regularInvoices : []) as unknown as T;
    }
    return {} as T;
  }

  const items = state[key] as DemoRecord[];
  if (key === 'yearlyInvoiceStartNumbers') {
    if (method === 'GET' && !id) return collectionResponse<T>(items);
    if (method === 'POST' && !id) {
      const year = Number(data.year);
      const existing = items.find(itemRecord => Number(itemRecord.year) === year);
      const record = {
        ...(existing || {}),
        id: String(year),
        year,
        start_number: Number(data.startNumber),
        created_at: existing?.created_at || isoDate(),
        updated_at: isoDate(),
      };
      if (existing) items[items.indexOf(existing)] = record; else items.push(record);
      saveState(state);
      return record as unknown as T;
    }
    if (method === 'DELETE' && id) {
      state.yearlyInvoiceStartNumbers = items.filter(itemRecord => String(itemRecord.year) !== id);
      saveState(state);
      return undefined as T;
    }
  }
  if (method === 'GET' && !id) {
    const visibleItems = key === 'invoices' ? items.filter(item => item.documentType !== 'credit_note') : items;
    return collectionResponse<T>(visibleItems);
  }
  if (method === 'POST' && !id) {
    const record: DemoRecord = { ...data, id: generateUUID(), createdAt: isoDate(), updatedAt: isoDate() };
    if (key === 'customers') record.customerNumber = String(1001 + items.length);
    items.push(record);
    saveState(state);
    return record as unknown as T;
  }
  if (id) {
    const index = items.findIndex(itemRecord => itemRecord.id === id);
    if (method === 'GET') return (index >= 0 ? items[index] : {}) as unknown as T;
    if (method === 'PUT') {
      const updated = { ...(items[index] || { id }), ...data, id, updatedAt: isoDate() };
      if (index >= 0) items[index] = updated; else items.push(updated);
      saveState(state);
      return updated as unknown as T;
    }
    if (method === 'DELETE') {
      const remainingItems = items.filter(itemRecord => itemRecord.id !== id);
      state[key] = remainingItems as DemoState[typeof key];
      saveState(state);
      return undefined as T;
    }
  }
  if (resource === 'jobs' && method === 'DELETE') {
    const ids = Array.isArray(data.ids) ? data.ids as string[] : [];
    state.jobs = state.jobs.filter(job => !ids.includes(job.id));
    saveState(state);
  }
  return {} as T;
}

export function resetDemoData() {
  localStorage.removeItem(STORAGE_KEY);
}

export function seedDemoData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(createInitialState()));
}
