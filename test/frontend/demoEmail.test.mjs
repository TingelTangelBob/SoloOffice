import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(String(key), String(value)); }
  removeItem(key) { this.#values.delete(String(key)); }
  clear() { this.#values.clear(); }
}

async function loadDemoApi() {
  const base = path.resolve('.test-dist');
  await mkdir(base, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(base, 'demo-email-'));
  const bundle = await rolldown({
    input: path.resolve('src/services/demoApi.ts'), platform: 'browser',
    plugins: [{
      name: 'demo-email-env',
      transform(code) {
        return code.replaceAll('import.meta.env', "({ VITE_API_URL: '/api', VITE_DEMO_MODE: 'true', DEV: false, PROD: true })");
      },
    }],
  });
  const output = path.join(temporaryDirectory, 'demo-email.mjs');
  await bundle.write({ file: output, format: 'esm' });
  await bundle.close();
  return { module: await import(pathToFileURL(output).href), temporaryDirectory };
}

const storageKey = 'solooffice-demo-data-v1';
const readState = () => JSON.parse(globalThis.localStorage.getItem(storageKey));
const writeState = state => globalThis.localStorage.setItem(storageKey, JSON.stringify(state));
const post = body => ({ method: 'POST', body: JSON.stringify(body) });

test('Demo-Angebots- und Rechnungsabläufe bleiben lokal und durchgängig', async t => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = () => {
    networkRequests += 1;
    throw new Error('Demo-E-Mail darf keinen echten Versand auslösen.');
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const { module: api, temporaryDirectory } = await loadDemoApi();
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  api.resetDemoWorkspaceData({ companyProfile: true, takeover: true });
  const state = readState();
  state.company.email = 'absender@example.com';
  state.customers = [{ id: 'customer-1', name: 'Demokunde' }];
  state.quotes = [{ id: 'quote-1', customerId: 'customer-1', status: 'draft' }];
  state.invoices = [
    { id: 'invoice-1', invoiceNumber: 'RE-2026-001', customerId: 'customer-1', customerName: 'Demokunde',
      status: 'sent', documentType: 'invoice', issueDate: '2026-10-01', dueDate: '2026-10-10', subtotal: 224.70, taxAmount: 42.69, total: 267.39 },
    { id: 'invoice-email', invoiceNumber: 'RE-2026-002', customerId: 'customer-1', customerName: 'Demokunde',
      status: 'draft', documentType: 'invoice', subtotal: 100, taxAmount: 19, total: 119 },
  ];
  writeState(state);
  const quotePayload = { customerEmails: ['kunde@example.com'], pdfBuffer: 'JVBERi0=' };

  await t.test('Demo-Einstellungen lehnen leere Pflichtfelder ab', async () => {
    const before = readState();
    await assert.rejects(api.demoRequest('/company', { method: 'PUT', body: JSON.stringify({ name: ' ' }) }), /Firmennamen/);
    assert.deepEqual(readState(), before);
  });

  await t.test('Angebotsversand setzt den Entwurf auf versendet und erlaubt den nächsten Status', async () => {
    const result = await api.demoRequest('/quotes/quote-1/send-email', post(quotePayload));
    assert.equal(result.success, true);
    assert.equal(result.simulated, true);
    assert.match(result.message, /keine E-Mail verschickt/);
    assert.match(result.messageId, /^<demo-.+@solooffice\.local>$/);
    assert.equal(result.copyRecipient, 'absender@example.com');
    assert.equal(result.copyAccepted, true);
    assert.equal(readState().quotes[0].status, 'sent');
    assert.ok(readState().quotes[0].updatedAt);
    await api.demoRequest('/quotes/quote-1', { method: 'PUT', body: JSON.stringify({ status: 'accepted' }) });
    await api.demoRequest('/quotes/quote-1/send-email', post(quotePayload));
    assert.equal(readState().quotes[0].status, 'accepted', 'Erneuter Versand erhält den bereits fortgeschrittenen Status');
  });

  await t.test('Manuell als versendet markiertes Angebot kann genau einmal zur Rechnung werden', async () => {
    const state = readState();
    state.quotes.push({
      id: 'quote-2', customerId: 'customer-1', customerName: 'Demokunde',
      quoteNumber: 'AN-2026-002', status: 'draft', notes: '',
      items: [{ id: 'item-1', description: 'Arbeit', quantity: 1, unitPrice: 100, taxRate: 19, total: 100, order: 0 }],
      attachments: [{ id: 'quote-attachment-1', name: 'Anlage.pdf', content: 'JVBERi0=', contentType: 'application/pdf', size: 7, uploadedAt: '2026-10-20T10:00:00.000Z' }],
    });
    writeState(state);

    await api.demoRequest('/quotes/quote-2', { method: 'PUT', body: JSON.stringify({ status: 'sent' }) });
    assert.equal(readState().quotes.find(item => item.id === 'quote-2').status, 'sent');
    await api.demoRequest('/quotes/quote-2', { method: 'PUT', body: JSON.stringify({ status: 'accepted' }) });
    const invoice = await api.demoRequest('/quotes/quote-2/convert-to-invoice', { method: 'POST' });
    assert.equal(invoice.sourceQuoteId, 'quote-2');
    assert.equal(invoice.total, 119);
    assert.equal(invoice.attachments.length, 1);
    assert.equal(invoice.attachments[0].name, 'Anlage.pdf');
    assert.equal(invoice.attachments[0].content, 'JVBERi0=');
    assert.notEqual(invoice.attachments[0].id, 'quote-attachment-1');
    assert.equal(readState().quotes.find(item => item.id === 'quote-2').status, 'billed');
    const invoiceCount = readState().invoices.length;
    const stateBeforeDelete = readState();
    await assert.rejects(api.demoRequest(`/invoices/${invoice.id}`, { method: 'DELETE' }), /Nur unabhängige Entwürfe ohne Dokumentquelle/);
    assert.deepEqual(readState(), stateBeforeDelete, 'Die verknüpfte Rechnung und das Angebot bleiben erhalten');
    await assert.rejects(api.demoRequest('/quotes/quote-2/convert-to-invoice', { method: 'POST' }));
    assert.equal(readState().invoices.length, invoiceCount, 'ein zweiter Aufruf erzeugt keine zusätzliche Rechnung');
  });

  await t.test('Fehlerhafte Angebote verändern weder Status noch Datenbestand', async () => {
    const before = readState();
    await assert.rejects(api.demoRequest('/quotes/missing/send-email', post(quotePayload)), { status: 404 });
    await assert.rejects(api.demoRequest('/quotes/quote-1/send-email', post({ ...quotePayload, customerEmails: [] })), { status: 400 });
    await assert.rejects(api.demoRequest('/quotes/quote-1/send-email', post({ ...quotePayload, customerEmails: ['ungueltig'] })), { status: 400 });
    await assert.rejects(api.demoRequest('/quotes/quote-1/send-email', post({ customerEmails: quotePayload.customerEmails })), { status: 400 });
    assert.deepEqual(readState(), before);
    api.setDemoActiveWorkspaceId('other-workspace');
    api.resetDemoWorkspaceData({ companyProfile: true, takeover: true });
    await assert.rejects(api.demoRequest('/quotes/quote-1/send-email', post(quotePayload)), { status: 404 });
    api.setDemoActiveWorkspaceId('demo-workspace');
    assert.deepEqual(readState(), before);
  });

  await t.test('Rechnungsversand liefert Erfolg für Einzel- und Mehrfachformat', async () => {
    const invoiceData = readState().invoices.find(item => item.id === 'invoice-email');
    const result = await api.demoRequest('/email/send-invoice', post({
      customerEmail: 'kunde@example.com', invoicePDF: 'JVBERi0=', invoiceData,
    }));
    assert.equal(result.success, true);
    assert.equal(result.simulated, true);
    assert.match(result.messageId, /^<demo-.+@solooffice\.local>$/);
    const recipients = ['kunde@example.com', 'buchhaltung@example.com'];
    const multi = await api.demoRequest('/email/send-invoice-multi', post({
      customerEmails: recipients, invoiceFormats: [{ format: 'zugferd', content: 'JVBERi0=' }], invoiceData,
    }));
    assert.equal(multi.success, true);
    assert.equal(multi.simulated, true);
    assert.equal(multi.successCount, 2);
    assert.equal(multi.failureCount, 0);
    assert.deepEqual(multi.results.map(item => item.email), recipients);
    assert.ok(multi.results.every(item => item.success && item.simulated && item.messageId && item.copyAccepted));
    assert.equal(new Set(multi.results.map(item => item.messageId)).size, 2);
    assert.equal(readState().invoices.find(item => item.id === 'invoice-email').status, 'draft', 'Wie im Backend setzt die Rechnungsoberfläche den Status separat');
    await assert.rejects(api.demoRequest('/email/send-invoice', post({ customerEmail: recipients[0], invoiceData })), { status: 400 });
    await assert.rejects(api.demoRequest('/email/send-invoice-multi', post({ customerEmails: [], invoiceFormats: [], invoiceData })), { status: 400 });
  });

  await t.test('Teilzahlung, Mahnstufen und Restzahlung gleichen EÜR und Rechnungsstatus ab', async () => {
    const partial = await api.demoRequest('/invoices/invoice-1/payments', post({ amount: 100, entryDate: '2026-10-20' }));
    assert.equal(partial.payment.amount, 100);
    assert.equal(partial.invoice.outstandingAmount, 167.39);
    assert.equal(readState().invoices[0].status, 'sent');
    await assert.rejects(api.demoRequest('/invoices/invoice-1/payments', post({ amount: 200, entryDate: '2026-10-20' })));

    const reminderResult = await api.demoRequest('/email/send-reminder', post({
      invoiceId: 'invoice-1', stage: 1, customerEmails: ['kunde@example.com'],
      reminderPDF: 'JVBERi0=', invoiceData: readState().invoices[0], fee: 0,
    }));
    assert.equal(reminderResult.success, true);
    assert.equal(reminderResult.simulated, true);
    assert.match(reminderResult.message, /keine E-Mail verschickt/);
    assert.equal(readState().invoices[0].status, 'sent', 'der simulierte Mailversand ändert den Mahnstatus nicht selbst');
    await api.demoRequest('/reminders/send/invoice-1', post({ stage: 1, updateStatus: true }));
    assert.equal(readState().invoices[0].status, 'reminded_1x');
    await api.demoRequest('/reminders/send/invoice-1', post({ stage: 2, updateStatus: true }));
    assert.equal(readState().invoices[0].status, 'reminded_2x');

    const rest = await api.demoRequest('/invoices/invoice-1/payments', post({ amount: 167.39, entryDate: '2026-10-20' }));
    assert.equal(rest.invoice.status, 'paid');
    assert.equal(rest.invoice.outstandingAmount, 0);
    const payments = readState().euerEntries.filter(entry => entry.sourceType === 'invoice_payment' && entry.sourceId === 'invoice-1');
    assert.deepEqual(payments.map(entry => entry.amount), [100, 167.39]);
    assert.equal(payments.reduce((sum, entry) => sum + entry.amount, 0), 267.39);
    await assert.rejects(api.demoRequest('/invoices/invoice-1/payments', post({ amount: 1, entryDate: '2026-10-20' })));
    await assert.rejects(api.demoRequest('/reminders/send/invoice-1', post({ stage: 3, updateStatus: true })));
    await assert.rejects(api.demoRequest('/email/send-reminder', post({
      invoiceId: 'invoice-1', stage: 3, customerEmails: ['kunde@example.com'],
      reminderPDF: 'JVBERi0=', invoiceData: readState().invoices[0], fee: 0,
    })), { status: 409 });
  });

  await t.test('Gutschrift entsteht negativ und ist als versendet markierbar', async () => {
    const creditNote = await api.demoRequest('/credit-notes', post({
      customerId: 'customer-1', referenceInvoiceId: 'invoice-1', creditNoteReason: 'Preisnachlass',
      issueDate: '2026-10-20', dueDate: '2026-10-20',
      items: [{ description: 'Nachlass', quantity: 1, unitPrice: 50, taxRate: 19, order: 0 }],
    }));
    assert.equal(creditNote.documentType, 'credit_note');
    assert.equal(creditNote.referenceInvoiceNumber, 'RE-2026-001');
    assert.equal(creditNote.total, -59.5);

    const sent = await api.demoRequest(`/credit-notes/${creditNote.id}`, {
      method: 'PUT', body: JSON.stringify({ status: 'sent' }),
    });
    assert.equal(sent.status, 'sent');
    assert.equal(readState().euerEntries.some(entry => entry.sourceId === creditNote.id), false);
    const beforeUnsupportedSettlement = readState();
    const blockedMessage = /Rückzahlung und Verrechnung sind noch nicht verfügbar/;
    await assert.rejects(api.demoRequest(`/credit-notes/${creditNote.id}`, {
      method: 'PUT', body: JSON.stringify({ status: 'paid' }),
    }), blockedMessage);
    await assert.rejects(api.demoRequest(`/invoices/${creditNote.id}`, {
      method: 'PUT', body: JSON.stringify({ status: 'paid' }),
    }), blockedMessage, 'Der allgemeine Rechnungsendpunkt darf die Gutschrift-Sperre nicht umgehen');
    await assert.rejects(api.demoRequest('/credit-notes', post({
      customerId: 'customer-1', referenceInvoiceId: 'invoice-1', creditNoteReason: 'Preisnachlass',
      issueDate: '2026-10-20', dueDate: '2026-10-20', status: 'paid',
      items: [{ description: 'Nachlass', quantity: 1, unitPrice: 50, taxRate: 19, order: 0 }],
    })), blockedMessage);
    assert.deepEqual(readState(), beforeUnsupportedSettlement, 'Abgewiesene Schein-Zahlungen verändern weder Gutschrift noch Buchungen');
    await assert.rejects(api.demoRequest(`/invoices/${creditNote.id}/payments`, post({ amount: 59.5, entryDate: '2026-10-20' })));
  });

  assert.equal(networkRequests, 0);
});
