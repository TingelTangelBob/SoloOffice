import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DASHBOARD_ITEM_DEFINITIONS,
  DASHBOARD_PREFERENCES_VERSION,
  DEFAULT_DASHBOARD_PREFERENCES,
  balancedColumns,
  canStepDashboardItem,
  dashboardItemSize,
  moveDashboardItem,
  nextDashboardSize,
  normalizeDashboardPreferences,
  packDashboardRows,
  resetDashboardLayout,
  resizeDashboardItem,
  setDashboardItemVisible,
  stepDashboardItem,
} from '../../.test-dist/utils/dashboardPreferences.js';

const LEGACY_IDS = [
  'quick-invoice', 'quick-receipt', 'quick-customer', 'quick-course',
  'revenue', 'top-customers', 'week-calendar', 'recent-jobs', 'recent-invoices', 'course-series',
];
const ids = items => items.map(item => item.id);
const visibleIds = items => items.filter(item => item.visible).map(item => item.id);

test('Dashboard-Einstellungen verwerfen unbekannte IDs, bereinigen Duplikate und ergänzen fehlende IDs', () => {
  const normalized = normalizeDashboardPreferences({ items: [
    { id: 'revenue', visible: false }, { id: 'unbekannt', visible: false }, { id: 'revenue', visible: true },
  ] });
  assert.equal(normalized.items[0].id, 'revenue');
  assert.equal(normalized.items[0].visible, false);
  assert.equal(normalized.items.length, DEFAULT_DASHBOARD_PREFERENCES.items.length);
  assert.ok(!ids(normalized.items).includes('unbekannt'));
  assert.equal(new Set(ids(normalized.items)).size, normalized.items.length);
});

test('Dashboard-Jahr, Schalter und Vergleich werden streng normalisiert', () => {
  assert.deepEqual(normalizeDashboardPreferences({ year: 'all', comparePrevious: true, includeUnpaidInvoices: true }).year, 'all');
  assert.equal(normalizeDashboardPreferences({ year: 'all', comparePrevious: true }).comparePrevious, false);
  assert.equal(normalizeDashboardPreferences({ year: 1899, includeUnpaidInvoices: 'true' }).year, null);
  assert.equal(normalizeDashboardPreferences({ year: 1899, includeUnpaidInvoices: 'true' }).includeUnpaidInvoices, false);
});

test('Standardauswahl entspricht exakt dem Stand vor Version 2; neue Kacheln sind ausgeblendet', () => {
  assert.equal(DEFAULT_DASHBOARD_PREFERENCES.version, DASHBOARD_PREFERENCES_VERSION);
  assert.deepEqual(visibleIds(DEFAULT_DASHBOARD_PREFERENCES.items), LEGACY_IDS);
  assert.ok(DEFAULT_DASHBOARD_PREFERENCES.items.length >= LEGACY_IDS.length + 6);
});

test('Gespeicherte Werte aus e140e0f (ohne version) bleiben erhalten und bekommen neue Kacheln ausgeblendet', () => {
  const legacy = {
    items: [
      { id: 'recent-invoices', visible: true }, { id: 'revenue', visible: false },
      ...LEGACY_IDS.filter(id => id !== 'recent-invoices' && id !== 'revenue').map(id => ({ id, visible: id !== 'quick-receipt' })),
    ],
    includeUnpaidInvoices: true,
    comparePrevious: true,
    year: 2025,
  };
  const migrated = normalizeDashboardPreferences(legacy);
  assert.equal(migrated.version, DASHBOARD_PREFERENCES_VERSION);
  assert.deepEqual(ids(migrated.items).slice(0, LEGACY_IDS.length), ids(legacy.items));
  assert.equal(migrated.items.find(item => item.id === 'revenue').visible, false);
  assert.equal(migrated.items.find(item => item.id === 'quick-receipt').visible, false);
  const added = migrated.items.slice(LEGACY_IDS.length);
  assert.ok(added.length > 0);
  assert.ok(added.every(item => !item.visible), 'neue Kacheln dürfen nicht automatisch sichtbar werden');
  assert.equal(migrated.includeUnpaidInvoices, true);
  assert.equal(migrated.comparePrevious, true);
  assert.equal(migrated.year, 2025);
  // Erneutes Normalisieren ist stabil.
  assert.deepEqual(normalizeDashboardPreferences(migrated), migrated);
});

test('Fehlende Standard-IDs werden sichtbar ergänzt, fehlende neue IDs ausgeblendet', () => {
  const normalized = normalizeDashboardPreferences({ version: 2, items: [{ id: 'open-invoices', visible: true }] });
  assert.equal(normalized.items[0].id, 'open-invoices');
  assert.equal(normalized.items[0].visible, true);
  for (const definition of DASHBOARD_ITEM_DEFINITIONS.filter(entry => entry.id !== 'open-invoices')) {
    assert.equal(normalized.items.find(item => item.id === definition.id).visible, definition.defaultVisible, definition.id);
  }
});

test('Version aus der Zukunft und ungültige Größen werden robust gelesen', () => {
  const normalized = normalizeDashboardPreferences({ version: 99, items: [
    { id: 'revenue', visible: true, size: 'quarter' },
    { id: 'top-customers', visible: true, size: 'half' },
    { id: 'week-calendar', visible: true, size: 'riesig' },
    { id: 'zukunft', visible: true, size: 'full' },
  ] });
  assert.equal(normalized.version, DASHBOARD_PREFERENCES_VERSION);
  assert.equal(normalized.items[0].size, undefined, 'Umsatzverlauf erlaubt kein Viertel');
  assert.equal(normalized.items[1].size, 'half');
  assert.equal(normalized.items[2].size, undefined);
  assert.equal(dashboardItemSize(normalized.items[0]), 'three-quarters');
});

test('Zu große Einstellungen fallen auf den Standard zurück', () => {
  const huge = { items: [], padding: 'x'.repeat(5000) };
  assert.deepEqual(normalizeDashboardPreferences(huge), normalizeDashboardPreferences(null));
});

test('Ziehen verschiebt innerhalb einer Gruppe, nie zwischen Schnellzugriffen und Kacheln', () => {
  const items = DEFAULT_DASHBOARD_PREFERENCES.items;
  const moved = moveDashboardItem(items, 'recent-invoices', 'revenue');
  assert.deepEqual(visibleIds(moved).slice(4, 7), ['recent-invoices', 'revenue', 'top-customers']);
  assert.equal(moveDashboardItem(items, 'revenue', 'quick-invoice'), items);
  assert.equal(moveDashboardItem(items, 'revenue', 'revenue'), items);
  const back = moveDashboardItem(moved, 'recent-invoices', 'course-series');
  assert.equal(visibleIds(back).at(-1), 'recent-invoices');
});

test('Pfeile springen über ausgeblendete Einträge zum nächsten sichtbaren Nachbarn', () => {
  let items = setDashboardItemVisible(DEFAULT_DASHBOARD_PREFERENCES.items, 'top-customers', false);
  assert.equal(canStepDashboardItem(items, 'revenue', -1), false);
  items = stepDashboardItem(items, 'revenue', 1);
  assert.deepEqual(visibleIds(items).slice(4, 6), ['week-calendar', 'revenue']);
  assert.equal(canStepDashboardItem(items, 'quick-course', 1), false, 'Schnellzugriffe springen nicht in die Kacheln');
  assert.equal(stepDashboardItem(items, 'quick-invoice', -1), items);
});

test('Hinzufügen setzt die Kachel ans Ende ihrer Gruppe, Ausblenden behält die Position', () => {
  const hidden = setDashboardItemVisible(DEFAULT_DASHBOARD_PREFERENCES.items, 'revenue', false);
  assert.equal(ids(hidden).indexOf('revenue'), ids(DEFAULT_DASHBOARD_PREFERENCES.items).indexOf('revenue'));
  const added = setDashboardItemVisible(hidden, 'open-invoices', true);
  assert.equal(visibleIds(added).at(-1), 'open-invoices');
  const quick = setDashboardItemVisible(added, 'quick-quote', true);
  assert.deepEqual(visibleIds(quick).slice(0, 5), ['quick-invoice', 'quick-receipt', 'quick-customer', 'quick-course', 'quick-quote']);
  const allQuickHidden = ['quick-invoice', 'quick-receipt', 'quick-customer', 'quick-course']
    .reduce((list, id) => setDashboardItemVisible(list, id, false), DEFAULT_DASHBOARD_PREFERENCES.items);
  const firstQuick = setDashboardItemVisible(allQuickHidden, 'quick-import', true);
  assert.equal(visibleIds(firstQuick)[0], 'quick-import');
  assert.equal(setDashboardItemVisible(added, 'open-invoices', true), added);
});

test('Größen: Standard wird nicht gespeichert, nur erlaubte Größen, Weiterschalten rotiert', () => {
  const items = DEFAULT_DASHBOARD_PREFERENCES.items;
  const resized = resizeDashboardItem(items, 'top-customers', 'third');
  assert.equal(resized.find(item => item.id === 'top-customers').size, 'third');
  const back = resizeDashboardItem(resized, 'top-customers', 'quarter');
  assert.equal('size' in back.find(item => item.id === 'top-customers'), false);
  assert.equal(resizeDashboardItem(items, 'top-customers', 'full'), items);
  assert.equal(nextDashboardSize({ id: 'top-customers', visible: true }), 'third');
  assert.equal(nextDashboardSize({ id: 'top-customers', visible: true, size: 'half' }), 'quarter');
  assert.equal(nextDashboardSize({ id: 'week-calendar', visible: true }), null);
});

test('Zurücksetzen stellt Auswahl, Reihenfolge und Größen her und lässt Zeitraum und Schalter stehen', () => {
  const custom = {
    ...DEFAULT_DASHBOARD_PREFERENCES,
    year: 2024,
    includeUnpaidInvoices: true,
    items: resizeDashboardItem(setDashboardItemVisible(DEFAULT_DASHBOARD_PREFERENCES.items, 'open-quotes', true), 'revenue', 'full'),
  };
  const reset = resetDashboardLayout(custom);
  assert.deepEqual(reset.items, DEFAULT_DASHBOARD_PREFERENCES.items);
  assert.equal(reset.year, 2024);
  assert.equal(reset.includeUnpaidInvoices, true);
});

test('Zeilen werden ohne Löcher aufgefüllt', () => {
  const pack = entries => Object.fromEntries(packDashboardRows(entries, 12));
  assert.deepEqual(pack([{ id: 'revenue', span: 9 }, { id: 'top', span: 3 }]), { revenue: 9, top: 3 });
  assert.deepEqual(pack([{ id: 'revenue', span: 9 }]), { revenue: 12 });
  assert.deepEqual(pack([{ id: 'a', span: 3 }, { id: 'b', span: 3 }, { id: 'c', span: 12 }]), { a: 6, b: 6, c: 12 });
  assert.deepEqual(pack([{ id: 'a', span: 4 }, { id: 'b', span: 4 }, { id: 'c', span: 4 }, { id: 'd', span: 9 }]), { a: 4, b: 4, c: 4, d: 12 });
  assert.deepEqual(pack([{ id: 'a', span: 9 }, { id: 'b', span: 4 }]), { a: 12, b: 12 });
  const tablet = Object.fromEntries(packDashboardRows([{ id: 'a', span: 2 }, { id: 'b', span: 1 }, { id: 'c', span: 1 }, { id: 'd', span: 1 }], 2));
  assert.deepEqual(tablet, { a: 2, b: 1, c: 1, d: 2 });
});

test('Schnellzugriffe verteilen sich gleichmäßig auf Reihen', () => {
  assert.equal(balancedColumns(4, 4), 4);
  assert.equal(balancedColumns(5, 4), 3);
  assert.equal(balancedColumns(7, 4), 4);
  assert.equal(balancedColumns(8, 6), 4);
  assert.equal(balancedColumns(3, 2), 2);
  assert.equal(balancedColumns(1, 2), 1);
  assert.equal(balancedColumns(0, 4), 1);
});
