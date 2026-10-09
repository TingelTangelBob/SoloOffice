import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

async function loadDisplay() {
  const temp = await mkdtemp(path.join('/tmp', 'solooffice-tax-display-'));
  const bundle = await rolldown({ input: path.resolve('src/utils/taxDashboardDisplay.ts'), platform: 'browser' });
  const output = path.join(temp, 'taxDashboardDisplay.mjs');
  await bundle.write({ file: output, format: 'esm' });
  await bundle.close();
  return { module: await import(pathToFileURL(output).href), temp };
}

test('§35-Summen übernehmen die Einkommensteuer nach Anrechnung und ziehen den Credit nicht erneut ab', async t => {
  const { module, temp } = await loadDisplay();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const result = module.taxBreakdown({ incomeTax: 4200, solidarity: 0, churchTax: 0, tradeTax: 3000, tradeCredit: 800 });
  assert.equal(result.total, 7200);
  assert.equal(result.tradeTax, 3000);
  assert.equal(result.tradeCredit, 800);
});

test('Monatsvergleich zeigt Fixkosten des gewählten Monats gegen den Vergleichsmonat', async t => {
  const { module, temp } = await loadDisplay();
  t.after(() => rm(temp, { recursive: true, force: true }));
  assert.deepEqual(module.fixedCostMonthlyComparison({ fixedCosts: 245 }, { fixedCosts: 180 }), {
    current: 245, comparison: 180, difference: 65,
  });
});

test('Nullreserve bei positivem Nenner ergibt eine berechenbare Quote von null', async t => {
  const { module, temp } = await loadDisplay();
  t.after(() => rm(temp, { recursive: true, force: true }));
  assert.deepEqual(module.reserveRatioDisplay(12000, 0), { ratio: 0, denominator: 12000 });
  assert.equal(module.reserveRatioDisplay(0, 500).ratio, null);
});

test('bekannter Nullumsatz im Vorjahr bleibt von einem unbekannten Vorjahreswert unterscheidbar', async t => {
  const { module, temp } = await loadDisplay();
  t.after(() => rm(temp, { recursive: true, force: true }));
  assert.equal(module.previousRevenueDisplay(0, true), 0);
  assert.equal(module.previousRevenueDisplay(0, false), null);
});

test('Ampelstatus wird deutsch angezeigt', async t => {
  const { module, temp } = await loadDisplay();
  t.after(() => rm(temp, { recursive: true, force: true }));
  assert.equal(module.germanThresholdStatus('green'), 'Im Richtwert');
  assert.equal(module.germanThresholdStatus('yellow'), 'Nahe am Richtwert');
  assert.equal(module.germanThresholdStatus('red'), 'Oberhalb des Richtwerts');
});

test('Schwellenanzeige liefert nächste Grenze, Abstand und offenes letztes Band', async t => {
  const { module, temp } = await loadDisplay();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const result = module.thresholdDistance({ value: 75, bands: [
    { id: 'low', label: 'Niedrig', from: 0, to: 100, tone: 'success' },
    { id: 'open', label: 'Offen', from: 100, to: null, tone: 'warning' },
  ] });
  assert.equal(result.nextBoundary, 100);
  assert.equal(result.distance, 25);
  const above = module.thresholdDistance({ value: 125, bands: [{ id: 'open', label: 'Offen', from: 100, to: null, tone: 'warning' }] });
  assert.equal(above.aboveLastBoundary, true);
  assert.equal(above.distance, null);
});

test('virtuelle Vorauszahlungstermine sind keine überfälligen Bescheide', async t => {
  const { module, temp } = await loadDisplay();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const common = { dueDate: '2026-03-10', paidOn: null };
  assert.equal(module.isRecordedAdvanceOverdue({ ...common, id: 'forecast:est_vz:2026-03' }, '2026-10-09'), false);
  assert.equal(module.isRecordedAdvanceOverdue({ ...common, id: 'stored-notice' }, '2026-10-09'), true);
  assert.equal(module.isRecordedAdvanceOverdue({ ...common, id: 'paid-notice', paidOn: '2026-03-10' }, '2026-10-09'), false);
});
