import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TAKEOVER_CATEGORY_ORDER,
  isValidTakeoverOrder,
  planTakeoverDependencies,
  takeoverOrderConflict,
} from '../utils/takeoverDependencies.js';

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

test('abgelehnte Reihenfolge nennt die fehlende Voraussetzung mit Namen', () => {
  const nodes = [
    { id: 'customers', label: 'Kunden', dependencies: [] },
    { id: 'invoices', label: 'Rechnungen', dependencies: ['customers'] },
  ];
  assert.equal(takeoverOrderConflict(nodes, ['customers', 'invoices']), null);
  assert.equal(takeoverOrderConflict(nodes, ['invoices', 'customers']), '„Rechnungen“ braucht „Kunden“ davor.');
  assert.match(takeoverOrderConflict(nodes, ['invoices']), /nicht alle Kategorien/);
});

test('Kategorien werden fachlich sortiert, auch wenn die Erkennung sie anders liefert', () => {
  const result = planTakeoverDependencies([
    { resource: 'euerEntries', rows: [{ _rowNumber: 2, entryDate: '2026-09-01', entryType: 'income', description: 'Kurs', amount: 30 }] },
    { resource: 'invoices', rows: [{ _rowNumber: 3, invoiceNumber: 'RE-5', issueDate: '2026-08-01', customerName: 'Mia Muster', total: 12 }] },
    { resource: 'materials', rows: [{ _rowNumber: 4, name: 'Arbeitsheft', unitPrice: 12.9 }] },
    { resource: 'customers', rows: [{ _rowNumber: 5, name: 'Mia Muster' }] },
  ], baseContext());

  assert.deepEqual(result.nodes.map(node => node.id), ['customers', 'materials', 'invoices', 'euerEntries']);
});

test('Rechnungen in derselben Datei sind Voraussetzung für Zahlungen und Geldbuchungen', () => {
  const result = planTakeoverDependencies([
    { resource: 'invoicePayments', rows: [{ _rowNumber: 2, invoiceNumber: 'RE-7', entryDate: '2026-09-02', amount: 12 }] },
    { resource: 'euerEntries', rows: [{ _rowNumber: 3, entryDate: '2026-09-01', entryType: 'income', description: 'Kurs', amount: 30 }] },
    { resource: 'invoices', rows: [{ _rowNumber: 4, invoiceNumber: 'RE-7', issueDate: '2026-08-01', customerName: 'Mia', total: 12 }] },
  ], baseContext({ customers: [{ id: 'existing', name: 'Mia' }] }));

  assert.deepEqual(result.nodes.map(node => node.id), ['invoices', 'invoicePayments', 'euerEntries']);
  assert.ok(result.nodes.find(node => node.id === 'euerEntries').dependencies.includes('invoices'));
  assert.ok(result.nodes.find(node => node.id === 'invoicePayments').dependencies.includes('invoices'));
});

test('eine mitgelieferte Kundenliste ist Voraussetzung aller kundenbezogenen Kategorien', () => {
  const result = planTakeoverDependencies([
    { resource: 'invoices', rows: [{ _rowNumber: 2, invoiceNumber: 'RE-8', issueDate: '2026-08-01', customerName: 'Mia Muster', total: 12 }] },
    { resource: 'customers', rows: [{ _rowNumber: 3, name: 'Mia Muster' }] },
  ], baseContext({ customers: [{ id: 'existing', name: 'Mia Muster' }] }));

  assert.deepEqual(result.nodes.map(node => node.id), ['customers', 'invoices']);
  assert.deepEqual(result.nodes.find(node => node.id === 'invoices').dependencies, ['customers']);
});

test('vorgeschlagene Kunden folgen der mitgelieferten Kundenliste', () => {
  const result = planTakeoverDependencies([
    { resource: 'customers', rows: [{ _rowNumber: 2, name: 'Mia Muster' }] },
    { resource: 'jobs', rows: [{ _rowNumber: 3, date: '2026-09-01', title: 'Mathe', customerName: 'Tom Neu' }] },
  ], baseContext());

  assert.deepEqual(result.nodes.map(node => node.id), ['customers', 'suggestedCustomers', 'jobs']);
  assert.deepEqual(result.nodes.find(node => node.id === 'suggestedCustomers').dependencies, ['customers']);
  assert.equal(isValidTakeoverOrder(result.nodes, ['suggestedCustomers', 'customers', 'jobs']), false);
});

test('die fachliche Grundreihenfolge deckt alle Importkategorien ab', () => {
  assert.deepEqual([...TAKEOVER_CATEGORY_ORDER].sort(), [
    'customers', 'euerEntries', 'hourlyRates', 'invoicePayments', 'invoices',
    'jobs', 'materials', 'positions', 'quotes',
  ]);
  assert.equal(TAKEOVER_CATEGORY_ORDER[0], 'customers');
  assert.ok(TAKEOVER_CATEGORY_ORDER.indexOf('invoices') > TAKEOVER_CATEGORY_ORDER.indexOf('materials'));
  assert.ok(TAKEOVER_CATEGORY_ORDER.indexOf('invoicePayments') > TAKEOVER_CATEGORY_ORDER.indexOf('invoices'));
});

test('alle Kategorien folgen dem Ablauf Stammdaten, Rechnungen, Geld und Arbeit', () => {
  const resources = ['quotes', 'jobs', 'euerEntries', 'invoicePayments', 'invoices', 'positions', 'materials', 'hourlyRates', 'customers'];
  const result = planTakeoverDependencies(resources.map(resource => ({ resource, rows: [] })), baseContext());
  assert.deepEqual(result.nodes.map(node => node.id), [
    'customers', 'hourlyRates', 'materials', 'positions', 'invoices', 'invoicePayments', 'euerEntries', 'jobs', 'quotes',
  ]);
});

test('eine unbekannte Kategorie kann keine echte Kategorie in der Reihenfolge ersetzen', () => {
  assert.equal(isValidTakeoverOrder([
    { id: 'customers', dependencies: [] }, { id: 'materials', dependencies: [] },
  ], ['customers', 'unknown']), false);
});

test('Zahlungen bleiben nach der Übernahme der Rechnung aus derselben Datei freigegeben', () => {
  const result = planTakeoverDependencies([
    { resource: 'invoices', rows: [{ invoiceNumber: 'ALT-1', issueDate: '2026-08-01', customerName: 'Mia', total: 12 }] },
    { resource: 'invoicePayments', rows: [{ invoiceNumber: 'ALT-1', entryDate: '2026-09-01', amount: 12 }] },
  ], baseContext({
    customers: [{ id: 'mia', name: 'Mia' }],
    invoices: [{ id: 'invoice', invoiceNumber: 'ALT-1', status: 'sent', total: 12 }],
  }));
  assert.equal(result.nodes.find(node => node.id === 'invoicePayments').blockedReason, null);
});

test('mehrere Positionszeilen sind eine geplante Rechnung für die Zahlungszuordnung', () => {
  const result = planTakeoverDependencies([
    { resource: 'invoices', rows: [
      { invoiceNumber: 'ALT-2', issueDate: '2026-08-01', customerName: 'Mia', itemDescription: 'A', itemQuantity: 1, itemUnitPrice: 5 },
      { invoiceNumber: 'ALT-2', issueDate: '2026-08-01', customerName: 'Mia', itemDescription: 'B', itemQuantity: 1, itemUnitPrice: 7 },
    ] },
    { resource: 'invoicePayments', rows: [{ invoiceNumber: 'ALT-2', entryDate: '2026-09-01', amount: 12 }] },
  ], baseContext({ customers: [{ id: 'mia', name: 'Mia' }] }));
  const payment = result.nodes.find(node => node.id === 'invoicePayments');
  assert.equal(payment.blockedReason, null);
  assert.deepEqual(payment.dependencies, ['invoices']);
});
