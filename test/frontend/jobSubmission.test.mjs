import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

async function load(t, input) {
  const base = path.resolve('.test-dist');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'job-submission-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bundle = await rolldown({ input: path.resolve(input), platform: 'browser', plugins: [{ name: 'demo-env',
    transform: code => code.replaceAll('import.meta.env', "({ VITE_API_URL: '/api', VITE_DEMO_MODE: 'true', DEV: false, PROD: true })"),
  }] });
  const output = path.join(directory, 'module.mjs');
  await bundle.write({ file: output, format: 'esm' });
  await bundle.close();
  return import(pathToFileURL(output).href);
}

test('Sofortiger Mehrfachklick und wechselnde Speicheraktionen lösen nur eine Speicherung aus', async t => {
  const { createSubmitGuard } = await load(t, 'src/utils/submitGuard.ts');
  const pendingStates = [];
  const guard = createSubmitGuard(value => pendingStates.push(value));
  let complete;
  let writes = 0;
  const first = guard.run(async () => { writes += 1; await new Promise(resolve => { complete = resolve; }); });
  await Promise.all([guard.run(async () => { writes += 1; }), guard.run(async () => { writes += 1; })]);
  assert.equal(writes, 1);
  assert.deepEqual(pendingStates, [true]);
  complete();
  await first;
  assert.deepEqual(pendingStates, [true, false]);
  await assert.rejects(guard.run(async () => { throw new Error('Speichern fehlgeschlagen'); }), /fehlgeschlagen/);
  await guard.run(async () => { writes += 1; });
  assert.equal(writes, 2, 'Nach Fehler oder Erfolg kann erneut gespeichert werden');
  assert.deepEqual(pendingStates, [true, false, true, false, true, false]);
});

test('Auftrags-Pflichtfehler nennen die Felder und markieren das erste ungültige Eingabefeld', async () => {
  const source = await readFile(path.resolve('src/components/JobEntryForm.tsx'), 'utf8');
  assert.match(source, /Bitte ergänzen Sie folgende Pflichtfelder:/);
  assert.match(source, /aria-invalid=\{Boolean\(formError && !formData\.title\.trim\(\)\)\}/);
  assert.match(source, /aria-invalid=\{Boolean\(formError && !formData\.customerId\)\}/);
  assert.match(source, /aria-invalid=\{Boolean\(formError && !formData\.description\.trim\(\)\)\}/);
  assert.match(source, /missingFields\[0\]\.ref\.current\?\.focus\(\)/);
});

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

test('Demo erlaubt Inhaltsänderungen mit unveränderter Serie und schützt abgeschlossene Einheiten', async t => {
  const originals = Object.fromEntries(['localStorage', 'sessionStorage', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  globalThis.fetch = () => { throw new Error('Keine Netzwerkanfragen in der Demo'); };
  t.after(() => { for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  } });
  const api = await load(t, 'src/services/demoApi.ts');
  api.resetDemoWorkspaceData({ companyProfile: true, takeover: true });
  const key = 'solooffice-demo-data-v1';
  const read = () => JSON.parse(localStorage.getItem(key));
  const state = read();
  const rule = { intervalUnit: 'week', interval: 1, startDate: '2026-10-19', duration: 3, weekdays: [1], id: 'series-1', totalOccurrences: 3 };
  state.jobs = ['completed', 'in-progress', 'draft'].map((status, index) => ({ id: `job-${index + 1}`, customerId: 'customer-1', title: 'Kurs', description: 'Termin', status,
    date: ['2026-10-19', '2026-10-26', '2026-11-02'][index], recurrence: { ...rule, occurrenceIndex: index + 1 } }));
  localStorage.setItem(key, JSON.stringify(state));
  const update = data => api.demoRequest('/jobs/job-2', { method: 'PUT', body: JSON.stringify(data) });
  const before = read();
  const updated = await update({ description: 'Neue Beschreibung', recurrence: { ...rule, duration: undefined, durationWeeks: 3, weekdays: [1, 1] } });
  assert.equal(updated.description, 'Neue Beschreibung');
  assert.deepEqual(updated.recurrence, before.jobs[1].recurrence, 'Serienmetadaten bleiben erhalten');
  assert.deepEqual(read().jobs.map(job => ({ id: job.id, date: job.date, status: job.status })), before.jobs.map(job => ({ id: job.id, date: job.date, status: job.status })));
  assert.deepEqual(read().jobs[0], before.jobs[0]);
  const saved = read();
  for (const recurrence of [{ ...rule, duration: 4 }, null]) {
    await assert.rejects(update({ description: 'Nicht speichern', recurrence }), /abgeschlossene oder abgerechnete/);
    assert.deepEqual(read(), saved);
  }
});
