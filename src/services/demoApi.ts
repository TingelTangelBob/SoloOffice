import { generateUUID } from '../utils/uuid';
import type { JobRecurrence, JobRecurrenceRule, TerminologyProfile } from '../types';
import { getJobRecurrenceDates } from '../utils/jobRecurrence';
import { formatInvoiceNumberPattern, validateInvoiceNumberPattern } from '../utils/invoiceNumberPattern';
import { getTerminology } from '../utils/terminology';
import { calculateDocumentMoney } from '../../backend/utils/documentMoney.js';
import { IMPORT_RESOURCES, MAX_IMPORT_ROWS, isApplicable, planImport, reportRows, summariseImport } from '../../backend/utils/importPlanner.js';
import type { ImportPlan, PlannerContext, PlannerResource } from '../../backend/utils/importPlanner.js';
import type { MoneyItem } from '../../backend/utils/documentMoney.js';

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
  invoiceHistory: DemoRecord[];
  fixedAssets: DemoRecord[];
  receipts: DemoRecord[];
  incomingEInvoices: DemoRecord[];
  /** Importläufe mit den angelegten bzw. geänderten Datensätzen (für „Rückgängig“). */
  importRuns?: DemoRecord[];
  /** Originaldokumente übernommener Rechnungen, je Rechnungs-ID. */
  invoiceOriginals?: Record<string, DemoRecord>;
  company: DemoRecord;
  workspaceSetup?: DemoRecord;
  seedProfile?: TerminologyProfile;
  seedVersion?: number;
  /** Zeitpunkt der Erzeugung – Grundlage für die Alterungsprüfung. */
  seededAt?: string;
  /** true, sobald der Besucher selbst etwas geändert hat (siehe saveState). */
  touched?: boolean;
}

const STORAGE_KEY = 'solooffice-demo-data-v1';
const ACTIVE_WORKSPACE_STORAGE_KEY = 'solooffice-demo-active-workspace-v1';
const DEMO_TAKEOVER_STORAGE_KEY = 'solooffice-demo-takeover-v1';
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

function demoTakeoverStorageKey(): string {
  return `${DEMO_TAKEOVER_STORAGE_KEY}:${getDemoActiveWorkspaceId()}`;
}

function readDemoTakeover(state: DemoState): DemoRecord | null {
  if (typeof sessionStorage !== 'undefined') {
    const saved = sessionStorage.getItem(demoTakeoverStorageKey());
    if (saved) {
      try { return JSON.parse(saved) as DemoRecord; } catch { sessionStorage.removeItem(demoTakeoverStorageKey()); }
    }
  }
  // Importläufe aus älteren Demo-Versionen sperren den Start ebenfalls.
  if (state.importRuns?.length) {
    return {
      id: `demo-legacy-${getDemoActiveWorkspaceId()}`, status: 'open', startedBy: null,
      startedAt: String(state.importRuns[0].createdAt || isoDate()), completedBy: null,
      completedAt: null, progressRevision: 1, legacyBackfill: true,
    };
  }
  return null;
}

function demoTakeoverCategoriesKey(): string {
  return `${demoTakeoverStorageKey()}:categories`;
}

function readDemoTakeoverCategories(): Record<string, DemoRecord> {
  if (typeof sessionStorage === 'undefined') return {};
  try { return JSON.parse(sessionStorage.getItem(demoTakeoverCategoriesKey()) || '{}') as Record<string, DemoRecord>; }
  catch { sessionStorage.removeItem(demoTakeoverCategoriesKey()); return {}; }
}

function writeDemoTakeoverCategories(categories: Record<string, DemoRecord>): void {
  if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(demoTakeoverCategoriesKey(), JSON.stringify(categories));
}

function stableDemoValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableDemoValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as DemoRecord).sort().map(key => [key, stableDemoValue((value as DemoRecord)[key])]));
  return value;
}

function demoDigest(value: unknown): string {
  const source = JSON.stringify(stableDemoValue(value));
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    first = Math.imul(first ^ source.charCodeAt(index), 0x01000193) >>> 0;
    second = Math.imul(second ^ source.charCodeAt(index), 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`.repeat(4);
}

// Bei Änderungen am Seed erhöhen – gespeicherte Zustände älterer Fassungen
// werden dadurch beim nächsten Laden neu aufgebaut.
const DEMO_SEED_VERSION = 8;

/**
 * Nach dieser Zeit gelten die Demodaten als veraltet.
 *
 * Die Daten werden relativ zu „heute" erzeugt, aber im localStorage
 * eingefroren. Ohne Alterungsprüfung sähe ein wiederkehrender Besucher nach
 * Wochen einen leeren Kalender, längst überfällige Rechnungen und eine EÜR
 * ohne aktuelle Buchungen.
 */
const DEMO_MAX_AGE_DAYS = 14;

/**
 * Wahr, wenn die gespeicherten Demodaten veraltet sind, der Besucher aber
 * selbst etwas geändert hat. Dann wird NICHT automatisch neu aufgebaut – seine
 * Arbeit soll nicht unangekündigt verschwinden. Die Oberfläche kann darauf
 * einen Hinweis mit Angebot zum Zurücksetzen stützen.
 */
let demoDataStale = false;

/**
 * Ob die gerade laufende Anfrage den Zustand im Auftrag des Besuchers ändert.
 * Wird zu Beginn jeder Anfrage gesetzt und von saveState ausgewertet.
 */
let currentRequestMutates = false;

/**
 * Ob eine Anfrage als Änderung *des Besuchers* zählt.
 *
 * Nicht jede schreibende Anfrage ist eine Nutzeraktion: Das Dashboard markiert
 * beim Laden automatisch überfällige Rechnungen (Dashboard.tsx). Würde das als
 * Änderung zählen, wäre jeder Zustand Sekunden nach dem ersten Aufruf „berührt"
 * und die Auffrischung der Demodaten könnte nie greifen.
 *
 * Deshalb: Anlegen, Löschen und Teiländerungen zählen immer. Ein PUT zählt nur,
 * wenn es mehr als den Status setzt – reine Statuswechsel stammen in aller
 * Regel aus dieser automatischen Wartung.
 */
function isUserEdit(method: string, body: Record<string, unknown>): boolean {
  if (method === 'GET') return false;
  if (method === 'PUT') {
    const keys = Object.keys(body || {});
    return keys.length > 0 && keys.some(key => key !== 'status');
  }
  return true;
}

export function isDemoDataStale(): boolean {
  return demoDataStale;
}

function ageInDays(iso: unknown): number {
  const parsed = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return (Date.now() - parsed) / 86400000;
}

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

function demoCustomerType(name: string): 'person' | 'organization' {
  return /(gmbh|gbr|ag\b|kg\b|partner|handwerk|design|beratung|immobilien|solutions|verein|werk|zentrum|stelle|hilfe|projekt|kanzlei|praxis|steuerberatung|notariat|architektur|apotheke|büro|schulträger|förderverein|bildungswerk)/i.test(name)
    ? 'organization'
    : 'person';
}

function enrichDemoState(state: DemoState, profile: TerminologyProfile): DemoState {
  const fixture = demoProfileFixtures[profile] || demoProfileFixtures.customers;
  const cities = ['Berlin', 'Hamburg', 'München', 'Köln', 'Leipzig', 'Bremen', 'Dresden', 'Freiburg'];
  const streets = ['Hauptstraße', 'Marktplatz', 'Werkstraße', 'Gartenweg', 'Bahnhofstraße', 'Rosenweg', 'Lindenallee', 'Am Stadtpark'];

  const customers: DemoRecord[] = fixture.names.map((name, index) => ({
    id: generateUUID(),
    customerNumber: String(1001 + index),
    name,
    customerType: demoCustomerType(name),
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
      id: generateUUID(), invoiceNumber: `RE-${yearOf(-(index * 4 + 1))}-${String(index + 1).padStart(3, '0')}`,
      customerId: customer.id, customerName: customer.name,
      issueDate: isoDate(-(index * 4 + 1)), dueDate: isoDate(14 - index * 3),
      ...totals,
      status: (['draft', 'sent', 'paid', 'overdue'][index % 4]), notes: fixture.workDescription,
      createdAt: isoDate(-(index * 4 + 1)),
    };
  });

  const quotes: DemoRecord[] = Array.from({ length: 6 }, (_, index) => {
    const customer = customerAt(index + 2);
    const items = [makeItem(fixture.workTitles[(index + 2) % fixture.workTitles.length], 680 + index * 95, (index % 2) + 1, 0)];
    const totals = calculateItems(items);
    return {
      id: generateUUID(), quoteNumber: `AN-${yearOf(-(index * 6 + 2))}-${String(index + 1).padStart(3, '0')}`,
      customerId: customer.id, customerName: customer.name, issueDate: isoDate(-(index * 6 + 2)), validUntil: isoDate(20 - index * 2),
      ...totals, status: (['draft', 'sent', 'accepted', 'rejected', 'expired', 'billed'][index]),
      notes: fixture.workDescription, createdAt: isoDate(-(index * 6 + 2)),
    };
  });

  const jobs: DemoRecord[] = Array.from({ length: 8 }, (_, index) => {
    const customer = customerAt(index + 1);
    return {
      id: generateUUID(), jobNumber: `AU-${yearOf(index - 3)}-${String(index + 1).padStart(3, '0')}`,
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
    const documentNumber = `BE-${yearOf(-index * 9)}-${String(index + 1).padStart(3, '0')}`;
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
      invoiceNumber: `EINGANG-${yearOf(-(index + 2) * 6)}-${String(index + 1).padStart(3, '0')}`,
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
  state.seededAt = isoDate();
  state.touched = false;
  return state;
}

const isoDate = (daysFromToday = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString();
};

/**
 * Jahr des jeweiligen Belegdatums.
 *
 * Die Nummernkreise dürfen nicht auf einem festen Jahr stehen bleiben: Die
 * Demodaten werden relativ zu „heute" erzeugt, eine fest verdrahtete Jahreszahl
 * würde ab dem Jahreswechsel zu Belegnummern führen, die nicht zum Datum
 * daneben passen.
 */
const yearOf = (daysFromToday = 0) => new Date(isoDate(daysFromToday)).getFullYear();

function createInitialState(profile: TerminologyProfile = 'customers'): DemoState {
  const customers: DemoRecord[] = [
    {
      id: generateUUID(), customerNumber: '1001', name: 'Musterkunde GmbH', email: 'kontakt@musterkunde.de',
      customerType: 'organization',
      address: 'Hauptstraße 12', city: 'Berlin', postalCode: '10115', country: 'Deutschland', phone: '+49 30 123456', createdAt: isoDate(-30),
    },
    {
      id: generateUUID(), customerNumber: '1002', name: 'Kolkman & Partner', email: 'office@kolkman.de',
      customerType: 'organization',
      address: 'Marktplatz 4', city: 'Hamburg', postalCode: '20095', country: 'Deutschland', phone: '+49 40 987654', createdAt: isoDate(-20),
    },
    {
      id: generateUUID(), customerNumber: '1003', name: 'Beispiel Handwerk', email: 'info@beispiel-handwerk.de',
      customerType: 'organization',
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
      id: generateUUID(), invoiceNumber: `RE-${yearOf(-index * 7)}-${String(index + 1).padStart(3, '0')}`,
      customerId: customer(index).id, customerName: customer(index).name, issueDate: isoDate(-index * 7), dueDate: isoDate(14 - index * 7),
      items: [lineItem], subtotal: lineItemPrice, taxAmount: lineItemPrice * 0.19, total: lineItemPrice * 1.19,
      status: index === 0 ? 'draft' : index === 1 ? 'sent' : 'paid', notes: '', createdAt: isoDate(-index * 7),
    };
  });

  const jobs: DemoRecord[] = [0, 1, 2].map((index) => ({
    id: generateUUID(), jobNumber: `AU-${yearOf(index - 1)}-${String(index + 1).padStart(3, '0')}`, customerId: customer(index).id,
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
    invoiceHistory: [],
    fixedAssets: [],
    receipts: [],
    incomingEInvoices: [],
    // Die Pflichtfelder müssen vollständig sein: Fehlt eines davon, blendet
    // Layout.tsx auf JEDER Seite den Hinweis „Firmendaten vervollständigen"
    // ein – in einer öffentlichen Demo der schlechteste erste Eindruck.
    // Geprüft werden name, address, city, postalCode, email, taxId, bankAccount.
    company: {
      id: 'demo-company', name: 'Demo-Firma', address: 'Beispielstraße 1', city: 'Berlin', postalCode: '10115', country: 'Deutschland',
      email: 'demo@example.com', phone: '030 1234567', website: 'demo.solooffice.de',
      taxId: 'DE123456789', bankAccount: 'DE02 1203 0000 0000 2020 51', bic: 'BYLADEM1001',
      primaryColor: '#2563eb', secondaryColor: '#64748b', jobTrackingEnabled: true, quotesEnabled: true,
      reportingEnabled: true, remindersEnabled: true, defaultPaymentDays: 30, isSmallBusiness: false, invoiceStartNumber: 1,
      invoiceNumberPattern: 'RE-{YYYY}-{NNN}', creditNoteNumberPattern: 'GS-{YYYY}-{NNN}',
      locale: 'de-DE', numberFormat: 'european', currency: 'EUR', dateFormat: 'DD.MM.YYYY', timeFormat: '24h', timeZone: 'Europe/Berlin', themeMode: 'system', terminologyProfile: 'customers', receiptLabel: 'Belege',
      invoiceTemplates: [], createdAt: isoDate(),
    },
    workspaceSetup: {
      currentStep: 1, completedAt: null, migrationChoice: 'undecided', setupRequired: true,
      createdAt: isoDate(), updatedAt: isoDate(),
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

    // Alterungsprüfung: Die Daten sind relativ zu ihrem Erzeugungstag gebaut.
    // Nach längerer Pause passen Kalender, Fälligkeiten und EÜR nicht mehr zum
    // heutigen Datum.
    if (ageInDays(parsed.seededAt) > DEMO_MAX_AGE_DAYS) {
      if (parsed.touched) {
        // Der Besucher hat eigene Einträge angelegt. Diese ungefragt zu
        // verwerfen wäre übergriffig – stattdessen nur vermerken, damit die
        // Oberfläche ein Zurücksetzen anbieten kann.
        demoDataStale = true;
      } else {
        const refreshed = createInitialState(storedProfile);
        refreshed.company = { ...refreshed.company, ...(parsed.company || {}), terminologyProfile: storedProfile };
        localStorage.setItem(storageKey, JSON.stringify(refreshed));
        return refreshed;
      }
    }

    return {
      ...parsed,
      yearlyInvoiceStartNumbers: parsed.yearlyInvoiceStartNumbers || [],
      calendarEvents: parsed.calendarEvents || [],
      recurringInvoices: parsed.recurringInvoices || [],
      euerEntries: parsed.euerEntries || [],
      euerEntryHistory: parsed.euerEntryHistory || [],
      invoiceHistory: parsed.invoiceHistory || [],
      fixedAssets: parsed.fixedAssets || [],
      receipts: (parsed.receipts || []).map(receipt => ({ ...receipt, ocrExtractedData: receipt.ocrExtractedData || receipt.extractedData || {} })),
      incomingEInvoices: parsed.incomingEInvoices || [],
      // Vor L2 gespeicherte Demodaten werden wie ein bestehender Workspace
      // behandelt: weiterhin per Einstellungen prüfbar, ohne Einrichtungszwang.
      workspaceSetup: parsed.workspaceSetup || {
        currentStep: 1, completedAt: null, migrationChoice: 'undecided', setupRequired: false,
        createdAt: isoDate(), updatedAt: isoDate(),
      },
    } as DemoState;
  } catch {
    const initial = createInitialState();
    localStorage.setItem(storageKey, JSON.stringify(initial));
    return initial;
  }
}

function saveState(state: DemoState) {
  // Nur echte Änderungen des Besuchers markieren. Manche Lesezugriffe
  // schreiben ebenfalls (etwa wenn wiederkehrende Vorgänge fällig werden) –
  // würden diese als „verändert" zählen, wäre jeder Zustand sofort nach dem
  // ersten Seitenaufruf berührt und die Auffrischung könnte nie greifen.
  if (currentRequestMutates) state.touched = true;
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

function calculateItems(
  items: DemoRecord[],
  documentType: 'invoice' | 'credit_note' | 'quote' = 'invoice',
  discountData?: DemoRecord,
) {
  const result = calculateDocumentMoney({
    ...(discountData || {}),
    items: items as unknown as MoneyItem[],
  }, { documentType });
  return {
    items: result.items as unknown as DemoRecord[],
    subtotal: result.subtotal,
    itemDiscountAmount: result.itemDiscountAmount,
    globalDiscountType: result.globalDiscountType,
    globalDiscountValue: result.globalDiscountValue,
    globalDiscountAmount: result.globalDiscountAmount,
    totalDiscountAmount: result.totalDiscountAmount,
    discountedSubtotal: result.discountedSubtotal,
    taxAmount: result.taxAmount,
    taxBreakdown: result.taxBreakdown,
    total: result.total,
  };
}

const derivedMoneyFields = [
  'subtotal', 'itemDiscountAmount', 'globalDiscountAmount', 'totalDiscountAmount',
  'discountedSubtotal', 'taxAmount', 'total', 'taxBreakdown',
] as const;

function withoutDerivedMoneyFields(data: DemoRecord): DemoRecord {
  const result = { ...data };
  derivedMoneyFields.forEach(field => { delete result[field]; });
  return result;
}

function hasMoneyUpdate(data: DemoRecord): boolean {
  return data.items !== undefined
    || data.globalDiscountType !== undefined
    || data.globalDiscountValue !== undefined
    || data.globalDiscountAmount !== undefined;
}

const invoiceContentFields = ['customerId', 'customerName', 'issueDate', 'dueDate', 'serviceDate', 'items', 'attachments', 'notes',
  'globalDiscountType', 'globalDiscountValue', 'globalDiscountAmount', 'referenceInvoiceId', 'creditNoteReason',
  'recurringInvoiceId', 'subtotal', 'taxAmount', 'total', 'documentType', 'documentSnapshot', 'invoiceNumber'];

function protectDemoInvoice(current: DemoRecord, data: DemoRecord) {
  if (current.status !== 'draft' && (data.status === 'draft' || invoiceContentFields.some(key => data[key] !== undefined))) {
    throw new Error('Diese Rechnung ist bereits ausgestellt. Für inhaltliche Korrekturen bitte eine Gutschrift und bei Bedarf eine neue Rechnung erstellen.');
  }
}

function captureDemoInvoice(state: DemoState, invoice: DemoRecord) {
  const customer = state.customers.find(row => row.id === invoice.customerId);
  if (!customer) throw new Error('Kunde nicht gefunden.');
  invoice.documentSnapshot = JSON.parse(JSON.stringify({ version: 1, capturedAt: isoDate(), company: state.company, customer }));
  invoice.customerName = customer.name;
}

function demoMoneyUpdate(current: DemoRecord, data: DemoRecord, documentType: 'invoice' | 'credit_note' | 'quote') {
  if (!hasMoneyUpdate(data)) return {};
  const merged = { ...current, ...data };
  if (data.globalDiscountType === null) merged.globalDiscountAmount = 0;
  return calculateItems(merged.items as DemoRecord[], documentType, merged);
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
    if (invoice.status === 'draft') throw new Error('Für einen Rechnungsentwurf kann noch keine Zahlung erfasst werden.');
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

// Kundenbezug gilt wie auf dem Server nur für Einnahmen ohne Rechnung.
function demoEuerCustomerId(state: DemoState, data: DemoRecord): string | undefined {
  if (data.entryType !== 'income' || (data.sourceType && data.sourceType !== 'manual') || !data.customerId) return undefined;
  const customer = state.customers.find(item => item.id === String(data.customerId));
  if (!customer) throw new Error('Der zugeordnete Kunde wurde nicht gefunden.');
  return customer.id;
}

function payload(options: RequestInit): DemoRecord {
  return options.body ? JSON.parse(String(options.body)) as DemoRecord : {} as DemoRecord;
}

function collectionResponse<T>(items: DemoRecord[]): T {
  return items as unknown as T;
}

// ---------------------------------------------------------------------------
// Importe im Demo-Modus
//
// Die Prüfung ist dieselbe wie auf dem Server (backend/utils/importPlanner.js);
// nur das Schreiben erfolgt in den Browserzustand. Jeder Import wird als Lauf
// protokolliert und kann bis zum Abschluss rückgängig gemacht werden.
// ---------------------------------------------------------------------------

interface DemoImportRunItem {
  tableName: string;
  recordId: string;
  action: 'created' | 'updated';
  oldData?: DemoRecord | null;
}

const DEMO_IMPORT_RESOURCE_LABELS: Record<string, string> = {
  customers: 'Kunden', jobs: 'Aufträge', quotes: 'Angebote', positions: 'Positionsvorlagen',
  hourlyRates: 'Stundensätze', materials: 'Materialien', euerEntries: 'Einnahmen und Ausgaben',
  invoicePayments: 'Zahlungseingänge', invoices: 'Rechnungen',
};

const DEMO_WORK_TITLES: Record<string, string> = {
  customers: 'Auftrag', mandants: 'Mandat', patients: 'Behandlung', students: 'Unterricht', clients: 'Beratung',
};

const DEMO_MAX_ORIGINAL_BYTES = 1024 * 1024;

function demoImportRuns(state: DemoState): DemoRecord[] {
  if (!Array.isArray(state.importRuns)) state.importRuns = [];
  return state.importRuns;
}

function demoInvoiceOriginals(state: DemoState): Record<string, DemoRecord> {
  if (!state.invoiceOriginals || typeof state.invoiceOriginals !== 'object') state.invoiceOriginals = {};
  return state.invoiceOriginals;
}

function demoImportContext(state: DemoState): PlannerContext {
  const profile = String(state.company.terminologyProfile || 'customers') as TerminologyProfile;
  const terminology = getTerminology(profile);
  const invoiceCustomer = (invoiceId: unknown) => state.invoices.find(invoice => invoice.id === invoiceId)?.customerId;
  return {
    entityLabel: terminology.entity.singular,
    workLabel: DEMO_WORK_TITLES[profile] || 'Auftrag',
    today: dateOnly(isoDate()),
    cutoverDate: typeof state.company.importCutoverDate === 'string' && state.company.importCutoverDate ? state.company.importCutoverDate : null,
    defaultPaymentDays: Number.isInteger(Number(state.company.defaultPaymentDays)) ? Number(state.company.defaultPaymentDays) : 14,
    customers: state.customers.map(customer => ({ ...customer })),
    jobs: state.jobs.map(job => ({
      id: job.id, jobNumber: job.jobNumber, externalJobNumber: job.externalJobNumber, customerId: job.customerId,
      title: job.title, date: dateOnly(job.date), startTime: job.startTime,
    })),
    quotes: state.quotes.map(quote => ({ id: quote.id, quoteNumber: quote.quoteNumber })),
    hourlyRates: state.hourlyRates.map(rate => ({ id: rate.id, name: rate.name })),
    materials: state.materialTemplates.map(material => ({ id: material.id, name: material.name })),
    positionTemplates: ((state.company.invoiceTemplates || []) as DemoRecord[]).map(template => ({ ...template })),
    euerEntries: state.euerEntries.filter(entry => entry.status !== 'voided').map(entry => ({
      ...entry,
      entryDate: dateOnly(entry.entryDate),
      status: 'active',
      customerId: entry.customerId || (entry.sourceType === 'invoice_payment' ? invoiceCustomer(entry.sourceId) : undefined),
    })),
    invoices: state.invoices.filter(invoice => invoice.documentType !== 'credit_note').map(invoice => {
      const customer = state.customers.find(item => item.id === invoice.customerId);
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        documentType: 'invoice',
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        customerNumber: customer?.customerNumber,
        customerEmail: customer?.email,
        issueDate: dateOnly(invoice.issueDate),
        serviceDate: invoice.serviceDate ? dateOnly(invoice.serviceDate) : null,
        jobDates: Array.isArray(invoice.sourceJobs) ? invoice.sourceJobs.map(job => dateOnly((job as DemoRecord).jobDate || (job as DemoRecord).date)) : [],
        itemTaxRates: Array.isArray(invoice.items) ? (invoice.items as DemoRecord[]).map(item => Number(item.taxRate)) : [],
        status: invoice.status,
        total: Number(invoice.total || 0),
        taxAmount: Number(invoice.taxAmount || 0),
      };
    }),
  };
}

function nextDemoDocumentNumber(existing: unknown[], prefix: string, date: unknown): string {
  const year = dateOnly(date || isoDate()).slice(0, 4);
  const used = new Set(existing.map(value => String(value || '')));
  let counter = existing.reduce<number>((highest, value) => {
    const match = String(value || '').match(new RegExp(`^${prefix}-${year}-(\\d+)$`));
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  let candidate: string;
  do {
    counter += 1;
    candidate = `${prefix}-${year}-${String(counter).padStart(3, '0')}`;
  } while (used.has(candidate));
  return candidate;
}

function applyDemoImport(state: DemoState, resource: string, plan: ImportPlan, fileName = ''): DemoImportRunItem[] {
  // Übernommene Buchungen verweisen wie auf dem Server auf ihre Quelle.
  const importNote = (notes: unknown, rowNumbers: number[]) => String(notes || '') || `Datenübernahme: ${fileName || 'Import'}, Zeile ${rowNumbers.join(', ')}`;
  const items: DemoImportRunItem[] = [];
  const track = (tableName: string, recordId: string, action: 'created' | 'updated', oldData: DemoRecord | null = null) => {
    items.push({ tableName, recordId, action, oldData: oldData ? JSON.parse(JSON.stringify(oldData)) as DemoRecord : null });
  };
  const usedCustomerNumbers = new Set(state.customers.map(customer => String(customer.customerNumber || '')));
  let highestCustomerNumber = state.customers.reduce((highest, customer) => {
    const value = String(customer.customerNumber || '');
    return /^\d+$/.test(value) ? Math.max(highest, Number(value)) : highest;
  }, 1000);
  const allocateCustomerNumber = (requested?: unknown) => {
    const wanted = String(requested || '').trim();
    if (wanted && !usedCustomerNumbers.has(wanted)) {
      usedCustomerNumbers.add(wanted);
      return wanted;
    }
    do { highestCustomerNumber += 1; } while (usedCustomerNumbers.has(String(highestCustomerNumber)));
    usedCustomerNumbers.add(String(highestCustomerNumber));
    return String(highestCustomerNumber);
  };
  const createCustomer = (data: DemoRecord): string => {
    const record: DemoRecord = {
      country: 'Deutschland', address: '', city: '', postalCode: '', email: '', customerType: 'person', isActive: true,
      ...data,
      id: generateUUID(),
      customerNumber: allocateCustomerNumber(data.customerNumber),
      createdAt: isoDate(),
      updatedAt: isoDate(),
    };
    state.customers.push(record);
    track('customers', record.id, 'created');
    return record.id;
  };
  const newCustomerIds = new Map<string, string>();
  plan.newCustomers.forEach(customer => {
    newCustomerIds.set(customer.key, createCustomer({ id: '', name: customer.name, customerNumber: customer.customerNumber, email: customer.email || '' }));
  });
  const customerIdFor = (data: DemoRecord) => String(data.customerId || (data.customerKey ? newCustomerIds.get(String(data.customerKey)) : '') || '');
  const customerName = (customerId: string) => String(state.customers.find(customer => customer.id === customerId)?.name || '');
  const applicable = plan.entries.filter(isApplicable);
  const touchedInvoices = new Set<string>();

  const addEuerEntry = (record: DemoRecord) => {
    const entry: DemoRecord = { ...record, status: 'active', createdAt: isoDate(), updatedAt: isoDate() };
    state.euerEntries.push(entry);
    state.euerEntryHistory.push({ id: generateUUID(), euerEntryId: entry.id, action: 'created', reason: '', oldData: null, newData: { ...entry }, changedAt: isoDate() });
    track('euer_entries', entry.id, 'created');
    return entry;
  };

  if (resource === 'customers') {
    applicable.forEach(entry => {
      if (entry.status === 'update' && entry.existingId) {
        const target = state.customers.find(customer => customer.id === entry.existingId);
        if (!target) return;
        const changes = entry.data as DemoRecord;
        track('customers', target.id, 'updated', Object.fromEntries(Object.keys(changes).map(key => [key, target[key]])) as DemoRecord);
        Object.assign(target, changes, { updatedAt: isoDate() });
        return;
      }
      createCustomer(entry.data as DemoRecord);
    });
  } else if (resource === 'hourlyRates' || resource === 'materials' || resource === 'positions') {
    const collection = resource === 'hourlyRates'
      ? state.hourlyRates
      : resource === 'materials'
        ? state.materialTemplates
        : ((state.company.invoiceTemplates || []) as DemoRecord[]);
    const tableName = resource === 'hourlyRates' ? 'hourly_rates' : resource === 'materials' ? 'material_templates' : 'invoice_templates';
    applicable.forEach(entry => {
      const data = entry.data as DemoRecord;
      if (data.isDefault) {
        collection.filter(item => item.isDefault).forEach(item => {
          track(tableName, item.id, 'updated', { id: item.id, isDefault: true });
          item.isDefault = false;
        });
      }
      if (entry.status === 'update' && entry.existingId) {
        const target = collection.find(item => item.id === entry.existingId);
        if (!target) return;
        track(tableName, target.id, 'updated', { ...target });
        Object.assign(target, data, { updatedAt: isoDate() });
        return;
      }
      const record: DemoRecord = { ...data, id: generateUUID(), createdAt: isoDate(), updatedAt: isoDate() };
      collection.push(record);
      track(tableName, record.id, 'created');
    });
    if (resource === 'positions') state.company.invoiceTemplates = collection;
  } else if (resource === 'jobs') {
    applicable.forEach(entry => {
      const data = entry.data as DemoRecord;
      const customerId = customerIdFor(data);
      const dates = Array.isArray(data.occurrenceDates) ? data.occurrenceDates as string[] : [String(data.date)];
      const recurrenceId = data.recurrence ? generateUUID() : undefined;
      dates.forEach((date, index) => {
        const hours = Number(data.hoursWorked || 0);
        const rate = Number(data.hourlyRate || 0);
        const timeEntries = Array.isArray(data.timeEntries) && data.timeEntries.length > 0
          ? data.timeEntries
          : hours > 0 || data.startTime || data.endTime
            ? [{ id: generateUUID(), description: 'Arbeitszeit', startTime: data.startTime || undefined, endTime: data.endTime || undefined, hoursWorked: hours, hourlyRate: rate, taxRate: data.taxRate ?? 19, total: Math.round(hours * rate * 100) / 100 }]
            : [];
        const record: DemoRecord = {
          id: generateUUID(),
          jobNumber: index === 0 && data.jobNumber ? data.jobNumber : nextDemoDocumentNumber(state.jobs.map(job => job.jobNumber), 'AB', date),
          externalJobNumber: data.externalJobNumber,
          customerId,
          customerName: customerName(customerId),
          customerAddress: data.customerAddress,
          location: data.location,
          title: data.title,
          description: data.description,
          date,
          startTime: data.startTime || undefined,
          endTime: data.endTime || undefined,
          hoursWorked: hours,
          hourlyRate: rate,
          hourlyRateId: data.hourlyRateId || undefined,
          timeEntries,
          materials: data.materials || [],
          status: data.status,
          notes: data.notes || '',
          priority: data.priority,
          recurrence: data.recurrence
            ? { ...(data.recurrence as DemoRecord), id: recurrenceId, occurrenceIndex: index + 1, totalOccurrences: dates.length }
            : undefined,
          createdAt: isoDate(),
          updatedAt: isoDate(),
        };
        state.jobs.push(record);
        track('job_entries', record.id, 'created');
      });
    });
  } else if (resource === 'quotes') {
    applicable.forEach(entry => {
      const data = entry.data as DemoRecord;
      const customerId = customerIdFor(data);
      const record: DemoRecord = {
        ...data,
        id: generateUUID(),
        quoteNumber: data.quoteNumber || nextDemoDocumentNumber(state.quotes.map(quote => quote.quoteNumber), 'AN', data.issueDate),
        customerId,
        customerName: customerName(customerId),
        customerKey: undefined,
        createdAt: isoDate(),
        updatedAt: isoDate(),
      };
      state.quotes.push(record);
      track('quotes', record.id, 'created');
    });
  } else if (resource === 'euerEntries' || resource === 'invoicePayments') {
    applicable.forEach(entry => {
      const data = entry.data as DemoRecord;
      if (data.kind === 'payment') {
        addEuerEntry({
          id: generateUUID(), entryType: 'income', entryDate: data.entryDate, description: `Zahlung Rechnung ${data.invoiceNumber}`,
          category: 'other_income', amount: data.amount, taxRate: data.taxRate, notes: importNote(data.notes, entry.rowNumbers),
          sourceType: 'invoice_payment', sourceId: data.invoiceId, externalReference: data.externalReference || undefined,
        });
        touchedInvoices.add(String(data.invoiceId));
        return;
      }
      addEuerEntry({
        id: generateUUID(), entryType: data.entryType, entryDate: data.entryDate, description: data.description,
        category: data.category, amount: data.amount, taxRate: data.taxRate, notes: importNote(data.notes, entry.rowNumbers),
        sourceType: 'manual', externalReference: data.externalReference || undefined,
        customerId: data.entryType === 'income' ? customerIdFor(data) || undefined : undefined,
      });
    });
  } else if (resource === 'invoices') {
    applicable.forEach(entry => {
      const data = entry.data as DemoRecord;
      const customerId = customerIdFor(data);
      const invoice: DemoRecord = {
        id: generateUUID(),
        invoiceNumber: data.invoiceNumber,
        documentType: 'invoice',
        origin: 'imported',
        hasOriginalDocument: false,
        customerId,
        customerName: customerName(customerId),
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        serviceDate: data.serviceDate || null,
        items: (data.items as DemoRecord[]).map(item => ({ ...item, id: generateUUID() })),
        subtotal: data.subtotal,
        taxAmount: data.taxAmount,
        total: data.total,
        status: data.status,
        notes: data.notes || '',
        attachments: [],
        createdAt: isoDate(),
        updatedAt: isoDate(),
      };
      captureDemoInvoice(state, invoice);
      state.invoices.push(invoice);
      recordInvoiceHistory(state, invoice, 'created', null, invoice);
      track('invoices', invoice.id, 'created');
      const payment = data.payment as DemoRecord | null;
      if (payment) {
        addEuerEntry({
          id: generateUUID(), entryType: 'income', entryDate: payment.entryDate, description: `Zahlung Rechnung ${data.invoiceNumber}`,
          category: 'other_income', amount: payment.amount, taxRate: payment.taxRate, notes: importNote('', entry.rowNumbers),
          sourceType: 'invoice_payment', sourceId: invoice.id,
        });
      }
    });
  }
  touchedInvoices.forEach(invoiceId => syncDemoInvoicePaymentStatus(state, invoiceId));
  return items;
}

function demoImport(resource: string, rows: DemoRecord[], data: DemoRecord, state: DemoState) {
  if (!IMPORT_RESOURCES.includes(resource as PlannerResource)) throw new Error('Nicht unterstütztes Importziel.');
  if (rows.length === 0) throw new Error('Es wurden keine Importzeilen übergeben.');
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Es dürfen höchstens ${MAX_IMPORT_ROWS.toLocaleString('de-DE')} Zeilen auf einmal importiert werden.`);
  const plan = planImport(resource as PlannerResource, rows, demoImportContext(state), {
    duplicateMode: data.duplicateMode === 'update' ? 'update' : 'skip',
    createMissingCustomers: data.createMissingCustomers === true,
    matchOpenInvoices: data.matchOpenInvoices !== false,
  });
  const summary = summariseImport(plan, rows.length);
  const commit = data.dryRun === false;
  const takeover = data.takeover && typeof data.takeover === 'object' ? data.takeover as DemoRecord : null;
  if (takeover && ((takeover.phase === 'preview') !== !commit)) throw new Error('Vorschau und Kategorieausführung müssen getrennt angefordert werden.');
  const session = readDemoTakeover(state);
  if (session && session.status === 'open' && !session.legacyBackfill && !takeover && commit) {
    throw new Error('Während einer Umzugssitzung müssen Kategorien einzeln anhand ihrer geprüften Vorschau übernommen werden.');
  }
  let categoryId: string | null = null;
  let digest: string | null = null;
  let categories = readDemoTakeoverCategories();
  let category: DemoRecord | undefined;
  if (takeover) {
    category = categories[resource];
    if (takeover.phase === 'execute' && category?.sessionId === takeover.sessionId && category?.status === 'completed') {
      if (category.idempotencyKey !== takeover.idempotencyKey) throw new Error('Diese Kategorie wurde bereits freigegeben und übernommen.');
      const previous = demoImportRuns(state).find(run => run.id === category.runId);
      if (previous) return { resource, dryRun: false, runId: previous.id, summary: previous.summary, rows: previous.report, truncated: false, idempotentReplay: true, demoMode: true };
    }
    if (!session || session.id !== takeover.sessionId || session.status !== 'open' || session.legacyBackfill) throw new Error('Die Umzugssitzung ist nicht für eine neue Kategorieübernahme offen.');
    if (takeover.phase === 'execute' && (!category || category.id !== takeover.categoryId || category.status !== 'open')) throw new Error('Die Kategoriekennung ist veraltet. Vorschau erneut prüfen.');
    digest = demoDigest({ resource, rows, options: plan.options, settings: data.settings || {}, file: data.file || {}, context: demoImportContext(state), plan });
    if (takeover.phase === 'execute') {
      if (!takeover.previewDigest || category?.digest !== takeover.previewDigest || category.digest !== digest) throw new Error('Der Bestand oder die Zuordnung hat sich seit der Vorschau geändert. Vorschau erneut prüfen.');
      categoryId = String(category.id);
    } else {
      if (category?.status === 'completed') throw new Error('Diese Kategorie wurde in der Sitzung bereits übernommen.');
      if (!category) category = { id: generateUUID(), status: 'open', resource };
      categoryId = String(category.id);
      categories[resource] = { ...category, digest, sessionId: session.id };
      writeDemoTakeoverCategories(categories);
    }
  }
  let runId: string | null = null;
  if (commit) {
    if (summary.records === 0) throw new Error('Es gibt keine Zeile, die übernommen werden kann.');
    const file = (data.file || {}) as DemoRecord;
    const items = applyDemoImport(state, resource, plan, String(file.name || ''));
    summary.imported = summary.records;
    runId = generateUUID();
    demoImportRuns(state).unshift({
      id: runId,
      resource,
      resourceLabel: DEMO_IMPORT_RESOURCE_LABELS[resource] || resource,
      fileName: String(file.name || ''),
      fileHash: typeof file.hash === 'string' ? file.hash : null,
      sourceHeaders: Array.isArray(file.headers) ? file.headers : [],
      settings: { ...((data.settings || {}) as DemoRecord), options: plan.options },
      summary,
      report: reportRows(plan, true),
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdByName: 'Demo',
      migrationSessionId: takeover?.sessionId || null,
      migrationCategoryId: categoryId,
      items,
    });
    if (takeover && category) {
      categories[resource] = { ...category, status: 'completed', idempotencyKey: takeover.idempotencyKey, runId, completedAt: new Date().toISOString() };
      writeDemoTakeoverCategories(categories);
      const updatedSession = { ...session!, progressRevision: Number(session!.progressRevision || 1) + 1 };
      sessionStorage.setItem(demoTakeoverStorageKey(), JSON.stringify(updatedSession));
    }
    saveState(state);
  }
  return {
    resource,
    dryRun: !commit,
    runId,
    summary,
    rows: reportRows(plan, commit),
    totals: plan.totals,
    newCustomers: plan.newCustomers.map(customer => ({ name: customer.name, rowNumbers: customer.rowNumbers })),
    truncated: false,
    ...(takeover ? { categoryId, previewDigest: digest } : {}),
    demoMode: true,
  };
}

function demoRevertImport(state: DemoState, run: DemoRecord): void {
  const items = (Array.isArray(run.items) ? run.items : []) as unknown as DemoImportRunItem[];
  const created = (table: string) => new Set(items.filter(item => item.tableName === table && item.action === 'created').map(item => item.recordId));
  const own = new Set(items.filter(item => item.action === 'created').map(item => item.recordId));
  const blockers: string[] = [];
  const customers = created('customers');
  const blockedCustomers = state.customers.filter(customer => customers.has(customer.id) && (
    state.invoices.some(invoice => invoice.customerId === customer.id && !own.has(invoice.id))
    || state.quotes.some(quote => quote.customerId === customer.id && !own.has(quote.id))
    || state.jobs.some(job => job.customerId === customer.id && !own.has(job.id))
    || state.euerEntries.some(entry => entry.customerId === customer.id && entry.status !== 'voided' && !own.has(entry.id))
  ));
  if (blockedCustomers.length > 0) blockers.push(`Für ${blockedCustomers.slice(0, 10).map(customer => `„${customer.name}“`).join(', ')} gibt es inzwischen weitere Dokumente oder Buchungen`);
  const invoices = created('invoices');
  const blockedInvoices = state.invoices.filter(invoice => invoices.has(invoice.id) && (
    state.euerEntries.some(entry => entry.sourceType === 'invoice_payment' && entry.sourceId === invoice.id && entry.status !== 'voided' && !own.has(entry.id))
    || state.invoices.some(other => other.referenceInvoiceId === invoice.id)
    || Boolean(invoice.lastReminderSentAt)
  ));
  if (blockedInvoices.length > 0) blockers.push(`Zu ${blockedInvoices.slice(0, 10).map(invoice => invoice.invoiceNumber).join(', ')} wurden inzwischen Zahlungen, Gutschriften oder Mahnungen erfasst`);
  const jobs = created('job_entries');
  const billedJobs = state.invoices.flatMap(invoice => (Array.isArray(invoice.sourceJobs) ? invoice.sourceJobs as DemoRecord[] : [])).filter(source => jobs.has(String(source.jobId)));
  if (billedJobs.length > 0) blockers.push(`${billedJobs.length} importierte Termine wurden inzwischen abgerechnet`);
  const quotes = created('quotes');
  const convertedQuotes = state.quotes.filter(quote => quotes.has(quote.id) && quote.convertedToInvoiceId);
  if (convertedQuotes.length > 0) blockers.push(`${convertedQuotes.length} importierte Angebote wurden inzwischen in Rechnungen umgewandelt`);
  if (blockers.length > 0) throw new Error(`Der Import kann nicht mehr rückgängig gemacht werden: ${blockers.join('. ')}. Machen Sie gegebenenfalls zuerst spätere Importe rückgängig.`);

  const touchedInvoices = new Set<string>();
  const remove = (collection: DemoRecord[], id: string) => {
    const index = collection.findIndex(item => item.id === id);
    if (index >= 0) collection.splice(index, 1);
  };
  [...items].reverse().forEach(item => {
    if (item.action === 'created') {
      if (item.tableName === 'euer_entries') {
        const entry = state.euerEntries.find(candidate => candidate.id === item.recordId);
        if (entry && entry.status !== 'voided') {
          const oldData = { ...entry };
          entry.status = 'voided';
          entry.correctionReason = 'Import rückgängig gemacht';
          entry.updatedAt = isoDate();
          state.euerEntryHistory.push({ id: generateUUID(), euerEntryId: entry.id, action: 'voided', reason: 'Import rückgängig gemacht', oldData, newData: null, changedAt: isoDate() });
          if (entry.sourceType === 'invoice_payment') touchedInvoices.add(String(entry.sourceId));
        }
      } else if (item.tableName === 'invoices') {
        const invoice = state.invoices.find(candidate => candidate.id === item.recordId);
        if (invoice) recordInvoiceHistory(state, invoice, 'deleted', invoice, null);
        remove(state.invoices, item.recordId);
        delete demoInvoiceOriginals(state)[item.recordId];
        touchedInvoices.delete(item.recordId);
      } else if (item.tableName === 'job_entries') remove(state.jobs, item.recordId);
      else if (item.tableName === 'quotes') remove(state.quotes, item.recordId);
      else if (item.tableName === 'customers') remove(state.customers, item.recordId);
      else if (item.tableName === 'hourly_rates') remove(state.hourlyRates, item.recordId);
      else if (item.tableName === 'material_templates') remove(state.materialTemplates, item.recordId);
      else if (item.tableName === 'invoice_templates') {
        state.company.invoiceTemplates = ((state.company.invoiceTemplates || []) as DemoRecord[]).filter(template => template.id !== item.recordId);
      }
      return;
    }
    if (!item.oldData) return;
    const collection = item.tableName === 'customers'
      ? state.customers
      : item.tableName === 'hourly_rates'
        ? state.hourlyRates
        : item.tableName === 'material_templates'
          ? state.materialTemplates
          : item.tableName === 'invoice_templates'
            ? (state.company.invoiceTemplates || []) as DemoRecord[]
            : [];
    const target = collection.find(candidate => candidate.id === item.recordId);
    if (target) Object.assign(target, item.oldData);
  });
  touchedInvoices.forEach(invoiceId => syncDemoInvoicePaymentStatus(state, invoiceId));
  run.status = 'reverted';
  run.revertedAt = new Date().toISOString();
  if (run.migrationCategoryId) {
    const categories = readDemoTakeoverCategories();
    const category = Object.values(categories).find(item => item.id === run.migrationCategoryId);
    if (category) {
      categories[String(category.resource)] = { ...category, status: 'open', digest: null, idempotencyKey: null, runId: null, completedAt: null };
      writeDemoTakeoverCategories(categories);
      const session = readDemoTakeover(state);
      if (session?.status === 'open') sessionStorage.setItem(demoTakeoverStorageKey(), JSON.stringify({ ...session, progressRevision: Number(session.progressRevision || 1) + 1 }));
    }
  }
}

function demoImportRequest<T>(state: DemoState, parts: string[], method: string, data: DemoRecord): T {
  const runs = demoImportRuns(state);
  const publicRun = (run: DemoRecord, includeReport = false) => {
    const result: Record<string, unknown> = { ...run };
    delete result.items;
    if (!includeReport) delete result.report;
    return result as unknown as T;
  };

  if (parts[1] === 'runs') {
    if (method === 'GET' && !parts[2]) return runs.map(run => publicRun(run)) as unknown as T;
    if (method === 'POST' && parts[2] === 'confirm-all') {
      const pending = runs.filter(run => run.status === 'pending');
      pending.forEach(run => { run.status = 'confirmed'; run.confirmedAt = new Date().toISOString(); });
      saveState(state);
      return { confirmed: pending.length } as unknown as T;
    }
    const run = runs.find(item => item.id === parts[2]);
    if (!run) throw new Error('Import nicht gefunden.');
    if (method === 'GET') return publicRun(run, true);
    if (run.status !== 'pending') {
      throw new Error(run.status === 'reverted' ? 'Dieser Import wurde bereits rückgängig gemacht.' : 'Dieser Import ist abgeschlossen und kann nicht mehr rückgängig gemacht werden.');
    }
    if (method === 'POST' && parts[3] === 'confirm') {
      run.status = 'confirmed';
      run.confirmedAt = new Date().toISOString();
      saveState(state);
      return { success: true } as unknown as T;
    }
    if (method === 'POST' && parts[3] === 'revert') {
      demoRevertImport(state, run);
      saveState(state);
      return { success: true } as unknown as T;
    }
    throw new Error('Unbekannte Importaktion.');
  }

  if (parts[1] === 'settings') {
    if (method === 'PUT') {
      const raw = data.cutoverDate;
      const cutoverDate = raw ? dateOnly(raw) : null;
      state.company.importCutoverDate = cutoverDate;
      saveState(state);
      return { cutoverDate } as unknown as T;
    }
    return {
      cutoverDate: typeof state.company.importCutoverDate === 'string' && state.company.importCutoverDate ? state.company.importCutoverDate : null,
      pendingRuns: runs.filter(run => run.status === 'pending').length,
    } as unknown as T;
  }

  if (parts[1] === 'original-documents' && parts[2]) {
    const invoice = state.invoices.find(item => item.id === parts[2]);
    if (!invoice) throw new Error('Rechnung nicht gefunden.');
    const originals = demoInvoiceOriginals(state);
    const pending = runs.some(run => run.status === 'pending' && Array.isArray(run.items)
      && (run.items as unknown as DemoImportRunItem[]).some(item => item.tableName === 'invoices' && item.recordId === invoice.id));
    if (method === 'GET') {
      const original = originals[invoice.id];
      if (!original) throw new Error('Für diese Rechnung ist kein Original hinterlegt.');
      return original as unknown as T;
    }
    if (invoice.origin !== 'imported') throw new Error('Originaldokumente können nur für übernommene Rechnungen hinterlegt werden.');
    if (method === 'DELETE') {
      if (!pending) throw new Error('Nach Abschluss des Umzugs kann das Original nicht mehr entfernt werden.');
      delete originals[invoice.id];
      invoice.hasOriginalDocument = false;
      saveState(state);
      return { success: true } as unknown as T;
    }
    if (originals[invoice.id] && !pending) throw new Error('Für diese Rechnung ist bereits ein Original hinterlegt. Es kann nach Abschluss des Umzugs nicht mehr ersetzt werden.');
    const content = String(data.content || '');
    const size = Math.floor(content.length * 3 / 4);
    if (!content || size > DEMO_MAX_ORIGINAL_BYTES) throw new Error('Im Demo-Modus sind Originale bis 1 MB möglich.');
    originals[invoice.id] = { id: invoice.id, name: String(data.name || 'Original'), content, contentType: String(data.contentType || 'application/pdf'), size, uploadedAt: new Date().toISOString() };
    invoice.hasOriginalDocument = true;
    saveState(state);
    return { name: originals[invoice.id].name, contentType: originals[invoice.id].contentType, size } as unknown as T;
  }

  const rows = Array.isArray(data.rows) ? data.rows as DemoRecord[] : [];
  return demoImport(parts[1], rows, data, state) as unknown as T;
}

/**
 * Bildet im Demo-Modus nach, was im produktiven Betrieb der Datenbank-Trigger
 * aus `029_invoice_audit` erledigt.
 */
function recordInvoiceHistory(
  state: DemoState,
  invoice: DemoRecord | undefined,
  action: 'created' | 'updated' | 'deleted',
  oldData: DemoRecord | null,
  newData: DemoRecord | null,
) {
  if (!invoice) return;
  state.invoiceHistory.push({
    id: generateUUID(),
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    recordType: 'invoice',
    action,
    oldData: oldData ? { ...oldData } : null,
    newData: newData ? { ...newData } : null,
    changedAt: isoDate(),
    changedBy: null,
  });
}

function demoPaidAmount(state: DemoState, invoice: DemoRecord): number {
  const total = Number(invoice.total || 0);
  const booked = state.euerEntries
    .filter(entry => entry.sourceType === 'invoice_payment'
      && entry.sourceId === invoice.id
      && entry.status !== 'voided')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  return Math.min(total, Math.max(booked, invoice.status === 'paid' ? total : 0));
}

function withDemoPaymentState(state: DemoState, invoice: DemoRecord): DemoRecord {
  const paidAmount = demoPaidAmount(state, invoice);
  const paymentDates = state.euerEntries
    .filter(entry => entry.sourceType === 'invoice_payment'
      && entry.sourceId === invoice.id
      && entry.status !== 'voided'
      && entry.entryDate)
    .map(entry => String(entry.entryDate))
    .sort();
  return {
    ...invoice,
    paidAmount,
    paymentReceivedAt: paymentDates[paymentDates.length - 1] || null,
    outstandingAmount: invoice.status === 'paid'
      ? 0
      : Math.max(Number(invoice.total || 0) - paidAmount, 0),
  };
}

function syncDemoInvoicePaymentStatus(state: DemoState, invoiceId: unknown): void {
  if (!invoiceId) return;
  const invoice = state.invoices.find(item => item.id === String(invoiceId) && item.documentType !== 'credit_note');
  if (!invoice) return;
  const booked = state.euerEntries
    .filter(entry => entry.sourceType === 'invoice_payment' && entry.sourceId === invoice.id && entry.status !== 'voided')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  if (booked >= Number(invoice.total || 0) - 0.005) invoice.status = 'paid';
  else if (invoice.status === 'paid') invoice.status = dateOnly(invoice.dueDate) < dateOnly(isoDate()) ? 'overdue' : 'sent';
  invoice.updatedAt = isoDate();
}

function nextDemoInvoiceNumber(state: DemoState, issueDate: unknown, documentType: 'invoice' | 'credit_note' = 'invoice'): string {
  const canonicalDate = dateOnly(issueDate || isoDate());
  const [year, month, day] = canonicalDate.split('-').map(Number);
  const patternValue = String(documentType === 'credit_note' ? state.company.creditNoteNumberPattern || 'GS-{YYYY}-{NNN}' : state.company.invoiceNumberPattern || 'RE-{YYYY}-{NNN}');
  const pattern = validateInvoiceNumberPattern(patternValue) ? (documentType === 'credit_note' ? 'GS-{YYYY}-{NNN}' : 'RE-{YYYY}-{NNN}') : patternValue;
  const startNumber = Number(state.yearlyInvoiceStartNumbers.find(item => Number(item.year) === year)?.start_number || state.company.invoiceStartNumber || 1);
  const reserved = new Set([
    ...state.invoices.map(invoice => String(invoice.invoiceNumber || '')),
    ...state.invoiceHistory.map(entry => String(entry.invoiceNumber || '')),
  ].filter(Boolean));
  let counter = Math.max(1, startNumber);
  let candidate = formatInvoiceNumberPattern(pattern, new Date(year, month - 1, day), counter);
  while (reserved.has(candidate)) {
    counter += 1;
    candidate = formatInvoiceNumberPattern(pattern, new Date(year, month - 1, day), counter);
  }
  return candidate;
}

function resolveDemoInvoiceNumber(
  state: DemoState,
  requestedValue: unknown,
  issueDate: unknown,
  documentType: 'invoice' | 'credit_note' = 'invoice',
): string {
  const requested = requestedValue === undefined || requestedValue === null ? '' : String(requestedValue).trim();
  if (requested.length > 50) throw new Error('Die Rechnungsnummer darf höchstens 50 Zeichen enthalten.');
  if (/[\r\n]/.test(requested)) throw new Error('Die Rechnungsnummer darf keine Zeilenumbrüche enthalten.');
  if (!requested) return nextDemoInvoiceNumber(state, issueDate, documentType);

  const reserved = new Set([
    ...state.invoices.map(invoice => String(invoice.invoiceNumber || '')),
    ...state.invoiceHistory.map(entry => String(entry.invoiceNumber || '')),
  ].filter(Boolean));
  if (reserved.has(requested)) throw new Error(`Die Rechnungsnummer „${requested}“ ist in diesem Workspace bereits vergeben.`);
  return requested;
}


// ---------------------------------------------------------------------------
// Demo: Support-Tickets und E-Mail-Benachrichtigungen
//
// Im produktiven Betrieb liegen Tickets im Control Plane und die Einstellungen
// je Benutzer in der Datenbank. Die Demo hält beides im Browser, damit sich
// die Oberfläche vollständig ausprobieren lässt; E-Mails gehen keine raus.
// ---------------------------------------------------------------------------

const DEMO_SUPPORT_STORAGE_KEY = 'solooffice-demo-support-v1';
const DEMO_NOTIFICATIONS_STORAGE_KEY = 'solooffice-demo-notifications-v1';

interface DemoSupportState {
  nextNumber: number;
  tickets: DemoRecord[];
  messages: DemoRecord[];
}

function readDemoSupport(): DemoSupportState {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(DEMO_SUPPORT_STORAGE_KEY) : null;
    if (stored) {
      const parsed = JSON.parse(stored) as DemoSupportState;
      if (Array.isArray(parsed.tickets) && Array.isArray(parsed.messages)) return parsed;
    }
  } catch {
    // Beschädigte Ablage: mit leerem Zustand weiterarbeiten.
  }
  return { nextNumber: 1001, tickets: [], messages: [] };
}

function saveDemoSupport(state: DemoSupportState): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(DEMO_SUPPORT_STORAGE_KEY, JSON.stringify(state));
}

function demoTicketDetail(state: DemoSupportState, ticketId: string): DemoRecord {
  const ticket = state.tickets.find(item => item.id === ticketId);
  if (!ticket) throw new Error('Ticket nicht gefunden.');
  const messages = state.messages
    .filter(message => message.ticketId === ticketId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return { ...ticket, messages, ticket, mail: { sent: false, skipped: true } } as DemoRecord;
}

function demoSupportRequest<T>(parts: string[], method: string, data: DemoRecord): T {
  const state = readDemoSupport();
  if (parts[1] === 'status') return { available: true } as unknown as T;
  if (parts[1] === 'tickets' && !parts[2]) {
    if (method === 'POST') {
      const subject = String(data.subject || '').trim();
      const body = String(data.body || '').trim();
      if (!subject) throw new Error('Bitte einen Betreff angeben.');
      if (!body) throw new Error('Bitte eine Nachricht eingeben.');
      const now = isoDate();
      const ticket: DemoRecord = {
        id: generateUUID(),
        ticketNumber: state.nextNumber,
        reference: `T-${state.nextNumber}`,
        subject,
        status: 'open',
        priority: 'normal',
        category: ['question', 'bug', 'billing', 'feature', 'other'].includes(String(data.category)) ? data.category : 'question',
        source: 'fachapp',
        workspaceId: getDemoActiveWorkspaceId(),
        workspaceName: 'Demo Workspace',
        requesterEmail: 'demo@solooffice.local',
        requesterName: 'Demo Benutzer',
        messageCount: 1,
        lastMessagePreview: body.slice(0, 160),
        lastCustomerMessageAt: now,
        lastAdminMessageAt: null,
        resolvedAt: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      state.nextNumber += 1;
      state.tickets.unshift(ticket);
      state.messages.push({ id: generateUUID(), ticketId: ticket.id, authorType: 'customer', authorName: 'Demo Benutzer', authorEmail: 'demo@solooffice.local', body, createdAt: now });
      // Die Demo antwortet sofort, damit der Verlauf nicht leer wirkt.
      const replyAt = new Date(Date.now() + 1000).toISOString();
      state.messages.push({ id: generateUUID(), ticketId: ticket.id, authorType: 'admin', authorName: 'Demo-Support', authorEmail: null, body: `Vielen Dank für Ihre Anfrage „${subject}“. Im Demo-Modus wird kein Ticket an den Betreiber übermittelt – in der gehosteten Version erscheint es sofort in der Adminkonsole und Sie erhalten eine Bestätigung per E-Mail.`, createdAt: replyAt });
      ticket.status = 'pending';
      ticket.messageCount = 2;
      ticket.lastAdminMessageAt = replyAt;
      ticket.updatedAt = replyAt;
      saveDemoSupport(state);
      const detail = demoTicketDetail(state, ticket.id);
      return { ticket: detail.ticket, messages: detail.messages, mail: { sent: false, skipped: true } } as unknown as T;
    }
    return { tickets: state.tickets.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) } as unknown as T;
  }
  if (parts[1] === 'tickets' && parts[2]) {
    const ticketId = parts[2];
    if (parts[3] === 'messages' && method === 'POST') {
      const body = String(data.body || '').trim();
      if (!body) throw new Error('Bitte eine Nachricht eingeben.');
      const ticket = state.tickets.find(item => item.id === ticketId);
      if (!ticket) throw new Error('Ticket nicht gefunden.');
      if (ticket.status === 'closed') throw new Error('Dieses Ticket ist geschlossen. Bitte eine neue Anfrage stellen.');
      const now = isoDate();
      state.messages.push({ id: generateUUID(), ticketId, authorType: 'customer', authorName: 'Demo Benutzer', authorEmail: 'demo@solooffice.local', body, createdAt: now });
      ticket.status = 'open';
      ticket.resolvedAt = null;
      ticket.lastCustomerMessageAt = now;
      ticket.lastMessagePreview = body.slice(0, 160);
      ticket.messageCount = Number(ticket.messageCount || 0) + 1;
      ticket.updatedAt = now;
      saveDemoSupport(state);
    }
    const detail = demoTicketDetail(state, ticketId);
    return { ticket: detail.ticket, messages: detail.messages } as unknown as T;
  }
  throw new Error('Unbekannter Support-Endpunkt.');
}

function readDemoNotificationSettings(): DemoRecord {
  const defaults: DemoRecord = { id: 'demo', jobsCompleted: false, invoiceDrafts: false, invoiceDraftDays: 3, invoicesOverdue: false, digestHour: 8, lastDigestAt: null, lastDigestError: null };
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(DEMO_NOTIFICATIONS_STORAGE_KEY) : null;
    return stored ? { ...defaults, ...(JSON.parse(stored) as DemoRecord) } : defaults;
  } catch {
    return defaults;
  }
}

function demoNotificationPreview(state: DemoState): DemoRecord {
  const settings = readDemoNotificationSettings();
  const sections: DemoRecord[] = [];
  const draftDays = Number(settings.invoiceDraftDays || 3);
  const cutoff = Date.now() - draftDays * 86400000;
  const completedJobs = state.jobs.filter(job => job.status === 'completed');
  if (completedJobs.length) {
    sections.push({ id: 'jobs_completed', key: 'jobs_completed', title: 'Abgeschlossene Aufträge ohne Rechnung', count: completedJobs.length, items: completedJobs.slice(0, 15).map(job => ({ title: [job.jobNumber, job.title].filter(Boolean).join(' · '), subtitle: String(job.customerName || ''), meta: Number(job.hoursWorked) > 0 ? `${Number(job.hoursWorked)} Std.` : undefined })) });
  }
  const drafts = state.invoices.filter(invoice => invoice.documentType !== 'credit_note' && invoice.status === 'draft' && new Date(String(invoice.createdAt)).getTime() <= cutoff);
  if (drafts.length) {
    sections.push({ id: 'invoice_drafts', key: 'invoice_drafts', title: 'Rechnungsentwürfe, die noch nicht versendet wurden', count: drafts.length, items: drafts.slice(0, 15).map(invoice => ({ title: String(invoice.invoiceNumber || 'Entwurf'), subtitle: String(invoice.customerName || ''), meta: `${Number(invoice.total || 0).toFixed(2)} €` })) });
  }
  const today = dateOnly(isoDate());
  const overdue = state.invoices.filter(invoice => invoice.documentType !== 'credit_note' && ['sent', 'overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x'].includes(String(invoice.status)) && dateOnly(invoice.dueDate) < today);
  if (overdue.length) {
    sections.push({ id: 'invoices_overdue', key: 'invoices_overdue', title: 'Überfällige Rechnungen', count: overdue.length, items: overdue.slice(0, 15).map(invoice => ({ title: String(invoice.invoiceNumber || 'Rechnung'), subtitle: `${invoice.customerName || ''} · fällig seit ${dateOnly(invoice.dueDate)}`, meta: `${Number(invoice.total || 0).toFixed(2)} €` })) });
  }
  const filtered = sections.filter(section => (section.key === 'jobs_completed' && settings.jobsCompleted) || (section.key === 'invoice_drafts' && settings.invoiceDrafts) || (section.key === 'invoices_overdue' && settings.invoicesOverdue));
  const active = settings.jobsCompleted || settings.invoiceDrafts || settings.invoicesOverdue;
  const shown = active ? filtered : sections;
  return { id: 'preview', total: shown.reduce((sum, section) => sum + Number(section.count), 0), sections: shown };
}

function demoNotificationRequest<T>(state: DemoState, parts: string[], method: string, data: DemoRecord): T {
  if (parts[1] === 'preview') return demoNotificationPreview(state) as unknown as T;
  if (parts[1] === 'send-now') {
    const settings = readDemoNotificationSettings();
    if (!(settings.jobsCompleted || settings.invoiceDrafts || settings.invoicesOverdue)) throw new Error('Bitte zuerst mindestens einen Hinweis aktivieren und speichern.');
    const preview = demoNotificationPreview(state);
    if (!Number(preview.total)) return { sent: false, message: 'Aktuell gibt es keine offenen Punkte – es wurde keine E-Mail gesendet.' } as unknown as T;
    return { sent: false, message: `Im Demo-Modus werden keine E-Mails versendet. Die Zusammenfassung hätte ${preview.total} ${Number(preview.total) === 1 ? 'Punkt' : 'Punkte'} enthalten.` } as unknown as T;
  }
  if (method === 'PUT') {
    const draftDays = Number(data.invoiceDraftDays);
    const digestHour = Number(data.digestHour);
    if (!Number.isInteger(draftDays) || draftDays < 1 || draftDays > 60) throw new Error('Die Wartezeit für Entwürfe muss zwischen 1 und 60 Tagen liegen.');
    if (!Number.isInteger(digestHour) || digestHour < 0 || digestHour > 23) throw new Error('Die Uhrzeit muss zwischen 0 und 23 Uhr liegen.');
    const next: DemoRecord = { id: 'demo', jobsCompleted: data.jobsCompleted === true, invoiceDrafts: data.invoiceDrafts === true, invoiceDraftDays: draftDays, invoicesOverdue: data.invoicesOverdue === true, digestHour, lastDigestAt: null, lastDigestError: null };
    if (typeof localStorage !== 'undefined') localStorage.setItem(DEMO_NOTIFICATIONS_STORAGE_KEY, JSON.stringify(next));
    return { settings: next, email: 'demo@solooffice.local' } as unknown as T;
  }
  return { settings: readDemoNotificationSettings(), email: 'demo@solooffice.local' } as unknown as T;
}

export async function demoRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const state = readState();
  const method = options.method || 'GET';
  const path = endpoint.split('?')[0];
  const queryParams = new URLSearchParams(endpoint.split('?')[1] || '');
  const parts = path.split('/').filter(Boolean);
  const resource = parts[0];
  currentRequestMutates = isUserEdit(method, payload(options));
  const id = parts[1];
  const data = payload(options);

  if (resource === 'takeover') {
    let session = readDemoTakeover(state);
    if (parts[1] === 'scan' && method === 'POST') {
      const headers = data.headers;
      const rows = data.rows;
      const sheets = data.sheets;
      if (!['csv', 'tsv', 'json', 'xlsx'].includes(String(data.format))) throw new Error('Dateiname oder Dateiformat ist ungültig.');
      if (!Number.isInteger(data.fileSize) || Number(data.fileSize) < 1 || Number(data.fileSize) > 10 * 1024 * 1024) throw new Error('Die Importdatei darf höchstens 10 MB groß sein.');
      if (!Array.isArray(headers) || headers.length < 1 || headers.length > 100 || new Set(headers).size !== headers.length || headers.some(header => typeof header !== 'string' || !header.trim() || header.length > 500)
        || !Array.isArray(rows) || rows.length < 1 || rows.length > 5000
        || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== headers.length || headers.some(header => !Object.hasOwn(row, header) || (typeof row[header] !== 'string' && typeof row[header] !== 'number') || String(row[header]).length > 100000))) {
        throw new Error('Die normalisierte Datei hat eine ungültige Tabellenstruktur.');
      }
      if (data.format === 'xlsx' && (!Array.isArray(sheets) || !sheets.includes(data.sheet))) throw new Error('Das ausgewählte Tabellenblatt ist unbekannt oder ungültig.');
      if (data.format !== 'xlsx' && (data.sheet != null || (sheets != null && (!Array.isArray(sheets) || sheets.length)))) throw new Error('Für dieses Dateiformat ist keine Tabellenblattauswahl zulässig.');
      if (!/^[a-f0-9]{64}$/i.test(String(data.hash || ''))) throw new Error('Der Datei-Hash ist ungültig.');
      // Nur eine flüchtige Bestätigung zurückgeben: weder Inhalt noch Hash/Dateiname werden gespeichert.
      return { accepted: true, fileName: String(data.fileName || ''), format: data.format, fileSize: data.fileSize, hash: String(data.hash).toLowerCase(), sheet: data.sheet || null, headerCount: headers.length, rowCount: rows.length, warnings: Array.isArray(data.warnings) ? data.warnings : [], demoMode: true } as unknown as T;
    }
    if (parts[1] === 'status' && method === 'GET') {
      return { takeoverUsed: Boolean(session), session, demoMode: true } as unknown as T;
    }
    if (parts[1] === 'start' && method === 'POST') {
      if (session) throw new Error('Der einmalige Umzug-Start wurde in dieser Demo-Sitzung bereits verwendet.');
      session = {
        id: `demo-migration-${generateUUID()}`, status: 'open', startedBy: 'demo-user', startedAt: new Date().toISOString(),
        completedBy: null, completedAt: null, progressRevision: 1, legacyBackfill: false,
      };
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(demoTakeoverStorageKey(), JSON.stringify(session));
      return { takeoverUsed: true, session, demoMode: true } as unknown as T;
    }
    if (parts.length === 3 && parts[2] === 'complete' && method === 'POST') {
      if (!session || session.id !== parts[1] || session.status !== 'open') throw new Error('Die Demo-Sitzung ist nicht offen oder wurde bereits abgeschlossen.');
      if (session.legacyBackfill) throw new Error('Der Altbestand belegt den einmaligen Start; ein neuer Sitzungsabschluss ist hier nicht verfügbar.');
      session = { ...session, status: 'completed', completedBy: 'demo-user', completedAt: new Date().toISOString(), progressRevision: Number(session.progressRevision) + 1 };
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(demoTakeoverStorageKey(), JSON.stringify(session));
      return { takeoverUsed: true, session, demoMode: true } as unknown as T;
    }
  }

  if (resource === 'workspace-setup') {
    state.workspaceSetup ||= {
      currentStep: 1, completedAt: null, migrationChoice: 'undecided', setupRequired: true,
      createdAt: isoDate(), updatedAt: isoDate(),
    };
    if (method === 'PATCH') {
      if (data.currentStep !== undefined && (!Number.isInteger(data.currentStep) || data.currentStep < 1 || data.currentStep > 5)) {
        throw new Error('Der Einrichtungsschritt muss zwischen 1 und 5 liegen.');
      }
      if (data.migrationChoice !== undefined && !['undecided', 'takeover', 'no_legacy_data'].includes(String(data.migrationChoice))) {
        throw new Error('Die Auswahl zur Datenübernahme ist ungültig.');
      }
      if (data.complete === true && !['takeover', 'no_legacy_data'].includes(String(data.migrationChoice))) {
        throw new Error('Bitte Datenübernahme starten oder „Keine Altdaten“ auswählen.');
      }
      state.workspaceSetup = {
        ...state.workspaceSetup,
        ...(data.currentStep !== undefined ? { currentStep: data.currentStep } : {}),
        ...(data.migrationChoice !== undefined ? { migrationChoice: data.migrationChoice } : {}),
        ...(data.complete === true ? { currentStep: 5, completedAt: state.workspaceSetup.completedAt || isoDate(), setupRequired: false } : {}),
        updatedAt: isoDate(),
      };
    }
    saveState(state);
    return state.workspaceSetup as unknown as T;
  }

  if (resource === 'invoices' && parts[2] === 'payments' && id && method === 'POST') {
    const invoice = state.invoices.find(item => item.id === id && item.documentType !== 'credit_note');
    if (!invoice) throw new Error('Rechnung nicht gefunden.');
    if (invoice.status === 'draft') throw new Error('Für einen Entwurf kann noch kein Zahlungseingang erfasst werden.');

    const amount = Number(data.amount);
    const amountCents = Math.round(amount * 100);
    const entryDate = assertDemoDate(data.entryDate, 'Das Zahlungsdatum');
    const notes = String(data.notes || '').trim();
    const paidAmount = demoPaidAmount(state, { ...invoice, status: invoice.status === 'paid' ? 'sent' : invoice.status });
    const remainingCents = Math.max(Math.round(Number(invoice.total || 0) * 100) - Math.round(paidAmount * 100), 0);
    const remaining = remainingCents / 100;
    if (invoice.status === 'paid' || remainingCents === 0) throw new Error('Die Rechnung ist bereits vollständig bezahlt.');
    if (!['number', 'string'].includes(typeof data.amount) || !Number.isFinite(amount) || amount <= 0
        || !Number.isSafeInteger(amountCents) || Math.abs(amount * 100 - amountCents) > 0.00001) {
      throw new Error('Der Zahlungsbetrag muss größer als 0 sein und darf höchstens zwei Nachkommastellen haben.');
    }
    if (amountCents > remainingCents) throw new Error(`Der Zahlungsbetrag überschreitet den offenen Betrag von ${remaining.toFixed(2)} €.`);
    if (notes.length > 500) throw new Error('Die Notiz darf höchstens 500 Zeichen enthalten.');

    const taxableNet = Number(invoice.total) - Number(invoice.taxAmount || 0);
    const payment: DemoRecord = {
      id: generateUUID(),
      entryType: 'income',
      entryDate,
      description: `Zahlung Rechnung ${invoice.invoiceNumber}`,
      category: 'other_income',
      amount: amountCents / 100,
      taxRate: taxableNet > 0 ? Number(invoice.taxAmount || 0) / taxableNet * 100 : 0,
      notes: notes || undefined,
      sourceType: 'invoice_payment',
      sourceId: invoice.id,
      status: 'active',
      createdAt: isoDate(),
      updatedAt: isoDate(),
    };
    state.euerEntries.push(payment);
    state.euerEntryHistory.push({
      id: generateUUID(), euerEntryId: payment.id, action: 'created', reason: '',
      oldData: null, newData: { ...payment }, changedAt: isoDate(),
    });

    if (remainingCents === amountCents) {
      const previous = { ...invoice };
      invoice.status = 'paid';
      invoice.updatedAt = isoDate();
      recordInvoiceHistory(state, invoice, 'updated', previous, invoice);
    }
    saveState(state);
    return { payment, invoice: withDemoPaymentState(state, invoice) } as unknown as T;
  }

  // Änderungsverlauf einer Rechnung. Im Demo-Modus übernimmt diese Funktion,
  // was im produktiven Betrieb ein Datenbank-Trigger erledigt.
  if (resource === 'invoices' && parts[2] === 'history') {
    return state.invoiceHistory
      .filter(entry => entry.invoiceId === parts[1])
      .sort((a, b) => String(b.changedAt).localeCompare(String(a.changedAt))) as unknown as T;
  }

  if (resource === 'reminders' && parts[1] === 'eligible' && method === 'GET') {
    if (state.company.remindersEnabled === false) return [] as unknown as T;
    const daysAfterDue = Number(state.company.reminderDaysAfterDue ?? 7);
    const daysBetween = Number(state.company.reminderDaysBetween ?? 7);
    const todayDate = new Date(`${dateOnly(isoDate())}T00:00:00Z`);
    return state.invoices
      .filter(invoice => invoice.documentType !== 'credit_note' && ['sent', 'overdue', 'reminded_1x', 'reminded_2x'].includes(String(invoice.status)))
      .map(invoice => withDemoPaymentState(state, invoice))
      .filter(invoice => Number(invoice.outstandingAmount || 0) >= 0.005)
      .map(invoice => {
        const dueDate = new Date(`${dateOnly(invoice.dueDate)}T00:00:00Z`);
        const daysSinceDue = Math.floor((todayDate.getTime() - dueDate.getTime()) / 86400000);
        const lastDate = invoice.lastReminderDate ? new Date(`${dateOnly(invoice.lastReminderDate)}T00:00:00Z`) : null;
        const daysSinceLastReminder = lastDate ? Math.floor((todayDate.getTime() - lastDate.getTime()) / 86400000) : undefined;
        const nextStage = invoice.status === 'reminded_1x' ? 2 : invoice.status === 'reminded_2x' ? 3 : 1;
        const waitDays = nextStage === 1 ? daysAfterDue : daysBetween;
        const elapsed = nextStage === 1 ? daysSinceDue : (daysSinceLastReminder ?? -1);
        const isEligible = elapsed >= waitDays;
        const baseDate = nextStage === 1 ? dueDate : lastDate;
        const nextEligibleDate = !isEligible && baseDate
          ? new Date(baseDate.getTime() + waitDays * 86400000).toISOString()
          : undefined;
        return {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerId: invoice.customerId,
          customerName: invoice.customerName,
          dueDate: invoice.dueDate,
          total: Number(invoice.total || 0),
          paidAmount: Number(invoice.paidAmount || 0),
          outstandingAmount: Number(invoice.outstandingAmount || 0),
          currentStatus: invoice.status,
          nextStage,
          daysSinceDue,
          daysSinceLastReminder,
          isEligible,
          nextEligibleDate,
        };
      }) as unknown as T;
  }

  if (resource === 'reminders' && parts[1] === 'history' && method === 'GET') {
    return state.invoices
      .filter(invoice => invoice.documentType !== 'credit_note' && invoice.lastReminderDate)
      .map(invoice => withDemoPaymentState(state, invoice))
      .sort((a, b) => String(b.lastReminderSentAt || '').localeCompare(String(a.lastReminderSentAt || ''))) as unknown as T;
  }

  if (resource === 'reminders' && parts[1] === 'send' && parts[2] && method === 'POST') {
    const invoice = state.invoices.find(item => item.id === parts[2] && item.documentType !== 'credit_note');
    if (!invoice) throw new Error('Rechnung nicht gefunden.');
    if (Number(withDemoPaymentState(state, invoice).outstandingAmount || 0) < 0.005) throw new Error('Die Rechnung ist bereits vollständig bezahlt.');
    const stage = Number(data.stage);
    if (![1, 2, 3].includes(stage)) throw new Error('Ungültige Mahnstufe.');
    const previous = { ...invoice };
    if (data.updateStatus) invoice.status = `reminded_${stage}x`;
    invoice.lastReminderDate = dateOnly(isoDate());
    invoice.lastReminderSentAt = isoDate();
    invoice.maxReminderStage = Math.max(Number(invoice.maxReminderStage || 0), stage);
    invoice.updatedAt = isoDate();
    recordInvoiceHistory(state, invoice, 'updated', previous, invoice);
    saveState(state);
    return { success: true, invoiceId: invoice.id } as unknown as T;
  }

  if (resource === 'receipts' && parts[2] === 'create-invoice' && id && method === 'POST') {
    const receipt = state.receipts.find(item => item.id === id);
    if (!receipt) throw new Error('Beleg nicht gefunden.');
    if (receipt.billedInvoiceId) throw new Error('Der Beleg wurde bereits weiterberechnet.');
    const customer = state.customers.find(item => item.id === String(data.customerId));
    if (!customer) throw new Error('Bitte einen gültigen Kunden auswählen.');
    const description = String(data.description || '').trim();
    const quantity = Number(data.quantity ?? 1);
    const unitPrice = Number(data.unitPrice);
    const taxRate = Number(data.taxRate ?? 0);
    if (!description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      throw new Error('Bitte Beschreibung, Menge, Nettopreis und MwSt.-Satz prüfen.');
    }
    const items = [{ id: generateUUID(), description, quantity, unitPrice, taxRate, total: quantity * unitPrice, order: 1 }];
    const totals = calculateItems(items);
    const invoice: DemoRecord = {
      id: generateUUID(),
      invoiceNumber: nextDemoInvoiceNumber(state, isoDate()),
      customerId: customer.id,
      customerName: customer.name,
      issueDate: dateOnly(isoDate()),
      dueDate: dateOnly(isoDate(Number(state.company.defaultPaymentDays || 30))),
      attachments: receipt.content ? [{ id: generateUUID(), name: receipt.name, content: receipt.content, contentType: receipt.contentType, size: receipt.size, uploadedAt: isoDate() }] : [],
      ...totals,
      status: 'draft',
      notes: String(data.notes || ''),
      documentType: 'invoice',
      createdAt: isoDate(),
      updatedAt: isoDate(),
    };
    captureDemoInvoice(state, invoice);
    state.invoices.push(invoice);
    receipt.billedInvoiceId = invoice.id;
    receipt.updatedAt = isoDate();
    recordInvoiceHistory(state, invoice, 'created', null, invoice);
    saveState(state);
    return { invoice: withDemoPaymentState(state, invoice), receipt } as unknown as T;
  }

  // Unterschrift eines Auftrags: eigener Endpunkt, deshalb vor der generischen
  // Ressourcenbehandlung.
  if (resource === 'jobs' && parts[2] === 'signature') {
    const index = state.jobs.findIndex(item => item.id === parts[1]);
    if (index < 0) throw new Error('Auftrag nicht gefunden');

    if (method === 'DELETE') {
      state.jobs[index] = { ...state.jobs[index], signature: null, updatedAt: isoDate() };
      saveState(state);
      return { message: 'Unterschrift entfernt', job: state.jobs[index] } as unknown as T;
    }

    const signatureData = String(data.signatureData || '');
    const customerName = String(data.customerName || '').trim();
    if (!signatureData) throw new Error('Unterschrift fehlt');
    if (!customerName) throw new Error('Name fehlt');
    if (customerName.length > 200) throw new Error('Der Name ist zu lang');
    if (!signatureData.startsWith('data:image/png;base64,')) throw new Error('Ungültiges Unterschriftsformat');
    if (signatureData.length > 1_800_022) throw new Error('Die Unterschrift ist zu groß');
    if (state.jobs[index].status === 'invoiced') throw new Error('Abgerechnete Einheiten können nicht mehr unterschrieben werden');

    state.jobs[index] = {
      ...state.jobs[index],
      status: 'completed',
      signature: {
        id: generateUUID(),
        customerName,
        signatureData,
        signedAt: isoDate(),
      },
      updatedAt: isoDate(),
    };
    saveState(state);
    return { message: 'Unterschrift gespeichert', job: state.jobs[index] } as unknown as T;
  }

  if (resource === 'imports') {
    return demoImportRequest<T>(state, parts, method, data);
  }

  if (resource === 'reporting') {
    const inDateRange = (invoice: DemoRecord, start?: string, end?: string) => {
      const date = dateOnly(invoice.issueDate);
      return (!start || date >= start) && (!end || date <= end);
    };
    const reportableInvoices = state.invoices.filter(invoice => invoice.documentType !== 'credit_note');
    /**
     * Teilzahlungen liegen als EÜR-Buchung mit sourceType 'invoice_payment'.
     * Ohne sie gilt eine Rechnung mit Anzahlung als vollständig offen.
     * Der Status 'paid' bleibt die Obergrenze, damit ältere Rechnungen ohne
     * erfasste Zahlung weiterhin als bezahlt zählen.
     */
    const paidAmountOf = (invoice: DemoRecord) => demoPaidAmount(state, invoice);
    const outstandingAmountOf = (invoice: DemoRecord) =>
      invoice.status === 'paid' ? 0 : Math.max(Number(invoice.total || 0) - paidAmountOf(invoice), 0);
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
        paidAmount: paidAmountOf(invoice),
        overdueAmount: invoice.status === 'overdue' ? outstandingAmountOf(invoice) : 0,
        outstandingAmount: outstandingAmountOf(invoice),
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
        paidSum: monthInvoices.reduce((sum, invoice) => sum + paidAmountOf(invoice), 0),
        overdueSum: monthInvoices.filter(invoice => invoice.status === 'overdue').reduce((sum, invoice) => sum + outstandingAmountOf(invoice), 0),
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
    // Einnahmen ohne Rechnung zählen wie auf dem Server mit ihrem Buchungsdatum.
    const otherIncome = state.euerEntries.filter(entry => entry.entryType === 'income'
      && (entry.sourceType || 'manual') === 'manual'
      && entry.status !== 'voided'
      && String(entry.entryDate).startsWith(`${selectedYear}-`));
    monthlyRevenue.forEach(month => {
      const monthEntries = otherIncome.filter(entry => Number(String(entry.entryDate).slice(5, 7)) === month.month);
      Object.assign(month, { otherIncomeSum: monthEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0), otherIncomeCount: monthEntries.length });
    });
    const otherByCustomer = new Map<string, number>();
    otherIncome.filter(entry => entry.customerId).forEach(entry => {
      otherByCustomer.set(String(entry.customerId), (otherByCustomer.get(String(entry.customerId)) || 0) + Number(entry.amount || 0));
    });
    otherByCustomer.forEach((amount, customerId) => {
      const existing = topCustomers.find(customer => customer.customerId === customerId);
      if (existing) {
        existing.totalRevenue += amount;
        Object.assign(existing, { otherIncome: amount });
      } else {
        topCustomers.push({
          customerId,
          customerName: String(state.customers.find(customer => customer.id === customerId)?.name || ''),
          invoiceCount: 0,
          totalRevenue: amount,
          avgInvoiceAmount: 0,
          otherIncome: amount,
        } as (typeof topCustomers)[number]);
      }
    });
    topCustomers.sort((a, b) => b.totalRevenue - a.totalRevenue);
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
        paidAmount: yearInvoices.reduce((sum, invoice) => sum + paidAmountOf(invoice), 0),
        overdueAmount: yearInvoices.filter(invoice => invoice.status === 'overdue').reduce((sum, invoice) => sum + outstandingAmountOf(invoice), 0),
        avgInvoiceAmount: yearInvoices.length ? totalAmount / yearInvoices.length : 0,
        otherIncome: otherIncome.reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
        otherIncomeCount: otherIncome.length,
      },
    } as T;
  }

  if (resource === 'support') return demoSupportRequest<T>(parts, method, data);
  if (resource === 'notification-settings') return demoNotificationRequest<T>(state, parts, method, data);

  if (resource === 'company') {
    if (method === 'PUT') {
      const invoicePatternError = data.invoiceNumberPattern === undefined ? null : validateInvoiceNumberPattern(String(data.invoiceNumberPattern));
      const creditNotePatternError = data.creditNoteNumberPattern === undefined ? null : validateInvoiceNumberPattern(String(data.creditNoteNumberPattern));
      if (invoicePatternError || creditNotePatternError) throw new Error(invoicePatternError || creditNotePatternError || 'Ungültiges Nummernmuster.');
      if (data.receiptLabel !== undefined) {
        if (typeof data.receiptLabel !== 'string' || !data.receiptLabel.trim() || data.receiptLabel.trim().length > 40) {
          throw new Error('Die Bezeichnung für Belege muss zwischen 1 und 40 Zeichen enthalten.');
        }
        data.receiptLabel = data.receiptLabel.trim();
      }
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
    const totals = calculateItems(items, 'invoice', quote);
    const issueDate = dateOnly(isoDate());
    const invoice: DemoRecord = {
      id: generateUUID(),
      invoiceNumber: nextDemoInvoiceNumber(state, issueDate),
      customerId: quote.customerId,
      customerName: quote.customerName,
      issueDate,
      dueDate: dateOnly(new Date(new Date(`${issueDate}T00:00:00`).getTime() + 30 * 86400000)),
      ...totals,
      status: 'draft',
      notes: quote.notes ? `Erstellt aus Angebot ${quote.quoteNumber}\n\n${quote.notes}` : `Erstellt aus Angebot ${quote.quoteNumber}`,
      sourceQuoteId: quote.id,
      sourceQuoteNumber: quote.quoteNumber,
      documentType: 'invoice',
      createdAt: isoDate(),
    };
    captureDemoInvoice(state, invoice);
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
    const totals = calculateItems(items as DemoRecord[], 'invoice', data);
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
      invoiceNumber: resolveDemoInvoiceNumber(state, data.invoiceNumber, data.issueDate || isoDate()),
      issueDate: dateOnly(data.issueDate || isoDate()),
      dueDate: dateOnly(data.dueDate || isoDate(30)),
      ...totals,
      status: 'draft',
      documentType: 'invoice',
      createdAt: isoDate(),
    };
    captureDemoInvoice(state, invoice);
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
        customerId: demoEuerCustomerId(state, data),
        createdAt: isoDate(),
        updatedAt: isoDate(),
      };
      entries.push(record);
      addHistory(record, 'created', record.correctionReason as string | undefined, undefined);
      if (record.sourceType === 'invoice_payment') syncDemoInvoicePaymentStatus(state, record.sourceId);
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
        updated.customerId = demoEuerCustomerId(state, updated);
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
        if (oldEntry.sourceType === 'invoice_payment') syncDemoInvoicePaymentStatus(state, oldEntry.sourceId);
        if (updated.sourceType === 'invoice_payment' && updated.sourceId !== oldEntry.sourceId) syncDemoInvoicePaymentStatus(state, updated.sourceId);
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
        if (updated.sourceType === 'invoice_payment') syncDemoInvoicePaymentStatus(state, updated.sourceId);
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
      const totals = calculateItems(invoiceItems, 'invoice', recurring);
      const invoice: DemoRecord = {
        id: generateUUID(),
        invoiceNumber: nextDemoInvoiceNumber(state, runDate),
        customerId: recurring.customerId,
        customerName: recurring.customerName,
        issueDate: runDate,
        dueDate: dateOnly(new Date(new Date(`${runDate}T00:00:00`).getTime() + Number(recurring.dueDays || 30) * 86400000)),
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

      captureDemoInvoice(state, invoice);
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
        if (state.invoices.some(invoice => invoice.recurringInvoiceId === id)) throw new Error('Diese Vorlage hat bereits Rechnungen erzeugt. Bitte beenden Sie die Wiederholung.');
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
      const totals = calculateItems(items, 'credit_note', data);
      const record: DemoRecord = {
        ...data,
        id: generateUUID(),
        invoiceNumber: nextDemoInvoiceNumber(state, data.issueDate || isoDate(), 'credit_note'),
        customerId: customer.id,
        customerName: customer.name,
        issueDate: dateOnly(data.issueDate || isoDate()),
        dueDate: dateOnly(data.dueDate || data.issueDate || isoDate()),
        ...totals,
        status: data.status || 'draft',
        documentType: 'credit_note',
        referenceInvoiceNumber: state.invoices.find(item => item.id === data.referenceInvoiceId)?.invoiceNumber,
        createdAt: isoDate(),
      };
      captureDemoInvoice(state, record);
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
        protectDemoInvoice(current, data);
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
        const totals = demoMoneyUpdate(current, data, 'credit_note');
        const updated = {
          ...current,
          ...withoutDerivedMoneyFields(data),
          ...(customer ? { customerId: customer.id, customerName: customer.name } : {}),
          ...(data.referenceInvoiceId === null ? { referenceInvoiceNumber: undefined } : data.referenceInvoiceId ? { referenceInvoiceNumber: state.invoices.find(item => item.id === data.referenceInvoiceId)?.invoiceNumber } : {}),
          items,
          ...totals,
          documentType: 'credit_note',
          updatedAt: isoDate(),
        };
        if (current.status === 'draft' && (invoiceContentFields.some(key => data[key] !== undefined) || !current.documentSnapshot)) captureDemoInvoice(state, updated);
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

  type DemoCollectionKey = Exclude<keyof DemoState, 'company' | 'seedProfile' | 'seedVersion' | 'seededAt' | 'touched' | 'importRuns' | 'invoiceOriginals'>;
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
    return collectionResponse<T>(key === 'invoices'
      ? visibleItems.map(invoice => withDemoPaymentState(state, invoice))
      : visibleItems);
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
    if (key === 'invoices' || key === 'quotes') {
      if (key === 'invoices' && data.status === 'paid') throw new Error('Bitte die Rechnung zunächst anlegen und anschließend den Zahlungseingang erfassen.');
      Object.assign(record, calculateItems(data.items as DemoRecord[], key === 'quotes' ? 'quote' : 'invoice', data));
      record.status = data.status || 'draft';
      if (key === 'invoices') captureDemoInvoice(state, record);
      else record.quoteNumber = data.quoteNumber || `AN-${new Date().getFullYear()}-${String(items.length + 1).padStart(3, '0')}`;
    }
    if (key === 'invoices') {
      record.invoiceNumber = resolveDemoInvoiceNumber(state, data.invoiceNumber, data.issueDate || isoDate());
      record.documentType = 'invoice';
    }
    items.push(record);
    if (key === 'invoices') recordInvoiceHistory(state, record, 'created', null, record);
    saveState(state);
    return (key === 'invoices' ? withDemoPaymentState(state, record) : record) as unknown as T;
  }
  if (id) {
    const index = items.findIndex(itemRecord => itemRecord.id === id);
    if (method === 'GET') {
      if (index < 0) return {} as T;
      const record = items[index];
      return (key === 'invoices' ? withDemoPaymentState(state, record) : record) as unknown as T;
    }
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
      if (key === 'invoices') {
        if (index < 0) throw new Error('Rechnung nicht gefunden.');
        protectDemoInvoice(items[index], data);
      }
      const moneyUpdate = (key === 'invoices' || key === 'quotes') && index >= 0
        ? demoMoneyUpdate(items[index], data, key === 'quotes' ? 'quote' : 'invoice') : {};
      if (key === 'invoices' && index >= 0 && data.status === 'paid' && items[index].status !== 'paid') {
        const booked = state.euerEntries
          .filter(entry => entry.sourceType === 'invoice_payment' && entry.sourceId === id && entry.status !== 'voided')
          .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
        const targetTotal = Number((moneyUpdate as Partial<DemoRecord>).total ?? items[index].total ?? 0);
        if (booked < targetTotal - 0.005) {
          throw new Error('Bitte den Zahlungseingang an der Rechnung erfassen. Der Status wird nach vollständiger Zahlung automatisch gesetzt.');
        }
      }
      const previous = index >= 0 ? { ...items[index] } : null;
      const updated: DemoRecord = { ...(items[index] || { id }),
        ...(key === 'invoices' || key === 'quotes' ? withoutDerivedMoneyFields(data) : data),
        ...moneyUpdate, id, updatedAt: isoDate() };
      if (key === 'invoices' && items[index]?.status === 'draft'
          && (invoiceContentFields.some(field => data[field] !== undefined) || !items[index].documentSnapshot)) captureDemoInvoice(state, updated);
      if (index >= 0) items[index] = updated; else items.push(updated);
      if (key === 'invoices' && state.euerEntries.some(entry => entry.sourceType === 'invoice_payment' && entry.sourceId === id && entry.status !== 'voided')) {
        syncDemoInvoicePaymentStatus(state, id);
      }
      if (key === 'invoices') recordInvoiceHistory(state, updated, previous ? 'updated' : 'created', previous, updated);
      saveState(state);
      return (key === 'invoices' ? withDemoPaymentState(state, updated) : updated) as unknown as T;
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
      if (key === 'invoices' && index >= 0) {
        recordInvoiceHistory(state, items[index], 'deleted', { ...items[index] }, null);
      }
      const remainingItems = items.filter(itemRecord => itemRecord.id !== id);
      state[key] = remainingItems as DemoState[typeof key];
      saveState(state);
      return undefined as T;
    }
  }
  if (resource === 'jobs' && method === 'DELETE') {
    const ids = Array.isArray(data.ids) ? data.ids as string[] : [];
    const deletedIds = state.jobs.filter(job => ids.includes(job.id)).map(job => job.id);
    state.jobs = state.jobs.filter(job => !ids.includes(job.id));
    saveState(state);
    return {
      message: `${deletedIds.length} Aufträge erfolgreich gelöscht.`,
      deletedIds,
    } as unknown as T;
  }
  return {} as T;
}

export function resetDemoData() {
  localStorage.removeItem(getDemoDataStorageKey());
  demoDataStale = false;
}

export function seedDemoData(profile: TerminologyProfile = 'customers') {
  localStorage.setItem(getDemoDataStorageKey(), JSON.stringify(createInitialState(profile)));
  demoDataStale = false;
}
