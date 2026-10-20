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

async function bundle(input, directory, plugins = []) {
  const build = await rolldown({ input: path.resolve(input), platform: 'browser', plugins: [{
    name: 'test-env', transform: code => code.replaceAll('import.meta.env', "({ VITE_API_URL: '/api', VITE_DEMO_MODE: 'true', DEV: false, PROD: true })"),
  }, ...plugins] });
  const output = path.join(directory, `${path.basename(input)}.mjs`);
  await build.write({ file: output, format: 'esm', codeSplitting: false });
  await build.close();
  return import(pathToFileURL(output).href);
}

test('EÜR verlangt für als bezahlt markierte Altfälle eine echte Zahlung und deren Datum', async t => {
  await mkdir('.test-dist', { recursive: true });
  const directory = await mkdtemp(path.resolve('.test-dist/euer-legacy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  const demo = await bundle('src/services/demoApi.ts', directory);
  demo.resetDemoWorkspaceData({ companyProfile: true, takeover: true });
  const storageKey = 'solooffice-demo-data-v1';
  const year = new Date().getFullYear();
  const state = JSON.parse(localStorage.getItem(storageKey));
  const invoice = (id, number) => ({ id, invoiceNumber: number, issueDate: `${year}-01-15`, dueDate: `${year}-02-15`, status: 'paid', documentType: 'invoice', subtotal: 100, taxAmount: 19, total: 119 });
  state.invoices = [invoice('legacy', 'RE-ALT'), invoice('partial', 'RE-TEILZAHLUNG'), invoice('prior-year', 'RE-VORJAHR'), { ...invoice('credit', 'GS-ALT'), documentType: 'credit_note', total: -119 }];
  state.euerEntries = [
    { id: 'voided', sourceId: 'legacy', entryType: 'income', sourceType: 'invoice_payment', category: 'other_income', amount: 119, entryDate: `${year}-01-20`, status: 'voided', description: 'Stornierte Zahlung' },
    { id: 'prior-payment', sourceId: 'prior-year', entryType: 'income', sourceType: 'invoice_payment', category: 'other_income', amount: 119, entryDate: `${year - 1}-12-31`, status: 'active', description: 'Zahlung im Vorjahr' },
    { id: 'partial-payment', sourceId: 'partial', entryType: 'income', sourceType: 'invoice_payment', category: 'other_income', amount: 19, entryDate: `${year - 1}-12-31`, status: 'active', description: 'Teilzahlung im Vorjahr' },
  ];
  localStorage.setItem(storageKey, JSON.stringify(state));
  const persisted = () => JSON.parse(localStorage.getItem(storageKey));
  globalThis.__euerLegacyFixture = {
    entries: state.euerEntries,
    invoices: state.invoices.filter(item => item.documentType !== 'credit_note'),
    creditNotes: state.invoices.filter(item => item.documentType === 'credit_note'),
    api: { createEuerEntry: payload => demo.demoRequest('/euer-entries', { method: 'POST', body: JSON.stringify(payload) }) },
  };
  globalThis.__euerHookState = [];
  globalThis.__euerHookIndex = 0;
  t.after(() => { delete globalThis.__euerLegacyFixture; delete globalThis.__euerHookState; delete globalThis.__euerHookIndex; });

  // Derselbe Berechnungs- und Speicherpfad des Components, ohne DOM oder Browser.
  // Nur die JSX-Ausgabe wird gegen die überprüfbaren Werte und Aktionen ersetzt.
  const { EuerManagement } = await bundle('src/components/EuerManagement.tsx', directory, [{
    name: 'euer-component-state-harness',
    resolveId(source, importer) {
      if (!importer?.endsWith('/components/EuerManagement.tsx')) return;
      if (source === 'react' || source.startsWith('../context/') || source === '../services/api' || source === '../hooks/useElementWidth') return `\0euer-mock:${source}`;
    },
    load(id) {
      if (!id.startsWith('\0euer-mock:')) return;
      const source = id.slice('\0euer-mock:'.length);
      if (source === 'react') return `export function useState(initial) { const i = globalThis.__euerHookIndex++; const state = globalThis.__euerHookState; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; } export const useMemo = fn => fn(); export const useCallback = fn => fn; export function useRef(initial) { return { current: initial }; } export function useEffect() {}`;
      if (source.endsWith('CompanyContext')) return `export const useCompany = () => ({ company: { locale: 'de-DE', numberFormat: 'european', currency: 'EUR', isSmallBusiness: true } });`;
      if (source.endsWith('CustomerContext')) return `export const useCustomers = () => ({ customers: [] });`;
      if (source.endsWith('InvoiceContext')) return `export const useInvoices = () => ({ invoices: globalThis.__euerLegacyFixture.invoices, refreshInvoices: async () => {} });`;
      if (source.endsWith('AuthContext')) return `export const useAuth = () => ({ workspace: { id: 'demo-workspace' }, can: () => true });`;
      if (source.endsWith('FeedbackContext')) return `export const useFeedback = () => ({ confirm: async () => true });`;
      if (source === '../services/api') return `export const apiService = globalThis.__euerLegacyFixture.api;`;
      if (source === '../hooks/useElementWidth') return `export const useElementWidth = () => ({ ref: {}, width: 1200 });`;
    },
    transform(code, id) {
      if (!id.endsWith('/components/EuerManagement.tsx')) return;
      const mainReturn = code.indexOf('  return <div className="page-root');
      assert.ok(mainReturn > 0);
      return code.slice(0, mainReturn)
        .replace('useState<EuerEntry[]>([])', 'useState<EuerEntry[]>(globalThis.__euerLegacyFixture.entries)')
        .replace('useState<CreditNote[]>([])', 'useState<CreditNote[]>(globalThis.__euerLegacyFixture.creditNotes)')
        + '  return { rows, summary, monthly, legacyPaidInvoices, legacyPaidCreditNotes, paymentTotals, openPayment, draft, setDraft, submit, notice };\n}';
    },
  }]);
  const render = () => { globalThis.__euerHookIndex = 0; return EuerManagement({}); };

  let view = render();
  assert.equal(view.summary.income, 0, 'Bezahlt-Status und Storno erzeugen keine Einnahme');
  assert.equal(view.summary.count, 0);
  assert.ok(view.monthly.every(month => month.income === 0));
  assert.deepEqual(view.rows, []);
  assert.deepEqual(view.legacyPaidInvoices.map(item => item.id), ['legacy', 'partial'], 'Nur eine vollständige aktive Zahlung aus einem anderen Jahr klärt den Altfall');
  assert.equal(view.legacyPaidCreditNotes.length, 1);
  assert.equal(view.paymentTotals.get('prior-year'), 119);

  const { TaxOverview } = await bundle('src/components/TaxOverview.tsx', directory, [{
    name: 'tax-overview-state-harness',
    resolveId(source, importer) {
      if (!importer?.endsWith('/components/TaxOverview.tsx')) return;
      if (source === 'react' || source.startsWith('../context/') || source === '../hooks/useForecast' || source === '../hooks/useExtensions') return `\0tax-mock:${source}`;
    },
    load(id) {
      if (!id.startsWith('\0tax-mock:')) return;
      const source = id.slice('\0tax-mock:'.length);
      if (source === 'react') return `export const useState = initial => [typeof initial === 'function' ? initial() : initial, () => {}]; export const useMemo = fn => fn(); export function useEffect() {}`;
      if (source.endsWith('CompanyContext')) return `export const useCompany = () => ({ company: {} });`;
      if (source.endsWith('InvoiceContext')) return `export const useInvoices = () => ({ invoices: globalThis.__euerLegacyFixture.invoices });`;
      if (source.endsWith('AuthContext')) return `export const useAuth = () => ({ workspace: { id: 'demo-workspace' }, can: () => true });`;
      if (source.endsWith('useExtensions')) return `export const useExtensions = () => ({ isEnabled: () => false });`;
      if (source.endsWith('useForecast')) return `export const useForecast = () => ({});`;
    },
    transform(code, id) {
      if (!id.endsWith('/components/TaxOverview.tsx')) return;
      const end = code.indexOf('  const forecastContent =');
      assert.ok(end > 0);
      return code.slice(0, end).replace("({ key: '', creditNotes: [], euerEntries: [] })", '({ key: sourceDataKey, creditNotes: globalThis.__euerLegacyFixture.creditNotes, euerEntries: globalThis.__euerLegacyFixture.entries })')
        + '  return paidInvoiceSummary;\n}';
    },
  }]);
  const taxSummary = TaxOverview({ onNavigate() {} });
  assert.equal(taxSummary.missingPaymentCount, 2, 'Steuerübersicht zählt fehlende und zu niedrige Zahlungen');
  assert.equal(taxSummary.income, 0, 'Rechnungszahlungen bleiben im tatsächlichen Zahlungsjahr');
  assert.equal(taxSummary.count, 0);
  globalThis.__euerLegacyFixture.entries = state.euerEntries;

  view.openPayment('legacy');
  view = render();
  assert.equal(view.draft.sourceId, 'legacy');
  assert.equal(view.draft.amount, '119', 'Stornierte Zahlungen verbrauchen keinen verfügbaren Betrag');
  assert.equal(view.draft.entryDate, '', 'Das tatsächliche Datum muss bewusst angegeben werden');
  await view.submit({ preventDefault() {} });
  assert.equal(persisted().euerEntries.filter(entry => entry.sourceId === 'legacy' && entry.status === 'active').length, 0, 'Kein Speichern ohne Zahlungsdatum');

  const paymentDate = `${year}-03-05`;
  view.setDraft(current => ({ ...current, entryDate: paymentDate }));
  view = render();
  await view.submit({ preventDefault() {} });
  view = render();
  assert.deepEqual(view.legacyPaidInvoices.map(item => item.id), ['partial']);
  assert.equal(view.summary.income, 119);
  assert.equal(view.rows.length, 1, 'Der Status erzeugt keine zweite Einnahme zusätzlich zur Zahlung');
  assert.equal(view.rows[0].entryDate, paymentDate);
  assert.equal(view.monthly[0].income, 0, 'Der Rechnungsmonat bleibt ohne tatsächliche Zahlung leer');
  assert.equal(view.monthly[2].income, 119);
  const activePayments = persisted().euerEntries.filter(entry => entry.sourceId === 'legacy' && entry.status === 'active');
  assert.equal(activePayments.length, 1);
  assert.equal(activePayments[0].entryDate, paymentDate);
  assert.equal(persisted().invoices.find(item => item.id === 'legacy').status, 'paid');
  await assert.rejects(demo.demoRequest('/euer-entries', { method: 'POST', body: JSON.stringify({ ...view.draft, amount: 119, entryDate: paymentDate, sourceType: 'invoice_payment', sourceId: 'legacy' }) }), /überschreitet/);

  view.openPayment('partial');
  view = render();
  assert.equal(view.draft.amount, '100', 'Bei einer zu niedrigen Teilzahlung wird genau der Rest angeboten');
  assert.equal(view.draft.entryDate, '', 'Auch der Rest braucht sein tatsächliches Zahlungsdatum');
  view.setDraft(current => ({ ...current, entryDate: `${year}-04-06` }));
  view = render();
  await view.submit({ preventDefault() {} });
  view = render();
  assert.equal(view.legacyPaidInvoices.length, 0);
  assert.equal(view.summary.income, 219, 'Die Vorjahres-Teilzahlung wird beim Restnachtrag nicht ein zweites Mal angesetzt');
  assert.equal(view.monthly[3].income, 100);
  assert.deepEqual(persisted().euerEntries.filter(entry => entry.sourceId === 'partial' && entry.status === 'active').map(entry => entry.amount), [19, 100]);
});
