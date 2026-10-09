import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DASHBOARD_PREFERENCES, normalizeDashboardPreferences } from '../../.test-dist/utils/dashboardPreferences.js';

test('Dashboard-Einstellungen verwerfen unbekannte IDs, bereinigen Duplikate und ergänzen neue Standards', () => {
  const normalized = normalizeDashboardPreferences({ items: [
    { id: 'revenue', visible: false }, { id: 'unbekannt', visible: false }, { id: 'revenue', visible: true },
  ] });
  assert.equal(normalized.items[0].id, 'revenue');
  assert.equal(normalized.items[0].visible, false);
  assert.equal(normalized.items.length, DEFAULT_DASHBOARD_PREFERENCES.items.length);
  assert.ok(normalized.items.slice(1).every(item => item.visible));
});

test('Dashboard-Jahr, Schalter und Vergleich werden streng normalisiert', () => {
  assert.deepEqual(normalizeDashboardPreferences({ year: 'all', comparePrevious: true, includeUnpaidInvoices: true }).year, 'all');
  assert.equal(normalizeDashboardPreferences({ year: 'all', comparePrevious: true }).comparePrevious, false);
  assert.equal(normalizeDashboardPreferences({ year: 1899, includeUnpaidInvoices: 'true' }).year, null);
  assert.equal(normalizeDashboardPreferences({ year: 1899, includeUnpaidInvoices: 'true' }).includeUnpaidInvoices, false);
});
