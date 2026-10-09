import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyseHeaderMapping,
  detectImportResources,
  getImportDefinition,
  mapImportRows,
  mapImportCandidateRows,
  parseImportFile,
} from '../../.test-dist/utils/importParser.js';

test('Jede Importfunktion beschreibt ihre Pflichtspalten und Suchbegriffe', () => {
  for (const resource of ['customers', 'jobs', 'quotes', 'positions', 'hourlyRates', 'materials', 'euerEntries', 'invoicePayments']) {
    const definition = getImportDefinition(resource);
    assert.ok(definition.fields.length > 0, `${resource} benötigt Felddefinitionen`);
    assert.ok(definition.fields.filter(field => field.required).every(field => field.aliases.length > 0), `${resource} benötigt Aliaslisten für Pflichtfelder`);
  }

  assert.ok(getImportDefinition('jobs').fields.some(field => field.key === 'location'));
});

test('Zahlungsimport ordnet die Rechnungsnummer automatisch zu', () => {
  const result = analyseHeaderMapping(
    ['Rechnungsnummer', 'Zahlungsdatum', 'Zahlungsbetrag'],
    getImportDefinition('invoicePayments'),
  );

  assert.equal(result.mapping.invoiceNumber, 'Rechnungsnummer');
  assert.equal(result.mapping.entryDate, 'Zahlungsdatum');
  assert.equal(result.mapping.amount, 'Zahlungsbetrag');
});

test('Stundensatzspalten werden im Import als Preis und nie als Name zugeordnet', () => {
  for (const resource of ['hourlyRates', 'positions']) {
    const result = analyseHeaderMapping(['Bezeichnung', 'Stundensatz'], getImportDefinition(resource));
    assert.equal(result.mapping.name, 'Bezeichnung');
    assert.equal(result.mapping[resource === 'hourlyRates' ? 'rate' : 'unitPrice'], 'Stundensatz');
  }
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
  assert.equal(result.fields.name.score, 100, 'Anzeigenwerte bleiben auf 0 bis 100 begrenzt');
});

test('Ressourcen-Confidence bleibt auf 100 begrenzt und behält das Roh-Ranking', () => {
  const parsedFile = {
    fileName: 'unterricht.csv',
    format: 'csv',
    headers: ['Datum', 'Schüler', 'Stunden', 'Pro Stunde'],
    rows: [{ Datum: '15.09.2025', 'Schüler': 'Anna', Stunden: '1', 'Pro Stunde': '25' }],
    rowNumbers: [2],
    warnings: [],
  };

  const candidates = detectImportResources(parsedFile);
  assert.ok(candidates.length > 0, 'die Nachhilfe-Spalten werden erkannt');
  assert.ok(candidates.every(candidate => candidate.score >= 0 && candidate.score <= 100));
  assert.equal(candidates[0].score, 100, 'ein historischer Rohwert von 110 wird als 100 angezeigt');
  assert.equal(candidates[0].resource, 'euerEntries', 'bei gleichem Anzeige-Score bleibt die fachliche Rangfolge stabil');
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

test('Manuell zugeordnete Kursname-Spalte bleibt als courseName in der Requestzeile', () => {
  const parsedFile = {
    fileName: 'altrechnungen.csv', format: 'csv', headers: ['Nr.', 'Leistung', 'Kursbezeichnung'], warnings: [],
    rows: [{ 'Nr.': 'ALT-17', 'Leistung': 'Einzelstunde', 'Kursbezeichnung': 'Mathe Klasse 8' }],
  };
  const mappedRows = mapImportRows(parsedFile, {
    invoiceNumber: 'Nr.', itemDescription: 'Leistung', courseName: 'Kursbezeichnung',
  }, { definition: getImportDefinition('invoices') });

  assert.equal(mappedRows[0].courseName, 'Mathe Klasse 8');
  assert.equal(mappedRows[0].invoiceNumber, 'ALT-17');
});

test('Abhängigkeitsplan verwendet nur passende Kategoriezeilen und ihre Quellzeilennummern', () => {
  const parsed = {
    fileName: 'gemischt.csv', format: 'csv',
    headers: ['Kundenname', 'Rechnungsnummer', 'Rechnungsdatum', 'Bruttobetrag'],
    rows: [
      { Kundenname: 'Mia', Rechnungsnummer: '', Rechnungsdatum: '', Bruttobetrag: '' },
      { Kundenname: 'Mia', Rechnungsnummer: 'ALT-1', Rechnungsdatum: '01.08.2026', Bruttobetrag: '12,00' },
    ],
    rowNumbers: [4, 9], warnings: [],
  };
  const candidate = detectImportResources(parsed).find(item => item.resource === 'invoices');
  assert.ok(candidate);
  const rows = mapImportCandidateRows(parsed, candidate);
  assert.equal(rows.length, 1, 'die reine Kundenzeile darf Rechnungen nicht blockieren');
  assert.equal(rows[0]._rowNumber, 9);
  assert.equal(rows[0].invoiceNumber, 'ALT-1');
  assert.equal(rows[0].total, 12);
  assert.equal(rows[0].issueDate, '2026-08-01');
});

test('Eine Quellspalte kann für Name und Titel zugleich verwendet werden', () => {
  const parsedFile = {
    fileName: 'unterricht.csv',
    format: 'csv',
    headers: ['Schüler', 'Datum', 'Arbeitszeit (Stunden)'],
    rows: [{ 'Schüler': 'Galina', Datum: '28.07.21', 'Arbeitszeit (Stunden)': '2' }],
    warnings: [],
  };

  const result = mapImportRows(parsedFile, {
    customerName: 'Schüler',
    title: 'Schüler',
    date: 'Datum',
    hoursWorked: 'Arbeitszeit (Stunden)',
  });
  assert.deepEqual(result, [{
    _rowNumber: 2,
    customerName: 'Galina',
    title: 'Galina',
    date: '28.07.21',
    hoursWorked: '2',
  }]);
});

test('Schüler-Spalten werden beim Auftragsimport als Bezug erkannt', () => {
  const result = analyseHeaderMapping(['Schüler'], getImportDefinition('jobs'));
  assert.equal(result.mapping.customerName, 'Schüler');
});

test('Leere und unbenannte CSV-Spalten werden nicht als Quellspalten übernommen', async () => {
  const file = new File([
    'Name;;Leere Spalte\nMuster GmbH;;\nNoch eine GmbH;;\n',
  ], 'kunden.csv', { type: 'text/csv' });

  const result = await parseImportFile(file);
  assert.deepEqual(result.headers, ['Name']);
  assert.deepEqual(result.rows, [
    { Name: 'Muster GmbH' },
    { Name: 'Noch eine GmbH' },
  ]);
});

// ---------------------------------------------------------------------------
// Datenübernahme: Zeichensatz, Excel-Arbeitsmappen und Spaltenformate
// ---------------------------------------------------------------------------

import { deflateRawSync } from 'node:zlib';
import { buildIssueList, buildImportTemplate, buildCombinedImportTemplate, describeCombinedImportTemplate } from '../../.test-dist/utils/importParser.js';

function zip(files) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const raw = encoder.encode(content);
    const data = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, Buffer.from(nameBytes), data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, Buffer.from(nameBytes));
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// Nachbildung der Nachhilfe-Tabelle: Titelzeile, Kopfzeile, Datumsformat,
// Zahlen mit Währungsformat und eine Summenzeile am Ende.
function tutoringWorkbook() {
  const shared = ['Einnahmen 2021', 'Datum', 'Schüler', 'Stunden', 'Pro Stunde', 'Anna', 'Summe'];
  const si = shared.map(value => `<si><t>${value}</t></si>`).join('');
  const cell = (ref, value, style = 0) => (typeof value === 'string'
    ? `<c r="${ref}" t="s"><v>${shared.indexOf(value)}</v></c>`
    : `<c r="${ref}" s="${style}"><v>${value}</v></c>`);
  const rows = [
    `<row r="1">${cell('A1', 'Einnahmen 2021')}</row>`,
    `<row r="3">${cell('A3', 'Datum')}${cell('B3', 'Schüler')}${cell('C3', 'Stunden')}${cell('D3', 'Pro Stunde')}</row>`,
    `<row r="4">${cell('A4', 44454, 1)}${cell('B4', 'Anna')}${cell('C4', 1, 2)}${cell('D4', 5, 3)}</row>`,
    `<row r="5">${cell('A5', 44479, 1)}${cell('B5', 'Anna')}${cell('C5', 1, 2)}${cell('D5', 10, 3)}</row>`,
    `<row r="6">${cell('A6', 'Summe')}<c r="C6" s="2"><f>SUM(C4:C5)</f><v>2</v></c><c r="D6" s="3"><f>SUM(D4:D5)</f><v>15</v></c></row>`,
  ].join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Einnahmen" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst>${si}</sst>`,
    'xl/styles.xml': '<?xml version="1.0"?><styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="2"/><xf numFmtId="164"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`,
  });
}

test('Deutsches Excel-CSV im Windows-Zeichensatz behält seine Umlaute', async () => {
  const bytes = Buffer.from('Schüler;Datum\nMüller;15.09.21\n', 'latin1');
  const result = await parseImportFile(new File([bytes], 'unterricht.csv', { type: 'text/csv' }));
  assert.deepEqual(result.headers, ['Schüler', 'Datum']);
  assert.equal(result.rows[0]['Schüler'], 'Müller');
  assert.equal(result.encoding, 'Windows-1252');
  assert.match(result.warnings.join(' '), /Windows-Zeichensatz/);
});

test('Excel-Arbeitsmappen werden mit Kopfzeile, Datumsformat und ohne Summenzeile gelesen', async () => {
  const file = new File([tutoringWorkbook()], 'einnahmen.xlsx');
  const result = await parseImportFile(file);
  assert.equal(result.format, 'xlsx');
  assert.deepEqual(result.sheets, ['Einnahmen']);
  assert.deepEqual(result.headers, ['Datum', 'Schüler', 'Stunden', 'Pro Stunde']);
  assert.deepEqual(result.rows, [
    { Datum: '2021-09-15', 'Schüler': 'Anna', Stunden: 1, 'Pro Stunde': 5 },
    { Datum: '2021-10-10', 'Schüler': 'Anna', Stunden: 1, 'Pro Stunde': 10 },
  ]);
  assert.deepEqual(result.rowNumbers, [4, 5], 'Zeilennummern entsprechen der Anzeige in Excel');
  assert.match(result.warnings.join(' '), /Kopfzeile wurde in Zeile 3/);
  assert.match(result.warnings.join(' '), /Summenzeile \(Zeile 6\)/);
  assert.match(result.hash, /^[0-9a-f]{64}$/);
});

test('Die Nachhilfe-Tabelle wird für Einnahmen erkannt und mit festen Werten normalisiert', () => {
  const definition = getImportDefinition('euerEntries');
  const headers = ['Datum', 'Schüler', 'Stunden', 'Pro Stunde'];
  const analysis = analyseHeaderMapping(headers, definition);
  assert.deepEqual(analysis.mapping, { entryDate: 'Datum', customerName: 'Schüler', quantity: 'Stunden', unitPrice: 'Pro Stunde' });

  const parsedFile = {
    fileName: 'unterricht.csv', format: 'csv', headers, warnings: [], rowNumbers: [2, 3],
    rows: [
      { Datum: '15.09.21', 'Schüler': 'Anna', Stunden: '1,0', 'Pro Stunde': '5,00 €' },
      { Datum: '10.10.21', 'Schüler': 'Anna', Stunden: '1,0', 'Pro Stunde': '10,00 €' },
    ],
  };
  const rows = mapImportRows(parsedFile, analysis.mapping, { definition, constants: { entryType: 'income', taxRate: '0', description: 'Unterricht' } });
  assert.deepEqual(rows[0], { _rowNumber: 2, entryDate: '2021-09-15', customerName: 'Anna', quantity: 1, unitPrice: 5, entryType: 'income', taxRate: 0, description: 'Unterricht' });
  assert.equal(rows[1].unitPrice, 10);
});

test('Auftragsimport erkennt Stunden und Preis pro Stunde', () => {
  const analysis = analyseHeaderMapping(['Datum', 'Schüler', 'Stunden', 'Pro Stunde'], getImportDefinition('jobs'));
  assert.equal(analysis.mapping.hoursWorked, 'Stunden');
  assert.equal(analysis.mapping.hourlyRate, 'Pro Stunde');
  assert.equal(analysis.mapping.customerName, 'Schüler');
});

test('Eigene Werte werden über die Werte-Zuordnung übersetzt und Tausenderpunkte richtig gelesen', () => {
  const definition = getImportDefinition('euerEntries');
  const parsedFile = {
    fileName: 'kosten.csv', format: 'csv', headers: ['Datum', 'Kategorie', 'Betrag'], warnings: [],
    rows: [{ Datum: '01.02.2025', Kategorie: 'Kfz', Betrag: '1.234' }, { Datum: '02.02.2025', Kategorie: 'Porto', Betrag: '2,50' }],
  };
  const rows = mapImportRows(parsedFile, { entryDate: 'Datum', category: 'Kategorie', amount: 'Betrag' }, {
    definition,
    valueMappings: { category: { kfz: 'vehicle' } },
  });
  assert.equal(rows[0].category, 'vehicle');
  assert.equal(rows[1].category, 'Porto', 'ohne Zuordnung bleibt der Wert für die Serverprüfung erhalten');
  assert.equal(rows[0].amount, 1234);
  assert.equal(rows[1].amount, 2.5);
});

test('Vorlage und Fehlerliste enthalten die erwarteten Spalten', () => {
  const template = buildImportTemplate(getImportDefinition('euerEntries'));
  assert.match(template, /^Datum;Art \(Einnahme\/Ausgabe\);Beschreibung;Betrag \(brutto\)/);
  const parsedFile = { fileName: 'a.csv', format: 'csv', headers: ['Datum', 'Betrag'], warnings: [], rowNumbers: [2, 3], rows: [{ Datum: 'x', Betrag: '1' }, { Datum: '01.01.2025', Betrag: '2' }] };
  const issues = buildIssueList(parsedFile, [
    { rowNumber: 2, status: 'error', message: 'Datum „x“ ist ungültig.' },
    { rowNumber: 3, status: 'valid', message: 'Ok.' },
  ]);
  const lines = issues.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
  assert.equal(lines[0], 'Zeile;Status;Hinweis;Datum;Betrag');
  assert.equal(lines[1], '2;Fehler;Datum „x“ ist ungültig.;x;1');
  assert.equal(lines.length, 2);
});

test('Die Komplettvorlage wird als Kunden und Rechnungen erkannt', async () => {
  const parsed = await parseImportFile(new File([buildCombinedImportTemplate()], 'komplettvorlage.csv', { type: 'text/csv' }));
  assert.equal(parsed.rows.length, 2, 'die Vorlage enthält zwei Beispielzeilen');

  const candidates = detectImportResources(parsed);
  const resources = candidates.map(candidate => candidate.resource);
  assert.ok(resources.includes('customers'), 'Kunden werden erkannt');
  assert.ok(resources.includes('invoices'), 'Rechnungen werden erkannt');
  for (const resource of ['customers', 'invoices']) {
    assert.equal(candidates.find(candidate => candidate.resource === resource).confidence, 'high', `${resource} wird sicher erkannt`);
  }

  const invoiceMapping = analyseHeaderMapping(parsed.headers, getImportDefinition('invoices')).mapping;
  assert.equal(invoiceMapping.invoiceNumber, 'Rechnungsnummer');
  assert.equal(invoiceMapping.issueDate, 'Rechnungsdatum');
  assert.equal(invoiceMapping.customerName, 'Kundenname');
  const customerMapping = analyseHeaderMapping(parsed.headers, getImportDefinition('customers')).mapping;
  assert.equal(customerMapping.name, 'Kundenname');
  assert.equal(customerMapping.postalCode, 'PLZ');
});

test('Eine breite Datei schlägt nur fachlich passende Kategorien vor', async () => {
  const parsed = await parseImportFile(new File([buildCombinedImportTemplate()], 'komplettvorlage.csv', { type: 'text/csv' }));
  const resources = detectImportResources(parsed).map(candidate => candidate.resource);

  assert.deepEqual([...resources].sort(), ['customers', 'invoices'], 'schwache Teiltreffer erzeugen keine zusätzlichen Kategorien');
});

test('Kategorien mit unsicher erkannter Pflichtspalte werden nicht vorgeschlagen', () => {
  const parsedFile = {
    fileName: 'rechnungen.csv',
    format: 'csv',
    headers: ['Rechnungsnummer', 'Rechnungsdatum', 'Kundenname', 'Rechnungsbetrag'],
    rows: [{ Rechnungsnummer: '2024-1', Rechnungsdatum: '01.03.2024', Kundenname: 'Anna Muster', Rechnungsbetrag: '119,00' }],
    rowNumbers: [2],
    warnings: [],
  };

  const resources = detectImportResources(parsedFile).map(candidate => candidate.resource);
  assert.ok(resources.includes('invoices'));
  assert.ok(!resources.includes('euerEntries'), '„Rechnungsdatum“ ist keine zuverlässige Buchungsdatumsspalte');
  assert.ok(!resources.includes('invoicePayments'), 'ohne Zahlungsdatum und Zahlungsbetrag keine Zahlungskategorie');
  assert.ok(!resources.includes('quotes'), 'ohne Angebotsnummer keine Angebotskategorie');
});

test('Die Beschreibung der Komplettvorlage nennt je Spalte die Zielkategorie', () => {
  const columns = describeCombinedImportTemplate();
  assert.equal(columns.length, 17);
  assert.deepEqual(columns[0], { header: 'Kundennummer', resourceLabel: 'Kunden', example: '1001' });
  assert.ok(columns.some(column => column.header === 'Rechnungsnummer' && column.resourceLabel === 'Rechnungen (Altbestand)'));
  assert.ok(columns.some(column => column.header === 'Kursname' && column.resourceLabel === 'Rechnungen (Altbestand)'));
});
