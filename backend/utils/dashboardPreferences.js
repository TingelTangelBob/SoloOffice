/**
 * Dashboard-Einstellungen je Benutzer (`users.dashboard_preferences`, JSONB).
 *
 * Dieses Modul ist die einzige Quelle für die bekannten Kacheln, ihre Größen
 * und die Normalisierung. Server, Frontend und Demo-API verwenden es
 * gemeinsam (wie `importPlanner.js`), damit die Prüfung nicht auseinanderläuft.
 *
 * Format-Historie:
 * - ohne `version` (Commit e140e0f): `items: [{ id, visible }]` mit den zehn
 *   Standardbereichen, fehlende IDs wurden sichtbar ergänzt.
 * - `version: 2`: zusätzliche Kacheln und Schnellzugriffe, optionale `size`
 *   je Kachel. Fehlende IDs erhalten ihre Standard-Sichtbarkeit; neue
 *   Kacheln erscheinen dadurch nicht ungefragt.
 *
 * Unbekannte IDs (etwa aus einer neueren Version) werden verworfen, ungültige
 * Größen fallen auf die Standardgröße zurück. Eine Datenbankmigration ist für
 * neue Kacheln nicht nötig.
 */
export const DASHBOARD_PREFERENCES_VERSION = 2;
export const DASHBOARD_PREFERENCES_MAX_BYTES = 4096;

/** Breiten im Zwölferraster der Desktop-Ansicht. */
export const DASHBOARD_SIZE_SPANS = Object.freeze({
  quarter: 3,
  third: 4,
  half: 6,
  'two-thirds': 8,
  'three-quarters': 9,
  full: 12,
});
export const DASHBOARD_SIZES = Object.freeze(Object.keys(DASHBOARD_SIZE_SPANS));

const SMALL = Object.freeze(['quarter', 'third', 'half']);
const LIST = Object.freeze(['third', 'half', 'two-thirds', 'full']);
const WIDE = Object.freeze(['half', 'two-thirds', 'three-quarters', 'full']);

/**
 * Reihenfolge = Standardreihenfolge. `defaultVisible: true` markiert die
 * Standardauswahl; sie entspricht exakt dem Stand vor Version 2.
 */
export const DASHBOARD_ITEM_DEFINITIONS = Object.freeze([
  { id: 'quick-invoice', group: 'quick', defaultVisible: true },
  { id: 'quick-receipt', group: 'quick', defaultVisible: true },
  { id: 'quick-customer', group: 'quick', defaultVisible: true },
  { id: 'quick-course', group: 'quick', defaultVisible: true },
  { id: 'quick-quote', group: 'quick', defaultVisible: false },
  { id: 'quick-calendar', group: 'quick', defaultVisible: false },
  { id: 'quick-credit-note', group: 'quick', defaultVisible: false },
  { id: 'quick-euer', group: 'quick', defaultVisible: false },
  { id: 'quick-import', group: 'quick', defaultVisible: false },
  { id: 'revenue', group: 'card', defaultVisible: true, defaultSize: 'three-quarters', sizes: WIDE },
  { id: 'top-customers', group: 'card', defaultVisible: true, defaultSize: 'quarter', sizes: SMALL },
  { id: 'week-calendar', group: 'card', defaultVisible: true, defaultSize: 'full', sizes: ['full'] },
  { id: 'recent-jobs', group: 'card', defaultVisible: true, defaultSize: 'full', sizes: LIST },
  { id: 'recent-invoices', group: 'card', defaultVisible: true, defaultSize: 'three-quarters', sizes: WIDE },
  { id: 'course-series', group: 'card', defaultVisible: true, defaultSize: 'quarter', sizes: SMALL },
  { id: 'open-invoices', group: 'card', defaultVisible: false, defaultSize: 'third', sizes: SMALL },
  { id: 'income-expense', group: 'card', defaultVisible: false, defaultSize: 'two-thirds', sizes: WIDE },
  { id: 'upcoming-jobs', group: 'card', defaultVisible: false, defaultSize: 'third', sizes: LIST },
  { id: 'open-quotes', group: 'card', defaultVisible: false, defaultSize: 'third', sizes: LIST },
  { id: 'unbilled-jobs', group: 'card', defaultVisible: false, defaultSize: 'third', sizes: LIST },
  { id: 'average-invoice', group: 'card', defaultVisible: false, defaultSize: 'quarter', sizes: SMALL },
  { id: 'active-customers', group: 'card', defaultVisible: false, defaultSize: 'quarter', sizes: SMALL },
  { id: 'recent-receipts', group: 'card', defaultVisible: false, defaultSize: 'third', sizes: LIST },
  { id: 'taxes', group: 'card', defaultVisible: false, defaultSize: 'half', sizes: WIDE, requiredExtension: 'taxes' },
  { id: 'tax-reserve', group: 'card', defaultVisible: false, defaultSize: 'third', sizes: SMALL, requiredExtension: 'taxes' },
  { id: 'tax-position', group: 'card', defaultVisible: false, defaultSize: 'half', sizes: WIDE, requiredExtension: 'taxes' },
  { id: 'small-business', group: 'card', defaultVisible: false, defaultSize: 'third', sizes: SMALL, requiredExtension: 'taxes' },
  { id: 'fixed-costs', group: 'card', defaultVisible: false, defaultSize: 'half', sizes: WIDE, requiredExtension: 'taxes' },
  { id: 'tax-advances', group: 'card', defaultVisible: false, defaultSize: 'half', sizes: WIDE, requiredExtension: 'taxes' },
  // Betriebliche Kachel (keine private Abgabe): USt-Zahllast des Voranmeldungszeitraums.
  { id: 'vat-return', group: 'card', defaultVisible: false, defaultSize: 'third', sizes: ['third', 'half'], requiredExtension: 'taxes' },
  { id: 'health-backpayment', group: 'card', defaultVisible: false, defaultSize: 'half', sizes: WIDE, requiredExtension: 'taxes' },
].map(definition => Object.freeze(definition)));

export const DASHBOARD_PREFERENCE_IDS = Object.freeze(DASHBOARD_ITEM_DEFINITIONS.map(definition => definition.id));

const DEFINITIONS_BY_ID = new Map(DASHBOARD_ITEM_DEFINITIONS.map(definition => [definition.id, definition]));

export function getDashboardItemDefinition(id) {
  return DEFINITIONS_BY_ID.get(id) || null;
}

/** Gültige Größe für eine Kachel oder `null`, wenn sie nicht erlaubt ist. */
export function validDashboardSize(id, size) {
  const definition = DEFINITIONS_BY_ID.get(id);
  return definition?.sizes?.includes(size) ? size : null;
}

export const DEFAULT_DASHBOARD_PREFERENCES = Object.freeze({
  version: DASHBOARD_PREFERENCES_VERSION,
  items: Object.freeze(DASHBOARD_ITEM_DEFINITIONS.map(({ id, defaultVisible }) => Object.freeze({ id, visible: defaultVisible }))),
  includeUnpaidInvoices: false,
  comparePrevious: false,
  year: null,
  showPrivateLevies: false,
  showFixedCosts: false,
  showSocialContributions: false,
  showTaxReserve: false,
  showVatReserve: false,
  showAvailable: false,
  monthView: false,
  month: null,
  compareMonth: null,
});

function byteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function cloneDefaults() {
  return {
    ...DEFAULT_DASHBOARD_PREFERENCES,
    items: DEFAULT_DASHBOARD_PREFERENCES.items.map(item => ({ ...item })),
  };
}

export function normalizeDashboardPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return cloneDefaults();
  try {
    if (byteLength(value) > DASHBOARD_PREFERENCES_MAX_BYTES) return cloneDefaults();
  } catch {
    return cloneDefaults();
  }

  const entries = Array.isArray(value.items) ? value.items.slice(0, DASHBOARD_PREFERENCE_IDS.length * 2) : [];
  const items = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (!DEFINITIONS_BY_ID.has(entry.id) || seen.has(entry.id) || typeof entry.visible !== 'boolean') continue;
    seen.add(entry.id);
    const size = validDashboardSize(entry.id, entry.size);
    items.push(size ? { id: entry.id, visible: entry.visible, size } : { id: entry.id, visible: entry.visible });
  }
  // Fehlende Einträge erhalten ihre Standard-Sichtbarkeit. Für Werte aus
  // e140e0f sind das genau die in Version 2 neuen Kacheln – ausgeblendet.
  for (const definition of DASHBOARD_ITEM_DEFINITIONS) {
    if (!seen.has(definition.id)) items.push({ id: definition.id, visible: definition.defaultVisible });
  }

  const year = value.year === 'all' ? 'all'
    : Number.isInteger(value.year) && value.year >= 2000 && value.year <= 2200 ? value.year : null;
  const validMonth = month => typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
  const normalized = {
    version: DASHBOARD_PREFERENCES_VERSION,
    items,
    includeUnpaidInvoices: value.includeUnpaidInvoices === true,
    comparePrevious: value.comparePrevious === true && year !== 'all',
    year,
    showPrivateLevies: value.showPrivateLevies === true,
    showFixedCosts: value.showFixedCosts === true,
    showSocialContributions: value.showSocialContributions === true,
    showTaxReserve: value.showTaxReserve === true,
    showVatReserve: value.showVatReserve === true,
    showAvailable: value.showAvailable === true,
    monthView: value.monthView === true,
    month: validMonth(value.month),
    compareMonth: validMonth(value.compareMonth),
  };
  if (byteLength(normalized) > DASHBOARD_PREFERENCES_MAX_BYTES) return cloneDefaults();
  return normalized;
}
