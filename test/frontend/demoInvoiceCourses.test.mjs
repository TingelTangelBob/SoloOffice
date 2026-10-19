import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
  const temporaryDirectory = await mkdtemp(path.join(base, 'demo-invoice-courses-'));
  const bundle = await rolldown({ input: path.resolve('src/services/demoApi.ts'), platform: 'browser', plugins: [{
    name: 'demo-env', transform(code) {
      return code.replaceAll('import.meta.env', "({ VITE_API_URL: '/api', VITE_DEMO_MODE: 'true', DEV: false, PROD: true })");
    },
  }] });
  const output = path.join(temporaryDirectory, 'demo-invoice-courses.mjs');
  await bundle.write({ file: output, format: 'esm' });
  await bundle.close();
  return { module: await import(pathToFileURL(output).href), temporaryDirectory };
}

const storageKey = 'solooffice-demo-data-v1';
const state = () => JSON.parse(globalThis.localStorage.getItem(storageKey));
const post = body => ({ method: 'POST', body: JSON.stringify(body) });

test('Demo-Kursnachschritt bleibt einschließlich Rechnungsimport vollständig rücknehmbar', async t => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  const { module: api, temporaryDirectory } = await loadDemoApi();
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  async function fixture() {
    api.setDemoActiveWorkspaceId('demo-workspace');
    api.resetDemoWorkspaceData({ companyProfile: true, takeover: true });
    const original = state();
    const customerId = randomUUID();
    const existingJobId = randomUUID();
    original.customers = [{ id: customerId, name: 'Kurskunde', customerNumber: 'C-1' }];
    original.jobs = [{ id: existingJobId, jobNumber: 'AB-2025-001', customerId, title: 'Bestehender Kurs',
      description: 'Bestehender Kurs', date: '2025-03-04', hoursWorked: 1, hourlyRate: 50,
      status: 'completed', invoiceId: null, materials: [], timeEntries: [] }];
    globalThis.localStorage.setItem(storageKey, JSON.stringify(original));
    const rows = ['Bestehender Kurs', 'Neuer Kurs'].map((title, index) => ({
      invoiceNumber: `ALT-${index + 1}`, issueDate: '2025-03-04', customerId, customerName: 'Kurskunde',
      taxRate: 0, itemDescription: title, courseName: title, itemQuantity: 1, itemUnitPrice: 50, itemUnit: 'Stunde',
    }));
    const imported = await api.demoRequest('/imports/invoices', post({ rows, dryRun: false, createInvoiceCourses: false }));
    assert.equal(imported.summary.imported, 2);
    return { imported, existingJobId };
  }

  await t.test('protokolliert Neu/Zuordnung und nimmt beide Stufen in umgekehrter Reihenfolge zurück', async () => {
    const { imported, existingJobId } = await fixture();
    const preview = await api.demoRequest('/imports/invoice-courses', post({ dryRun: true }));
    assert.equal(preview.runId, null);
    assert.deepEqual(preview.summary, { invoices: 2, created: 1, assigned: 1 });
    const courses = await api.demoRequest('/imports/invoice-courses', post({ dryRun: false }));
    assert.ok(courses.runId);
    assert.equal(courses.summary.imported, 2);
    const run = await api.demoRequest(`/imports/runs/${courses.runId}`);
    assert.equal(run.resource, 'invoiceCourses');
    assert.equal(run.report.length, 2);
    assert.ok(run.report.every(row => row.status === 'imported' && row.values.title && row.values.date));
    assert.deepEqual(run.report.map(row => row.rowNumber), [1, 2]);
    const again = await api.demoRequest('/imports/invoice-courses', post({ dryRun: false }));
    assert.equal(again.runId, null);
    assert.equal(again.summary.imported, 0);
    await assert.rejects(api.demoRequest(`/imports/runs/${imported.runId}/revert`, post({})), /rückgängig/);

    api.setDemoActiveWorkspaceId('foreign-workspace');
    api.resetDemoWorkspaceData({ companyProfile: true, takeover: true });
    await assert.rejects(api.demoRequest(`/imports/runs/${courses.runId}/revert`, post({})), /nicht gefunden/);
    api.setDemoActiveWorkspaceId('demo-workspace');
    await api.demoRequest(`/imports/runs/${courses.runId}/revert`, post({}));
    assert.equal(state().invoices.length, 2);
    assert.ok(state().invoices.every(invoice => invoice.jobSources.length === 0));
    assert.equal(state().jobs.length, 1);
    assert.equal(state().jobs[0].id, existingJobId);
    assert.equal(state().jobs[0].status, 'completed');
    assert.equal(state().jobs[0].invoiceId, null);
    await api.demoRequest(`/imports/runs/${imported.runId}/revert`, post({}));
    assert.equal(state().invoices.length, 0);
    assert.equal(state().jobs.length, 1);
  });

  await t.test('schützt nachträglich bearbeitete Kurse vor dem Entfernen', async () => {
    await fixture();
    const courses = await api.demoRequest('/imports/invoice-courses', post({ dryRun: false }));
    const edited = state();
    const createdJob = edited.jobs.find(job => job.title === 'Neuer Kurs');
    createdJob.title = 'Nachträglich geändert';
    globalThis.localStorage.setItem(storageKey, JSON.stringify(edited));
    await assert.rejects(api.demoRequest(`/imports/runs/${courses.runId}/revert`, post({})), /verändert/);
    assert.equal(state().jobs.find(job => job.id === createdJob.id).title, 'Nachträglich geändert');
    assert.ok(state().invoices.every(invoice => invoice.jobSources.length === 1));
  });

  await t.test('Umzugsabschluss finalisiert auch den separaten Kurslauf', async () => {
    await fixture();
    const sessionId = randomUUID();
    globalThis.sessionStorage.setItem('solooffice-demo-takeover-v1:demo-workspace', JSON.stringify({
      id: sessionId, status: 'open', legacyBackfill: false, startedAt: new Date().toISOString(), progressRevision: 1,
    }));
    const courses = await api.demoRequest('/imports/invoice-courses', post({ dryRun: false }));
    const run = await api.demoRequest(`/imports/runs/${courses.runId}`);
    assert.equal(run.migrationSessionId, sessionId);
    await api.demoRequest(`/takeover/${sessionId}/complete`, post({}));
    const completed = await api.demoRequest(`/imports/runs/${courses.runId}`);
    assert.equal(completed.status, 'confirmed');
    await assert.rejects(api.demoRequest(`/imports/runs/${courses.runId}/revert`, post({})), /abgeschlossen/);
  });

  await t.test('ergänztes Material bleibt bei verweigerter Rücknahme erhalten', async () => {
    await fixture();
    const courses = await api.demoRequest('/imports/invoice-courses', post({ dryRun: false }));
    const edited = state();
    const createdJob = edited.jobs.find(job => job.title === 'Neuer Kurs');
    createdJob.materials = [{ id: 'material-1', name: 'Nachträglich erfasst', quantity: 1, unitPrice: 12 }];
    globalThis.localStorage.setItem(storageKey, JSON.stringify(edited));
    await assert.rejects(api.demoRequest(`/imports/runs/${courses.runId}/revert`, post({})), /verändert|ergänzt/);
    assert.equal(state().jobs.find(job => job.id === createdJob.id).materials.length, 1);
    assert.ok(state().invoices.every(invoice => invoice.jobSources.length === 1));
  });
});
