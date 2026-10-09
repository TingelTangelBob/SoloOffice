import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DASHBOARD_ITEM_DEFINITIONS,
  DEFAULT_DASHBOARD_PREFERENCES,
  normalizeDashboardPreferences,
} from '../utils/dashboardPreferences.js';

test('Dashboard-Steuerkacheln sind registriert, Erweiterungs-gebunden und standardmäßig verborgen', () => {
  const ids = ['taxes', 'tax-reserve', 'tax-position', 'small-business', 'fixed-costs', 'tax-advances', 'health-backpayment'];
  for (const id of ids) {
    const definition = DASHBOARD_ITEM_DEFINITIONS.find(item => item.id === id);
    assert.ok(definition, id);
    assert.equal(definition.defaultVisible, false, id);
    assert.equal(definition.requiredExtension, 'taxes', id);
    assert.ok(definition.sizes.length > 0, id);
  }
});

test('neue Dashboard-Schalter starten aus und gültige Monatsauswahl bleibt gespeichert', () => {
  const defaults = normalizeDashboardPreferences(null);
  for (const key of ['showPrivateLevies', 'showFixedCosts', 'showSocialContributions', 'showTaxReserve', 'showVatReserve', 'showAvailable', 'monthView']) {
    assert.equal(defaults[key], false, key);
  }
  assert.equal(defaults.month, null);
  assert.equal(defaults.compareMonth, null);

  const saved = normalizeDashboardPreferences({ showPrivateLevies: true, showFixedCosts: true, showSocialContributions: true,
    showTaxReserve: true, showVatReserve: true, showAvailable: true, monthView: true, month: '2026-09', compareMonth: '2026-06' });
  assert.equal(saved.showPrivateLevies, true);
  assert.equal(saved.showFixedCosts, true);
  assert.equal(saved.showSocialContributions, true);
  assert.equal(saved.showTaxReserve, true);
  assert.equal(saved.showVatReserve, true);
  assert.equal(saved.showAvailable, true);
  assert.equal(saved.monthView, true);
  assert.equal(saved.month, '2026-09');
  assert.equal(saved.compareMonth, '2026-06');
  assert.deepEqual(normalizeDashboardPreferences(saved), saved);
});

test('unbekannte Präferenzschlüssel werden entfernt und ungültige Monatswerte fallen zurück', () => {
  const normalized = normalizeDashboardPreferences({ showPrivateLevies: 'true', monthView: 1, month: '2026-13', compareMonth: 'September', unknown: true });
  assert.equal(normalized.showPrivateLevies, false);
  assert.equal(normalized.monthView, false);
  assert.equal(normalized.month, null);
  assert.equal(normalized.compareMonth, null);
  assert.equal('unknown' in normalized, false);
  assert.deepEqual(normalizeDashboardPreferences({ items: [], padding: 'x'.repeat(5000) }), DEFAULT_DASHBOARD_PREFERENCES);
});
