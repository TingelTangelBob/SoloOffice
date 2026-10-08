import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { rolldown } from 'rolldown';

test('importierte Rechnungs-Zweitschrift nutzt aktuelles PDF-Layout und historische Daten', async () => {
  const testOutputDirectory = path.resolve('.test-dist');
  await mkdir(testOutputDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(testOutputDirectory, 'invoice-reprint-'));
  try {
    const bundle = await rolldown({
      input: path.resolve('src/utils/pdfGenerator.ts'),
      platform: 'node',
      plugins: [{
        name: 'solooffice-test-env',
        transform(code) {
          return code.replaceAll('import.meta.env', "({ VITE_API_URL: '/api', VITE_DEMO_MODE: 'false', DEV: false, PROD: true })");
        },
        resolveId(source) {
          if (source === 'jspdf') return '\0test-jspdf';
        },
        load(id) {
          if (id !== '\0test-jspdf') return null;
          return `
            export default class jsPDF {
              constructor() {
                this.calls = [];
                this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
              }
              record(name, ...args) { this.calls.push([name, ...args]); }
              addPage(...args) { this.record('addPage', ...args); }
              addImage(...args) { this.record('addImage', ...args); }
              getNumberOfPages() { return 1; }
              getTextWidth(value) { return String(value).length; }
              line(...args) { this.record('line', ...args); }
              output() { return new Blob([JSON.stringify(this.calls)], { type: 'application/pdf' }); }
              rect(...args) { this.record('rect', ...args); }
              setDrawColor(...args) { this.record('setDrawColor', ...args); }
              setFillColor(...args) { this.record('setFillColor', ...args); }
              setFont(...args) { this.record('setFont', ...args); }
              setFontSize(...args) { this.record('setFontSize', ...args); }
              setLineWidth(...args) { this.record('setLineWidth', ...args); }
              setPage(...args) { this.record('setPage', ...args); }
              setTextColor(...args) { this.record('setTextColor', ...args); }
              splitTextToSize(value) { return [String(value)]; }
              text(...args) { this.record('text', ...args); }
            }
          `;
        },
      }],
    });
    const outputFile = path.join(temporaryDirectory, 'pdfGenerator.mjs');
    await bundle.write({ file: outputFile, format: 'esm' });
    await bundle.close();

    globalThis.localStorage = { getItem: () => null };
    const { generateInvoicePDF } = await import(pathToFileURL(outputFile).href);
    const snapshotCompany = {
      name: 'Historische Firma', address: 'Altweg 1', postalCode: '12345', city: 'Altstadt', country: 'Deutschland',
      phone: '', email: '', taxId: 'DE-HISTORISCH', locale: 'de-DE', currency: 'EUR',
      documentTemplates: [{ id: 'old-invoice', documentType: 'invoice', name: 'Altes Layout', isDefault: true, accentColor: '#0000ff', layout: 'classic' }],
      isSmallBusiness: false,
    };
    const snapshotCustomer = {
      id: 'customer-old', name: 'Historischer Empfänger', address: 'Kundenweg 9', postalCode: '54321', city: 'Kundenstadt',
      country: 'Deutschland', email: 'alt@example.test', phone: '',
    };
    const currentCompany = {
      name: 'Aktuelle Firma', address: 'Neuweg 2', postalCode: '99999', city: 'Neustadt', country: 'Deutschland',
      phone: '', email: '', taxId: 'DE-AKTUELL', locale: 'de-DE', currency: 'EUR',
      documentTemplates: [{
        id: 'new-invoice', documentType: 'invoice', name: 'Neues Layout', isDefault: true,
        accentColor: '#d7263d', layout: 'minimal', tableStyle: 'dark', showPaymentInformation: false,
      }],
      isSmallBusiness: true,
    };
    const invoice = {
      id: 'invoice-imported', invoiceNumber: 'ALT-2020-0042', origin: 'imported', status: 'sent',
      issueDate: '2020-03-04', dueDate: '2020-03-18', items: [{
        id: 'item-1', description: 'Importierter Gesamtbetrag – keine Einzelpositionen überliefert',
        quantity: 1, unitPrice: 100, taxRate: 19, total: 119, order: 1,
      }],
      subtotal: 100, taxAmount: 19, total: 119,
      documentSnapshot: { version: 1, capturedAt: '2020-03-04T00:00:00.000Z', company: snapshotCompany, customer: snapshotCustomer },
    };

    const pdf = await generateInvoicePDF(invoice, {
      format: 'pdf', company: currentCompany,
      customer: { ...snapshotCustomer, name: 'Geänderte aktuelle Kundenakte' },
      legacyReprint: true,
    });
    const calls = JSON.parse(await pdf.text());
    const text = JSON.stringify(calls);

    assert.match(text, /Kopie \/ Neudruck/);
    assert.match(text, /Historischer Empfänger/);
    assert.match(text, /Historische Firma/);
    assert.doesNotMatch(text, /Geänderte aktuelle Kundenakte|Aktuelle Firma|DE-AKTUELL/);
    assert.match(text, /ALT-2020-0042/);
    assert.match(text, /4\.3\.2020/);
    assert.match(text, /100,00/);
    assert.match(text, /19,00/);
    assert.match(text, /119,00/);
    assert.match(text, /Importierter Gesamtbetrag/);
    assert.ok(calls.some(([name, ...args]) => name === 'setTextColor' && args.join(',') === '215,38,61'));
    assert.ok(calls.some(([name, ...args]) => name === 'setFillColor' && args.join(',') === '31,41,55'));
    assert.doesNotMatch(text, /§ 19 UStG|§ 13b UStG/);
    await assert.rejects(
      generateInvoicePDF({ ...invoice, documentSnapshot: undefined }, { format: 'pdf', company: currentCompany, customer: snapshotCustomer, legacyReprint: true }),
      /historische Firmen- und Empfänger-Snapshot/,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
