import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { rolldown } from 'rolldown';

class MemoryStorage {
  #values = new Map();

  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(String(key), String(value)); }
  removeItem(key) { this.#values.delete(String(key)); }
  clear() { this.#values.clear(); }
}

async function loadDemoApi() {
  const testOutputDirectory = path.resolve('.test-dist');
  await mkdir(testOutputDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(testOutputDirectory, 'demo-workspace-reset-'));
  const bundle = await rolldown({
    input: path.resolve('src/services/demoApi.ts'),
    platform: 'browser',
    plugins: [{
      name: 'solooffice-demo-test-env',
      transform(code) {
        return code.replaceAll('import.meta.env', "({ VITE_API_URL: '/api', VITE_DEMO_MODE: 'true', DEV: false, PROD: true })");
      },
    }],
  });
  const outputFile = path.join(temporaryDirectory, 'demoApi-reset.mjs');
  await bundle.write({ file: outputFile, format: 'esm' });
  await bundle.close();
  return { module: await import(`${pathToFileURL(outputFile).href}?reset-test=${Date.now()}`), temporaryDirectory };
}

function readDemoState() {
  return JSON.parse(globalThis.localStorage.getItem('solooffice-demo-data-v1'));
}

function writeDemoState(state) {
  globalThis.localStorage.setItem('solooffice-demo-data-v1', JSON.stringify(state));
}

function seedTakeoverStorage() {
  globalThis.sessionStorage.setItem('solooffice-demo-takeover-v1:demo-workspace', JSON.stringify({ id: 'session-1', status: 'open' }));
  globalThis.sessionStorage.setItem('solooffice-demo-takeover-v1:demo-workspace:categories', JSON.stringify({ invoices: { status: 'completed' } }));
}

test('Demo-Workspace-Reset setzt Daten und Umzugs-Sitzung passend zum gewählten Umfang zurück', async t => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  const { module: demoApi, temporaryDirectory } = await loadDemoApi();
  t.after(async () => { await rm(temporaryDirectory, { recursive: true, force: true }); });

  // Ausgangszustand anlegen und den Reset ohne Optionen prüfen.
  demoApi.resetDemoWorkspaceData();
  let state = readDemoState();
  state.customers = [{ id: 'customer-1', name: 'Wird gelöscht' }];
  state.company.importCutoverDate = '2026-10-01';
  state.importRuns = [{ id: 'run-1', status: 'pending' }];
  writeDemoState(state);
  seedTakeoverStorage();

  demoApi.resetDemoWorkspaceData({ companyProfile: true, takeover: true });
  state = readDemoState();
  assert.deepEqual(state.customers, [], 'Fachdaten werden geleert');
  assert.deepEqual(state.importRuns, [], 'Importläufe werden geleert');
  assert.equal(state.company.name, 'Demo Workspace');
  assert.equal(state.company.importCutoverDate, null);
  assert.equal(state.company.invoiceStartNumber, 1);
  assert.ok(state.hourlyRates.some(rate => rate.name === 'Standard'), 'der Standard-Stundensatz bleibt im neutralen Demo-Start');
  assert.ok(state.materialTemplates.length > 0, 'der neutrale Demo-Start enthält Materialvorlagen');
  assert.ok(!state.materialTemplates.some(template => template.name === 'Eigene Vorlage'), 'eigene Materialvorlagen sind im neutralen Demo-Start entfernt');
  assert.equal(globalThis.sessionStorage.getItem('solooffice-demo-takeover-v1:demo-workspace'), null);
  assert.equal(globalThis.sessionStorage.getItem('solooffice-demo-takeover-v1:demo-workspace:categories'), null);

  // Firmendaten, Vorlagen, Nummernkreise und der Firmenname bleiben erhalten;
  // der Umzugsstatus einschließlich Stichtag wird mit takeover=true neu gesetzt.
  state = readDemoState();
  state.company = { ...state.company, name: 'Eigene Firma', invoiceStartNumber: 77, importCutoverDate: '2026-09-30' };
  state.hourlyRates = [{ id: 'rate-own', name: 'Eigener Satz', rate: 123 }];
  state.materialTemplates = [{ id: 'material-own', name: 'Eigene Vorlage', unitPrice: 9 }];
  state.yearlyInvoiceStartNumbers = [{ id: '2026', year: 2026, start_number: 42 }];
  state.workspaceSetup = { ...state.workspaceSetup, migrationChoice: 'takeover', completedAt: '2026-10-01' };
  writeDemoState(state);
  seedTakeoverStorage();

  demoApi.resetDemoWorkspaceData({ companyProfile: false, takeover: true });
  state = readDemoState();
  assert.equal(state.company.name, 'Eigene Firma');
  assert.equal(state.company.invoiceStartNumber, 77);
  assert.equal(state.company.importCutoverDate, null, 'der Stichtag gehört zum Umzugsstatus');
  assert.deepEqual(state.hourlyRates, [{ id: 'rate-own', name: 'Eigener Satz', rate: 123 }]);
  assert.deepEqual(state.materialTemplates, [{ id: 'material-own', name: 'Eigene Vorlage', unitPrice: 9 }]);
  assert.deepEqual(state.yearlyInvoiceStartNumbers, [{ id: '2026', year: 2026, start_number: 42 }]);
  assert.equal(state.workspaceSetup.migrationChoice, 'undecided');
  assert.equal(globalThis.sessionStorage.getItem('solooffice-demo-takeover-v1:demo-workspace'), null);

  // Firmendaten zurücksetzen, den Umzugsstatus aber behalten: Firmenfelder
  // gehen auf den Startwert, Stichtag, Sitzung und Auswahl bleiben erhalten.
  state = readDemoState();
  state.company.importCutoverDate = '2026-11-15';
  state.workspaceSetup = { ...state.workspaceSetup, migrationChoice: 'no_legacy_data', completedAt: '2026-11-16' };
  writeDemoState(state);
  seedTakeoverStorage();

  demoApi.resetDemoWorkspaceData({ companyProfile: true, takeover: false });
  state = readDemoState();
  assert.equal(state.company.name, 'Demo Workspace');
  assert.equal(state.company.invoiceStartNumber, 1);
  assert.equal(state.company.importCutoverDate, '2026-11-15');
  assert.equal(state.workspaceSetup.migrationChoice, 'no_legacy_data');
  assert.equal(state.workspaceSetup.completedAt, null, 'Ersteinrichtung wird bei Firmendaten-Reset neu geöffnet');
  assert.ok(globalThis.sessionStorage.getItem('solooffice-demo-takeover-v1:demo-workspace'));
  assert.ok(globalThis.sessionStorage.getItem('solooffice-demo-takeover-v1:demo-workspace:categories'));
});
