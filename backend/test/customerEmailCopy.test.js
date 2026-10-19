import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { pool } from '../database.js';
import {
  sendInvoiceEmail,
  sendInvoiceEmailMultiFormat,
  sendQuoteEmail,
  sendReminderEmail,
  sendSystemEmail,
} from '../services/emailService.js';
import { customerEmailCopy, customerEmailDeliveryResult } from '../utils/customerEmailCopy.js';
import { getRequestContext, runWithRequestContext } from '../utils/requestContext.js';
import { encryptSecret } from '../utils/secretBox.js';

const senderEmail = 'archive@example.invalid';
const customerEmail = 'customer@example.invalid';
const document = {
  id: 'invoice-fixture',
  invoiceNumber: 'RE-2026-001',
  quoteNumber: 'AN-2026-001',
  customerId: 'customer-fixture',
  customerName: 'Musterkunde',
  issueDate: '2026-10-13',
  dueDate: '2026-10-27',
  validUntil: '2026-10-27',
  total: 119,
  subtotal: 100,
  taxAmount: 19,
  pdfBuffer: Buffer.from('fixture-pdf').toString('base64'),
};
const company = { name: 'Musterbetrieb', locale: 'de-DE', currency: 'EUR' };
const customerSenders = [
  ['Rechnung', email => sendInvoiceEmail(email, Buffer.from('fixture-pdf'), document, 'zugferd', null, [], company), 'invoice_zugferd'],
  ['Rechnung mit mehreren Formaten', email => sendInvoiceEmailMultiFormat(email, [{ format: 'zugferd', content: Buffer.from('fixture-pdf') }], document, null, [], company), 'invoice_multi'],
  ['Angebot', email => sendQuoteEmail([email], document, company), 'quote'],
  ['Zahlungserinnerung', email => sendReminderEmail([email], document.pdfBuffer, document, 1, 0, null, company), 'reminder'],
];

function installMailFixture(t, resultFor = null) {
  const previousKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = '1'.repeat(64);
  t.after(() => {
    if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previousKey;
  });
  const settings = {
    smtp_host: 'smtp.example.invalid',
    smtp_port: 587,
    smtp_secure: false,
    smtp_user: 'account@example.invalid',
    smtp_pass_encrypted: encryptSecret('fixture-smtp-password'),
    email_from: senderEmail,
    email_from_name: 'Musterbetrieb',
    is_enabled: true,
  };
  const messages = [];
  const history = [];
  const contexts = [];
  t.mock.method(pool, 'connect', async () => ({
    query: async (sql, params) => {
      contexts.push(getRequestContext()?.workspaceId);
      if (sql.includes('FROM smtp_settings')) return { rows: [settings] };
      if (sql.includes('INSERT INTO email_history')) history.push(params);
      return { rows: [] };
    },
    release() {},
  }));
  t.mock.method(nodemailer, 'createTransport', () => ({
    sendMail: async options => {
      messages.push(options);
      const to = String(options.to).split(',').map(address => address.trim());
      return {
        messageId: 'fixture-message-id',
        response: '250 OK',
        accepted: [...to, ...(options.bcc ? [options.bcc] : [])],
        rejected: [],
        ...(resultFor ? resultFor(options) : {}),
      };
    },
  }));
  return { messages, history, contexts, settings };
}

test('Eigenkopie geht an den Absender und wird bei vorhandenen Empfängern nicht verdoppelt', () => {
  assert.equal(customerEmailCopy(senderEmail, customerEmail), senderEmail);
  assert.equal(customerEmailCopy(` ${senderEmail} `, [customerEmail]), senderEmail);
  assert.equal(customerEmailCopy(senderEmail, ' ARCHIVE@EXAMPLE.INVALID '), undefined);
  assert.equal(customerEmailCopy(senderEmail, [customerEmail, 'ARCHIVE@example.invalid']), undefined);
  assert.equal(customerEmailCopy(senderEmail, `${customerEmail}, ${senderEmail}`), undefined);
  assert.equal(customerEmailCopy(senderEmail, `Musterbetrieb <${senderEmail}>`), undefined);
  for (const invalid of [undefined, '', 'invalid', 'one@example.invalid,two@example.invalid', 'archive@example.invalid\r\nBcc: other@example.invalid']) {
    assert.throws(() => customerEmailCopy(invalid, customerEmail), /gültige Absender-E-Mail-Adresse/);
  }
});

test('Alle vier Kundenversandwege senden dieselbe Nachricht mit Eigenkopie und korrektem Historientyp', async t => {
  const fixture = installMailFixture(t);
  await runWithRequestContext({ workspaceId: 'workspace-fixture' }, async () => {
    for (const [name, send, emailType] of customerSenders) {
      const result = await send(customerEmail);
      const mail = fixture.messages.at(-1);
      assert.equal(result.success, true, name);
      assert.equal(mail.bcc, senderEmail, name);
      assert.equal(result.copyRecipient, senderEmail, name);
      assert.equal(result.copyAccepted, true, name);
      assert.equal(result.warning, undefined, name);
      assert.ok(mail.attachments.length > 0, name);
      assert.equal(fixture.history.at(-1)[15], emailType, name);
    }
  });
  assert.ok(fixture.contexts.length > 0);
  assert.ok(fixture.contexts.every(workspaceId => workspaceId === 'workspace-fixture'));
});

test('Alle vier Kundenversandwege vermeiden die zweite Kopie, wenn der Absender schon Empfänger ist', async t => {
  const fixture = installMailFixture(t);
  for (const [name, send] of customerSenders) {
    const result = await send('ARCHIVE@example.invalid');
    assert.equal(result.success, true, name);
    assert.equal(fixture.messages.at(-1).bcc, undefined, name);
    assert.equal(result.copyAccepted, true, name);
  }
});

test('Eine abgelehnte Eigenkopie bleibt ein erfolgreicher Kundenversand mit sichtbarer Warnung', async t => {
  const fixture = installMailFixture(t, () => ({ accepted: [customerEmail], rejected: [senderEmail] }));
  for (const [name, send] of customerSenders) {
    const result = await send(customerEmail);
    assert.equal(result.success, true, name);
    assert.equal(result.copyAccepted, false, name);
    assert.match(result.warning, /Kopie.*abgelehnt/, name);
    const history = fixture.history.at(-1);
    assert.equal(history[17], 'sent', name);
    assert.deepEqual(JSON.parse(history[8]).rejected, [senderEmail], name);
  }
});

test('Nur die angenommene Eigenkopie macht einen abgelehnten Kundenversand nicht erfolgreich', async t => {
  installMailFixture(t, () => ({ accepted: [senderEmail], rejected: [customerEmail] }));
  for (const [name, send] of customerSenders) {
    if (name.startsWith('Rechnung')) {
      await assert.rejects(() => send(customerEmail), /keinen Kundenempfänger angenommen/);
    } else {
      const result = await send(customerEmail);
      assert.equal(result.success, false, name);
      assert.match(result.message, /keinen Kundenempfänger angenommen/, name);
    }
  }
});

test('Teilweise abgelehnte Kundenliste berichtet die betroffenen Adressen ohne Komplettfehler', () => {
  const result = customerEmailDeliveryResult({ accepted: [customerEmail, senderEmail], rejected: ['second@example.invalid'] }, senderEmail, [customerEmail, 'second@example.invalid']);
  assert.equal(result.copyAccepted, true);
  assert.match(result.warning, /second@example.invalid/);
});

test('System- und Auth-Mails bekommen keine automatische Eigenkopie', async t => {
  const fixture = installMailFixture(t);
  await sendSystemEmail({ workspaceId: 'system-workspace-fixture', to: customerEmail, subject: 'Systemmail', text: 'Testinhalt' });
  assert.equal(fixture.messages[0].bcc, undefined);
  assert.equal(fixture.history.length, 0);
  assert.ok(fixture.contexts.every(workspaceId => workspaceId === 'system-workspace-fixture'));
});
