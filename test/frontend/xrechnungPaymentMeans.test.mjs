import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

if (typeof globalThis.DOMParser === 'undefined') {
  globalThis.DOMParser = class {
    parseFromString(xml) {
      const stack = [];
      let malformed = false;
      for (const [, raw] of xml.matchAll(/<([^!?][^>]*)>/g)) {
        const token = raw.trim();
        const closing = token.startsWith('/');
        const selfClosing = token.endsWith('/');
        const name = token.replace(/^\//, '').replace(/\/$/, '').split(/[\s/]/, 1)[0];
        if (closing) {
          if (stack.pop() !== name) malformed = true;
        } else if (!selfClosing) stack.push(name);
      }
      malformed ||= stack.length > 0;
      const rootName = xml.match(/<([\w.-]+:)?([\w.-]+)(?:\s[^>]*)?>/)?.[2] || '';
      return {
        querySelector: selector => selector === 'parsererror' && malformed ? {} : null,
        documentElement: { localName: rootName },
        getElementsByTagNameNS: (_namespace, localName) => [...xml.matchAll(new RegExp(`<([\\w.-]+:)?${localName}(?:\\s[^>]*)?>`, 'g'))],
      };
    }
  };
}

const vite = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
const { generateXRechnungXML } = await vite.ssrLoadModule('/src/utils/pdf/xrechnungGenerator.ts');
after(() => vite.close());

const company = bankAccount => ({
  name: 'Beispielfirma GmbH', address: 'Teststraße 1', city: 'Berlin', postalCode: '10115',
  country: 'Deutschland', phone: '+49 30 123456', email: 'firma@example.test', taxId: 'DE123456789',
  ...(bankAccount ? { bankAccount, bic: 'BYLADEM1001' } : {}), defaultPaymentDays: 14,
});
const customer = {
  id: 'customer-1', customerNumber: 'K-1', name: 'Beispielkunde GmbH', customerType: 'organization',
  email: 'kunde@example.test', address: 'Markt 2', city: 'Hamburg', postalCode: '20095', country: 'Deutschland',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};
const invoice = {
  id: 'invoice-1', invoiceNumber: 'RE-1', customerId: customer.id, customerName: customer.name,
  issueDate: new Date('2026-10-15T00:00:00Z'), dueDate: new Date('2026-10-29T00:00:00Z'),
  items: [{ id: 'line-1', description: 'Beratung', quantity: 1, unitPrice: 100, taxRate: 19, total: 119, order: 1 }],
  subtotal: 100, taxAmount: 19, total: 119, status: 'sent', documentType: 'invoice', createdAt: new Date('2026-10-15T00:00:00Z'),
};

async function xmlFor(bankAccount) {
  return (await generateXRechnungXML(invoice, { format: 'xrechnung', company: company(bankAccount), customer })).text();
}

test('XRechnung enthält BG-16 ohne Bankverbindung und ordnet PaymentMeans korrekt ein', async () => {
  const xml = await xmlFor(null);
  assert.equal((xml.match(/<cac:PaymentMeans>/g) || []).length, 1);
  assert.match(xml, /<cac:PaymentMeans>\s*<cbc:PaymentMeansCode>1<\/cbc:PaymentMeansCode>\s*<\/cac:PaymentMeans>/);
  assert.doesNotMatch(xml, /<cac:PayeeFinancialAccount>/);
  assert.ok(xml.indexOf('<cac:Delivery>') < xml.indexOf('<cac:PaymentMeans>'));
  assert.ok(xml.indexOf('<cac:PaymentMeans>') < xml.indexOf('<cac:PaymentTerms>'));
  assert.ok(xml.indexOf('<cac:PaymentTerms>') < xml.indexOf('<cac:TaxTotal>'));
});

test('XRechnung enthält IBAN bei SEPA-Zahlung mit PaymentMeansCode 58', async () => {
  const xml = await xmlFor('DE02120300000000202051');
  assert.equal((xml.match(/<cac:PaymentMeans>/g) || []).length, 1);
  assert.match(xml, /<cbc:PaymentMeansCode>58<\/cbc:PaymentMeansCode>/);
  assert.match(xml, /<cbc:ID>DE02120300000000202051<\/cbc:ID>/);
  assert.match(xml, /<cbc:ID>BYLADEM1001<\/cbc:ID>/);
  assert.ok(xml.indexOf('<cac:Delivery>') < xml.indexOf('<cac:PaymentMeans>'));
  assert.ok(xml.indexOf('<cac:PaymentMeans>') < xml.indexOf('<cac:PaymentTerms>'));
  assert.ok(xml.indexOf('<cac:PaymentTerms>') < xml.indexOf('<cac:TaxTotal>'));
});
