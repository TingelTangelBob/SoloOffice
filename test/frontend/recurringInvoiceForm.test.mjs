import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../../src/components/RecurringInvoiceManagement.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(entry) {
  const states = [];
  const effects = [];
  const saved = [];
  let cursor = 0;
  let mounted = false;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useEffect(callback) { if (!mounted) effects.push(callback); },
    useMemo: callback => callback(),
  };
  const modules = {
    react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' },
    '../context/CustomerContext': { useCustomers: () => ({ customers: [{ id: 'customer-1', name: 'Testkunde' }] }) },
    '../context/CompanyContext': { useCompany: () => ({ company: {} }) },
    '../context/FeedbackContext': { useFeedback: () => ({ confirm: async () => true }) },
    '../utils/terminology': { getTerminology: () => ({ entity: { singular: 'Kunde' } }) },
    '../utils/formatters': { formatCurrency: String, formatDate: String },
    '../services/api': { apiService: {
      getRecurringInvoices: async () => [entry],
      updateRecurringInvoice: async (id, payload) => {
        // Exercise the serialization used by the real API client.
        saved.push({ id, payload: JSON.parse(JSON.stringify(payload)) });
        return { ...entry, ...payload };
      },
    } },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: name => modules[name] || new Proxy({}, { get: (_, name) => name }),
  }, { filename: 'RecurringInvoiceManagement.js' });
  return {
    saved,
    render() {
      cursor = 0;
      const result = exports.RecurringInvoiceManagement();
      mounted = true;
      return result;
    },
    async load() {
      this.render();
      effects.forEach(effect => effect());
      await setImmediate();
      return this.render();
    },
  };
}

function find(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => find(child, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...find(tree.props?.children, predicate)];
}

test('Vorlage bearbeiten und speichern erhält 0% MwSt. und ein Zahlungsziel von null Tagen', async () => {
  const entry = {
    id: 'template-1', customerId: 'customer-1', name: 'Wartung', frequency: 'monthly', intervalUnit: 'month', intervalValue: 1,
    startDate: '2026-10-20', nextRunDate: '2026-10-20', endDate: '2026-12-31', dueDays: 0, status: 'active',
    items: [{ description: 'Leistung', quantity: 1, unitPrice: 100, taxRate: 0 }],
  };
  const state = fixture(entry);
  let tree = await state.load();
  find(tree, node => node.type === 'button' && node.props.children?.includes('Bearbeiten'))[0].props.onClick();
  tree = state.render();
  await find(tree, node => node.type === 'DialogShell')[0].props.onSubmit({ preventDefault() {} });
  assert.equal(state.saved.length, 1);
  assert.equal(state.saved[0].payload.dueDays, 0);
  assert.equal(state.saved[0].payload.items[0].taxRate, 0);
  assert.equal(state.saved[0].payload.endDate, '2026-12-31');
});

test('Enddatum im Formular leeren sendet nach JSON-Serialisierung explizit null', async () => {
  const state = fixture({
    id: 'template-1', customerId: 'customer-1', name: 'Wartung', frequency: 'monthly', intervalUnit: 'month', intervalValue: 1,
    startDate: '2026-10-20', nextRunDate: '2026-10-20', endDate: '2026-12-31', dueDays: 14, status: 'active',
    items: [{ description: 'Leistung', quantity: 1, unitPrice: 100, taxRate: 19 }],
  });
  let tree = await state.load();
  find(tree, node => node.type === 'button' && node.props.children?.includes('Bearbeiten'))[0].props.onClick();
  tree = state.render();
  find(tree, node => node.type === 'input' && node.props.type === 'date' && node.props.value === '2026-12-31')[0]
    .props.onChange({ target: { value: '' } });
  tree = state.render();
  await find(tree, node => node.type === 'DialogShell')[0].props.onSubmit({ preventDefault() {} });
  assert.equal(state.saved.length, 1);
  assert.ok(Object.hasOwn(state.saved[0].payload, 'endDate'));
  assert.equal(state.saved[0].payload.endDate, null);
});
