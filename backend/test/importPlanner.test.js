import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerDirectory, planImport, summariseImport } from '../utils/importPlanner.js';

const context = (overrides = {}) => ({
  entityLabel: 'Schüler',
  workLabel: 'Unterricht',
  today: '2026-09-22',
  customers: [],
  jobs: [],
  quotes: [],
  euerEntries: [],
  invoices: [],
  ...overrides,
});

// Die Beispieldaten aus der Nachhilfe-Tabelle: Datum, Schüler, Stunden, Preis pro Stunde.
const lessonRows = () => [
  { _rowNumber: 2, entryDate: '2021-09-15', customerName: 'Anna', quantity: 1, unitPrice: 5, entryType: 'income', taxRate: 0 },
  { _rowNumber: 3, entryDate: '2021-10-10', customerName: 'Anna', quantity: 1, unitPrice: 10, entryType: 'income', taxRate: 0 },
  { _rowNumber: 4, entryDate: '2021-10-21', customerName: 'Anna', quantity: 1, unitPrice: 10, entryType: 'income', taxRate: 0 },
  { _rowNumber: 5, entryDate: '2021-10-31', customerName: 'Anna', quantity: 1, unitPrice: 10, entryType: 'income', taxRate: 0 },
  { _rowNumber: 6, entryDate: '2021-11-11', customerName: 'Anna', quantity: 1, unitPrice: 10, entryType: 'income', taxRate: 0 },
];

test('Unterrichtsstunden werden als Einnahmen mit neuem Schüler und Monatssummen geplant', () => {
  const plan = planImport('euerEntries', lessonRows(), context(), { createMissingCustomers: true });
  const summary = summariseImport(plan, 5);
  assert.equal(summary.errors, 0);
  assert.equal(summary.valid, 5);
  assert.equal(plan.newCustomers.length, 1, 'Anna wird genau einmal angelegt');
  assert.equal(plan.newCustomers[0].name, 'Anna');
  assert.equal(plan.entries[0].status, 'valid', 'ein neu angelegter Schüler ist eine Information, keine Warnung');
  assert.match(plan.entries[0].message, /wird neu angelegt/);
  assert.ok(plan.entries.every(item => item.data.kind === 'manual' && item.data.entryType === 'income' && item.data.customerKey));
  assert.equal(plan.entries[0].data.amount, 5);
  assert.match(plan.entries[0].data.description, /Einnahme Anna \(1 × 5,00 €\)/);
  assert.deepEqual(plan.totals.byMonth.map(bucket => [bucket.month, bucket.income]), [['2021-09', 5], ['2021-10', 30], ['2021-11', 10]]);
  assert.equal(plan.totals.income, 45);
});

test('Ohne „Fehlende anlegen“ bleibt die Einnahme ohne Zuordnung, aber nicht fehlerhaft', () => {
  const plan = planImport('euerEntries', lessonRows().slice(0, 1), context(), {});
  assert.equal(plan.entries[0].status, 'warning');
  assert.match(plan.entries[0].message, /nicht gefunden – die Einnahme wird ohne Zuordnung gebucht/);
  assert.equal(plan.newCustomers.length, 0);
});

test('Einnahmen werden einer offenen Rechnung zugeordnet statt doppelt gezählt', () => {
  const customers = [{ id: 'c-anna', customerNumber: '1001', name: 'Anna Müller', email: '' }];
  const invoices = [{ id: 'i-1', invoiceNumber: 'RE-2021-001', customerId: 'c-anna', customerName: 'Anna Müller', issueDate: '2021-10-01', status: 'sent', total: 10, taxAmount: 0 }];
  const plan = planImport('euerEntries', lessonRows(), context({ customers, invoices }), {});
  const payment = plan.entries.find(item => item.data?.kind === 'payment');
  assert.equal(payment.rowNumbers[0], 3, 'die erste passende Einnahme nach dem Rechnungsdatum bezahlt die Rechnung');
  assert.equal(payment.data.invoiceId, 'i-1');
  assert.equal(payment.status, 'warning', 'automatische Zuordnung wird zur Prüfung markiert');
  assert.match(payment.message, /Namensteil|Kunde und Betrag/);
  assert.equal(plan.entries.filter(item => item.data?.kind === 'manual').length, 4);
  assert.equal(plan.totals.invoicePayments, 10);
  assert.equal(plan.totals.income, 35);
});

test('Erneuter Import derselben Datei erkennt jede Zeile als vorhanden', () => {
  const customers = [{ id: 'c-anna', customerNumber: '1001', name: 'Anna', email: '' }];
  const first = planImport('euerEntries', lessonRows(), context({ customers }), {});
  const imported = first.entries.map((item, index) => ({ id: `e-${index}`, sourceType: 'manual', status: 'active', ...item.data }));
  const second = planImport('euerEntries', lessonRows(), context({ customers, euerEntries: imported }), {});
  assert.ok(second.entries.every(item => item.status === 'duplicate'));
});

test('Gleiche Buchungen in der Datei werden gezählt und nur der fehlende Rest übernommen', () => {
  const row = { entryDate: '2025-01-05', description: 'Parken', amount: 3.5, entryType: 'expense', taxRate: 19 };
  const plan = planImport('euerEntries', [{ ...row, _rowNumber: 2 }, { ...row, _rowNumber: 3 }], context({
    euerEntries: [{ id: 'x', sourceType: 'manual', status: 'active', entryType: 'expense', entryDate: '2025-01-05', description: 'Parken', amount: 3.5 }],
  }), {});
  assert.deepEqual(plan.entries.map(item => item.status), ['duplicate', 'warning']);
});

test('Vorzeichen, Einnahmen-/Ausgabenspalten und fehlende Art', () => {
  const signed = planImport('euerEntries', [
    { _rowNumber: 2, entryDate: '2025-02-01', description: 'Kunde zahlt', amount: '120,00' },
    { _rowNumber: 3, entryDate: '2025-02-02', description: 'Druckerpapier', amount: '-19,99', category: 'Büromaterial', taxRate: 19 },
  ], context(), {});
  assert.deepEqual(signed.entries.map(item => [item.data.entryType, item.data.amount, item.data.category]), [['income', 120, 'other_income'], ['expense', 19.99, 'office']]);

  const columns = planImport('euerEntries', [
    { _rowNumber: 2, entryDate: '2025-02-01', description: 'Honorar', incomeAmount: '200' },
    { _rowNumber: 3, entryDate: '2025-02-02', description: 'Bahn', expenseAmount: '45,50', category: 'Fahrtkosten' },
  ], context(), {});
  assert.deepEqual(columns.entries.map(item => [item.data.entryType, item.data.amount, item.data.category]), [['income', 200, 'other_income'], ['expense', 45.5, 'travel']]);

  const unclear = planImport('euerEntries', [{ _rowNumber: 2, entryDate: '2025-02-01', description: 'Etwas', amount: '10' }], context(), {});
  assert.equal(unclear.entries[0].status, 'error');
  assert.match(unclear.entries[0].message, /Einnahme oder Ausgabe/);
});

test('Namensteile ordnen nur ganze Wörter und eindeutig zu', () => {
  const directory = createCustomerDirectory([
    { id: '1', name: 'Johanna Schmidt' },
    { id: '2', name: 'Anna Müller' },
    { id: '3', name: 'Paul Meier' },
    { id: '4', name: 'Paula Meier' },
  ]);
  assert.equal(directory.resolve({ customerName: 'Anna' }, 2).customer.id, '2');
  assert.equal(directory.resolve({ customerName: 'Mueller, Anna' }, 2).customer.id, '2', 'Reihenfolge und Umlautschreibweise spielen keine Rolle');
  assert.equal(directory.resolve({ customerName: 'Meier' }, 2).ambiguous, 2);
  assert.ok(directory.resolve({ customerName: 'Hanna' }, 2).notFound);
});

test('Kunden-Aktualisierung ändert nur zugeordnete Felder', () => {
  const customers = [{ id: 'c1', customerNumber: '1001', name: 'Anna Müller', email: 'anna@example.org', address: 'Weg 1', city: 'Köln', postalCode: '50667', phone: '' }];
  const plan = planImport('customers', [
    { _rowNumber: 2, customerNumber: '1001', name: 'Anna Müller', phone: '0221 123' },
    { _rowNumber: 3, customerNumber: '1001', name: 'Anna Müller' },
  ], context({ customers }), { duplicateMode: 'update' });
  assert.equal(plan.entries[0].status, 'update');
  assert.deepEqual(plan.entries[0].data, { phone: '0221 123' });
  assert.match(plan.entries[0].message, /Telefon/);
  assert.equal(plan.entries[1].status, 'duplicate', 'doppelte Zeile in der Datei');

  const unchanged = planImport('customers', [{ _rowNumber: 2, customerNumber: '1001', name: 'Anna Müller', email: 'anna@example.org' }], context({ customers }), { duplicateMode: 'update' });
  assert.equal(unchanged.entries[0].status, 'duplicate');
  assert.match(unchanged.entries[0].message, /bereits aktuell/);
});

test('Unterricht: Titel-Vorgabe, neue Schüler, Dublettenschutz und Serien', () => {
  const rows = [
    { _rowNumber: 2, date: '2021-09-15', customerName: 'Anna', hoursWorked: 1, hourlyRate: 5, status: 'abgerechnet' },
    { _rowNumber: 3, date: '2021-10-10', customerName: 'Anna', hoursWorked: 1, hourlyRate: 10, status: 'abgerechnet' },
  ];
  const plan = planImport('jobs', rows, context(), { createMissingCustomers: true });
  assert.ok(plan.entries.every(item => item.status === 'valid'), 'Titel-Vorgabe und neuer Schüler sind Informationen');
  assert.match(plan.entries[0].message, /Titel wird als „Unterricht“ übernommen/);
  assert.equal(plan.entries[0].data.title, 'Unterricht');
  assert.equal(plan.entries[0].data.status, 'invoiced');
  assert.equal(plan.newCustomers.length, 1);

  const existing = context({
    customers: [{ id: 'c-anna', name: 'Anna' }],
    jobs: [{ id: 'j1', customerId: 'c-anna', date: '2021-09-15', startTime: null, title: 'Unterricht' }],
  });
  const again = planImport('jobs', rows.map(row => ({ ...row, title: 'Unterricht' })), existing, {});
  assert.deepEqual(again.entries.map(item => item.status), ['duplicate', 'valid']);

  const series = planImport('jobs', [{ _rowNumber: 2, date: '2025-09-02', customerName: 'Anna', title: 'Mathe', startTime: '16:00', repeat: 'wöchentlich', repeatUntil: '30.09.2025', status: 'geplant' }], context({ customers: [{ id: 'c-anna', name: 'Anna' }] }), {});
  assert.equal(series.entries[0].status, 'valid');
  assert.deepEqual(series.entries[0].data.occurrenceDates, ['2025-09-02', '2025-09-09', '2025-09-16', '2025-09-23', '2025-09-30']);
  assert.match(series.entries[0].message, /Serie mit 5 Terminen/);

  const counted = planImport('jobs', [{ _rowNumber: 2, date: '2025-09-02', customerName: 'Anna', title: 'Mathe', repeat: '14-tägig', repeatCount: 3, status: 'geplant' }], context({ customers: [{ id: 'c-anna', name: 'Anna' }] }), {});
  assert.deepEqual(counted.entries[0].data.occurrenceDates, ['2025-09-02', '2025-09-16', '2025-09-30']);
});

test('Übernommene Rechnungen: Sammelposition, Zahlung, Teilzahlung und Prüfungen', () => {
  const customers = [{ id: 'c1', name: 'Anna Müller' }];
  const plan = planImport('invoices', [
    { _rowNumber: 2, invoiceNumber: '2024-17', issueDate: '2024-03-01', customerName: 'Anna Müller', total: '100,00', taxRate: 19, paidDate: '2024-03-10' },
    { _rowNumber: 3, invoiceNumber: '2024-18', issueDate: '2024-03-02', customerName: 'Anna Müller', total: '50', taxRate: 0, paidAmount: 20, paidDate: '2024-03-20' },
    { _rowNumber: 4, invoiceNumber: '2024-19', issueDate: '2024-03-03', customerName: 'Anna Müller', total: '30', status: 'bezahlt' },
    { _rowNumber: 5, invoiceNumber: 'RE-1', issueDate: '2024-03-04', customerName: 'Anna Müller', total: '10' },
    { _rowNumber: 6, invoiceNumber: '2024-20', issueDate: '2024-03-05', customerName: 'Anna Müller', netto: '100', taxRate: 19, total: '120' },
  ], context({ customers, invoices: [{ id: 'x', invoiceNumber: 'RE-1', total: 10, status: 'sent' }] }), {});
  const [paid, partial, paidWithoutDate, duplicate, mismatch] = plan.entries;
  assert.equal(paid.status, 'valid');
  assert.equal(paid.data.total, 100);
  assert.equal(paid.data.taxAmount, 15.97);
  assert.equal(paid.data.items[0].unitPrice, 84.03);
  assert.equal(paid.data.status, 'paid');
  assert.deepEqual(paid.data.payment, { entryDate: '2024-03-10', amount: 100, taxRate: 19 });
  assert.equal(partial.data.status, 'overdue');
  assert.equal(partial.data.payment.amount, 20);
  assert.match(partial.message, /Teilzahlung 20,00 €/);
  assert.equal(paidWithoutDate.status, 'warning');
  assert.equal(paidWithoutDate.data.payment.entryDate, '2024-03-03');
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(mismatch.status, 'error');
  assert.equal(plan.totals.invoiced, 180);
  assert.equal(plan.totals.invoicePayments, 150);
  assert.equal(plan.totals.openAmount, 30);
});

test('Zahlungsimport bleibt kompatibel und verhindert Überzahlungen', () => {
  const invoices = [{ id: '11111111-1111-4111-8111-111111111111', invoiceNumber: 'RE-2025-001', customerId: 'c1', customerName: 'Anna', issueDate: '2025-01-01', status: 'sent', total: 100, taxAmount: 0 }];
  const plan = planImport('invoicePayments', [
    { _rowNumber: 2, invoiceNumber: 'RE-2025-001', entryDate: '10.01.2025', amount: '60,00' },
    { _rowNumber: 3, invoiceNumber: 'RE-2025-001', entryDate: '11.01.2025', amount: '50,00' },
  ], context({ invoices }), {});
  assert.deepEqual(plan.entries.map(item => item.status), ['valid', 'error']);
  assert.match(plan.entries[1].message, /offenen Betrag von 40,00 €/);
});

test('Erneut importierte Zahlungen werden unabhängig von Notizen als vorhanden erkannt', () => {
  const invoiceId = '11111111-1111-4111-8111-111111111111';
  const invoices = [{ id: invoiceId, invoiceNumber: 'RE-2025-001', customerId: 'c1', customerName: 'Anna', issueDate: '2025-01-01', status: 'sent', total: 100, taxAmount: 0 }];
  const euerEntries = [{ id: 'p1', sourceType: 'invoice_payment', sourceId: invoiceId, entryType: 'income', entryDate: '2025-01-10', amount: 60, notes: 'Datenübernahme: zahlungen.csv, Zeile 2', status: 'active' }];
  const plan = planImport('invoicePayments', [
    { _rowNumber: 2, invoiceNumber: 'RE-2025-001', entryDate: '10.01.2025', amount: '60,00' },
    { _rowNumber: 3, invoiceNumber: 'RE-2025-001', entryDate: '20.01.2025', amount: '40,00' },
  ], context({ invoices, euerEntries }), {});
  assert.deepEqual(plan.entries.map(item => item.status), ['duplicate', 'valid']);
});
