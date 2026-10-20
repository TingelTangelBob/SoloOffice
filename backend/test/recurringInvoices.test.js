import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertDateOnly as assertCalendarDate } from '../shared/recurrence.js';

// Execute the real route handlers with isolated dependencies: no pool or network is opened.
const routeSource = readFileSync(new URL('../routes/recurringInvoices.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace('export default router;', 'return router;');
const loadRouter = new Function('express', 'pool', 'logger', 'createInvoice', 'findInvoiceById', 'assertCalendarDate', routeSource);

function template(overrides = {}) {
  return {
    id: 'template-1', customer_id: 'customer-1', customer_name: 'Testkunde', name: 'Wartung',
    items: [{ description: 'Leistung', quantity: 1, unitPrice: 100, taxRate: 0 }],
    frequency: 'monthly', interval_value: 1, interval_unit: 'month',
    start_date: '2026-01-01', next_run_date: '2026-10-20', end_date: null,
    last_run_date: null, due_days: 0, status: 'active', ...overrides,
  };
}

function fixture(row, lockedRow = row) {
  const routes = [];
  const queries = [];
  const invoices = [];
  const query = async (sql, params = []) => {
    sql = sql.trim();
    queries.push({ sql, params });
    if (sql.includes('FROM recurring_invoices')) return { rows: [sql.includes('FOR UPDATE') ? lockedRow : row] };
    if (sql.includes('FROM recurring_invoice_runs')) return { rows: [{ scheduled_date: row.next_run_date }] };
    if (sql.startsWith('UPDATE recurring_invoices')) return { rows: [{ id: row.id }] };
    if (sql.includes('INSERT INTO recurring_invoice_runs')) return { rows: [] };
    throw new Error(`Unerwartete SQL: ${sql}`);
  };
  const router = {};
  for (const method of ['get', 'post', 'put', 'delete']) {
    router[method] = (path, handler) => routes.push({ method, path, handler });
  }
  loadRouter({ Router: () => router }, { query }, { error() {} }, async (payload, hook) => {
    invoices.push(payload);
    const invoice = { ...payload, id: 'invoice-1' };
    await hook({ query }, invoice);
    return invoice;
  }, async () => null, assertCalendarDate);
  return {
    queries, invoices,
    async invoke(method, path, body = {}) {
      const route = routes.find(route => route.method === method && route.path === path);
      assert.ok(route);
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.payload = payload; return this; },
      };
      await route.handler({ body, params: { id: row.id } }, res);
      return res;
    },
  };
}

async function inBerlin(callback) {
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  try { await callback(); } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
}

test('Vorlagen und Laufprotokoll liefern PostgreSQL-DATE als lokale Kalendertage', async () => {
  await inBerlin(async () => {
    const state = fixture(template({ start_date: new Date(2026, 0, 1), next_run_date: new Date(2026, 9, 20),
      end_date: new Date(2026, 11, 31), last_run_date: new Date(2026, 8, 20) }));
    const response = await state.invoke('get', '/:id');
    assert.equal(response.payload.startDate, '2026-01-01');
    assert.equal(response.payload.nextRunDate, '2026-10-20');
    assert.equal(response.payload.endDate, '2026-12-31');
    assert.equal(response.payload.lastRunDate, '2026-09-20');
    assert.equal((await state.invoke('get', '/:id/runs')).payload[0].scheduledDate, '2026-10-20');
  });
});

test('Enddatum entfernen speichert SQL NULL und erhält Zahlungsziel und MwSt. null', async () => {
  await inBerlin(async () => {
    const state = fixture(template({ start_date: new Date(2026, 0, 1), next_run_date: new Date(2026, 9, 20), end_date: new Date(2026, 11, 31) }));
    const response = await state.invoke('put', '/:id', { endDate: null, dueDays: 0 });
    assert.equal(response.statusCode, 200);
    const update = state.queries.find(({ sql }) => sql.startsWith('UPDATE recurring_invoices'));
    assert.deepEqual(update.params, [null, 0, 'template-1']);
    assert.equal(response.payload.dueDays, 0);
    assert.equal(response.payload.items[0].taxRate, 0);
  });
});

test('Erzeugen ohne expliziten Termin akzeptiert PostgreSQL-DATE und beendet nach dem inklusiven Enddatum', async () => {
  await inBerlin(async () => {
    const state = fixture(template({ next_run_date: new Date(2026, 9, 20), end_date: new Date(2026, 9, 20) }));
    const response = await state.invoke('post', '/:id/generate');
    assert.equal(response.statusCode, 201);
    assert.equal(response.payload.issueDate, '2026-10-20');
    assert.equal(response.payload.dueDate, '2026-10-20');
    assert.equal(response.payload.items[0].taxRate, 0);
    const update = state.queries.find(({ sql }) => sql.includes('SET last_run_date'));
    assert.deepEqual(update.params, ['2026-10-20', '2026-11-20', 'ended', 'template-1']);
  });
});

test('Gemischte String-/DATE-Werte verhindern das Erzeugen nach dem Enddatum vor der Rechnungserstellung', async () => {
  await inBerlin(async () => {
    for (const [next_run_date, end_date] of [
      ['2026-10-21', new Date(2026, 9, 20)],
      [new Date(2026, 9, 21), '2026-10-20'],
    ]) {
      const state = fixture(template({ next_run_date, end_date }));
      const response = await state.invoke('post', '/:id/generate');
      assert.equal(response.statusCode, 400);
      assert.equal(state.invoices.length, 0);
    }
  });
});

test('Gesperrte Vorlage prüft expliziten Termin und zwischenzeitlich geändertes PostgreSQL-Enddatum', async () => {
  await inBerlin(async () => {
    const row = template({ next_run_date: new Date(2026, 9, 20) });
    const state = fixture(row, { ...row, end_date: new Date(2026, 9, 19) });
    const response = await state.invoke('post', '/:id/generate', { scheduledDate: '2026-10-20' });
    assert.equal(response.statusCode, 400);
    assert.match(response.payload.error, /bereits beendet/);
    assert.ok(!state.queries.some(({ sql }) => sql.includes('SET last_run_date')));
    assert.ok(!state.queries.some(({ sql }) => sql.includes("VALUES ($1, 'success'")));
  });
});

test('Ungültiger Ausführungstag bleibt ein Validierungsfehler ohne Rechnungserstellung', async () => {
  const state = fixture(template());
  const response = await state.invoke('post', '/:id/generate', { scheduledDate: '2026-02-30' });
  assert.equal(response.statusCode, 400);
  assert.equal(state.invoices.length, 0);
});
