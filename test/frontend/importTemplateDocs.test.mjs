import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getImportTemplateDoc,
  getImportTemplateDocs,
} from '../../.test-dist/utils/importTemplateDocs.js';

test('Rechnungsvorlage nennt Nummer und Datum als Pflichtspalten', () => {
  const doc = getImportTemplateDoc('invoices');

  const numberField = doc.columns.find(column => column.key === 'invoiceNumber');
  const dateField = doc.columns.find(column => column.key === 'issueDate');

  assert.ok(numberField, 'Rechnungsnummer-Spalte existiert');
  assert.equal(numberField.requirement, 'required', 'Rechnungsnummer ist Pflichtfeld');

  assert.ok(dateField, 'Rechnungsdatum-Spalte existiert');
  assert.equal(dateField.requirement, 'required', 'Rechnungsdatum ist Pflichtfeld');
});

test('Kundenbezug-Felder sind als Gruppenpflicht mit Gruppenlabel ausgewiesen', () => {
  const doc = getImportTemplateDoc('jobs');

  const customerIdField = doc.columns.find(column => column.key === 'customerId');
  const customerNumberField = doc.columns.find(column => column.key === 'customerNumber');
  const customerNameField = doc.columns.find(column => column.key === 'customerName');
  const customerEmailField = doc.columns.find(column => column.key === 'customerEmail');

  assert.equal(customerIdField.requirement, 'group', 'customerId ist Gruppenpflicht');
  assert.equal(customerNumberField.requirement, 'group', 'customerNumber ist Gruppenpflicht');
  assert.equal(customerNameField.requirement, 'group', 'customerName ist Gruppenpflicht');
  assert.equal(customerEmailField.requirement, 'group', 'customerEmail ist Gruppenpflicht');

  assert.match(customerIdField.requirementLabel, /Kundenbezug/, 'Gruppenlabel wird in requirementLabel angezeigt');
});

test('Erkannte Spaltennamen sind begrenzt (höchstens 6) und frei von Duplikaten', () => {
  const doc = getImportTemplateDoc('customers');

  for (const column of doc.columns) {
    assert.ok(Array.isArray(column.recognisedHeaders), `${column.key} hat recognisedHeaders-Array`);
    assert.ok(column.recognisedHeaders.length <= 6, `${column.key} hat höchstens 6 Spaltennamen`);

    // Dubletten unabhängig von Groß- und Kleinschreibung ausschließen.
    const lowerHeaders = column.recognisedHeaders.map(header => header.toLowerCase());
    assert.equal(lowerHeaders.length, new Set(lowerHeaders).size, `${column.key} hat keine Duplikate`);
  }
});

test('getImportTemplateDocs() liefert alle neun Kategorien in der festen Reihenfolge, Kunden zuerst', () => {
  const docs = getImportTemplateDocs();

  assert.equal(docs.length, 9, 'Es gibt neun Kategorien');
  assert.equal(docs[0].resource, 'customers', 'Kunden sind die erste Kategorie');
  assert.equal(docs[1].resource, 'positions', 'Positionsvorlagen sind die zweite Kategorie');
  assert.equal(docs[2].resource, 'hourlyRates', 'Stundensätze sind die dritte Kategorie');
  assert.equal(docs[3].resource, 'materials', 'Materialien sind die vierte Kategorie');
  assert.equal(docs[4].resource, 'invoices', 'Rechnungen sind die fünfte Kategorie');
  assert.equal(docs[5].resource, 'invoicePayments', 'Zahlungseingänge sind die sechste Kategorie');
  assert.equal(docs[6].resource, 'euerEntries', 'EÜR-Einträge sind die siebte Kategorie');
  assert.equal(docs[7].resource, 'jobs', 'Aufträge sind die achte Kategorie');
  assert.equal(docs[8].resource, 'quotes', 'Angebote sind die neunte Kategorie');
});

test('Aufzählungsfeld listet Auswahl-Labels und erlaubt einen festen Wert', () => {
  const doc = getImportTemplateDoc('euerEntries');

  const entryTypeField = doc.columns.find(column => column.key === 'entryType');
  assert.ok(entryTypeField, 'entryType-Feld existiert');
  assert.equal(entryTypeField.typeLabel, 'Auswahl', 'Feldtyp ist Auswahl');
  assert.ok(Array.isArray(entryTypeField.options), 'options ist ein Array');
  assert.equal(entryTypeField.options.length, 2, 'entryType hat zwei Optionen');
  assert.ok(entryTypeField.options.includes('Einnahme'), 'Einnahme ist eine Option');
  assert.ok(entryTypeField.options.includes('Ausgabe'), 'Ausgabe ist eine Option');
  assert.ok(entryTypeField.allowsConstant, 'entryType erlaubt konstante Werte');
});
