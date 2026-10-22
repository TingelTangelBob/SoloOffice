import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { rolldown } from 'rolldown';
import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';

const company = {
  name: 'PDF-Testfirma', address: 'Testweg 1', postalCode: '12345', city: 'Teststadt', country: 'Deutschland',
  email: 'test@example.invalid', phone: '0123456', currency: 'EUR', bankName: 'Testbank', bankAccount: 'DE02120300000000202051',
};
const settings = { design: 'classic', font: 'helvetica', accentColor: '#2563eb', showLogo: false, showFooter: true, showBankDetails: true };
const model = {
  title: 'Rechnung', number: 'QA-001', meta: [{ label: 'Datum', value: '22.10.2026' }],
  recipient: { name: 'Testkunde', address: 'Kundenweg 2', postalCode: '12345', city: 'Teststadt', country: 'Deutschland' },
  table: { columns: [{ label: 'Pos.', width: 11 }, { label: 'Beschreibung' }, { label: 'Gesamt', width: 27, align: 'right' }], rows: [['1', 'Beratung', '119,00 €']] },
  totals: { lines: [], grand: { label: 'Gesamtbetrag', value: '119,00 €' } },
};

// Ein gültiges PNG; der Browser-Decoder/Canvas wird im Node-Test injiziert.
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAAAyCAYAAAAZUZThAAAAnElEQVR4nO3ToREAIAzAwO6/dFmAiwXx4n1MZmcWuJvXAfAzg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAgEg0AwCASDQDAIBINAMAiEA1lX1mSnS824AAAAAElFTkSuQmCC';

test('Geschäftsdokumente: echte jsPDF-Metriken, Seitenumbrüche und gemeinsame Bildquelle', async t => {
  await mkdir('.test-dist', { recursive: true });
  const directory = await mkdtemp(path.resolve('.test-dist', 'business-document-'));
  const previous = { localStorage: globalThis.localStorage, Image: globalThis.Image, document: globalThis.document };
  try {
    const bundle = await rolldown({
      input: 'business-document-test-entry', platform: 'node',
      plugins: [{
        name: 'business-document-test',
        transform(code) { return code.replaceAll('import.meta.env', '({ DEV: false, PROD: true })'); },
        resolveId(source) {
          if (source === 'business-document-test-entry' || source === 'jspdf') return `\0${source}`;
        },
        load(id) {
          if (id === '\0business-document-test-entry') return `
            export { renderBusinessDocument } from ${JSON.stringify(path.resolve('src/utils/pdf/documentRenderer.ts'))};
            export { PreviewRecorder } from ${JSON.stringify(path.resolve('src/utils/pdf/previewRecorder.ts'))};
            export { loadPdfImage } from ${JSON.stringify(path.resolve('src/utils/pdf/imageHelpers.ts'))};`;
          if (id === '\0jspdf') return `import pkg from ${JSON.stringify(path.resolve('node_modules/jspdf/dist/jspdf.node.min.js'))}; export default pkg.jsPDF;`;
        },
      }],
    });
    const outputFile = path.join(directory, 'renderer.mjs');
    await bundle.write({ file: outputFile, format: 'esm' });
    await bundle.close();
    globalThis.localStorage = { getItem: () => null };
    const { renderBusinessDocument, PreviewRecorder, loadPdfImage } = await import(pathToFileURL(outputFile).href);
    async function render(chosenModel, chosenSettings = settings, chosenCompany = company) {
      const preview = new PreviewRecorder();
      const pdf = new jsPDF();
      await renderBusinessDocument(preview, chosenModel, chosenSettings, chosenCompany);
      await renderBusinessDocument(pdf, chosenModel, chosenSettings, chosenCompany);
      const parsed = await PDFDocument.load(pdf.output('arraybuffer'));
      assert.equal(parsed.getPageCount(), preview.pages.length);
      const body = preview.pages.map(page => page.filter(op => op.kind === 'text' && op.y > 25 && op.y < 270));
      // Der Standardfuß beginnt bei 271; der Inhaltsbereich endet bei 265.
      for (const page of preview.pages) {
        for (const op of page.filter(op => op.kind === 'text' && op.y > 25 && !op.lines[0].startsWith('Seite '))) {
          if (op.y >= 271) continue; // reguläre Fußzeilen
          assert.ok(op.y <= 265, `Text ragt in den Fuß: ${op.lines.join(' ')} bei ${op.y}`);
        }
      }
      return { preview, pdf, body };
    }

    await t.test('normale Rechnung, Gutschrift, Angebot und Mahnung bleiben einseitig lesbar', async () => {
      for (const title of ['Rechnung', 'Gutschrift', 'Angebot', 'Mahnung']) {
        const chosenModel = title === 'Mahnung'
          ? { ...model, title, table: undefined, blocks: [{ heading: 'Offene Rechnung', text: 'Bitte gleichen Sie den offenen Betrag aus.' }] }
          : { ...model, title };
        const result = await render(chosenModel);
        assert.equal(result.pdf.getNumberOfPages(), 1);
        assert.ok(result.preview.pages[0].some(op => op.kind === 'text' && op.lines.includes(title)));
        assert.ok(result.body.flat().some(op => op.lines.includes('119,00 €')));
      }
    });

    await t.test('lange Position bleibt vollständig auf den Seiten, mit Kopf und Beträgen genau einmal', async () => {
      const words = Array.from({ length: 1000 }, (_, index) => `Wort${index}`);
      for (const design of ['classic', 'modern', 'minimal', 'elegant', 'bold']) {
        const result = await render({ ...model, table: { ...model.table, rows: [['1', words.join(' '), '119,00 €'], ['2', 'Folgeposition', '50,00 €']] } }, { ...settings, design });
        assert.ok(result.preview.pages.length > 2);
        const bodyText = result.body.flat().flatMap(op => op.lines).join(' ');
        for (const word of words) assert.equal(bodyText.split(/\s+/).filter(token => token === word).length, 1, word);
        assert.equal(result.body.flat().filter(op => op.lines.includes('50,00 €')).length, 1);
        assert.equal(result.body.flat().filter(op => op.lines.includes('119,00 €')).length, 2, 'Position und Gesamtsumme, keine Wiederholung auf Fortsetzungen');
        assert.ok(bodyText.includes('Folgeposition'));
        const header = design === 'minimal' ? 'BESCHREIBUNG' : 'Beschreibung';
        assert.ok(result.preview.pages.slice(0, -1).every(page => page.some(op => op.kind === 'text' && op.lines.includes(header))));
        for (const page of result.preview.pages) {
          for (const op of page.filter(op => op.kind === 'text' && op.lines.some(line => /^Wort\d/.test(line)))) assert.ok(op.y < 265);
        }
      }
    });

    await t.test('lange Zahlungsabsätze und mehrseitige Bankfelder bleiben über dem Fuß', async () => {
      for (const count of [21, 120]) {
        const payment = {
          heading: 'Zahlungsinformationen', emphasis: 'Bitte fristgerecht zahlen.',
          intro: Array.from({ length: count }, (_, index) => `Zahlungsbedingung ${index}`).join('\n'),
          fields: [{ label: 'Bank', value: 'QA-BANK' }, { label: 'IBAN', value: Array.from({ length: 90 }, (_, index) => `KONTO-${index}`).join('\n') }, { label: 'BIC', value: 'QA-BIC' }],
        };
        const result = await render({ ...model, payment });
        const lines = result.body.flat().flatMap(op => op.lines);
        for (let index = 0; index < count; index += 1) assert.equal(lines.filter(line => line === `Zahlungsbedingung ${index}`).length, 1);
        for (let index = 0; index < 90; index += 1) assert.equal(lines.filter(line => line === `KONTO-${index}`).length, 1);
        assert.equal(lines.filter(line => line === 'QA-BIC').length, 1);
        for (const page of result.preview.pages) {
          for (const op of page.filter(op => op.kind === 'text' && op.lines.some(line => /^(?:QA-|KONTO-|Zahlungsbedingung)/.test(line)))) assert.ok(op.y <= 265);
        }
      }
    });

    await t.test('SVG wird vor beiden Zeichenflächen zu einem gültigen PNG normalisiert', async () => {
      const source = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><rect width="200" height="50" fill="red"/></svg>').toString('base64')}`;
      let drawCalls = 0;
      globalThis.Image = class {
        naturalWidth = 200; naturalHeight = 50;
        set src(value) { this.source = value; queueMicrotask(() => this.onload()); }
      };
      globalThis.document = {
        createElement(type) {
          assert.equal(type, 'canvas');
          return { width: 0, height: 0, getContext: () => ({ drawImage(image, x, y, width, height) {
            assert.equal(image.source, source); assert.deepEqual([x, y, width, height], [0, 0, 200, 50]); drawCalls += 1;
          } }), toDataURL: mime => { assert.equal(mime, 'image/png'); return png; } };
        },
      };
      const result = await render(model, { ...settings, showLogo: true }, { ...company, logo: source });
      const images = result.preview.pages.flat().filter(op => op.kind === 'image');
      assert.equal(drawCalls, 2);
      assert.equal(images.length, 1);
      assert.equal(images[0].href, png);
      assert.equal(images[0].width / images[0].height, 4);
      assert.equal(Object.keys(result.pdf.internal.collections.addImage_images).length, 1);
      assert.doesNotMatch(result.pdf.output(), /\/DCTDecode/);
      globalThis.document.createElement = () => ({ getContext: () => null });
      await assert.rejects(loadPdfImage(source), /aufbereitet/);
      const fallback = await render(model, { ...settings, showLogo: true }, { ...company, logo: source });
      assert.equal(fallback.preview.pages.flat().filter(op => op.kind === 'image').length, 0);
      assert.equal(Object.keys(fallback.pdf.internal.collections.addImage_images || {}).length, 0);
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
