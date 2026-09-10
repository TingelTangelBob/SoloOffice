import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../../database.js';
import { createInvoice, updateInvoice, deleteInvoice } from '../../services/invoiceService.js';
import { findInvoiceById } from '../../queries/invoiceQueries.js';
import { runWithRequestContext } from '../../utils/requestContext.js';
import { readBackupSnapshot } from '../../services/backupExport.js';
import { hasValidBackupManifest } from '../../utils/backupIntegrity.js';
import { createQuote, updateQuote, convertQuoteToInvoice } from '../../services/quoteService.js';
import { clearWorkspaceData } from '../../routes/backup.js';
import { deleteWorkspaceData } from '../../services/workspaceDeletion.js';
import invoicesRouter from '../../routes/invoices.js';
import { calculateDocumentMoney } from '../../utils/documentMoney.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Dieser Test benötigt eine ausdrücklich als Test benannte Datenbank.');
}
const workspaceId = randomUUID();
const inWorkspace = callback => runWithRequestContext({ workspaceId, userId: randomUUID() }, callback);
let customerId;
const item = { description: 'Beratung', quantity: 2, unitPrice: 100, taxRate: 19 };
const draft = (extra = {}) => ({ customerId, issueDate: '2099-02-01', dueDate: '2099-03-01', items: [item], ...extra });

async function recordPayment(invoiceId, amount) {
  const handler = invoicesRouter.stack.find(layer => layer.route?.path === '/:id/payments' && layer.route.methods.post)?.route.stack[0].handle;
  assert.equal(typeof handler, 'function');
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; } };
  await handler({ params: { id: invoiceId }, body: { amount, entryDate: '2099-02-15' } }, response);
  return response;
}

before(async () => {
  await query('INSERT INTO workspaces (id,name,slug) VALUES ($1,$2,$3)', [workspaceId, 'Rechnungsintegrität', `invoice-integrity-${workspaceId}`]);
  await inWorkspace(async () => {
    const customer = await query(`INSERT INTO customers (customer_number,name,address,city,postal_code,country)
      VALUES ('TEST-1','Originalkunde','Teststraße 1','Berlin','10115','Deutschland') RETURNING id`);
    customerId = customer.rows[0].id;
    // Nur separate Zahlungsdaten: auch dieser gültige Pflegepfad muss reichen.
    await query(`INSERT INTO company (name,address,city,postal_code,country,phone,email,tax_id,payment_bank_account)
      VALUES ('Originalfirma','Firmenstraße 1','Berlin','10115','Deutschland','0123','test@example.invalid','DE123456789','DE89370400440532013000')`);
    await query("INSERT INTO smtp_settings (smtp_host,is_enabled) VALUES ('smtp.example.invalid',FALSE)");
  });
});

after(async () => {
  try {
    await inWorkspace(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.audit_disabled','true',true), set_config('app.allow_history_purge','true',true)");
        await client.query('DELETE FROM euer_entry_history');
        await client.query('DELETE FROM euer_entries');
        await client.query('DELETE FROM smtp_settings');
        await client.query('DELETE FROM invoices');
        await client.query('DELETE FROM quotes');
        await client.query('DELETE FROM invoice_history');
        await client.query('DELETE FROM company');
        await client.query('DELETE FROM customers');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    });
    await query('DELETE FROM workspaces WHERE id=$1', [workspaceId]);
  } finally { await pool.end(); }
});

test('API ignoriert manipulierte Summen und berechnet geänderte Rabatte ohne neue Positionen', () => inWorkspace(async () => {
  const invoice = await createInvoice(draft({ subtotal: 1, taxAmount: 0, total: 1 }));
  assert.deepEqual([invoice.subtotal, invoice.taxAmount, invoice.total], [200, 38, 238]);
  const unchanged = await updateInvoice(invoice.id, { subtotal: 1, taxAmount: 0, total: 1 });
  assert.equal(unchanged.total, 238);
  const discounted = await updateInvoice(invoice.id, { globalDiscountType: 'percentage', globalDiscountValue: 10, globalDiscountAmount: 199 });
  assert.deepEqual([discounted.globalDiscountAmount, discounted.taxAmount, discounted.total], [20, 34.2, 214.2]);
  const cleared = await updateInvoice(invoice.id, { globalDiscountType: null });
  assert.equal(cleared.total, 238);
  await assert.rejects(updateInvoice(invoice.id, { items: [{ ...item, quantity: -1 }] }), error => error.statusCode === 400);
  assert.equal((await findInvoiceById(invoice.id)).total, 238);
  await assert.rejects(createInvoice(draft({ status: 'paid' })), error => error.statusCode === 409);
}));

test('Ausstellen sperrt Inhalte in Service und Datenbank, Status bleibt fortschreibbar', () => inWorkspace(async () => {
  const invoice = await createInvoice(draft());
  const issued = await updateInvoice(invoice.id, { items: [{ ...item, quantity: 1 }], status: 'sent' });
  assert.equal(issued.total, 119);
  for (const update of [{ notes: 'nachträglich' }, { status: 'draft' }, { total: 1 }, { attachments: [] }]) {
    await assert.rejects(updateInvoice(invoice.id, update), error => error.statusCode === 409);
  }
  await assert.rejects(query("UPDATE invoices SET notes='direkt' WHERE id=$1", [invoice.id]), error => error.code === '23514');
  await assert.rejects(query('UPDATE invoice_items SET quantity=10 WHERE invoice_id=$1', [invoice.id]), error => error.code === '23514');
  await assert.rejects(query(`INSERT INTO invoice_attachments (invoice_id,name,content,content_type,size)
    VALUES ($1,'später.txt','x','text/plain',1)`, [invoice.id]), error => error.code === '23514');
  await assert.rejects(deleteInvoice(invoice.id), error => error.statusCode === 409);
  assert.equal((await updateInvoice(invoice.id, { status: 'overdue' })).status, 'overdue');
}));

test('Dokumentdaten bleiben nach Änderungen an Firma und Kunde erhalten und sind im Backup enthalten', () => inWorkspace(async () => {
  const invoice = await createInvoice(draft({ status: 'sent' }));
  const original = invoice.documentSnapshot;
  assert.equal(original.customer.name, 'Originalkunde');
  assert.equal(original.company.name, 'Originalfirma');
  assert.ok(!Object.keys(original.company).some(key => /password|smtp|secret/i.test(key)));
  await query("UPDATE company SET name='Spätere Firma', payment_bank_account='NEU'");
  await query("UPDATE customers SET name='Späterer Kunde' WHERE id=$1", [customerId]);
  assert.deepEqual((await updateInvoice(invoice.id, { status: 'overdue' })).documentSnapshot, original);
  const client = await pool.connect();
  try {
    const backup = await readBackupSnapshot(client, ['invoices', 'invoice_items']);
    assert.equal(hasValidBackupManifest(backup), true);
    assert.deepEqual(backup.data.invoices.find(row => row.id === invoice.id).document_snapshot, original);
  } finally { client.release(); }
  await query("UPDATE company SET name='Originalfirma', payment_bank_account='DE89370400440532013000'");
  await query("UPDATE customers SET name='Originalkunde' WHERE id=$1", [customerId]);
}));

test('Bestandsrechnung ohne Snapshot bleibt beim Statuswechsel unverändert', () => inWorkspace(async () => {
  const invoice = await createInvoice(draft());
  await query('UPDATE invoices SET document_snapshot=NULL, status=$1 WHERE id=$2', ['sent', invoice.id]);
  const changed = await updateInvoice(invoice.id, { status: 'overdue' });
  assert.equal(changed.documentSnapshot, undefined);
  assert.equal(changed.total, 238);
}));

test('Gutschrift berechnet negative Beträge und Gesamtrabatt konsistent', () => inWorkspace(async () => {
  const invoice = await createInvoice(draft({ documentType: 'credit_note', creditNoteReason: 'Korrektur', globalDiscountType: 'percentage', globalDiscountValue: 10 }));
  assert.deepEqual([invoice.subtotal, invoice.globalDiscountAmount, invoice.taxAmount, invoice.total], [-200, -20, -34.2, -214.2]);
  assert.equal((await updateInvoice(invoice.id, { status: 'sent' })).total, -214.2);
}));

test('Ein ausgewählter Nullrabatt bleibt nach Speicherung und Angebotsumwandlung berechenbar', () => inWorkspace(async () => {
  const items = [{ ...item, discountType: 'percentage', discountValue: 0 }];
  const invoice = await createInvoice(draft({ items, status: 'sent' }));
  assert.equal(invoice.items[0].discountValue, 0);
  assert.equal(calculateDocumentMoney(invoice).total, 238);
  const quote = await createQuote(draft({ items, validUntil: '2099-03-01' }));
  assert.equal(quote.items[0].discountValue, 0);
  const updated = await updateQuote(quote.id, { items, status: 'accepted' });
  assert.equal(updated.items[0].discountValue, 0);
  const converted = await convertQuoteToInvoice(quote.id);
  assert.equal(converted.invoice.items[0].discountValue, 0);
  assert.equal(calculateDocumentMoney(converted.invoice).total, 238);
}));

test('Teilzahlungen einer rabattierten Rechnung behalten den Steuersatz und schließen centgenau ab', () => inWorkspace(async () => {
  const invoice = await createInvoice(draft({ status: 'sent', globalDiscountType: 'percentage', globalDiscountValue: 10 }));
  assert.equal(invoice.total, 214.2);
  for (const invalidAmount of [0.001, 0.006, true, 214.21]) {
    assert.equal((await recordPayment(invoice.id, invalidAmount)).statusCode, 400);
  }
  const first = await recordPayment(invoice.id, 107.1);
  assert.equal(first.statusCode, 201);
  assert.equal(first.payload.payment.taxRate, 19);
  assert.equal(first.payload.invoice.status, 'sent');
  assert.equal(first.payload.invoice.outstandingAmount, 107.1);
  const second = await recordPayment(invoice.id, 107.1);
  assert.equal(second.statusCode, 201);
  assert.equal(second.payload.invoice.status, 'paid');
  assert.equal(second.payload.invoice.outstandingAmount, 0);
  assert.deepEqual(second.payload.invoice.documentSnapshot, invoice.documentSnapshot);
  assert.equal((await recordPayment(invoice.id, 0.01)).statusCode, 409);
}));

test('Angebot und Umwandlung verwenden berechnete Beträge und gespeicherte Dokumentdaten', () => inWorkspace(async () => {
  const quote = await createQuote(draft({ validUntil: '2099-03-01', globalDiscountType: 'percentage', globalDiscountValue: 10, globalDiscountAmount: 199 }));
  assert.equal(quote.total, 214.2);
  assert.equal((await updateQuote(quote.id, { total: 1 })).total, 214.2);
  assert.equal((await updateQuote(quote.id, { globalDiscountType: null })).total, 238);
  await updateQuote(quote.id, { status: 'accepted' });
  const result = await convertQuoteToInvoice(quote.id);
  assert.equal(result.invoice.total, 238);
  assert.equal(result.invoice.documentSnapshot.company.name, 'Originalfirma');
  assert.equal(result.invoice.sourceQuoteId, quote.id);
  assert.equal((await convertQuoteToInvoice(quote.id)).status, 400);
}));

test('Restore und bestätigte Workspace-Löschung berücksichtigen Dokumentzyklus, Zahlungen und SMTP-Konfiguration', () => inWorkspace(async () => {
  const quote = await createQuote(draft({ validUntil: '2099-03-01', status: 'accepted' }));
  const { invoice } = await convertQuoteToInvoice(quote.id);
  await updateInvoice(invoice.id, { status: 'sent' });
  for (const clear of [clearWorkspaceData, deleteWorkspaceData]) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.audit_disabled','true',true), set_config('app.allow_history_purge','true',true)");
      await clear(client, workspaceId);
      assert.equal(Number((await client.query('SELECT COUNT(*) FROM invoices')).rows[0].count), 0);
      assert.equal(Number((await client.query('SELECT COUNT(*) FROM quotes')).rows[0].count), 0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }
  assert.equal((await findInvoiceById(invoice.id)).status, 'sent');
}));
