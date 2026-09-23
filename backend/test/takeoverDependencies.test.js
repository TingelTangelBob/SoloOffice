import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidTakeoverOrder, planTakeoverDependencies } from '../utils/takeoverDependencies.js';

const baseContext = overrides => ({ customers: [], invoices: [], jobs: [], quotes: [], euerEntries: [], ...overrides });

test('Auftrag ohne bekannten Kunden erzeugt nur eine vorgeschaltete Kundenvorschlagskategorie', () => {
  const result = planTakeoverDependencies([{
    resource: 'jobs', rows: [{ _rowNumber: 2, date: '2026-09-01', title: 'Mathe', customerName: 'Mia' }],
  }], baseContext());
  assert.deepEqual(result.proposedCustomers.map(customer => customer.name), ['Mia']);
  assert.deepEqual(result.nodes.find(node => node.id === 'jobs').dependencies, ['suggestedCustomers']);
  assert.equal(result.nodes[0].id, 'suggestedCustomers');
});

test('Auftrag ohne Kundenbezug wird mit konkretem Grund blockiert', () => {
  const result = planTakeoverDependencies([{
    resource: 'jobs', rows: [{ _rowNumber: 2, date: '2026-09-01', title: 'Mathe' }],
  }], baseContext());
  assert.match(result.nodes[0].blockedReason, /Bezug fehlt/);
  assert.equal(result.proposedCustomers.length, 0);
});

test('gleiche Schüler aus mehreren Folgezeilen werden dedupliziert', () => {
  const result = planTakeoverDependencies([{
    resource: 'jobs', rows: [
      { _rowNumber: 2, date: '2026-09-01', title: 'Mathe', customerName: 'Mia Muster' },
      { _rowNumber: 3, date: '2026-09-02', title: 'Deutsch', customerName: 'Mia Muster' },
    ],
  }], baseContext());
  assert.equal(result.proposedCustomers.length, 1);
  assert.deepEqual(result.proposedCustomers[0].rowNumbers, [2, 3]);
});

test('erkannte Kunden aus eigener Kategorie verhindern einen zweiten Vorschlag und werden Voraussetzung', () => {
  const result = planTakeoverDependencies([
    { resource: 'customers', rows: [{ _rowNumber: 2, name: 'Mia Muster' }] },
    { resource: 'jobs', rows: [{ _rowNumber: 3, date: '2026-09-01', title: 'Mathe', customerName: 'Mia Muster' }] },
  ], baseContext());
  assert.equal(result.proposedCustomers.length, 0);
  assert.deepEqual(result.nodes.find(node => node.id === 'jobs').dependencies, ['customers']);
});

test('unbekannte und mehrdeutige Rechnungsnummern blockieren Zahlungen', () => {
  const unknown = planTakeoverDependencies([{
    resource: 'invoicePayments', rows: [{ _rowNumber: 2, invoiceNumber: 'RE-9', entryDate: '2026-09-01', amount: 12 }],
  }], baseContext());
  assert.match(unknown.nodes[0].blockedReason, /weder im Workspace vorhanden/);

  const ambiguous = planTakeoverDependencies([{
    resource: 'invoicePayments', rows: [{ _rowNumber: 2, invoiceNumber: 'RE-1', entryDate: '2026-09-01', amount: 12 }],
  }], baseContext({ invoices: [
    { id: 'one', invoiceNumber: 'RE-1', status: 'sent', total: 12 },
    { id: 'two', invoiceNumber: 'RE-1', status: 'sent', total: 12 },
  ] }));
  assert.match(ambiguous.nodes[0].blockedReason, /mehrdeutig/);
});

test('übersprungene optionale Rechnungskategorie blockiert davon abhängige Zahlung', () => {
  const result = planTakeoverDependencies([
    { resource: 'invoices', rows: [{ _rowNumber: 2, invoiceNumber: 'RE-2', issueDate: '2026-08-01', customerName: 'Mia', total: 12 }] },
    { resource: 'invoicePayments', rows: [{ _rowNumber: 3, invoiceNumber: 'RE-2', entryDate: '2026-09-01', amount: 12 }] },
  ], baseContext(), ['invoices']);
  assert.match(result.nodes.find(node => node.id === 'invoicePayments').blockedReason, /übersprungen/);
});

test('Zahlung kann von einer genau einmal vorgeschlagenen Rechnung abhängen', () => {
  const result = planTakeoverDependencies([
    { resource: 'invoices', rows: [{ _rowNumber: 2, invoiceNumber: 'RE-3', issueDate: '2026-08-01', customerName: 'Mia', total: 12 }] },
    { resource: 'invoicePayments', rows: [{ _rowNumber: 3, invoiceNumber: 'RE-3', entryDate: '2026-09-01', amount: 12 }] },
  ], baseContext());
  const payment = result.nodes.find(node => node.id === 'invoicePayments');
  assert.deepEqual(payment.dependencies, ['invoices']);
  assert.equal(payment.blockedReason, null);
});

test('nur topologische Reihenfolgen werden akzeptiert; unabhängige Knoten sind frei', () => {
  const nodes = [
    { id: 'suggestedCustomers', dependencies: [] },
    { id: 'jobs', dependencies: ['suggestedCustomers'] },
    { id: 'materials', dependencies: [] },
  ];
  assert.equal(isValidTakeoverOrder(nodes, ['materials', 'suggestedCustomers', 'jobs']), true);
  assert.equal(isValidTakeoverOrder(nodes, ['jobs', 'suggestedCustomers', 'materials']), false);
});
