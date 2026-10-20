import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import invoicesRouter from '../routes/invoices.js';
import { pool } from '../database.js';

async function updateStatuses(ids, status) {
  const handler = invoicesRouter.stack.find(layer => layer.route?.path === '/bulk-status' && layer.route.methods.patch)?.route.stack[0].handle;
  assert.equal(typeof handler, 'function');
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({ body: { ids, status } }, response);
  return response;
}

// Nur die Datenbank ist ersetzt; Router und Einzelupdate-Service laufen echt.
function fixture(t, records) {
  const invoices = records.map(record => ({
    id: randomUUID(), document_type: 'invoice', status: 'sent',
    customer_id: randomUUID(), issue_date: '2099-02-01', due_date: '2099-03-01',
    total: 238, subtotal: 200, tax_amount: 38, document_snapshot: { version: 1 },
    paymentAmount: 0, ...record,
  }));
  const calls = [];
  let afterPreflight;
  t.mock.method(pool, 'connect', async () => ({
    query: async (sql, params = []) => {
      const statement = sql.trim();
      calls.push({ sql: statement, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(statement)) return { rows: [] };
      if (statement.startsWith('SELECT id, status, document_type')) {
        const rows = invoices.filter(invoice => params[0].includes(invoice.id)).map(invoice => ({ ...invoice }));
        afterPreflight?.();
        return { rows };
      }
      if (statement.startsWith('SELECT * FROM invoices WHERE id')) {
        assert.match(statement, /FOR UPDATE/);
        return { rows: invoices.filter(invoice => invoice.id === params[0]).map(invoice => ({ ...invoice })) };
      }
      if (statement.startsWith('SELECT * FROM invoice_items')) {
        const invoice = invoices.find(invoice => invoice.id === params[0]);
        return { rows: invoice.emptyItems ? [] : [{ description: 'Beratung', quantity: 2, unit_price: 100, tax_rate: 19, total: 200 }] };
      }
      if (statement.startsWith('SELECT COALESCE(SUM(amount), 0) AS amount')) {
        return { rows: [{ amount: invoices.find(invoice => invoice.id === params[0]).paymentAmount }] };
      }
      if (statement.startsWith('UPDATE invoices SET customer_id=')) {
        const invoice = invoices.find(invoice => invoice.id === params[16]);
        invoice.status = params[8];
        return { rows: [] };
      }
      if (statement.startsWith('SELECT i.*,')) {
        return { rows: invoices.filter(invoice => invoice.id === params[0]) };
      }
      throw new Error(`Unerwartete Datenbankabfrage: ${statement}`);
    },
    release() {},
  }));
  return { invoices, calls, onPreflight(callback) { afterPreflight = callback; } };
}

test('Sammelstatus erhält vollständige Zahlungen bei Versand, Überfälligkeit und Mahnung', async t => {
  const { invoices, calls } = fixture(t, [{ status: 'paid', paymentAmount: 238 }, {}]);
  for (const status of ['sent', 'overdue', 'reminded_1x']) {
    const response = await updateStatuses(invoices.map(invoice => invoice.id), status);
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.partial, false);
    assert.deepEqual(response.payload.updatedIds, invoices.map(invoice => invoice.id));
    assert.equal(invoices[0].status, 'paid');
    assert.equal(invoices[1].status, status);
  }
  assert.equal(calls.filter(call => call.sql.endsWith('FOR UPDATE')).length, 6);
});

test('Sammelstatus bezahlt lehnt fehlende und unvollständige Zahlungen einzeln ab', async t => {
  const { invoices, calls } = fixture(t, [{ status: 'paid', paymentAmount: 238 }, {}, { paymentAmount: 100 }]);
  const response = await updateStatuses(invoices.map(invoice => invoice.id), 'paid');
  assert.equal(response.statusCode, 207);
  assert.equal(response.payload.partial, true);
  assert.deepEqual(response.payload.updatedIds, [invoices[0].id]);
  assert.deepEqual(response.payload.failedIds, invoices.slice(1).map(invoice => invoice.id));
  assert.ok(response.payload.failures.every(failure => /Zahlungseingang/.test(failure.message)));
  assert.deepEqual(invoices.map(invoice => invoice.status), ['paid', 'sent', 'sent']);
  assert.equal(calls.filter(call => call.sql === 'ROLLBACK').length, 2);
});

test('Sammelstatus berücksichtigt Zahlungen zwischen Vorprüfung und gesperrtem Update', async t => {
  const state = fixture(t, [{}]);
  state.onPreflight(() => {
    state.invoices[0].status = 'paid';
    state.invoices[0].paymentAmount = 238;
  });
  const response = await updateStatuses([state.invoices[0].id], 'overdue');
  assert.equal(response.statusCode, 200);
  assert.equal(state.invoices[0].status, 'paid');
});

test('Sammelstatus validiert beim Ausstellen auch die Positionen eines Entwurfs', async t => {
  const { invoices, calls } = fixture(t, [{ status: 'draft', emptyItems: true }]);
  const response = await updateStatuses([invoices[0].id], 'sent');
  assert.equal(response.statusCode, 207);
  assert.deepEqual(response.payload.updatedIds, []);
  assert.deepEqual(response.payload.failedIds, [invoices[0].id]);
  assert.match(response.payload.failures[0].message, /mindestens eine Position/);
  assert.equal(invoices[0].status, 'draft');
  assert.ok(!calls.some(call => call.sql.startsWith('UPDATE invoices')));
});
