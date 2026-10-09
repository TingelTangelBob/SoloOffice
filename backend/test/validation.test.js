import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPositiveNumber,
  isValidDate,
  isValidUUID,
  validateDiscountFields,
  validateSchema,
} from '../utils/validation.js';
import {
  DASHBOARD_ITEM_DEFINITIONS,
  DASHBOARD_PREFERENCE_IDS,
  DASHBOARD_PREFERENCES_VERSION,
  DEFAULT_DASHBOARD_PREFERENCES,
  normalizeDashboardPreferences,
} from '../utils/dashboardPreferences.js';

test('Grundtypen werden streng validiert', () => {
  assert.equal(isValidUUID('8c0d9c77-6b26-4279-866e-11042e056cbc'), true);
  assert.equal(isValidUUID('8c0d9c77'), false);
  assert.equal(isValidDate('2026-08-27'), true);
  assert.equal(isValidDate('kein-datum'), false);
  assert.equal(isPositiveNumber('0'), true);
  assert.equal(isPositiveNumber('-0.01'), false);
});

test('Schemafehler nennen das betroffene Feld', () => {
  const result = validateSchema({ email: 'ungueltig', amount: -1 }, {
    email: { required: true, type: 'email' },
    amount: { type: 'number', min: 0 },
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map(error => error.field), ['email', 'amount']);
});

test('Rabatte verhindern negative und zu hohe Werte', () => {
  assert.deepEqual(validateDiscountFields({ globalDiscountType: 'percentage', globalDiscountValue: 101 }), {
    valid: false,
    message: 'Ungültiger Rabatt: Prozentwert muss zwischen 0 und 100 liegen',
  });
  assert.equal(validateDiscountFields({ items: [{ discountType: 'fixed', discountValue: 2.5 }] }).valid, true);
  assert.match(validateDiscountFields({ items: [{ discountType: 'fixed', discountValue: -1 }] }).message, /Position 1/);
});

test('Dashboard-Einstellungen akzeptieren nur bekannte Bausteine und begrenzte Auswahlwerte', () => {
  const result = normalizeDashboardPreferences({
    items: [{ id: 'revenue', visible: false }, { id: 'unknown', visible: false }, { id: 'revenue', visible: true }],
    year: 2026, includeUnpaidInvoices: true, comparePrevious: true,
  });
  assert.equal(result.items.length, DASHBOARD_PREFERENCE_IDS.length);
  assert.deepEqual(result.items[0], { id: 'revenue', visible: false });
  assert.equal(result.version, DASHBOARD_PREFERENCES_VERSION);
  assert.equal(result.includeUnpaidInvoices, true);
  assert.equal(result.year, 2026);
  assert.equal(normalizeDashboardPreferences({ year: '2099', comparePrevious: true }).year, null);
  assert.equal(normalizeDashboardPreferences({ year: 'all', comparePrevious: true }).comparePrevious, false);
});

test('Dashboard-Einstellungen: alte Werte ohne Version bleiben gültig, neue Kacheln kommen ausgeblendet hinzu', () => {
  const legacyIds = ['quick-invoice', 'quick-receipt', 'quick-customer', 'quick-course',
    'revenue', 'top-customers', 'week-calendar', 'recent-jobs', 'recent-invoices', 'course-series'];
  assert.deepEqual(DEFAULT_DASHBOARD_PREFERENCES.items.filter(item => item.visible).map(item => item.id), legacyIds);
  const legacy = { items: [...legacyIds].reverse().map(id => ({ id, visible: id !== 'week-calendar' })), year: null };
  const result = normalizeDashboardPreferences(legacy);
  assert.deepEqual(result.items.slice(0, legacyIds.length), legacy.items);
  assert.ok(result.items.slice(legacyIds.length).every(item => item.visible === false));
  assert.deepEqual(normalizeDashboardPreferences(result), result);
});

test('Dashboard-Einstellungen prüfen Größen je Kachel und verwerfen unbekannte Felder', () => {
  const result = normalizeDashboardPreferences({ version: 2, items: [
    { id: 'revenue', visible: true, size: 'full' },
    { id: 'top-customers', visible: true, size: 'full' },
    { id: 'quick-invoice', visible: true, size: 'half' },
    { id: 'open-invoices', visible: 'ja' },
    { id: 'recent-receipts', visible: true, size: 'third', extra: '<script>' },
  ], extra: true });
  assert.deepEqual(result.items[0], { id: 'revenue', visible: true, size: 'full' });
  assert.deepEqual(result.items[1], { id: 'top-customers', visible: true });
  assert.deepEqual(result.items[2], { id: 'quick-invoice', visible: true });
  assert.deepEqual(result.items[3], { id: 'recent-receipts', visible: true, size: 'third' });
  assert.equal(result.items.find(item => item.id === 'open-invoices').visible, false);
  assert.equal('extra' in result, false);
  assert.ok(DASHBOARD_ITEM_DEFINITIONS.every(definition => definition.group === 'quick' || definition.sizes.includes(definition.defaultSize)));
});
