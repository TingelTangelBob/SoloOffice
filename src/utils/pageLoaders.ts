/**
 * Jede Seite wird über ihren Lader geholt. Dieselben Lader dienen dem Vorladen:
 * Nach dem Start holt der Browser im Leerlauf alle Seitenpakete, beim Zeigen
 * oder Anfassen eines Menüeintrags sofort das passende. So ist das Paket beim
 * Klick meist schon da und der Wechsel braucht keinen Ladezustand.
 */
export const pageLoaders = {
  Dashboard: () => import('../components/Dashboard').then(({ Dashboard: page }) => ({ default: page })),
  CustomerManagement: () => import('../components/CustomerManagement').then(({ CustomerManagement: page }) => ({ default: page })),
  CustomerDetail: () => import('../components/CustomerDetail').then(({ CustomerDetail: page }) => ({ default: page })),
  InvoiceManagement: () => import('../components/InvoiceManagement').then(({ InvoiceManagement: page }) => ({ default: page })),
  QuoteManagement: () => import('../components/QuoteManagement').then(({ QuoteManagement: page }) => ({ default: page })),
  QuoteEditor: () => import('../components/QuoteEditor').then(({ QuoteEditor: page }) => ({ default: page })),
  Settings: () => import('../components/Settings').then(({ Settings: page }) => ({ default: page })),
  DataImportCenter: () => import('../components/DataImportCenter').then(({ DataImportCenter: page }) => ({ default: page })),
  SetupWizard: () => import('../components/SetupWizard').then(({ SetupWizard: page }) => ({ default: page })),
  TemplatesManagement: () => import('../components/TemplatesManagement').then(({ TemplatesManagement: page }) => ({ default: page })),
  PositionTemplatesManagement: () => import('../components/PositionTemplatesManagement').then(({ PositionTemplatesManagement: page }) => ({ default: page })),
  JobManagement: () => import('../components/JobManagement').then(({ JobManagement: page }) => ({ default: page })),
  Calendar: () => import('../components/Calendar').then(({ Calendar: page }) => ({ default: page })),
  ReportingManagement: () => import('../components/ReportingManagement').then(({ ReportingManagement: page }) => ({ default: page })),
  ReminderManagement: () => import('../components/ReminderManagement').then(({ ReminderManagement: page }) => ({ default: page })),
  RecurringInvoiceManagement: () => import('../components/RecurringInvoiceManagement').then(({ RecurringInvoiceManagement: page }) => ({ default: page })),
  CreditNoteManagement: () => import('../components/CreditNoteManagement').then(({ CreditNoteManagement: page }) => ({ default: page })),
  TaxOverview: () => import('../components/TaxOverview').then(({ TaxOverview: page }) => ({ default: page })),
  EuerManagement: () => import('../components/EuerManagement').then(({ EuerManagement: page }) => ({ default: page })),
  VatOverview: () => import('../components/VatOverview').then(({ VatOverview: page }) => ({ default: page })),
  RecurringExpensesManagement: () => import('../components/RecurringExpensesManagement').then(({ RecurringExpensesManagement: page }) => ({ default: page })),
  FixedAssetManagement: () => import('../components/FixedAssetManagement').then(({ FixedAssetManagement: page }) => ({ default: page })),
  DocumentsManagement: () => import('../components/DocumentsManagement').then(({ DocumentsManagement: page }) => ({ default: page })),
  SupportManagement: () => import('../components/SupportManagement').then(({ SupportManagement: page }) => ({ default: page })),
};

const pageToLoader: Record<string, keyof typeof pageLoaders> = {
  dashboard: 'Dashboard',
  setup: 'SetupWizard',
  customers: 'CustomerManagement',
  customer: 'CustomerDetail',
  jobs: 'JobManagement',
  calendar: 'Calendar',
  invoices: 'InvoiceManagement',
  'recurring-invoices': 'RecurringInvoiceManagement',
  'credit-notes': 'CreditNoteManagement',
  taxes: 'TaxOverview',
  'tax-overview': 'TaxOverview',
  euer: 'EuerManagement',
  vat: 'VatOverview',
  'fixed-costs': 'RecurringExpensesManagement',
  'fixed-assets': 'FixedAssetManagement',
  documents: 'DocumentsManagement',
  receipts: 'DocumentsManagement',
  'incoming-e-invoices': 'DocumentsManagement',
  quotes: 'QuoteManagement',
  'quote-editor': 'QuoteEditor',
  reporting: 'ReportingManagement',
  reminders: 'ReminderManagement',
  settings: 'Settings',
  profile: 'Settings',
  workspace: 'Settings',
  support: 'SupportManagement',
  templates: 'TemplatesManagement',
  positions: 'PositionTemplatesManagement',
  'data-import': 'DataImportCenter',
};

// Seiten mit großem Zusatzpaket (die Vorlagen-Vorschau bringt die PDF-Erzeugung
// mit) werden nicht im Leerlauf geholt, sondern erst beim Zielen oder Öffnen.
const skipIdlePreload = new Set<keyof typeof pageLoaders>(['TemplatesManagement']);

// Ein Lader läuft nur einmal; danach liegt das Modul im Browser-Cache.
const started = new Set<string>();

function run(name: keyof typeof pageLoaders) {
  if (started.has(name)) return;
  started.add(name);
  // Vorladen ist reine Optimierung: Scheitert es (etwa offline), holt der
  // spätere Seitenwechsel das Paket selbst und zeigt dort den Fehler.
  void pageLoaders[name]().catch(() => started.delete(name));
}

/** Holt das Paket einer Seite, sobald der Nutzer sie anzielt (Hover, Fokus, Tippen). */
export function preloadPage(page: string): void {
  const name = pageToLoader[page];
  if (name) run(name);
}

/**
 * Holt nach dem Start alle Seitenpakete nacheinander im Leerlauf, ohne die
 * erste Darstellung oder laufende Eingaben zu stören. Auf Verbindungen mit
 * Datensparmodus bleibt es beim Vorladen per Zielen.
 */
export function preloadAllPages(): () => void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return () => {};
  const queue = (Object.keys(pageLoaders) as Array<keyof typeof pageLoaders>).filter(name => !started.has(name) && !skipIdlePreload.has(name));
  let cancelled = false;
  let handle: number | undefined;
  const schedule = typeof window.requestIdleCallback === 'function'
    ? (cb: () => void) => window.requestIdleCallback(cb, { timeout: 2000 })
    : (cb: () => void) => window.setTimeout(cb, 200);
  const next = () => {
    if (cancelled) return;
    const name = queue.shift();
    if (!name) return;
    run(name);
    handle = schedule(next) as number;
  };
  handle = schedule(next) as number;
  return () => {
    cancelled = true;
    if (handle !== undefined) {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    }
  };
}
