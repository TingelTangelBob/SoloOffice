import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(String(key), String(value)); }
  removeItem(key) { this.#values.delete(String(key)); }
  clear() { this.#values.clear(); }
}

async function loadDemoApi() {
  const base = path.resolve('.test-dist');
  await mkdir(base, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(base, 'demo-job-invoices-'));
  const bundle = await rolldown({
    input: path.resolve('src/services/demoApi.ts'), platform: 'browser',
    plugins: [{
      name: 'demo-job-invoices-env',
      transform(code) {
        return code.replaceAll('import.meta.env', "({ VITE_API_URL: '/api', VITE_DEMO_MODE: 'true', DEV: false, PROD: true })");
      },
    }],
  });
  const output = path.join(temporaryDirectory, 'demo-job-invoices.mjs');
  await bundle.write({ file: output, format: 'esm' });
  await bundle.close();
  return { module: await import(pathToFileURL(output).href), temporaryDirectory };
}

const storageKey = 'solooffice-demo-data-v1';
const readState = () => JSON.parse(globalThis.localStorage.getItem(storageKey));
const writeState = state => globalThis.localStorage.setItem(storageKey, JSON.stringify(state));
const post = body => ({ method: 'POST', body: JSON.stringify(body) });
const put = body => ({ method: 'PUT', body: JSON.stringify(body) });

test('Demo-Auftragseinheiten werden einmalig und ohne Netzwerk zur Rechnung', async t => {
  const originalGlobals = Object.fromEntries(['localStorage', 'sessionStorage', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  let networkRequests = 0;
  globalThis.fetch = () => {
    networkRequests += 1;
    throw new Error('Der Demo-Auftragsablauf darf keine Netzwerkanfrage auslösen.');
  };
  t.after(() => {
    for (const [key, descriptor] of Object.entries(originalGlobals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const { module: api, temporaryDirectory } = await loadDemoApi();
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  api.resetDemoWorkspaceData({ companyProfile: true, takeover: true });
  const state = readState();
  state.customers = [
    { id: 'customer-1', name: 'Auftragskunde' },
    { id: 'customer-2', name: 'Anderer Kunde' },
  ];
  state.jobs = [
    { id: 'job-1', customerId: 'customer-1', jobNumber: 'AU-2026-001', externalJobNumber: 'EXT-001',
      title: 'Montage', description: 'Montage der Unterverteilung', date: '2026-10-19', status: 'completed' },
    { id: 'job-2', customerId: 'customer-1', jobNumber: 'AU-2026-002',
      title: 'Material', description: 'Klemmen und Kabel', date: '2026-10-20', status: 'completed', recurrence: { id: 'series-1', occurrenceIndex: 2 } },
    { id: 'job-3', customerId: 'customer-1', jobNumber: 'AU-2026-003',
      title: 'Noch offen', description: 'Offene Arbeit', date: '2026-10-20', status: 'draft' },
    { id: 'job-4', customerId: 'customer-2', jobNumber: 'AU-2026-004',
      title: 'Fremder Kunde', description: 'Arbeit für einen anderen Kunden', date: '2026-10-20', status: 'completed' },
    { id: 'job-5', customerId: 'customer-1', jobNumber: 'AU-2026-005',
      title: 'Weitere Arbeit', description: 'Zusätzliche Montage', date: '2026-10-20', status: 'completed' },
  ];
  writeState(state);
  const payload = {
    sourceJobIds: ['job-1', 'job-2'], issueDate: '2026-10-20', dueDate: '2026-11-03',
    items: [
      { description: 'Montage', quantity: 2.5, unitPrice: 75, taxRate: 19, order: 0 },
      { description: 'Klemmen und Kabel', quantity: 3, unitPrice: 12.40, taxRate: 19, order: 1 },
    ],
    subtotal: 999, taxAmount: 999, total: 999,
  };
  const createInvoice = changes => api.demoRequest('/invoices/from-jobs', post({ ...payload, ...changes }));

  await t.test('Ungültige Auswahl wird ohne Datenänderung abgewiesen', async () => {
    const cases = [
      [[], /Mindestens eine eindeutige Auftragseinheit/],
      [['job-1', 'job-1'], /Mindestens eine eindeutige Auftragseinheit/],
      [['missing'], /nicht gefunden/],
      [['job-1', 'job-3'], /Nur abgeschlossene Auftragseinheiten/],
      [['job-1', 'job-4'], /zum selben Kunden/],
    ];
    for (const [sourceJobIds, expected] of cases) {
      const before = readState();
      await assert.rejects(createInvoice({ sourceJobIds }), expected);
      assert.deepEqual(readState(), before, `Abgewiesene Auswahl ${sourceJobIds} bleibt unverändert`);
    }
  });

  let invoice;
  await t.test('Abgeschlossene Einheiten erzeugen eine verknüpfte Rechnung mit neu berechneten Summen', async () => {
    invoice = await createInvoice();
    assert.equal(invoice.status, 'draft');
    assert.equal(invoice.documentType, 'invoice');
    assert.equal(invoice.customerId, 'customer-1');
    assert.equal(invoice.customerName, 'Auftragskunde');
    assert.equal(invoice.issueDate, '2026-10-20');
    assert.equal(invoice.dueDate, '2026-11-03');
    assert.equal(invoice.subtotal, 224.70);
    assert.equal(invoice.taxAmount, 42.69);
    assert.equal(invoice.total, 267.39);
    assert.deepEqual(invoice.sourceJobIds, ['job-1', 'job-2']);
    assert.deepEqual(invoice.sourceJobs.map(source => ({
      jobId: source.jobId, jobNumber: source.jobNumber, title: source.title, jobDate: source.jobDate,
    })), [
      { jobId: 'job-1', jobNumber: 'AU-2026-001', title: 'Montage', jobDate: '2026-10-19' },
      { jobId: 'job-2', jobNumber: 'AU-2026-002', title: 'Material', jobDate: '2026-10-20' },
    ]);
    assert.equal(invoice.sourceJobs[0].externalJobNumber, 'EXT-001');
    assert.equal(invoice.sourceJobs[1].recurrenceIndex, 2);
    assert.equal(invoice.documentSnapshot.customer.id, 'customer-1');
    const saved = readState();
    assert.equal(saved.invoices.length, 1);
    assert.equal(saved.invoices[0].id, invoice.id);
    assert.deepEqual(saved.jobs.map(job => job.status), ['invoiced', 'invoiced', 'draft', 'completed', 'completed']);
    assert.ok(saved.jobs[0].updatedAt);
    assert.ok(saved.jobs[1].updatedAt);
    assert.equal(saved.euerEntries.length, 0, 'Ein Rechnungsentwurf ist noch keine Zahlung');
  });

  await t.test('Unmittelbare Wiederholung und Teilüberschneidung erzeugen keine zweite Rechnung', async () => {
    const before = readState();
    await assert.rejects(createInvoice(), /Nur abgeschlossene Auftragseinheiten/);
    assert.deepEqual(readState(), before);
    await assert.rejects(createInvoice({ sourceJobIds: ['job-1', 'job-5'] }), /Nur abgeschlossene Auftragseinheiten/);
    assert.deepEqual(readState(), before);
  });

  await t.test('Gespeicherter Rechnungsbezug verhindert Doppelabrechnung auch nach erneutem Abschließen', async () => {
    await api.demoRequest('/jobs/job-1', put({ status: 'completed' }));
    await api.demoRequest('/jobs/job-2', put({ status: 'completed' }));
    const before = readState();
    await assert.rejects(createInvoice(), /bereits abgerechnet/);
    assert.deepEqual(readState(), before);
    await assert.rejects(createInvoice({ sourceJobIds: ['job-1', 'job-5'] }), /bereits abgerechnet/);
    assert.deepEqual(readState(), before);
    assert.equal(readState().invoices.length, 1);
    await api.demoRequest('/jobs/job-1', put({ status: 'invoiced' }));
    await api.demoRequest('/jobs/job-2', put({ status: 'invoiced' }));
  });

  await t.test('Löschen des Entwurfs gibt Einheiten für genau eine neue Rechnung frei', async () => {
    await api.demoRequest(`/invoices/${invoice.id}`, { method: 'DELETE' });
    assert.equal(readState().invoices.length, 0);
    assert.equal(readState().jobs.find(job => job.id === 'job-1').status, 'completed');
    assert.equal(readState().jobs.find(job => job.id === 'job-2').status, 'completed');
    const replacement = await createInvoice();
    assert.notEqual(replacement.id, invoice.id);
    assert.equal(replacement.total, 267.39);
    assert.equal(readState().invoices.length, 1);
    const before = readState();
    await assert.rejects(createInvoice());
    assert.deepEqual(readState(), before);
  });

  assert.equal(networkRequests, 0);
});
