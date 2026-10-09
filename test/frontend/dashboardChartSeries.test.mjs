import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';
import { DEFAULT_DASHBOARD_PREFERENCES } from '../../.test-dist/utils/dashboardPreferences.js';

async function loadChartSeries() {
  const base = path.resolve('.test-dist');
  await mkdir(base, { recursive: true });
  const temp = await mkdtemp(path.join(base, 'dashboard-chart-series-'));
  const bundle = await rolldown({ input: path.resolve('src/utils/dashboardChartSeries.ts'), platform: 'browser' });
  const output = path.join(temp, 'dashboardChartSeries.mjs');
  await bundle.write({ file: output, format: 'esm' });
  await bundle.close();
  return { module: await import(pathToFileURL(output).href), temp };
}

const forecastFor = (overrides = {}) => ({
  year: 2026,
  vatStatus: 'regular',
  profileComplete: true,
  missingFields: [],
  monthly: Array.from({ length: 12 }, (_, index) => ({
    month: `2026-${String(index + 1).padStart(2, '0')}`,
    revenue: 1000,
    fixedCosts: 100,
    social: 50,
    taxReserve: 70,
    vatReserve: 30,
    available: 600,
    forecast: index >= 8,
  })),
  ...overrides,
});
const contextFor = (overrides = {}) => ({
  preferences: { ...DEFAULT_DASHBOARD_PREFERENCES, year: 2026, showFixedCosts: true },
  allYears: false,
  year: 2026,
  records: [],
  locale: 'de-DE',
  taxesEnabled: true,
  forecast: forecastFor(),
  ...overrides,
});

test('Zusatzreihen sind an aktives Jahr, Erweiterung und vollständiges Profil gebunden', async t => {
  const { module, temp } = await loadChartSeries();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const DEFAULT_DASHBOARD_PREFERENCES = (await import('../../.test-dist/utils/dashboardPreferences.js')).DEFAULT_DASHBOARD_PREFERENCES;
  const { REVENUE_CHART_SERIES } = module;
  const definition = id => REVENUE_CHART_SERIES.find(series => series.id === id);
  const series = definition('fixed-costs');
  assert.equal(series.unavailableReason(contextFor()), null);
  assert.ok(series.build(contextFor()));
  assert.equal(series.build(contextFor({ preferences: { ...DEFAULT_DASHBOARD_PREFERENCES, year: 2026 } })), null);
  assert.match(series.unavailableReason(contextFor({ allYears: true, year: 'all' })), /einzelnes Jahr/);
  assert.match(series.unavailableReason(contextFor({ taxesEnabled: false })), /Erweiterung/);
  assert.match(series.unavailableReason(contextFor({ forecast: forecastFor({ profileComplete: false, missingFields: ['Geburtsjahr'] }) })), /Geburtsjahr/);
  assert.match(series.unavailableReason(contextFor({ forecast: forecastFor({ year: 2025 }) })), /Schätzgrundlage/);
});

test('private Reihen bleiben standardmäßig aus und betriebliche Fixkosten unabhängig davon verfügbar', async t => {
  const { module, temp } = await loadChartSeries();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const { DEFAULT_DASHBOARD_PREFERENCES } = await import('../../.test-dist/utils/dashboardPreferences.js');
  const { REVENUE_CHART_SERIES } = module;
  const definition = id => REVENUE_CHART_SERIES.find(series => series.id === id);
  const preferences = { ...DEFAULT_DASHBOARD_PREFERENCES, year: 2026, showFixedCosts: true, showSocialContributions: true };
  const context = contextFor({ preferences });
  const privateSeries = definition('social-contributions');
  assert.equal(privateSeries.isActive(preferences), false);
  assert.equal(privateSeries.build(context), null);
  assert.ok(definition('fixed-costs').build(context));
  const enabled = { ...preferences, showPrivateLevies: true };
  assert.equal(privateSeries.isActive(enabled), true);
  assert.ok(privateSeries.build(contextFor({ preferences: enabled })));
});

test('Verfügbar zieht nur aktiv ausgewählte Reihen ab und ignoriert vollständiges Backend-available', async t => {
  const { module, temp } = await loadChartSeries();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const { DEFAULT_DASHBOARD_PREFERENCES } = await import('../../.test-dist/utils/dashboardPreferences.js');
  const { REVENUE_CHART_SERIES } = module;
  const definition = id => REVENUE_CHART_SERIES.find(series => series.id === id);
  const base = { ...DEFAULT_DASHBOARD_PREFERENCES, year: 2026, showAvailable: true };
  const available = definition('available');
  assert.equal(available.build(contextFor({ preferences: base })).points[0].value, 1000);
  const selected = { ...base, showPrivateLevies: true, showFixedCosts: true, showSocialContributions: true, showTaxReserve: true, showVatReserve: true };
  const point = available.build(contextFor({ preferences: selected })).points[0];
  assert.equal(point.value, 750);
  assert.notEqual(point.value, 600, 'monthly.available zieht variable Ausgaben mit ab und ist für diese Linie ungeeignet');
  const privateOff = { ...selected, showPrivateLevies: false };
  assert.equal(available.build(contextFor({ preferences: privateOff })).points[0].value, 870);
  assert.equal(point.forecast, false);
  assert.equal(available.build(contextFor({ preferences: selected })).points[8].forecast, true);
});

test('Umsatzpunkte verbinden Ist-Werte mit markierten Forecastmonaten und negative Werte bleiben erhalten', async t => {
  const { module, temp } = await loadChartSeries();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const { getForecastRevenuePoints } = module;
  const actual = [
    { key: '2026-01', label: 'Januar 2026', shortLabel: 'Jan', value: 875 },
    { key: '2026-02', label: 'Februar 2026', shortLabel: 'Feb', value: 900 },
  ];
  const forecast = forecastFor({ monthly: [
    { month: '2026-01', revenue: 1000, forecast: false },
    { month: '2026-02', revenue: -250, forecast: true },
  ] });
  const points = getForecastRevenuePoints(forecast, actual);
  assert.equal(points[0].value, 875);
  assert.equal(points[0].forecast, false);
  assert.equal(points[1].value, -250);
  assert.equal(points[1].forecast, true);
});

test('Forecast-Tooltips unterscheiden Schätzungen in vergangenen Sozialbeitragsmonaten von Ist-Zahlungen', async t => {
  const { module, temp } = await loadChartSeries();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const { DEFAULT_DASHBOARD_PREFERENCES } = await import('../../.test-dist/utils/dashboardPreferences.js');
  const { REVENUE_CHART_SERIES } = module;
  const definition = id => REVENUE_CHART_SERIES.find(series => series.id === id);
  const context = contextFor({ preferences: { ...DEFAULT_DASHBOARD_PREFERENCES, year: 2026, showPrivateLevies: true, showSocialContributions: true } });
  const overlay = definition('social-contributions').build(context);
  assert.equal(overlay.points[0].forecast, false);
  assert.match(overlay.tooltip, /keine bestätigten Zahlungen/);
  assert.match(overlay.tooltip, /Unverbindliche Schätzung/);
});

test('USt-Reihe wird ohne Regelbesteuerung weder gebaut noch heimlich von Verfügbar abgezogen', async t => {
  const { module, temp } = await loadChartSeries();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const context = contextFor({ forecast: forecastFor({ vatStatus: 'small_business' }), preferences: { ...DEFAULT_DASHBOARD_PREFERENCES, showAvailable: true, showVatReserve: true } });
  const vat = module.REVENUE_CHART_SERIES.find(series => series.id === 'vat-reserve');
  assert.match(vat.unavailableReason(context), /Regelbesteuerung/);
  assert.equal(vat.build(context), null);
  assert.equal(module.REVENUE_CHART_SERIES.find(series => series.id === 'available').build(context).points[0].value, 1000);
});

test('Finanzdiagramm kann die EÜR-Istbasis nutzen und stimmt mit der Verfügbar-Reihe überein', async t => {
  const { module, temp } = await loadChartSeries();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const context = contextFor({ preferences: { ...DEFAULT_DASHBOARD_PREFERENCES, showAvailable: true } });
  const revenue = module.getForecastRevenuePoints(context.forecast, [], 'de-DE');
  const available = module.REVENUE_CHART_SERIES.find(series => series.id === 'available').build(context);
  assert.equal(revenue[0].value, available.points[0].value);
  assert.equal(revenue[0].forecast, false, 'erfasste EÜR-Einnahmen bleiben Ist');
  assert.equal(revenue[8].forecast, true);
});
