import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyseHeaderMapping,
  getImportDefinition,
  mapImportRows,
} from '../../.test-dist/utils/importParser.js';

test('Jede Importfunktion beschreibt ihre Pflichtspalten und Suchbegriffe', () => {
  for (const resource of ['customers', 'jobs', 'quotes', 'positions', 'hourlyRates', 'materials', 'euerEntries']) {
    const definition = getImportDefinition(resource);
    assert.ok(definition.fields.length > 0, `${resource} benötigt Felddefinitionen`);
    assert.ok(definition.fields.filter(field => field.required).every(field => field.aliases.length > 0), `${resource} benötigt Aliaslisten für Pflichtfelder`);
  }

  assert.ok(getImportDefinition('jobs').fields.some(field => field.key === 'location'));
});

test('Kundenimport ordnet deutsche und englische Spalten automatisch zu', () => {
  const result = analyseHeaderMapping(
    ['Kundenname', 'E-Mail', 'PLZ', 'steuerId'],
    getImportDefinition('customers'),
  );

  assert.equal(result.mapping.name, 'Kundenname');
  assert.equal(result.mapping.email, 'E-Mail');
  assert.equal(result.mapping.postalCode, 'PLZ');
  assert.equal(result.mapping.taxId, 'steuerId');
  assert.equal(result.fields.name.confidence, 'exact');
});

test('Mehrdeutige Positionsspalten werden nicht stillschweigend doppelt verwendet', () => {
  const result = analyseHeaderMapping(
    ['Beschreibung', 'Preis'],
    getImportDefinition('positions'),
  );

  assert.equal(result.mapping.unitPrice, 'Preis');
  assert.equal(result.mapping.name, undefined);
  assert.equal(result.mapping.description, undefined);
  assert.equal(result.fields.name.confidence, 'ambiguous');
  assert.equal(result.fields.description.confidence, 'ambiguous');
  assert.match(result.warnings.join(' '), /Zuordnung/);
});

test('Angebotsimport nutzt die für Positionen vorgesehenen Spalten', () => {
  const result = analyseHeaderMapping(
    ['Angebotsnummer', 'Kundennummer', 'Beschreibung', 'Menge', 'Einzelpreis'],
    getImportDefinition('quotes'),
  );

  assert.equal(result.mapping.quoteNumber, 'Angebotsnummer');
  assert.equal(result.mapping.customerNumber, 'Kundennummer');
  assert.equal(result.mapping.itemDescription, 'Beschreibung');
  assert.equal(result.mapping.itemQuantity, 'Menge');
  assert.equal(result.mapping.itemUnitPrice, 'Einzelpreis');
});

test('Gematchte Quellspalten werden unter den erwarteten Zielfeldern an den Server gegeben', () => {
  const parsedFile = {
    fileName: 'kunden.csv',
    format: 'csv',
    headers: ['Kundenname', 'E-Mail'],
    rows: [{ 'Kundenname': 'Muster GmbH', 'E-Mail': 'mail@example.test' }],
    warnings: [],
  };

  const result = mapImportRows(parsedFile, { name: 'Kundenname', email: 'E-Mail' });
  assert.deepEqual(result, [{ _rowNumber: 2, name: 'Muster GmbH', email: 'mail@example.test' }]);
});
