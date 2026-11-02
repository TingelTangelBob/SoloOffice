import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateXRechnungXML } from '../src/utils/pdf/xrechnungGenerator';
import type { Company, Customer, Invoice, InvoiceItem } from '../src/types';

// Der Generator enthält für die Browser-Laufzeit eine DOMParser-Prüfung. In
// Node übernehmen wir hier nur deren strukturelle Mindestprüfung; die
// verbindliche XML-/Fachregelprüfung führt anschließend KoSIT aus.
if (typeof globalThis.DOMParser === 'undefined') {
  class FixtureDOMParser {
    parseFromString(xml: string) {
      const stack: string[] = [];
      const tags = [...xml.matchAll(/<([^!?][^>]*)>/g)];
      let malformed = tags.length === 0;
      for (const match of tags) {
        const token = match[1].trim();
        const closing = token.startsWith('/');
        const selfClosing = token.endsWith('/');
        const name = token.replace(/^\//, '').replace(/\/$/, '').split(/[\s/]/, 1)[0];
        if (!name) { malformed = true; break; }
        if (closing) {
          if (stack.pop() !== name) { malformed = true; break; }
        } else if (!selfClosing) stack.push(name);
      }
      malformed ||= stack.length > 0;
      const root = xml.match(/<([\w.-]+:)?([\w.-]+)(?:\s[^>]*)?>/)?.[2] || '';
      return {
        querySelector: (selector: string) => selector === 'parsererror' && malformed ? {} : null,
        documentElement: { localName: root },
        getElementsByTagNameNS: (_namespace: string, localName: string) => [...xml.matchAll(new RegExp(`<([\\w.-]+:)?${localName}(?:\\s[^>]*)?>`, 'g'))],
      };
    }
  }
  Object.assign(globalThis, { DOMParser: FixtureDOMParser });
}

const outputDirectory = resolve(process.argv[2] || '.test-dist/xrechnung-fixtures');
await mkdir(outputDirectory, { recursive: true });

const company: Company = {
  name: 'Muster & Partner GmbH', address: 'Hauptstraße 1', city: 'Berlin', postalCode: '10115',
  country: 'Deutschland', phone: '+49 30 123456', email: 'rechnung@example.test', taxId: 'DE123456789',
  defaultPaymentDays: 14,
};
const customer: Customer = {
  id: 'customer-fixture', customerNumber: 'K-2026-01', name: 'Beispielkunde GmbH', customerType: 'organization',
  email: 'einkauf@example.test', address: 'Markt 2', city: 'Hamburg', postalCode: '20095', country: 'Deutschland',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function item(id: string, description: string, amount: number, taxRate: number, order: number): InvoiceItem {
  return { id, description, quantity: 1, unitPrice: amount, taxRate, total: amount * (1 + taxRate / 100), order };
}

const scenarios: Array<{ filename: string; company: Company; customer: Customer; items: InvoiceItem[]; subtotal: number; taxAmount: number; total: number }> = [
  {
    filename: 'regelbesteuerung-mehrere-steuersaetze.xml', company,
    customer: { ...customer, name: 'Kunde Regelbesteuerung' },
    items: [item('standard', 'Beratung (19 %)', 100, 19, 1), item('ermaessigt', 'Buch (7 %)', 50, 7, 2)],
    subtotal: 150, taxAmount: 22.5, total: 172.5,
  },
  {
    filename: 'kleinunternehmer-19-ustg.xml', company: { ...company, isSmallBusiness: true },
    customer: { ...customer, name: 'Kunde Kleinunternehmen' },
    items: [item('leistung', 'Dienstleistung nach § 19 UStG', 150, 0, 1)],
    subtotal: 150, taxAmount: 0, total: 150,
  },
  {
    filename: 'ausland-sonderzeichen.xml', company,
    customer: { ...customer, name: 'Müller & Söhne <Österreich>', address: 'Ringstraße 4 & 6', city: 'Wien', postalCode: '1010', country: 'Österreich' },
    items: [item('sonderzeichen', 'Prüfung & Beratung <Paket> „A“', 100, 19, 1)],
    subtotal: 100, taxAmount: 19, total: 119,
  },
];

for (const [index, scenario] of scenarios.entries()) {
  const invoice: Invoice = {
    id: `invoice-fixture-${index + 1}`, invoiceNumber: `TEST-2026-${String(index + 1).padStart(3, '0')}`,
    customerId: scenario.customer.id, customerName: scenario.customer.name,
    issueDate: new Date('2026-10-15T00:00:00Z'), dueDate: new Date('2026-10-29T00:00:00Z'),
    items: scenario.items, subtotal: scenario.subtotal, taxAmount: scenario.taxAmount, total: scenario.total,
    status: 'sent', documentType: 'invoice', createdAt: new Date('2026-10-15T00:00:00Z'),
  };
  const xml = await generateXRechnungXML(invoice, { format: 'xrechnung', company: scenario.company, customer: scenario.customer });
  await writeFile(resolve(outputDirectory, scenario.filename), await xml.text(), 'utf8');
}

console.log(`3 XRechnungen erzeugt: ${outputDirectory}`);
