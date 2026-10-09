import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

async function loadDashboardPeriod() {
  const base = path.resolve('.test-dist');
  await mkdir(base, { recursive: true });
  const temp = await mkdtemp(path.join(base, 'dashboard-period-'));
  const bundle = await rolldown({ input: path.resolve('src/utils/dashboardPeriod.ts'), platform: 'browser' });
  const output = path.join(temp, 'dashboardPeriod.mjs');
  await bundle.write({ file: output, format: 'esm' });
  await bundle.close();
  return { module: await import(pathToFileURL(output).href), temp };
}

test('Monatsfenster umfasst genau zwölf Monatsanfänge einschließlich Monatsende und Jahreswechsel', async t => {
  const { module, temp } = await loadDashboardPeriod();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const { createDashboardMonthKeys, toDashboardMonthKey } = module;
  assert.equal(toDashboardMonthKey(new Date(2026, 0, 31, 23, 59)), '2026-01');
  assert.equal(toDashboardMonthKey('2025-12-31'), '2025-12');
  assert.deepEqual(createDashboardMonthKeys(new Date(2026, 0, 31)), [
    '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07',
    '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01',
  ]);
});

test('veralteter gespeicherter Monat außerhalb der zwölf Monate wird auf den letzten abgeschlossenen Monat gesetzt', async t => {
  const { module, temp } = await loadDashboardPeriod();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const period = module.resolveDashboardPeriod({ monthView: true, month: '2024-10', compareMonth: '2024-09' }, new Date(2026, 0, 31));
  assert.equal(period.monthKeys.length, 12);
  assert.equal(period.selectedMonth, '2025-12');
  assert.equal(period.selectedYear, 2025);
  assert.equal(period.comparisonMonth, '2025-11');
  assert.equal(period.allYears, false);
});

test('Vergleichsmonat bleibt bei validem Monat über Jahresgrenzen erhalten und Filter nutzt den vollständigen Schlüssel', async t => {
  const { module, temp } = await loadDashboardPeriod();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const { resolveDashboardPeriod, filterDashboardPointsByMonth, sumDashboardRecordsByMonth } = module;
  const period = resolveDashboardPeriod({ monthView: true, month: '2026-01', compareMonth: '2025-03' }, new Date(2026, 0, 1));
  assert.equal(period.selectedMonth, '2026-01');
  assert.equal(period.comparisonMonth, '2025-03');
  assert.equal(period.selectedYear, 2026);
  assert.deepEqual(filterDashboardPointsByMonth([{ key: '2025-01' }, { key: '2026-01' }], '2026-01'), [{ key: '2026-01' }]);
  assert.equal(sumDashboardRecordsByMonth([
    { date: '2025-03-31', amount: 12 }, { date: '2025-04-01', amount: 99 },
  ], '2025-03', row => row.date, row => row.amount), 12);
});

test('Sliderwahl behält den manuell gewählten Vergleichsmonat bei und wechselt bei Kollision auf einen anderen Monat', async t => {
  const { module, temp } = await loadDashboardPeriod();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const { moveDashboardMonthSelection } = module;
  const keys = ['2025-11', '2025-12', '2026-01'];
  assert.deepEqual(moveDashboardMonthSelection(keys, '2026-01', '2025-11', '2025-12'), {
    selectedMonth: '2025-12', comparisonMonth: '2025-11',
  });
  assert.deepEqual(moveDashboardMonthSelection(keys, '2025-12', '2025-11', '2025-11'), {
    selectedMonth: '2025-11', comparisonMonth: '2025-12',
  });
});

test('Präferenz-Speicherwarteschlange schreibt bei verzögerten Antworten die letzte Wahl zuletzt', async t => {
  const { module, temp } = await loadDashboardPeriod();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const { enqueueDashboardPreferenceSave } = module;
  const saved = [];
  let finishFirst;
  const first = enqueueDashboardPreferenceSave(Promise.resolve(), () => new Promise(resolve => {
    finishFirst = () => { saved.push('Monat A'); resolve(); };
  }));
  const second = enqueueDashboardPreferenceSave(first.catch(() => undefined), async () => { saved.push('Monat B'); });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(saved, [], 'die zweite Anfrage wartet auf den ersten Schreibvorgang');
  finishFirst();
  await second;
  assert.deepEqual(saved, ['Monat A', 'Monat B']);
});

test('private Kacheln bleiben in Normal- und Bearbeiten-Ansicht verborgen, §19 und Fixkosten bleiben sichtbar', async t => {
  const { module, temp } = await loadDashboardPeriod();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const { isDashboardCardVisibleForPrivateView } = module;
  for (const mode of ['normal', 'edit']) {
    assert.equal(isDashboardCardVisibleForPrivateView('taxes', false, mode), false);
    assert.equal(isDashboardCardVisibleForPrivateView('tax-reserve', false, mode), false);
    assert.equal(isDashboardCardVisibleForPrivateView('tax-advances', false, mode), false);
    assert.equal(isDashboardCardVisibleForPrivateView('fixed-costs', false, mode), true);
    assert.equal(isDashboardCardVisibleForPrivateView('small-business', false, mode), true);
  }
  assert.equal(isDashboardCardVisibleForPrivateView('taxes', true), true);
});

test('gespeicherter Vergleich mit sich selbst fällt auf einen anderen Monat zurück', async t => {
  const { module, temp } = await loadDashboardPeriod();
  t.after(() => rm(temp, { recursive: true, force: true }));
  const period = module.resolveDashboardPeriod({ monthView: true, month: '2026-10', compareMonth: '2026-10' }, new Date(2026, 9, 9));
  assert.equal(period.comparisonMonth, '2026-09');
});


test('Monatsansicht startet ohne gespeicherte Wahl abgeschlossen; expliziter laufender Monat bleibt erhalten', async t => {
  const { module, temp } = await loadDashboardPeriod();
  t.after(() => rm(temp, { recursive: true, force: true }));
  assert.equal(module.resolveDashboardPeriod({ monthView: true }, new Date(2026, 9, 9)).selectedMonth, '2026-09');
  assert.equal(module.resolveDashboardPeriod({ monthView: true, month: '2026-10' }, new Date(2026, 9, 9)).selectedMonth, '2026-10');
});
