import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(String(key), String(value)); }
  removeItem(key) { this.#values.delete(String(key)); }
}

async function bundleModule(input, directory, plugins = []) {
  const bundle = await rolldown({ input: path.resolve(input), platform: 'browser', plugins: [{
    name: 'euer-history-env',
    transform: code => code.replaceAll('import.meta.env', "({ VITE_API_URL: '/api', VITE_DEMO_MODE: 'true', DEV: false, PROD: true })"),
  }, ...plugins] });
  const output = path.join(directory, `${path.basename(input)}.mjs`);
  await bundle.write({ file: output, format: 'esm' });
  await bundle.close();
  return import(pathToFileURL(output).href);
}

test('Stornierte EÜR-Nachweise bleiben erreichbar und aus aktiven Berechnungen ausgeschlossen', async t => {
  await mkdir('.test-dist', { recursive: true });
  const directory = await mkdtemp(path.resolve('.test-dist/euer-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  const demo = await bundleModule('src/services/demoApi.ts', directory);
  const { getEuerHistoryChanges, isActiveEuerEntry } = await bundleModule('src/utils/euerHistory.ts', directory);
  const storageKey = 'solooffice-demo-data-v1';
  demo.resetDemoWorkspaceData({ companyProfile: true, takeover: true });
  const state = JSON.parse(localStorage.getItem(storageKey));
  state.euerEntries = [
    { id: 'active', entryType: 'income', description: 'Einnahme', amount: 119, entryDate: '2026-10-01', status: 'active', sourceType: 'manual', category: 'other_income' },
    { id: 'voided', entryType: 'expense', description: 'Stornierte Ausgabe', amount: 59.5, entryDate: '2026-10-02', status: 'voided', sourceType: 'manual', category: 'office' },
    { id: 'shifted', entryType: 'expense', description: 'USt-Vorauszahlung', amount: 200, entryDate: '2027-01-08', euerYear: 2026, status: 'active', sourceType: 'vat_payment', category: 'other_expense' },
  ];
  state.euerEntryHistory = [{ id: 'void-history', euerEntryId: 'voided', action: 'voided', oldData: state.euerEntries[1], newData: null, changedAt: '2026-10-03T10:00:00Z' }];
  localStorage.setItem(storageKey, JSON.stringify(state));

  await t.test('Demo-Listenfilter, EÜR-Jahr und unveränderlicher Stornoverlauf', async () => {
    const active = await demo.demoRequest('/euer-entries?year=2026');
    assert.deepEqual(active.map(entry => entry.id), ['shifted', 'active']);
    const all = await demo.demoRequest('/euer-entries?year=2026&includeVoided=true');
    assert.deepEqual(all.map(entry => entry.id), ['shifted', 'voided', 'active']);
    assert.deepEqual(all.filter(isActiveEuerEntry), active);
    assert.equal(all.filter(isActiveEuerEntry).reduce((sum, entry) => sum + (entry.entryType === 'income' ? entry.amount : -entry.amount), 0), -81);
    assert.equal((await demo.demoRequest('/euer-entries?year=2027&includeVoided=true')).length, 0);
    assert.equal((await demo.demoRequest('/euer-entries?year=2026&includeVoided=false')).length, 2);
    assert.equal((await demo.demoRequest('/euer-entries/voided/history'))[0].action, 'voided');
    await assert.rejects(demo.demoRequest('/euer-entries/voided', { method: 'PUT', body: JSON.stringify({ description: 'Geändert' }) }), /stornierte Buchung/);
    await assert.rejects(demo.demoRequest('/euer-entries/voided', { method: 'DELETE' }), /bereits storniert/);
    assert.equal(JSON.parse(localStorage.getItem(storageKey)).euerEntries[1].description, 'Stornierte Ausgabe');
    await assert.rejects(demo.demoRequest('/euer-entries?year=ungueltig'), /Ungültiges Jahr/);
  });

  const formatters = {
    amount: value => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value),
    date: value => value.slice(0, 10).split('-').reverse().join('.'),
    number: value => new Intl.NumberFormat('de-DE').format(value),
    categories: { office: 'Bürobedarf', software: 'Software und Lizenzen' },
    customers: new Map([['kunde', 'Musterkunde']]),
  };
  await t.test('Produktive snake_case-Historie zeigt nur fachliche Änderungen mit Vorher/Nachher', () => {
    const changes = getEuerHistoryChanges({ action: 'updated', oldData: {
      amount: '119.00', tax_rate: '19.00', entry_date: '2026-10-01', category: 'office',
      status: 'active', notes: 'active', updated_at: 'vorher', customer_id: null,
    }, newData: {
      amount: '238.00', tax_rate: 19, entry_date: '2026-10-02', category: 'software',
      status: 'active', notes: 'active', updated_at: 'nachher', customer_id: 'kunde',
    } }, formatters);
    assert.deepEqual(changes.map(change => change.label), ['Zahlungsdatum', 'Kategorie', 'Bruttobetrag', 'Kunde']);
    assert.deepEqual(changes.find(change => change.key === 'amount'), { key: 'amount', label: 'Bruttobetrag', before: '119,00 €', after: '238,00 €' });
    assert.equal(changes.find(change => change.key === 'entryDate').after, '02.10.2026');
    assert.equal(changes.find(change => change.key === 'customerId').after, 'Musterkunde');
  });
  await t.test('Demo-camelCase, leere Werte und Storno ohne Nachher-Snapshot bleiben lesbar', () => {
    const created = getEuerHistoryChanges({ action: 'created', newData: { entryType: 'expense', taxRate: 7, vatAmount: 0, inputTaxDeductible: false, notes: 'active', status: 'active', sourceType: 'manual' } }, formatters);
    assert.equal(created.find(change => change.key === 'entryType').after, 'Ausgabe');
    assert.equal(created.find(change => change.key === 'taxRate').after, '7 %');
    assert.equal(created.find(change => change.key === 'inputTaxDeductible').after, 'Nein');
    assert.equal(created.find(change => change.key === 'vatAmount').after, '0,00 €');
    assert.equal(created.find(change => change.key === 'notes').after, 'active');
    const voided = getEuerHistoryChanges({ action: 'voided', oldData: { description: 'Beleg', status: 'active', amount: 119 }, newData: null }, formatters);
    assert.deepEqual(voided, [{ key: 'status', label: 'Status', before: 'Aktiv', after: 'Storniert' }]);
  });

  await t.test('Backend-GET erweitert die Statusauswahl nur bei ausdrücklichem includeVoided=true', async () => {
    const { default: router } = await bundleModule('backend/routes/euerEntries.js', directory, [{
      name: 'euer-route-mocks',
      resolveId(source) {
        if (source === 'express') return '\0express-mock';
        if (source === '../database.js') return '\0database-mock';
      },
      load(id) {
        if (id === '\0express-mock') return `export default { Router: () => ({ routes: {}, get(path, handler) { this.routes[path] = handler; }, post() {}, put() {}, delete() {} }) };`;
        if (id === '\0database-mock') return `export const pool = {}; export async function query(sql, params) { globalThis.__euerQuery = { sql, params }; return { rows: [] }; }`;
      },
    }]);
    const result = { json() {}, status() { return this; } };
    const next = error => { throw error; };
    await router.routes['/']({ query: { year: '2026' } }, result, next);
    assert.match(globalThis.__euerQuery.sql, /status = 'active'/);
    assert.deepEqual(globalThis.__euerQuery.params, [2026]);
    await router.routes['/']({ query: { year: '2026', includeVoided: 'true' } }, result, next);
    assert.match(globalThis.__euerQuery.sql, /status IN \('active', 'voided'\)/);
    assert.match(globalThis.__euerQuery.sql, /COALESCE\(euer_year/);
    await router.routes['/']({ query: { includeVoided: 'false' } }, result, next);
    assert.match(globalThis.__euerQuery.sql, /status = 'active'/);
    delete globalThis.__euerQuery;
  });
});
