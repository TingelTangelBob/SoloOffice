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
  const temporaryDirectory = await mkdtemp(path.join(base, 'demo-recurring-invoice-'));
  const bundle = await rolldown({
    input: path.resolve('src/services/demoApi.ts'), platform: 'browser',
    plugins: [{
      name: 'demo-recurring-invoice-env',
      transform(code) {
        return code.replaceAll('import.meta.env', "({ VITE_API_URL: '/api', VITE_DEMO_MODE: 'true', DEV: false, PROD: true })");
      },
    }],
  });
  const output = path.join(temporaryDirectory, 'demo-recurring-invoice.mjs');
  await bundle.write({ file: output, format: 'esm' });
  await bundle.close();
  return { module: await import(pathToFileURL(output).href), temporaryDirectory };
}

test('Demo erzeugt wiederkehrende Rechnungen mit einem Zahlungsziel von null Tagen', async t => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Der Demo-Test darf keine Netzwerkanfrage auslösen.'); };
  t.after(() => { globalThis.fetch = originalFetch; });

  const { module: api, temporaryDirectory } = await loadDemoApi();
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  api.resetDemoWorkspaceData({ companyProfile: true, takeover: true });

  const storageKey = 'solooffice-demo-data-v1';
  const state = JSON.parse(globalThis.localStorage.getItem(storageKey));
  state.customers = [{ id: 'customer-1', name: 'Demokunde' }];
  globalThis.localStorage.setItem(storageKey, JSON.stringify(state));

  const scheduledDate = '2026-10-20';
  const recurring = await api.demoRequest('/recurring-invoices', {
    method: 'POST',
    body: JSON.stringify({
      customerId: 'customer-1', name: 'Sofort fällige Rechnung',
      frequency: 'monthly', intervalValue: 1, intervalUnit: 'month',
      startDate: scheduledDate, nextRunDate: scheduledDate, dueDays: 0, status: 'active',
      items: [{ description: 'Leistung', quantity: 1, unitPrice: 100, taxRate: 19 }],
    }),
  });
  assert.equal(recurring.dueDays, 0);

  const invoice = await api.demoRequest(`/recurring-invoices/${recurring.id}/generate`, {
    method: 'POST', body: JSON.stringify({ scheduledDate }),
  });
  assert.equal(invoice.issueDate, scheduledDate);
  assert.equal(invoice.dueDate, scheduledDate, 'Null Tage bedeuten Fälligkeit am Rechnungsdatum');
});
