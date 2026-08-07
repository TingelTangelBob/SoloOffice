import { generateUUID } from '../utils/uuid';
import type { JobRecurrence, JobRecurrenceRule, TerminologyProfile } from '../types';
import { getJobRecurrenceDates } from '../utils/jobRecurrence';

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
  euerEntryHistory: DemoRecord[];
  fixedAssets: DemoRecord[];
  receipts: DemoRecord[];
  incomingEInvoices: DemoRecord[];
  company: DemoRecord;
  seedProfile?: TerminologyProfile;
  seedVersion?: number;
}

const STORAGE_KEY = 'solooffice-demo-data-v1';
const ACTIVE_WORKSPACE_STORAGE_KEY = 'solooffice-demo-active-workspace-v1';
export const DEMO_DEFAULT_WORKSPACE_ID = 'demo-workspace';

export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

export function getDemoActiveWorkspaceId(): string {
  if (typeof localStorage === 'undefined') return DEMO_DEFAULT_WORKSPACE_ID;
  return localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) || DEMO_DEFAULT_WORKSPACE_ID;
}

export function setDemoActiveWorkspaceId(workspaceId: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);
}

function getDemoDataStorageKey(): string {
  const workspaceId = getDemoActiveWorkspaceId();
  return workspaceId === DEMO_DEFAULT_WORKSPACE_ID ? STORAGE_KEY : `${STORAGE_KEY}:${workspaceId}`;
}

const DEMO_SEED_VERSION = 4;

interface DemoProfileFixture {
  primaryColor: string;
  secondaryColor: string;
  names: string[];
  workTitles: string[];
  workDescription: string;
}

const demoProfileFixtures: Record<TerminologyProfile, DemoProfileFixture> = {
  customers: {
    primaryColor: '#2563eb', secondaryColor: '#64748b',
    names: ['Musterkunde GmbH', 'Kolkman & Partner', 'Beispiel Handwerk', 'Nordlicht Design', 'Hanseatische Beratung', 'Berg & Tal Immobilien', 'Studio Morgenrot', 'Klarwerk Solutions'],
    workTitles: ['Website-Relaunch', 'Elektroinstallation', 'Wartungsvertrag', 'Marketingkonzept', 'Fotoproduktion', 'Support-Paket', 'Umzugsplanung', 'Jahresbetreuung'],
    workDescription: 'Beispielauftrag für den lokalen Frontend-Test',
  },
  mandants: {
    primaryColor: '#7c3aed', secondaryColor: '#6d5bbd',
    names: ['Kanzlei Müller', 'Praxisgemeinschaft Weber', 'Steuerberatung Schneider', 'Notariat Albrecht', 'Hansen Architektur', 'Meyer & Kollegen', 'Linden Apotheke', 'Büro am Markt'],
    workTitles: ['Jahresabschluss 2025', 'Steuererklärung', 'Gründungsberatung', 'Lohnbuchhaltung', 'Betriebsprüfung', 'Vertragsprüfung', 'Finanzplanung', 'Laufende Beratung'],
    workDescription: 'Beispielmandat für den lokalen Frontend-Test',
  },
  patients: {
    primaryColor: '#0f9f9a', secondaryColor: '#4b7f7b',
    names: ['Anna Müller', 'Jonas Weber', 'Sofia Schneider', 'Paul Hoffmann', 'Mia Fischer', 'Emil Wagner', 'Lina Becker', 'Noah Krause'],
    workTitles: ['Erstuntersuchung', 'Kontrolltermin', 'Therapieplanung', 'Behandlung', 'Nachsorge', 'Diagnostik', 'Beratungsgespräch', 'Folgetermin'],
    workDescription: 'Beispielbehandlung für den lokalen Frontend-Test',
  },
  students: {
    primaryColor: '#f97316', secondaryColor: '#b45309',
    names: ['Lena Schneider', 'Maximilian Weber', 'Schulträger Berlin', 'Förderverein Nord', 'Noah Hoffmann', 'Mia Fischer', 'Bildungswerk Mitte', 'Kurszentrum West'],
    workTitles: ['Deutsch-Kurs B2', 'Mathematik-Nachhilfe', 'Prüfungsvorbereitung', 'Ferienkurs', 'Integrationskurs', 'Lernbegleitung', 'Elternberatung', 'Abschlussprüfung'],
    workDescription: 'Beispielkurs für den lokalen Frontend-Test',
  },
  clients: {
    primaryColor: '#db3764', secondaryColor: '#9f365c',
    names: ['Sarah König', 'Beratungsstelle Neustart', 'Daniel Richter', 'Familienhilfe West', 'Aylin Yilmaz', 'Projekt Zukunft', 'Thomas Neumann', 'Anlaufstelle Mitte'],
    workTitles: ['Erstberatung', 'Sozialberatung', 'Coaching', 'Fallbesprechung', 'Orientierungsgespräch', 'Begleitung', 'Gruppenangebot', 'Abschlussgespräch'],
    workDescription: 'Beispielberatung für den lokalen Frontend-Test',
  },
};

function demoSlug(value: string): string {
  return value.toLocaleLowerCase('de-DE')
    .replace(/[äöü]/g, character => ({ ä: 'ae', ö: 'oe', ü: 'ue' })[character] || character)
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
}

function enrichDemoState(state: DemoState, profile: TerminologyProfile): DemoState {
  const fixture = demoProfileFixtures[profile] || demoProfileFixtures.customers;
  const cities = ['Berlin', 'Hamburg', 'München', 'Köln', 'Leipzig', 'Bremen', 'Dresden', 'Freiburg'];
  const streets = ['Hauptstraße', 'Marktplatz', 'Werkstraße', 'Gartenweg', 'Bahnhofstraße', 'Rosenweg', 'Lindenallee', 'Am Stadtpark'];

  const customers: DemoRecord[] = fixture.names.map((name, index) => ({
    id: generateUUID(),
    customerNumber: String(1001 + index),
    name,
    email: `${demoSlug(name)}@demo.solooffice.de`,
    address: `${streets[index % streets.length]} ${12 + index}`,
    city: cities[index % cities.length],
    postalCode: String(10115 + index * 137).slice(0, 5),
    country: 'Deutschland',
    phone: `+49 ${30 + index} ${123456 + index * 11111}`,
    createdAt: isoDate(-(35 - index * 3)),
  }));

  const customerAt = (index: number) => customers[index % customers.length];
  const makeItem = (description: string, unitPrice: number, quantity: number, order: number): DemoRecord => ({
    id: generateUUID(), description, quantity, unitPrice, taxRate: 19, total: quantity * unitPrice, order,
  });

  const invoices: DemoRecord[] = Array.from({ length: 10 }, (_, index) => {
    const customer = customerAt(index);
    const items = [
      makeItem(fixture.workTitles[index % fixture.workTitles.length], 240 + index * 45, (index % 3) + 1, 0),
      ...(index % 2 === 0 ? [makeItem('Zusatzleistung und Dokumentation', 85 + index * 10, 1, 1)] : []),
    ];
    const totals = calculateItems(items);
    return {
      id: generateUUID(), invoiceNumber: `RE-2026-${String(index + 1).padStart(3, '0')}`,
      customerId: customer.id, customerName: customer.name,
      issueDate: isoDate(-(index * 4 + 1)), dueDate: isoDate(14 - index * 3),
      items, ...totals,
      status: (['draft', 'sent', 'paid', 'overdue'][index % 4]), notes: fixture.workDescription,
      createdAt: isoDate(-(index * 4 + 1)),
    };
  });

  const quotes: DemoRecord[] = Array.from({ length: 6 }, (_, index) => {
    const customer = customerAt(index + 2);
    const items = [makeItem(fixture.workTitles[(index + 2) % fixture.workTitles.length], 680 + index * 95, (index % 2) + 1, 0)];
    const totals = calculateItems(items);
    return {
      id: generateUUID(), quoteNumber: `AN-2026-${String(index + 1).padStart(3, '0')}`,
      customerId: customer.id, customerName: customer.name, issueDate: isoDate(-(index * 6 + 2)), validUntil: isoDate(20 - index * 2),
      items, ...totals, status: (['draft', 'sent', 'accepted', 'rejected', 'expired', 'billed'][index]),
      notes: fixture.workDescription, createdAt: isoDate(-(index * 6 + 2)),
    };
  });

  const jobs: DemoRecord[] = Array.from({ length: 8 }, (_, index) => {
    const customer = customerAt(index + 1);
    return {
      id: generateUUID(), jobNumber: `AU-2026-${String(index + 1).padStart(3, '0')}`,
      customerId: customer.id, customerName: customer.name, customerAddress: customer.address,
      title: fixture.workTitles[index % fixture.workTitles.length], description: fixture.workDescription,
      date: isoDate(index - 3), startTime: ['08:00', '09:30', '10:30', '13:00'][index % 4], endTime: ['10:00', '11:30', '12:30', '15:00'][index % 4],
      hoursWorked: 2 + (index % 4), hourlyRate: 65 + (index % 3) * 15,
      status: (['draft', 'in-progress', 'completed', 'completed'][index % 4]), priority: index % 4 === 0 ? 'high' : 'medium',
      timeEntries: [], materials: [], createdAt: isoDate(-(index * 3 + 1)), updatedAt: isoDate(-(index * 2)),
    };
  });

  const hourlyRates: DemoRecord[] = [
    { name: 'Standard', description: fixture.workTitles[0], rate: 75 },
    { name: 'Beratung', description: fixture.workTitles[1], rate: 95 },
    { name: 'Premium', description: fixture.workTitles[2], rate: 125 },
    { name: 'Assistenz', description: fixture.workTitles[3], rate: 55 },
    { name: 'Vor-Ort-Termin', description: 'Termin mit persönlicher Betreuung', rate: 110 },
  ].map((rate, index) => ({ ...rate, id: generateUUID(), isDefault: index === 0, createdAt: isoDate(-index) }));

  const materialTemplates: DemoRecord[] = [
    ['Dokumentation', 24], ['Arbeitsmaterial', 38], ['Fahrtkosten', 45], ['Unterlagenmappe', 12], ['Lizenz', 79], ['Zusatzpaket', 149],
  ].map(([name, unitPrice], index) => ({
    id: generateUUID(), name, description: `${name} für ${fixture.workTitles[index % fixture.workTitles.length]}`,
    unit: index % 2 === 0 ? 'Pauschale' : 'Stück', unitPrice, taxRate: 19, isDefault: index === 0, createdAt: isoDate(-index),
  }));

  state.customers = customers;
  state.invoices = invoices;
  state.quotes = quotes;
  state.jobs = jobs;
  state.hourlyRates = hourlyRates;
  state.materialTemplates = materialTemplates;
  state.recurringInvoices = [0, 1, 2].map((index) => {
    const customer = customerAt(index + 3);
    const items = [makeItem(fixture.workTitles[(index + 4) % fixture.workTitles.length], 390 + index * 110, 1, 0)];
    return {
      id: generateUUID(), name: `${fixture.workTitles[index]} – laufend`, customerId: customer.id, customerName: customer.name,
      items, frequency: ['monthly', 'quarterly', 'annual'][index], intervalValue: 1, intervalUnit: 'month',
      startDate: dateOnly(isoDate(-30)), nextRunDate: dateOnly(isoDate(10 + index * 7)), dueDays: 30,
      status: index === 2 ? 'paused' : 'active', runs: [], notes: fixture.workDescription, createdAt: isoDate(-30), updatedAt: isoDate(),
    };
  });
  state.calendarEvents = Array.from({ length: 10 }, (_, index) => {
    const customer = customerAt(index + 1);
    const start = isoDate(index - 2);
    return {
      id: generateUUID(), title: fixture.workTitles[index % fixture.workTitles.length], description: fixture.workDescription,
      customerId: customer.id, customerName: customer.name, start, end: isoDate(index - 2), allDay: false,
      type: index % 2 === 0 ? 'appointment' : 'task', createdAt: isoDate(-index),
    };
  });
  state.yearlyInvoiceStartNumbers = [
    { id: '2026', year: 2026, start_number: 1, created_at: isoDate(-20), updated_at: isoDate() },
    { id: '2027', year: 2027, start_number: 100, created_at: isoDate(-5), updated_at: isoDate() },
  ];
  state.euerEntries = Array.from({ length: 8 }, (_, index) => ({
    id: generateUUID(), entryDate: dateOnly(isoDate(-index * 5)), description: `${fixture.workTitles[index % fixture.workTitles.length]} – Einnahme`,
    amount: 280 + index * 75, taxRate: 19, notes: fixture.workDescription, sourceType: 'manual', status: 'active', createdAt: isoDate(-index * 5), updatedAt: isoDate(-index * 5),
  }));
  state.euerEntryHistory = [];
  state.fixedAssets = [
    ['Notebook', 'Büroausstattung', 1299], ['Arbeitsplatz', 'Büroausstattung', 850], ['Kamera', 'Arbeitsmittel', 1740], ['Fahrzeug', 'Mobilität', 18500], ['Softwarelizenz', 'Software', 690],
  ].map(([name, category, acquisitionCost], index) => ({
    id: generateUUID(), name, category, acquisitionDate: dateOnly(isoDate(-(index + 1) * 40)), acquisitionCost,
    usefulLifeYears: index === 3 ? 6 : 3, status: 'active', notes: fixture.workDescription, createdAt: isoDate(-(index + 1) * 40), updatedAt: isoDate(),
  }));
  state.receipts = Array.from({ length: 5 }, (_, index) => {
    const vendorName = ['Bürobedarf Schmidt', 'Stadtwerke', 'Cloud Services', 'Fachverlag', 'Reisebüro'][index];
    const documentNumber = `BE-2026-${String(index + 1).padStart(3, '0')}`;
    const grossAmount = 49 + index * 57;
    const taxAmount = grossAmount * 0.19 / 1.19;
    const extractedData = {
      vendorName,
      documentDate: dateOnly(isoDate(-index * 8)),
      documentNumber,
      netAmount: grossAmount - taxAmount,
      taxAmount,
      grossAmount,
      taxRate: 19,
      currency: 'EUR',
      suggestedCategory: 'other_expense',
    };
    return {
      id: generateUUID(), name: `${documentNumber}.pdf`, contentType: 'application/pdf', size: 128000 + index * 17000,
      ocrStatus: 'completed', ocrText: 'Lokaler Demo-Beleg', extractedData, ocrExtractedData: extractedData, linkedEuerEntryId: null,
      createdAt: isoDate(-index * 8), updatedAt: isoDate(-index * 8),
    };
  });
  state.incomingEInvoices = Array.from({ length: 3 }, (_, index) => {
    const customer = customerAt(index + 2);
    const extractedData = {
      invoiceNumber: `EINGANG-2026-${String(index + 1).padStart(3, '0')}`,
      issueDate: dateOnly(isoDate(-(index + 2) * 6)),
      currency: 'EUR',
      supplierName: ['Nordlicht Büroservice', 'Klarwerk Software', 'Berg & Tal Immobilien'][index],
      supplierTaxId: `DE${String(100000000 + index * 1234567).slice(0, 9)}`,
      buyerReference: index === 0 ? '04011000-123456-78' : undefined,
      grossAmount: 357 + index * 211,
    };
    return {
      id: generateUUID(), filename: `${extractedData.invoiceNumber}.xml`, contentType: 'application/xml', size: 24500 + index * 3200,
      sha256: `demo-sha256-${String(index + 1).padStart(2, '0')}`, format: index === 1 ? 'ZUGFeRD' : 'XRechnung',
      validationStatus: 'validated', validationError: undefined, ...extractedData,
      extractedData, linkedCustomerId: index === 0 ? customer.id : undefined,
      receivedAt: isoDate(-(index + 2) * 6), updatedAt: isoDate(-(index + 2) * 6),
    };
  });
  state.company = {
    ...state.company, terminologyProfile: profile, terminologyColorSource: 'profile',
    primaryColor: fixture.primaryColor, secondaryColor: fixture.secondaryColor,
  };
  state.seedProfile = profile;
  state.seedVersion = DEMO_SEED_VERSION;
  return state;
}

const isoDate = (daysFromToday = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString();
};

function createInitialState(profile: TerminologyProfile = 'customers'): DemoState {
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

  const state: DemoState = {
    customers, invoices, recurringInvoices: [], jobs, quotes: [], materialTemplates: [],
    hourlyRates: [{ id: generateUUID(), name: 'Standard', description: 'Lokaler Demo-Stundensatz', rate: 75, isDefault: true, createdAt: isoDate() }],
    yearlyInvoiceStartNumbers: [],
    calendarEvents: [],
    euerEntries: [],
    euerEntryHistory: [],
    fixedAssets: [],
    receipts: [],
    incomingEInvoices: [],
    company: {
      id: 'demo-company', name: 'Demo-Firma', address: 'Beispielstraße 1', city: 'Berlin', postalCode: '10115', country: 'Deutschland',
      email: 'demo@example.com', primaryColor: '#2563eb', secondaryColor: '#64748b', jobTrackingEnabled: true, quotesEnabled: true,
      reportingEnabled: true, remindersEnabled: true, defaultPaymentDays: 30, isSmallBusiness: false, invoiceStartNumber: 1,
      locale: 'de-DE', numberFormat: 'european', currency: 'EUR', dateFormat: 'DD.MM.YYYY', timeFormat: '24h', timeZone: 'Europe/Berlin', themeMode: 'system', terminologyProfile: 'customers', receiptLabel: 'Belege', taxBusinessType: 'commercial', legalForm: 'gmbh',
      invoiceTemplates: [], createdAt: isoDate(),
    },
  };
  return enrichDemoState(state, profile);
}

function readState(): DemoState {
  const storageKey = getDemoDataStorageKey();
  const saved = localStorage.getItem(storageKey);
  if (!saved) {
    const initial = createInitialState();
    localStorage.setItem(storageKey, JSON.stringify(initial));
    return initial;
  }
  try {
    const parsed = JSON.parse(saved) as Partial<DemoState>;
    const storedProfile = typeof parsed.company?.terminologyProfile === 'string' && parsed.company.terminologyProfile in demoProfileFixtures
      ? parsed.company.terminologyProfile as TerminologyProfile
      : 'customers';
    if (parsed.seedVersion !== DEMO_SEED_VERSION) {
      const upgraded = createInitialState(storedProfile);
      upgraded.company = { ...upgraded.company, ...(parsed.company || {}), terminologyProfile: storedProfile };
      localStorage.setItem(storageKey, JSON.stringify(upgraded));
      return upgraded;
    }
    return {
      ...parsed,
      yearlyInvoiceStartNumbers: parsed.yearlyInvoiceStartNumbers || [],
      calendarEvents: parsed.calendarEvents || [],
      recurringInvoices: parsed.recurringInvoices || [],
      euerEntries: parsed.euerEntries || [],
      euerEntryHistory: parsed.euerEntryHistory || [],
      fixedAssets: parsed.fixedAssets || [],
      receipts: (parsed.receipts || []).map(receipt => ({ ...receipt, ocrExtractedData: receipt.ocrExtractedData || receipt.extractedData || {} })),
      incomingEInvoices: parsed.incomingEInvoices || [],
    } as DemoState;
  } catch {
    const initial = createInitialState();
    localStorage.setItem(storageKey, JSON.stringify(initial));
    return initial;
  }
}

function saveState(state: DemoState) {
  localStorage.setItem(getDemoDataStorageKey(), JSON.stringify(state));
}

function dateOnly(value: unknown): string {
  return new Date(String(value)).toISOString().split('T')[0];
}

function addScheduleInterval(value: string, frequency: string, intervalValue = 1, intervalUnit = 'month'): string {
  const date = new Date(`${value}T00:00:00`);
  if (frequency === 'daily') date.setDate(date.getDate() + 1);
  else if (frequency === 'weekly') date.setDate(date.getDate() + 7);
  else if (frequency === 'monthly' || frequency === 'quarterly' || frequency === 'semiannual' || frequency === 'annual' || intervalUnit === 'month' || intervalUnit === 'year') {
    const day = date.getDate();
    const sourceLastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const preserveEndOfMonth = day === sourceLastDay;
    const monthOffset = frequency === 'monthly' ? 1
      : frequency === 'quarterly' ? 3
        : frequency === 'semiannual' ? 6
          : frequency === 'annual' ? 12
            : intervalUnit === 'year' ? Math.max(1, intervalValue) * 12
              : Math.max(1, intervalValue);
    date.setDate(1);
    date.setMonth(date.getMonth() + monthOffset);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(preserveEndOfMonth ? lastDay : Math.min(day, lastDay));
  }
  else if (intervalUnit === 'day') date.setDate(date.getDate() + Math.max(1, intervalValue));
  else if (intervalUnit === 'week') date.setDate(date.getDate() + Math.max(1, intervalValue) * 7);
  return date.toISOString().split('T')[0];
}

const demoRecurringFrequencies = new Set(['monthly', 'quarterly', 'semiannual', 'annual', 'custom']);
const demoRecurringStatuses = new Set(['active', 'paused', 'ended']);
const demoRecurringUnits = new Set(['day', 'week', 'month', 'year']);

function assertDemoDate(value: unknown, label: string): string {
  const date = String(value || '');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`${label} ist ungültig.`);
  }
  return date;
}

function validateDemoRecurring(data: DemoRecord): { startDate: string; endDate?: string; nextRunDate: string; dueDays: number } {
  if (!String(data.customerId || '') || !String(data.name || '').trim()) throw new Error('Kunde und Name sind erforderlich.');
  if (!Array.isArray(data.items) || data.items.length === 0) throw new Error('Mindestens eine Position ist erforderlich.');
  if (!demoRecurringFrequencies.has(String(data.frequency))) throw new Error('Ungültige Häufigkeit.');
  if (!demoRecurringStatuses.has(String(data.status))) throw new Error('Ungültiger Status.');
  if ((data.items as unknown[]).some(item => {
    const row = item as DemoRecord;
    return !String(row.description || '').trim()
      || !Number.isFinite(Number(row.quantity))
      || Number(row.quantity) <= 0
      || !Number.isFinite(Number(row.unitPrice))
      || Number(row.unitPrice) < 0
      || !Number.isFinite(Number(row.taxRate))
      || Number(row.taxRate) < 0
      || Number(row.taxRate) > 100;
  })) throw new Error('Bitte Beschreibung, Menge, Preis und MwSt.-Satz der Positionen prüfen.');
  if (String(data.frequency) === 'custom' && (!Number.isInteger(Number(data.intervalValue)) || Number(data.intervalValue) <= 0 || !demoRecurringUnits.has(String(data.intervalUnit)))) {
    throw new Error('Für ein benutzerdefiniertes Intervall sind eine positive Zahl und eine gültige Einheit erforderlich.');
  }
  const startDate = assertDemoDate(data.startDate, 'Das Startdatum');
  const endDate = data.endDate ? assertDemoDate(data.endDate, 'Das Enddatum') : null;
  const nextRunDate = assertDemoDate(data.nextRunDate, 'Das nächste Ausführungsdatum');
  const dueDays = Number(data.dueDays);
  if (endDate && endDate < startDate) throw new Error('Das Enddatum darf nicht vor dem Startdatum liegen.');
  if (nextRunDate < startDate) throw new Error('Die nächste Ausführung darf nicht vor dem Startdatum liegen.');
  if (!Number.isInteger(dueDays) || dueDays < 0) throw new Error('Das Zahlungsziel muss eine ganze Zahl ab 0 sein.');
  return { startDate, endDate: endDate || undefined, nextRunDate, dueDays };
}

function calculateItems(items: DemoRecord[]) {
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
  const taxAmount = items.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unitPrice || 0) * Number(item.taxRate || 0)) / 100, 0);
  return { subtotal, taxAmount, total: subtotal + taxAmount };
}

function validateDemoEuerSource(state: DemoState, data: DemoRecord, currentId?: string) {
  const sourceType = String(data.sourceType || 'manual');
  const sourceId = data.sourceId ? String(data.sourceId) : '';
  if (sourceType === 'manual') return;
  if (!sourceId) throw new Error('Für diese Buchungsart ist eine Quelle erforderlich.');
  if (sourceType === 'invoice_payment') {
    if (data.entryType !== 'income') throw new Error('Teilzahlungen zu Rechnungen müssen als Einnahme erfasst werden.');
    const invoice = state.invoices.find(item => item.id === sourceId && item.documentType !== 'credit_note');
    if (!invoice) throw new Error('Die zugeordnete Rechnung wurde nicht gefunden.');
    const allocated = state.euerEntries
      .filter(entry => entry.sourceType === 'invoice_payment' && entry.sourceId === sourceId && entry.status !== 'voided' && entry.id !== currentId)
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const remaining = Math.max(0, Number(invoice.total || 0) - allocated);
    if (Number(data.amount || 0) > remaining + 0.01) throw new Error(`Die Teilzahlung überschreitet den offenen Rechnungsbetrag von ${remaining.toFixed(2)} €.`);
    return;
  }
  if (sourceType === 'receipt') {
    const receipt = state.receipts.find(item => item.id === sourceId);
    if (!receipt) throw new Error('Der zugeordnete Beleg wurde nicht gefunden.');
    if (receipt.linkedEuerEntryId && receipt.linkedEuerEntryId !== currentId) throw new Error('Der Beleg ist bereits mit einer anderen EÜR-Buchung verknüpft.');
    if (state.euerEntries.some(entry => entry.sourceType === 'receipt' && entry.sourceId === sourceId && entry.status !== 'voided' && entry.id !== currentId)) throw new Error('Der Beleg ist bereits mit einer aktiven EÜR-Buchung verknüpft.');
    return;
  }
  if (sourceType === 'correction' && !state.euerEntries.some(entry => entry.id === sourceId && entry.status === 'active')) throw new Error('Die zu korrigierende EÜR-Buchung wurde nicht gefunden.');
}

function payload(options: RequestInit): DemoRecord {
  return options.body ? JSON.parse(String(options.body)) as DemoRecord : {} as DemoRecord;
}

function collectionResponse<T>(items: DemoRecord[]): T {
  return items as unknown as T;
}

function demoImportNumber(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const source = String(value).replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const number = Number(source);
  return Number.isFinite(number) ? number : null;
}

function demoImportText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

function demoImportDate(value: unknown): string | null {
  const source = demoImportText(value);
  if (!source) return null;
  const germanDate = source.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (germanDate) {
    const year = germanDate[3].length === 2 ? `20${germanDate[3]}` : germanDate[3];
    const result = `${year}-${germanDate[2].padStart(2, '0')}-${germanDate[1].padStart(2, '0')}`;
    const parsed = new Date(`${result}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result ? null : result;
  }
  const isoDate = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoDate) {
    const result = `${isoDate[1]}-${isoDate[2].padStart(2, '0')}-${isoDate[3].padStart(2, '0')}`;
    const parsed = new Date(`${result}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result ? null : result;
  }
  const excelSerial = Number(source);
  if (Number.isFinite(excelSerial) && excelSerial > 20000 && excelSerial < 100000) {
    const parsed = new Date(Date.UTC(1899, 11, 30) + excelSerial * 86400000);
    return parsed.toISOString().slice(0, 10);
  }
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function demoImportEuerCategory(value: unknown): string | null {
  const source = demoImportText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('de-DE')
    .replace(/[^a-z0-9]/g, '');
  const aliases: Record<string, string> = {
    material: 'materials', materialien: 'materials', waren: 'materials',
    office: 'office', buro: 'office', buerobedarf: 'office', buerokosten: 'office', burobedarf: 'office', burokosten: 'office',
    software: 'software', lizenzen: 'software',
    telefon: 'telecommunications', internet: 'telecommunications', telekommunikation: 'telecommunications',
    reise: 'travel', reisekosten: 'travel',
    fahrzeug: 'vehicle', fahrzeugkosten: 'vehicle',
    werbung: 'marketing', marketing: 'marketing',
    beratung: 'professional_services', dienstleistung: 'professional_services', fremdleistung: 'professional_services', fremdleistungen: 'professional_services',
    versicherung: 'insurance', versicherungen: 'insurance',
    bankgebuehren: 'bank_fees', bankgebuhren: 'bank_fees', bankkosten: 'bank_fees',
    sonstige: 'other_expense', sonstigeausgabe: 'other_expense', sonstigebetriebsausgaben: 'other_expense', otherexpense: 'other_expense',
  };
  return aliases[source] || (['materials', 'office', 'software', 'telecommunications', 'travel', 'vehicle', 'marketing', 'professional_services', 'insurance', 'bank_fees', 'other_expense'].includes(source) ? source : null);
}

function demoImportCustomer(state: DemoState, row: DemoRecord): DemoRecord | undefined {
  const customerId = demoImportText(row.customerId);
  const customerNumber = demoImportText(row.customerNumber);
  const customerEmail = demoImportText(row.customerEmail || row.email).toLocaleLowerCase();
  const customerName = demoImportText(row.customerName || row.name).toLocaleLowerCase();
  return state.customers.find(customer =>
    (customerId && customer.id === customerId)
    || (customerNumber && String(customer.customerNumber).toLocaleLowerCase() === customerNumber.toLocaleLowerCase())
    || (customerEmail && String(customer.email || '').toLocaleLowerCase() === customerEmail)
    || (!customerNumber && !customerEmail && customerName && String(customer.name).toLocaleLowerCase() === customerName)
  );
}

function demoImportItems(row: DemoRecord): DemoRecord[] {
  const structured = Array.isArray(row.items)
    ? row.items
    : typeof row.items === 'string'
      ? (() => { try { const parsed = JSON.parse(row.items as string); return Array.isArray(parsed) ? parsed : []; } catch { return []; } })()
      : [];
  const items = structured.map((item, index) => {
    const record = item as DemoRecord;
    const quantity = demoImportNumber(record.quantity || record.menge) ?? 1;
    const unitPrice = demoImportNumber(record.unitPrice || record.unit_price || record.price || record.preis) ?? 0;
    return {
      id: generateUUID(),
      description: demoImportText(record.description || record.name || record.position) || `Position ${index + 1}`,
      quantity,
      unitPrice,
      taxRate: demoImportNumber(record.taxRate || record.tax_rate || record.mwst) ?? 19,
      total: quantity * unitPrice,
      order: index + 1,
    } as DemoRecord;
  });
  if (items.length > 0) return items;
  const description = demoImportText(row.itemDescription || row.description || row.position);
  const unitPrice = demoImportNumber(row.itemUnitPrice || row.itemUnitPrice || row.price || row.preis);
  if (!description || unitPrice === null) return [];
  const quantity = demoImportNumber(row.itemQuantity || row.quantity || row.menge) ?? 1;
  return [{ id: generateUUID(), description, quantity, unitPrice, taxRate: demoImportNumber(row.itemTaxRate || row.taxRate || row.mwst) ?? 19, total: quantity * unitPrice, order: 1 }];
}

function demoImport(resource: string, rows: DemoRecord[], duplicateMode: string, state: DemoState, commit: boolean) {
  const entries: Array<{ rowNumbers: number[]; status: string; message: string; data?: DemoRecord; existingId?: string }> = [];
  const isUpdateable = ['customers', 'positions', 'hourlyRates', 'materials'].includes(resource);
  const collection = resource === 'customers'
    ? state.customers
    : resource === 'jobs'
      ? state.jobs
      : resource === 'quotes'
        ? state.quotes
        : resource === 'hourlyRates'
          ? state.hourlyRates
          : resource === 'materials'
            ? state.materialTemplates
            : resource === 'euerEntries'
              ? state.euerEntries
            : ((state.company.invoiceTemplates || []) as DemoRecord[]);
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = Number(row._rowNumber || index + 2);

    if (resource === 'euerEntries') {
      const rawDate = demoImportText(row.entryDate ?? row.entry_date ?? row.date ?? row.datum ?? row.buchungsdatum ?? row.belegdatum);
      const entryDate = demoImportDate(rawDate);
      const description = demoImportText(row.description ?? row.beschreibung ?? row.bezeichnung ?? row.text ?? row.verwendungszweck ?? row.zweck);
      const amount = demoImportNumber(row.amount ?? row.betrag ?? row.brutto ?? row.grossAmount ?? row.gross_amount ?? row.ausgabe ?? row.ausgabenbetrag);
      const categoryValue = demoImportText(row.category ?? row.kategorie ?? row.ausgabenkategorie ?? row.kostenart);
      const category = demoImportEuerCategory(categoryValue) || 'other_expense';
      const rawTaxRate = row.taxRate ?? row.tax_rate ?? row.tax ?? row.mwst ?? row.ust ?? row.steuersatz;
      const taxRate = rawTaxRate === undefined ? 0 : demoImportNumber(rawTaxRate);

      if (!entryDate) {
        entries.push({ rowNumbers: [rowNumber], status: 'error', message: 'Datum der Ausgabe fehlt oder ist ungültig.' });
        return;
      }
      if (!description || description.length > 255) {
        entries.push({ rowNumbers: [rowNumber], status: 'error', message: 'Eine Beschreibung ist erforderlich und darf höchstens 255 Zeichen enthalten.' });
        return;
      }
      if (amount === null || amount < 0) {
        entries.push({ rowNumbers: [rowNumber], status: 'error', message: 'Betrag ist ungültig oder fehlt.' });
        return;
      }
      if (taxRate === null || taxRate < 0 || taxRate > 100) {
        entries.push({ rowNumbers: [rowNumber], status: 'error', message: 'Der MwSt.-Satz muss zwischen 0 und 100 liegen.' });
        return;
      }

      const identity = `${entryDate}|${description.toLocaleLowerCase()}|${category}|${amount.toFixed(2)}`;
      const existing = collection.find(item => `${item.entryDate}|${demoImportText(item.description).toLocaleLowerCase()}|${item.category}|${Number(item.amount).toFixed(2)}` === identity);
      if (seen.has(identity) || existing) {
        entries.push({ rowNumbers: [rowNumber], status: 'duplicate', message: 'Diese Ausgabe ist bereits vorhanden oder doppelt in der Importdatei enthalten.' });
        return;
      }
      seen.add(identity);

      const warnings: string[] = [];
      if (!categoryValue) warnings.push('Kategorie wird als sonstige Betriebsausgabe übernommen');
      else if (!demoImportEuerCategory(categoryValue)) warnings.push('Unbekannte Kategorie wird als sonstige Betriebsausgabe übernommen');
      if (rawTaxRate === undefined) warnings.push('MwSt.-Satz wird mit 0 % übernommen');
      entries.push({
        rowNumbers: [rowNumber],
        status: warnings.length ? 'warning' : 'valid',
        message: warnings.length ? `${warnings.join(', ')}.` : 'Ausgabe kann angelegt werden.',
        data: {
          entryType: 'expense', entryDate, description, category, amount, taxRate,
          notes: demoImportText(row.notes ?? row.note ?? row.notizen ?? row.bemerkung ?? row.anmerkung) || undefined,
          sourceType: 'manual',
        },
      });
      return;
    }

    const name = demoImportText(row.name || row.customerName);
    if ((resource === 'customers' || resource === 'positions' || resource === 'hourlyRates' || resource === 'materials') && !name) {
      entries.push({ rowNumbers: [rowNumber], status: 'error', message: 'Name fehlt.' });
      return;
    }
    const identity = resource === 'customers'
      ? demoImportText(row.customerNumber || row.email || row.name).toLocaleLowerCase()
      : demoImportText(row.name).toLocaleLowerCase();
    if (seen.has(identity)) {
      entries.push({ rowNumbers: [rowNumber], status: 'duplicate', message: 'Doppelte Zeile in der Importdatei.' });
      return;
    }
    seen.add(identity);

    if (resource === 'customers') {
      const existing = collection.find(item =>
        (row.customerNumber && String(item.customerNumber).toLocaleLowerCase() === demoImportText(row.customerNumber).toLocaleLowerCase())
        || (row.email && String(item.email || '').toLocaleLowerCase() === demoImportText(row.email).toLocaleLowerCase())
        || (!row.customerNumber && !row.email && String(item.name || '').toLocaleLowerCase() === name.toLocaleLowerCase())
      );
      const customerData = {
        name,
        customerNumber: demoImportText(row.customerNumber) || undefined,
        email: demoImportText(row.email),
        address: demoImportText(row.address),
        addressSupplement: demoImportText(row.addressSupplement),
        postalCode: demoImportText(row.postalCode),
        city: demoImportText(row.city),
        country: demoImportText(row.country) || 'Deutschland',
        taxId: demoImportText(row.taxId),
        phone: demoImportText(row.phone),
      } as unknown as DemoRecord;
      if (existing && duplicateMode === 'update') entries.push({ rowNumbers: [rowNumber], status: 'update', message: 'Bestehender Kunde wird aktualisiert.', data: customerData, existingId: existing.id });
      else if (existing) entries.push({ rowNumbers: [rowNumber], status: 'duplicate', message: 'Kunde bereits vorhanden.' });
      else entries.push({ rowNumbers: [rowNumber], status: 'valid', message: 'Kunde kann angelegt werden.', data: customerData });
      return;
    }

    if (resource === 'jobs') {
      const customer = demoImportCustomer(state, row);
      if (!customer || !demoImportText(row.title)) {
        entries.push({ rowNumbers: [rowNumber], status: 'error', message: !customer ? 'Kunde konnte nicht gefunden werden.' : 'Auftragstitel fehlt.' });
        return;
      }
      const date = dateOnly(row.date || isoDate());
      const existing = collection.find(item => row.jobNumber && item.jobNumber === row.jobNumber);
      if (existing) {
        entries.push({ rowNumbers: [rowNumber], status: 'duplicate', message: 'Auftrag bereits vorhanden.' });
        return;
      }
      entries.push({ rowNumbers: [rowNumber], status: row.date ? 'valid' : 'warning', message: row.date ? 'Auftrag kann angelegt werden.' : 'Datum wird auf heute gesetzt.', data: { ...row, customerId: customer.id, customerName: customer.name, date, description: demoImportText(row.description) || demoImportText(row.title) } });
      return;
    }

    if (resource === 'quotes') {
      const customer = demoImportCustomer(state, row);
      const items = demoImportItems(row);
      if (!customer || items.length === 0) {
        entries.push({ rowNumbers: [rowNumber], status: 'error', message: !customer ? 'Kunde konnte nicht gefunden werden.' : 'Keine gültige Position gefunden.' });
        return;
      }
      const existing = collection.find(item => row.quoteNumber && item.quoteNumber === row.quoteNumber);
      if (existing) {
        entries.push({ rowNumbers: [rowNumber], status: 'duplicate', message: 'Angebot bereits vorhanden.' });
        return;
      }
      const totals = calculateItems(items);
      entries.push({ rowNumbers: [rowNumber], status: 'valid', message: 'Angebot kann angelegt werden.', data: { ...row, customerId: customer.id, customerName: customer.name, issueDate: dateOnly(row.issueDate || isoDate()), validUntil: dateOnly(row.validUntil || isoDate()), items, ...totals } });
      return;
    }

    const priceKey = resource === 'hourlyRates' ? 'rate' : 'unitPrice';
    const price = demoImportNumber(row[priceKey] || row.price || row.preis);
    if (price === null || price < 0) {
      entries.push({ rowNumbers: [rowNumber], status: 'error', message: 'Preis ist ungültig oder fehlt.' });
      return;
    }
    const existing = collection.find(item => String(item.name || '').toLocaleLowerCase() === name.toLocaleLowerCase());
    const data: DemoRecord = { ...row, name, [priceKey]: price, taxRate: demoImportNumber(row.taxRate || row.mwst) ?? 19, unit: resource === 'materials' ? (demoImportText(row.unit) || 'Stück') : undefined };
    if (existing && duplicateMode === 'update' && isUpdateable) entries.push({ rowNumbers: [rowNumber], status: 'update', message: 'Bestehender Eintrag wird aktualisiert.', data, existingId: existing.id });
    else if (existing) entries.push({ rowNumbers: [rowNumber], status: 'duplicate', message: 'Eintrag bereits vorhanden.' });
    else entries.push({ rowNumbers: [rowNumber], status: 'valid', message: 'Eintrag kann angelegt werden.', data });
  });

  const count = (status: string) => entries.reduce((sum, entry) => sum + (entry.status === status ? entry.rowNumbers.length : 0), 0);
  const summary = {
    total: rows.length,
    valid: count('valid') + count('warning'),
    updated: count('update'),
    duplicates: count('duplicate'),
    warnings: count('warning'),
    errors: count('error'),
    imported: 0,
    skipped: count('duplicate') + count('error'),
  };
  if (commit) {
    let imported = 0;
    entries.forEach(entry => {
      if (!['valid', 'warning', 'update'].includes(entry.status) || !entry.data) return;
      if (resource === 'customers') {
        if (entry.status === 'update') {
          const target = state.customers.find(item => item.id === entry.existingId);
          if (target) Object.assign(target, entry.data, { id: target.id, updatedAt: isoDate() });
        } else {
          state.customers.push({ ...entry.data, id: generateUUID(), customerNumber: entry.data.customerNumber || String(1001 + state.customers.length), createdAt: isoDate() });
        }
      } else if (resource === 'jobs') {
        state.jobs.push({ ...entry.data, id: generateUUID(), jobNumber: entry.data.jobNumber || `AB-${new Date().getFullYear()}-${String(state.jobs.length + 1).padStart(3, '0')}`, createdAt: isoDate(), updatedAt: isoDate() });
      } else if (resource === 'quotes') {
        state.quotes.push({ ...entry.data, id: generateUUID(), quoteNumber: entry.data.quoteNumber || `AN-${new Date().getFullYear()}-${String(state.quotes.length + 1).padStart(3, '0')}`, createdAt: isoDate() });
      } else if (resource === 'positions') {
        const templates = (state.company.invoiceTemplates || []) as DemoRecord[];
        if (entry.status === 'update') {
          const target = templates.find(item => item.id === entry.existingId);
          if (target) Object.assign(target, entry.data, { updatedAt: isoDate() });
        } else templates.push({ ...entry.data, id: generateUUID(), createdAt: isoDate(), updatedAt: isoDate() });
        state.company.invoiceTemplates = templates;
      } else if (resource === 'euerEntries') {
        const createdEntry = { ...entry.data, id: generateUUID(), status: 'active', sourceType: 'manual', createdAt: isoDate(), updatedAt: isoDate() };
        state.euerEntries.push(createdEntry);
        state.euerEntryHistory.push({ id: generateUUID(), euerEntryId: createdEntry.id, action: 'created', reason: '', oldData: null, newData: { ...createdEntry }, changedAt: isoDate() });
      } else {
        const targetCollection = resource === 'hourlyRates' ? state.hourlyRates : state.materialTemplates;
        if (entry.status === 'update') {
          const target = targetCollection.find(item => item.id === entry.existingId);
          if (target) Object.assign(target, entry.data, { updatedAt: isoDate() });
        } else targetCollection.push({ ...entry.data, id: generateUUID(), createdAt: isoDate(), updatedAt: isoDate() });
      }
      imported += 1;
    });
    summary.imported = imported;
    entries.forEach(entry => { if (['valid', 'warning', 'update'].includes(entry.status)) entry.status = 'imported'; });
    saveState(state);
  }
  return {
    resource,
    dryRun: !commit,
    summary,
    rows: entries.flatMap(entry => entry.rowNumbers.map(rowNumber => ({ rowNumber, status: entry.status, message: entry.message }))),
  };
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

  if (resource === 'imports') {
    const importResource = parts[1];
    const rows = Array.isArray(data.rows) ? data.rows as DemoRecord[] : [];
    return demoImport(importResource, rows, String(data.duplicateMode || 'skip'), state, data.dryRun === false) as unknown as T;
  }

  if (resource === 'reporting') {
    const inDateRange = (invoice: DemoRecord, start?: string, end?: string) => {
      const date = dateOnly(invoice.issueDate);
      return (!start || date >= start) && (!end || date <= end);
    };
    const reportableInvoices = state.invoices.filter(invoice => invoice.documentType !== 'credit_note');
    if (path.includes('invoice-journal')) {
      const startDate = queryParams.get('startDate') || undefined;
      const endDate = queryParams.get('endDate') || undefined;
      const customerId = queryParams.get('customerId') || undefined;
      const filteredInvoices = reportableInvoices.filter(invoice => inDateRange(invoice, startDate, endDate) && (!customerId || invoice.customerId === customerId));
      const invoices = filteredInvoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customerName,
        customerNumber: state.customers.find((customer) => customer.id === invoice.customerId)?.customerNumber,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        subtotal: Number(invoice.subtotal || 0),
        taxAmount: Number(invoice.taxAmount || 0),
        total: Number(invoice.total || 0),
        status: invoice.status,
        paidAmount: invoice.status === 'paid' ? Number(invoice.total || 0) : 0,
        overdueAmount: invoice.status === 'overdue' ? Number(invoice.total || 0) : 0,
        outstandingAmount: ['draft', 'sent'].includes(String(invoice.status)) ? Number(invoice.total || 0) : 0,
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
        dateRange: { startDate: startDate || null, endDate: endDate || null },
      } as T;
    }
    const selectedYear = Number(queryParams.get('year') || new Date().getFullYear());
    const yearInvoices = reportableInvoices.filter(invoice => new Date(String(invoice.issueDate)).getFullYear() === selectedYear);
    const monthlyRevenue = Array.from({ length: 12 }, (_, index) => {
      const monthInvoices = yearInvoices.filter(invoice => new Date(String(invoice.issueDate)).getMonth() === index);
      return {
        month: index + 1,
        invoiceCount: monthInvoices.length,
        subtotalSum: monthInvoices.reduce((sum, invoice) => sum + Number(invoice.subtotal || 0), 0),
        taxSum: monthInvoices.reduce((sum, invoice) => sum + Number(invoice.taxAmount || 0), 0),
        totalSum: monthInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
        paidSum: monthInvoices.filter(invoice => invoice.status === 'paid').reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
        overdueSum: monthInvoices.filter(invoice => invoice.status === 'overdue').reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
      };
    });
    const customerTotals = new Map<string, DemoRecord[]>();
    yearInvoices.forEach(invoice => {
      const customerInvoices = customerTotals.get(String(invoice.customerId)) || [];
      customerInvoices.push(invoice);
      customerTotals.set(String(invoice.customerId), customerInvoices);
    });
    const topCustomers = Array.from(customerTotals.entries()).map(([customerId, customerInvoices]) => ({
      customerId,
      customerName: customerInvoices[0].customerName,
      invoiceCount: customerInvoices.length,
      totalRevenue: customerInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
      avgInvoiceAmount: customerInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0) / customerInvoices.length,
    })).sort((a, b) => b.totalRevenue - a.totalRevenue);
    const statuses = ['draft', 'sent', 'paid', 'overdue'] as const;
    const statusDistribution = statuses.map(status => {
      const statusInvoices = yearInvoices.filter(invoice => invoice.status === status);
      return { status, count: statusInvoices.length, totalAmount: statusInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0) };
    });
    const totalSubtotal = yearInvoices.reduce((sum, invoice) => sum + Number(invoice.subtotal || 0), 0);
    const totalTax = yearInvoices.reduce((sum, invoice) => sum + Number(invoice.taxAmount || 0), 0);
    const totalAmount = yearInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
    return {
      year: selectedYear,
      monthlyRevenue,
      topCustomers,
      statusDistribution,
      yearOverview: {
        totalInvoices: yearInvoices.length,
        totalSubtotal,
        totalTax,
        totalAmount,
        paidAmount: yearInvoices.filter(invoice => invoice.status === 'paid').reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
        overdueAmount: yearInvoices.filter(invoice => invoice.status === 'overdue').reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
        avgInvoiceAmount: yearInvoices.length ? totalAmount / yearInvoices.length : 0,
      },
    } as T;
  }

  if (resource === 'company') {
    if (method === 'PUT') {
      const requestedProfile = typeof data.terminologyProfile === 'string' && data.terminologyProfile in demoProfileFixtures
        ? data.terminologyProfile as TerminologyProfile
        : String(state.company.terminologyProfile || 'customers') as TerminologyProfile;
      const currentProfile = String(state.company.terminologyProfile || 'customers');
      if (requestedProfile !== currentProfile) {
        const previousCompany = { ...state.company };
        const seeded = createInitialState(requestedProfile);
        Object.assign(state, seeded);
        state.company = { ...seeded.company, ...previousCompany, ...data, terminologyProfile: requestedProfile };
      } else {
        state.company = { ...state.company, ...data };
      }
    }
    saveState(state);
    return state.company as unknown as T;
  }

  if (resource === 'quotes' && parts[2] === 'convert-to-invoice' && id && method === 'POST') {
    const quote = state.quotes.find(item => item.id === id);
    if (!quote) throw new Error('Angebot nicht gefunden');
    if (quote.convertedToInvoiceId) throw new Error('Das Angebot wurde bereits in eine Rechnung umgewandelt.');
    if (quote.status !== 'accepted') throw new Error('Nur angenommene Angebote können in Rechnungen umgewandelt werden.');

    const items = (Array.isArray(quote.items) ? quote.items : []).map(item => ({
      ...item,
      id: generateUUID(),
      order: Number(item.order || 0),
    }));
    const totals = calculateItems(items);
    const issueDate = dateOnly(isoDate());
    const invoice: DemoRecord = {
      id: generateUUID(),
      invoiceNumber: `RE-${new Date(`${issueDate}T00:00:00`).getFullYear()}-${String(state.invoices.length + 1).padStart(3, '0')}`,
      customerId: quote.customerId,
      customerName: quote.customerName,
      issueDate,
      dueDate: dateOnly(new Date(new Date(`${issueDate}T00:00:00`).getTime() + 30 * 86400000)),
      items,
      ...totals,
      status: 'draft',
      notes: quote.notes ? `Erstellt aus Angebot ${quote.quoteNumber}\n\n${quote.notes}` : `Erstellt aus Angebot ${quote.quoteNumber}`,
      sourceQuoteId: quote.id,
      sourceQuoteNumber: quote.quoteNumber,
      documentType: 'invoice',
      createdAt: isoDate(),
    };
    state.invoices.push(invoice);
    quote.convertedToInvoiceId = invoice.id;
    quote.status = 'billed';
    quote.updatedAt = isoDate();
    saveState(state);
    return invoice as unknown as T;
  }

  if (resource === 'invoices' && parts[1] === 'from-jobs' && method === 'POST') {
    const sourceJobIds = Array.isArray(data.sourceJobIds) ? data.sourceJobIds.map(String) : [];
    if (sourceJobIds.length === 0 || new Set(sourceJobIds).size !== sourceJobIds.length) {
      throw new Error('Mindestens eine eindeutige Auftragseinheit ist erforderlich.');
    }
    const sourceJobs = sourceJobIds.map(jobId => state.jobs.find(job => job.id === jobId));
    if (sourceJobs.some(job => !job)) throw new Error('Mindestens eine Auftragseinheit wurde nicht gefunden.');
    const jobsForInvoice = sourceJobs.filter((job): job is DemoRecord => Boolean(job));
    if (jobsForInvoice.some(job => job.status !== 'completed')) throw new Error('Nur abgeschlossene Auftragseinheiten können abgerechnet werden.');
    if (new Set(jobsForInvoice.map(job => String(job.customerId))).size !== 1) throw new Error('Alle Auftragseinheiten müssen zum selben Kunden gehören.');
    if (state.invoices.some(invoice => Array.isArray(invoice.sourceJobIds) && sourceJobIds.some(jobId => (invoice.sourceJobIds as string[]).includes(jobId)))) {
      throw new Error('Mindestens eine Auftragseinheit wurde bereits abgerechnet.');
    }

    const customer = state.customers.find(item => item.id === String(jobsForInvoice[0].customerId));
    if (!customer) throw new Error('Kunde nicht gefunden');
    const items = (Array.isArray(data.items) ? data.items : []).map(item => ({ ...item, id: generateUUID() }));
    const totals = calculateItems(items as DemoRecord[]);
    const sourceJobSources = jobsForInvoice.map(job => {
      const recurrence = job.recurrence as Partial<JobRecurrence> | undefined;
      return {
      id: generateUUID(),
      jobId: job.id,
      jobNumber: String(job.jobNumber || ''),
      externalJobNumber: job.externalJobNumber ? String(job.externalJobNumber) : undefined,
      title: String(job.title || ''),
      jobDate: dateOnly(job.date || isoDate()),
        recurrenceIndex: recurrence?.occurrenceIndex,
      };
    });
    const invoice: DemoRecord = {
      ...data,
      id: generateUUID(),
      sourceJobIds,
      sourceJobs: sourceJobSources,
      customerId: customer.id,
      customerName: customer.name,
      invoiceNumber: `RE-${new Date().getFullYear()}-${String(state.invoices.length + 1).padStart(3, '0')}`,
      issueDate: dateOnly(data.issueDate || isoDate()),
      dueDate: dateOnly(data.dueDate || isoDate(30)),
      items,
      ...totals,
      status: 'draft',
      documentType: 'invoice',
      createdAt: isoDate(),
    };
    state.invoices.push(invoice);
    jobsForInvoice.forEach(job => { job.status = 'invoiced'; job.updatedAt = isoDate(); });
    saveState(state);
    return invoice as unknown as T;
  }

  if (resource === 'customers' && id && (parts[2] === 'archive' || parts[2] === 'restore') && method === 'POST') {
    const customer = state.customers.find(item => item.id === id);
    if (!customer) throw new Error('Kunde nicht gefunden');
    customer.isActive = parts[2] === 'restore';
    customer.updatedAt = isoDate();
    saveState(state);
    return { id: customer.id, isActive: customer.isActive } as unknown as T;
  }

  if (resource === 'euer-entries') {
    const entries = state.euerEntries;
    const history = state.euerEntryHistory;
    const addHistory = (entry: DemoRecord, action: 'created' | 'updated' | 'voided', reason?: string, oldData?: DemoRecord) => {
      history.push({
        id: generateUUID(),
        euerEntryId: entry.id,
        action,
        reason: reason || '',
        oldData: oldData || null,
        newData: action === 'voided' ? null : { ...entry },
        changedAt: isoDate(),
      });
    };

    if (parts[2] === 'history' && id && method === 'GET') {
      return history.filter(item => item.euerEntryId === id).sort((a, b) => String(b.changedAt).localeCompare(String(a.changedAt))) as unknown as T;
    }

    if (method === 'GET' && !id) {
      const year = queryParams.get('year');
      const activeEntries = entries.filter(entry => entry.status !== 'voided');
      return (year ? activeEntries.filter(entry => String(entry.entryDate).startsWith(`${year}-`)) : activeEntries) as unknown as T;
    }
    if (method === 'POST' && !id) {
      const amount = Number(data.amount);
      const taxRate = Number(data.taxRate || 0);
      if (!['income', 'expense'].includes(String(data.entryType))) throw new Error('Ungültiger Buchungstyp.');
      if (!String(data.entryDate || '').match(/^\d{4}-\d{2}-\d{2}$/)) throw new Error('Ungültiges Datum.');
      if (!String(data.description || '').trim()) throw new Error('Eine Beschreibung ist erforderlich.');
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Der Betrag muss eine positive Zahl sein.');
      if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new Error('Der MwSt.-Satz muss zwischen 0 und 100 liegen.');
      validateDemoEuerSource(state, data);
      const record: DemoRecord = {
        ...data,
        id: generateUUID(),
        entryDate: dateOnly(data.entryDate),
        description: String(data.description).trim(),
        amount,
        taxRate,
        notes: data.notes || '',
        sourceType: data.sourceType || 'manual',
        sourceId: data.sourceId || undefined,
        status: 'active',
        correctionReason: data.correctionReason || undefined,
        createdAt: isoDate(),
        updatedAt: isoDate(),
      };
      entries.push(record);
      addHistory(record, 'created', record.correctionReason as string | undefined, undefined);
      saveState(state);
      return record as unknown as T;
    }
    if (id) {
      const index = entries.findIndex(entry => entry.id === id);
      if (index < 0) throw new Error('EÜR-Buchung nicht gefunden.');
      if (method === 'GET') return entries[index] as unknown as T;
      if (method === 'PUT') {
        if (entries[index].status === 'voided') throw new Error('Eine stornierte Buchung kann nicht bearbeitet werden.');
        const oldEntry = entries[index];
        const updated: DemoRecord = { ...oldEntry, ...data, id, updatedAt: isoDate() };
        validateDemoEuerSource(state, updated, id);
        if (oldEntry.sourceType === 'receipt' && (updated.sourceType !== 'receipt' || updated.sourceId !== oldEntry.sourceId)) {
          const oldReceipt = state.receipts.find(receipt => receipt.id === String(oldEntry.sourceId));
          if (oldReceipt?.linkedEuerEntryId === id) oldReceipt.linkedEuerEntryId = null;
        }
        if (updated.sourceType === 'receipt') {
          const receipt = state.receipts.find(item => item.id === String(updated.sourceId));
          if (receipt) receipt.linkedEuerEntryId = id;
        }
        const oldData = { ...entries[index] };
        updated.entryDate = dateOnly(updated.entryDate);
        updated.status = 'active';
        entries[index] = updated;
        addHistory(updated, 'updated', String(data.correctionReason || ''), oldData);
        saveState(state);
        return updated as unknown as T;
      }
      if (method === 'DELETE') {
        if (entries[index].status === 'voided') throw new Error('Die Buchung wurde bereits storniert.');
        const oldData = { ...entries[index] };
        const updated: DemoRecord = { ...entries[index], status: 'voided', correctionReason: String(data.correctionReason || 'Stornierung'), updatedAt: isoDate() };
        entries[index] = updated;
        if (updated.sourceType === 'receipt') {
          const receipt = state.receipts.find(item => item.id === String(updated.sourceId));
          if (receipt?.linkedEuerEntryId === id) receipt.linkedEuerEntryId = null;
        }
        addHistory(updated, 'voided', updated.correctionReason as string, oldData);
        saveState(state);
        return undefined as T;
      }
    }
  }

  if (resource === 'receipts') {
    const receipts = state.receipts;

    if (parts[2] === 'ocr' && id && method === 'POST') {
      const index = receipts.findIndex(receipt => receipt.id === id);
      if (index < 0) throw new Error('Beleg nicht gefunden.');
      receipts[index] = {
        ...receipts[index],
        ocrStatus: 'completed',
        ocrText: 'Demo-Modus: Das lokale OCR wird im Backend-Container ausgeführt.',
        ocrConfidence: 0,
        ocrError: undefined,
        extractedData: receipts[index].extractedData || {},
        ocrExtractedData: receipts[index].extractedData || {},
        updatedAt: isoDate(),
      };
      saveState(state);
      return receipts[index] as unknown as T;
    }

    if (parts[2] === 'create-euer' && id && method === 'POST') {
      const receipt = receipts.find(item => item.id === id);
      if (!receipt) throw new Error('Beleg nicht gefunden.');
      if (receipt.linkedEuerEntryId) throw new Error('Der Beleg ist bereits mit einer EÜR-Buchung verknüpft.');
      if (state.euerEntries.some(entry => entry.sourceType === 'receipt' && entry.sourceId === id && entry.status === 'active')) {
        throw new Error('Der Beleg ist bereits mit einer aktiven EÜR-Buchung verknüpft.');
      }
      const entryData = { ...data, sourceType: 'receipt', sourceId: id, entryType: 'expense' } as DemoRecord;
      validateDemoEuerSource(state, entryData);
      const entry: DemoRecord = {
        ...entryData,
        id: generateUUID(),
        entryDate: dateOnly(data.entryDate || isoDate()),
        description: String(data.description || '').trim(),
        amount: Number(data.amount || 0),
        taxRate: Number(data.taxRate || 0),
        status: 'active',
        createdAt: isoDate(),
        updatedAt: isoDate(),
      };
      state.euerEntries.push(entry);
      state.euerEntryHistory.push({ id: generateUUID(), euerEntryId: entry.id, action: 'created', reason: '', oldData: null, newData: { ...entry }, changedAt: isoDate() });
      receipt.linkedEuerEntryId = entry.id;
      receipt.updatedAt = isoDate();
      saveState(state);
      return { entry, receipt } as unknown as T;
    }

    if (parts[2] === 'link-euer' && id && method === 'POST') {
      const receipt = receipts.find(item => item.id === id);
      const entry = state.euerEntries.find(item => item.id === data.euerEntryId);
      if (!receipt || !entry) throw new Error('Beleg oder EÜR-Buchung nicht gefunden.');
      if (entry.sourceType !== 'receipt' || entry.sourceId !== id || entry.status === 'voided') throw new Error('Die EÜR-Buchung gehört nicht zu diesem Beleg.');
      if (receipt.linkedEuerEntryId && receipt.linkedEuerEntryId !== entry.id) throw new Error('Der Beleg ist bereits mit einer anderen EÜR-Buchung verknüpft.');
      receipt.linkedEuerEntryId = String(data.euerEntryId);
      receipt.updatedAt = isoDate();
      saveState(state);
      return receipt as unknown as T;
    }

    if (method === 'GET' && !id) return collectionResponse<T>(receipts);
    if (method === 'POST' && !id) {
      const record: DemoRecord = {
        ...data,
        id: generateUUID(),
        ocrStatus: 'completed',
        ocrText: 'Demo-Modus: Das lokale OCR wird im Backend-Container ausgeführt.',
        ocrConfidence: 0,
        extractedData: {},
        ocrExtractedData: {},
        linkedEuerEntryId: null,
        createdAt: isoDate(),
        updatedAt: isoDate(),
      };
      receipts.push(record);
      saveState(state);
      return record as unknown as T;
    }
    if (id) {
      const index = receipts.findIndex(receipt => receipt.id === id);
      if (index < 0) throw new Error('Beleg nicht gefunden.');
      if (method === 'GET') return receipts[index] as unknown as T;
      if (method === 'PUT') {
        receipts[index] = { ...receipts[index], ...data, id, updatedAt: isoDate() };
        saveState(state);
        return receipts[index] as unknown as T;
      }
      if (method === 'DELETE') {
        if (receipts[index].linkedEuerEntryId) throw new Error('Der Beleg ist mit einer EÜR-Buchung verknüpft. Bitte die Buchung zuerst stornieren.');
        state.receipts = receipts.filter(receipt => receipt.id !== id);
        saveState(state);
        return undefined as T;
      }
    }
  }

  if (resource === 'e-invoices') {
    const incoming = state.incomingEInvoices;
    if (parts[2] === 'link-customer' && id && method === 'POST') {
      const invoice = incoming.find(item => item.id === id);
      if (!invoice) throw new Error('E-Rechnung nicht gefunden.');
      const customer = state.customers.find(item => item.id === String(data.customerId));
      if (!customer) throw new Error('Kunde nicht gefunden.');
      invoice.linkedCustomerId = customer.id;
      invoice.updatedAt = isoDate();
      saveState(state);
      return invoice as unknown as T;
    }
    if (method === 'GET' && !id) return collectionResponse<T>(incoming);
    if (method === 'POST' && !id) {
      const filename = String(data.filename || 'eingang.xml');
      const record: DemoRecord = {
        ...data,
        id: generateUUID(),
        filename,
        contentType: String(data.contentType || 'application/xml'),
        size: Math.max(1, Math.round(String(data.content || '').length * 0.75)),
        sha256: `demo-sha256-${generateUUID()}`,
        format: 'XRechnung',
        validationStatus: 'validated',
        invoiceNumber: `DEMO-EINGANG-${String(incoming.length + 1).padStart(3, '0')}`,
        issueDate: dateOnly(isoDate()),
        currency: 'EUR',
        supplierName: 'Demo-Lieferant',
        grossAmount: 119,
        extractedData: { invoiceNumber: `DEMO-EINGANG-${String(incoming.length + 1).padStart(3, '0')}`, issueDate: dateOnly(isoDate()), currency: 'EUR', supplierName: 'Demo-Lieferant', grossAmount: 119 },
        receivedAt: isoDate(),
        updatedAt: isoDate(),
      };
      incoming.push(record);
      saveState(state);
      return record as unknown as T;
    }
    if (id) {
      const invoice = incoming.find(item => item.id === id);
      if (!invoice) throw new Error('E-Rechnung nicht gefunden.');
      if (method === 'GET') return invoice as unknown as T;
    }
  }

  if (resource === 'fixed-assets') {
    const assets = state.fixedAssets;
    if (method === 'GET' && !id) return collectionResponse<T>(assets);
    if (method === 'POST' && !id) {
      const record: DemoRecord = {
        ...data,
        id: generateUUID(),
        name: String(data.name || '').trim(),
        category: String(data.category || '').trim(),
        acquisitionDate: dateOnly(data.acquisitionDate || isoDate()),
        acquisitionCost: Number(data.acquisitionCost || 0),
        usefulLifeYears: Number(data.usefulLifeYears || 1),
        status: data.status || 'active',
        disposalDate: data.disposalDate ? dateOnly(data.disposalDate) : undefined,
        notes: data.notes || '',
        createdAt: isoDate(),
        updatedAt: isoDate(),
      };
      if (!record.name || !record.category || Number(record.acquisitionCost) < 0 || Number(record.usefulLifeYears) <= 0) throw new Error('Bitte die Anlagendaten prüfen.');
      assets.push(record);
      saveState(state);
      return record as unknown as T;
    }
    if (id) {
      const index = assets.findIndex(asset => asset.id === id);
      if (index < 0) throw new Error('Anlage nicht gefunden.');
      if (method === 'GET') return assets[index] as unknown as T;
      if (method === 'PUT') {
        const updated: DemoRecord = { ...assets[index], ...data, id, updatedAt: isoDate() };
        if (updated.acquisitionDate) updated.acquisitionDate = dateOnly(updated.acquisitionDate);
        if (updated.disposalDate) updated.disposalDate = dateOnly(updated.disposalDate);
        assets[index] = updated;
        saveState(state);
        return updated as unknown as T;
      }
      if (method === 'DELETE') {
        state.fixedAssets = assets.filter(asset => asset.id !== id);
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

      const runDate = assertDemoDate(data.scheduledDate || recurring.nextRunDate, 'Das Ausführungsdatum');
      if (recurring.endDate && runDate > assertDemoDate(recurring.endDate, 'Das Enddatum')) throw new Error('Die wiederkehrende Rechnung ist bereits beendet.');
      const existingRun = ((recurring.runs as DemoRecord[] | undefined) || []).find(run => run.scheduledDate === runDate && run.status === 'success');
      if (existingRun?.generatedInvoiceId) {
        const existingInvoice = state.invoices.find(invoice => invoice.id === existingRun.generatedInvoiceId);
        if (existingInvoice) return existingInvoice as unknown as T;
      }
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
      const normalized = validateDemoRecurring({
        ...data,
        frequency: data.frequency || 'monthly',
        intervalValue: Number(data.intervalValue || 1),
        intervalUnit: data.intervalUnit || 'month',
        startDate: data.startDate || isoDate(),
        nextRunDate: data.nextRunDate || data.startDate || isoDate(),
        status: data.status || 'active',
        dueDays: Number(data.dueDays ?? 30),
      });
      const record: DemoRecord = {
        ...data,
        id: generateUUID(),
        customerName: customer.name,
        ...normalized,
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
        if (data.customerId && !customer) throw new Error('Kunde nicht gefunden');
        const updated = {
          ...recurringItems[index],
          ...data,
          ...(customer ? { customerName: customer.name } : {}),
          updatedAt: isoDate(),
        };
        const normalized = validateDemoRecurring(updated);
        Object.assign(updated, normalized);
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

  type DemoCollectionKey = Exclude<keyof DemoState, 'company' | 'seedProfile' | 'seedVersion'>;
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
    const visibleItems = key === 'invoices'
      ? items.filter(item => item.documentType !== 'credit_note')
      : key === 'customers' && queryParams.get('includeArchived') !== 'true'
        ? items.filter(item => item.isActive !== false)
        : items;
    return collectionResponse<T>(visibleItems);
  }
  if (method === 'POST' && !id) {
    if (key === 'jobs') {
      const recurrence = data.recurrence as JobRecurrenceRule | undefined;
      const occurrenceDates = recurrence
        ? getJobRecurrenceDates(recurrence)
        : [dateOnly(data.date || isoDate())];
      if (occurrenceDates.length === 0) throw new Error('Die Wiederholung erzeugt keine Einheiten.');

      const recurrenceId = recurrence ? generateUUID() : undefined;
      const records = occurrenceDates.map((occurrenceDate, index) => ({
        ...data,
        id: generateUUID(),
        jobNumber: data.jobNumber || `AB-${new Date().getFullYear()}-${String(state.jobs.length + index + 1).padStart(3, '0')}`,
        date: occurrenceDate,
        recurrence: recurrence
          ? { ...recurrence, id: recurrenceId, occurrenceIndex: index + 1, totalOccurrences: occurrenceDates.length }
          : undefined,
        createdAt: isoDate(),
        updatedAt: isoDate(),
      })) as DemoRecord[];
      state.jobs.push(...records);
      saveState(state);
      return records[0] as unknown as T;
    }
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
      if (key === 'quotes' && (items[index]?.convertedToInvoiceId || items[index]?.status === 'billed')) {
        throw new Error('Ein bereits abgerechnetes Angebot kann nicht mehr geändert werden.');
      }
      if (key === 'jobs' && index >= 0) {
        const current = items[index];
        const targetStatus = String(data.status ?? current.status ?? 'draft');
        const effectiveCustomerId = data.customerId !== undefined ? data.customerId : current.customerId;
        const effectiveTitle = data.title !== undefined ? data.title : current.title;
        const effectiveDescription = data.description !== undefined ? data.description : current.description;
        if (targetStatus !== 'draft' && (
          !String(effectiveCustomerId || '')
          || !String(effectiveTitle || '').trim()
          || !String(effectiveDescription || '').trim()
        )) {
          throw new Error('Pflichtfelder fehlen: Kunde, Titel und Beschreibung sind vor dem Weiterführen erforderlich.');
        }
        const recurrence = data.recurrence as JobRecurrenceRule | null | undefined;
        const currentRecurrence = current.recurrence as JobRecurrence | undefined;

        if (recurrence !== undefined && currentRecurrence?.id) {
          const seriesId = currentRecurrence.id;
          const series = state.jobs
            .filter((record) => (record.recurrence as JobRecurrence | undefined)?.id === seriesId)
            .sort((a, b) => (
              ((a.recurrence as JobRecurrence | undefined)?.occurrenceIndex || 0)
              - ((b.recurrence as JobRecurrence | undefined)?.occurrenceIndex || 0)
            ));

          if (series.some((record) => record.status === 'completed' || record.status === 'invoiced')) {
            throw new Error('Diese Kursserie enthält bereits abgeschlossene oder abgerechnete Termine und kann deshalb nicht mehr in ihrer Wiederholung geändert werden.');
          }

          const seriesIds = new Set(series.map((record) => record.id));
          if (recurrence === null) {
            const updated = { ...current, ...data, id, recurrence: undefined, updatedAt: isoDate() } as DemoRecord;
            state.jobs = state.jobs
              .filter((record) => !seriesIds.has(record.id) || record.id === id)
              .map((record) => record.id === id ? updated : record);
            saveState(state);
            return updated as unknown as T;
          }

          const occurrenceDates = getJobRecurrenceDates(recurrence);
          if (occurrenceDates.length === 0) throw new Error('Die Wiederholung erzeugt keine Einheiten.');

          const survivorCount = Math.min(series.length, occurrenceDates.length);
          const survivors = series.slice(0, survivorCount);
          const currentSeriesRow = series.find((record) => record.id === id);
          if (currentSeriesRow && !survivors.some((record) => record.id === id)) {
            survivors[survivors.length - 1] = currentSeriesRow;
          }

          const updatedCurrent = { ...current, ...data, id, updatedAt: isoDate() } as DemoRecord;
          const survivorIds = new Set(survivors.map((record) => record.id));
          const updatedSeries = survivors.map((record, occurrenceIndex) => ({
            ...(record.id === id ? updatedCurrent : record),
            date: occurrenceDates[occurrenceIndex],
            recurrence: {
              ...recurrence,
              id: seriesId,
              occurrenceIndex: occurrenceIndex + 1,
              totalOccurrences: occurrenceDates.length,
            },
            updatedAt: isoDate(),
          })) as DemoRecord[];
          const extraRecords = occurrenceDates.slice(survivors.length).map((occurrenceDate, occurrenceOffset) => ({
            ...updatedCurrent,
            id: generateUUID(),
            jobNumber: `AB-${new Date().getFullYear()}-${String(state.jobs.length + occurrenceOffset + 1).padStart(3, '0')}`,
            date: occurrenceDate,
            recurrence: {
              ...recurrence,
              id: seriesId,
              occurrenceIndex: survivors.length + occurrenceOffset + 1,
              totalOccurrences: occurrenceDates.length,
            },
            createdAt: isoDate(),
            updatedAt: isoDate(),
          })) as DemoRecord[];

          const updatedSeriesById = new Map(updatedSeries.map((record) => [record.id, record]));
          state.jobs = state.jobs
            .filter((record) => !seriesIds.has(record.id) || survivorIds.has(record.id))
            .map((record) => updatedSeriesById.get(record.id) || record);
          state.jobs.push(...extraRecords);
          saveState(state);
          return (updatedSeriesById.get(id) || updatedCurrent) as unknown as T;
        }

        if (recurrence && !current.recurrence) {
          const occurrenceDates = getJobRecurrenceDates(recurrence);
          if (occurrenceDates.length === 0) throw new Error('Die Wiederholung erzeugt keine Einheiten.');
          const recurrenceId = generateUUID();
          const records = occurrenceDates.map((occurrenceDate, occurrenceIndex) => ({
            ...current,
            ...data,
            id: occurrenceIndex === 0 ? id : generateUUID(),
            jobNumber: occurrenceIndex === 0
              ? current.jobNumber
              : `AB-${new Date().getFullYear()}-${String(state.jobs.length + occurrenceIndex).padStart(3, '0')}`,
            date: occurrenceDate,
            recurrence: { ...recurrence, id: recurrenceId, occurrenceIndex: occurrenceIndex + 1, totalOccurrences: occurrenceDates.length },
            createdAt: current.createdAt || isoDate(),
            updatedAt: isoDate(),
          })) as DemoRecord[];
          items[index] = records[0];
          items.push(...records.slice(1));
          saveState(state);
          return records[0] as unknown as T;
        }
      }
      const updated = { ...(items[index] || { id }), ...data, id, updatedAt: isoDate() };
      if (index >= 0) items[index] = updated; else items.push(updated);
      saveState(state);
      return updated as unknown as T;
    }
    if (method === 'DELETE') {
      if (key === 'quotes' && (items[index]?.status !== 'draft' || items[index]?.convertedToInvoiceId)) throw new Error('Nur unabhängige Angebotsentwürfe können gelöscht werden.');
      if (key === 'invoices' && items[index]?.status !== 'draft') throw new Error('Nur Entwürfe können gelöscht werden.');
      if (key === 'invoices' && Array.isArray(items[index]?.sourceJobIds)) {
        state.jobs.forEach(job => {
          if (((items[index]?.sourceJobIds as string[]) || []).includes(job.id) && job.status === 'invoiced') {
            job.status = 'completed';
            job.updatedAt = isoDate();
          }
        });
      }
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
  localStorage.removeItem(getDemoDataStorageKey());
}

export function seedDemoData(profile: TerminologyProfile = 'customers') {
  localStorage.setItem(getDemoDataStorageKey(), JSON.stringify(createInitialState(profile)));
}
