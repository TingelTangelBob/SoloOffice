import { generateUUID } from '../utils/uuid';

type DemoRecord = Record<string, unknown> & { id: string };

interface DemoState {
  customers: DemoRecord[];
  invoices: DemoRecord[];
  quotes: DemoRecord[];
  jobs: DemoRecord[];
  materialTemplates: DemoRecord[];
  hourlyRates: DemoRecord[];
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
    return {
      id: generateUUID(), invoiceNumber: `RE-2026-${String(index + 1).padStart(3, '0')}`,
      customerId: customer(index).id, customerName: customer(index).name, issueDate: isoDate(-index * 7), dueDate: isoDate(14 - index * 7),
      items: [lineItem], subtotal: lineItem.unitPrice, taxAmount: lineItem.unitPrice * 0.19, total: lineItem.unitPrice * 1.19,
      status: index === 0 ? 'draft' : index === 1 ? 'sent' : 'paid', notes: '', createdAt: isoDate(-index * 7),
    };
  });

  const jobs: DemoRecord[] = [0, 1, 2].map((index) => ({
    id: generateUUID(), jobNumber: `AU-2026-${String(index + 1).padStart(3, '0')}`, customerId: customer(index).id,
    customerName: customer(index).name, customerAddress: customer(index).address, title: ['Website-Relaunch', 'Elektroinstallation', 'Wartungsvertrag'][index],
    description: 'Beispielauftrag für den lokalen Frontend-Test', date: isoDate(index - 1), hoursWorked: 2 + index, hourlyRate: 75,
    status: index === 0 ? 'draft' : index === 1 ? 'in-progress' : 'completed', priority: index === 2 ? 'high' : 'medium',
    timeEntries: [], materials: [], createdAt: isoDate(-index * 5), updatedAt: isoDate(-index * 2),
  }));

  return {
    customers, invoices, jobs, quotes: [], materialTemplates: [],
    hourlyRates: [{ id: generateUUID(), name: 'Standard', description: 'Lokaler Demo-Stundensatz', rate: 75, isDefault: true, createdAt: isoDate() }],
    company: {
      id: 'demo-company', name: 'Demo-Firma', address: 'Beispielstraße 1', city: 'Berlin', postalCode: '10115', country: 'Deutschland',
      email: 'demo@example.com', primaryColor: '#2563eb', secondaryColor: '#64748b', jobTrackingEnabled: true, quotesEnabled: true,
      reportingEnabled: true, remindersEnabled: true, defaultPaymentDays: 30, isSmallBusiness: false, invoiceStartNumber: 1,
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
    return JSON.parse(saved) as DemoState;
  } catch {
    const initial = createInitialState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }
}

function saveState(state: DemoState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
  const parts = path.split('/').filter(Boolean);
  const resource = parts[0];
  const id = parts[1];
  const data = payload(options);

  if (resource === 'company') {
    if (method === 'PUT') state.company = { ...state.company, ...data };
    saveState(state);
    return state.company as unknown as T;
  }

  const resourceMap: Record<string, keyof DemoState> = {
    customers: 'customers', invoices: 'invoices', quotes: 'quotes', jobs: 'jobs',
    'material-templates': 'materialTemplates', 'hourly-rates': 'hourlyRates',
  };
  const key = resourceMap[resource];
  if (!key) {
    if (path.startsWith('/reporting/')) return (path.includes('statistics') ? { yearOverview: { totalInvoices: state.invoices.length } } : { entries: [] }) as T;
    if (path.startsWith('/reminders/')) return (path.includes('history') ? state.invoices : []) as unknown as T;
    return {} as T;
  }

  const items = state[key] as DemoRecord[];
  if (method === 'GET' && !id) return collectionResponse<T>(items);
  if (method === 'POST' && !id) {
    const record = { ...data, id: generateUUID(), createdAt: isoDate(), updatedAt: isoDate() };
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
      state[key] = items.filter(itemRecord => itemRecord.id !== id) as DemoState[typeof key];
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
