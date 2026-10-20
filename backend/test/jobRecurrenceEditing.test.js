import test from 'node:test';
import assert from 'node:assert/strict';
import jobsRouter from '../routes/jobs.js';
import { pool } from '../database.js';
import { sameRecurrenceRule } from '../utils/jobRecurrenceRule.js';

const rule = { intervalUnit: 'week', interval: 1, startDate: '2026-10-19', duration: 3, weekdays: [1, 3] };

test('Regelvergleich ignoriert Metadaten, Aliasfelder und Wochentagsreihenfolge', () => {
  assert.equal(sameRecurrenceRule(rule, { ...rule, duration: undefined, durationWeeks: 3, weekdays: [3, 1, 3], id: 'series-1', occurrenceIndex: 2 }), true);
  assert.equal(sameRecurrenceRule(rule, JSON.stringify(rule)), true);
  for (const change of [{ duration: 4 }, { interval: 2 }, { weekdays: [1, 5] }, { startDate: '2026-10-20' }]) {
    assert.equal(sameRecurrenceRule(rule, { ...rule, ...change }), false);
  }
  assert.equal(sameRecurrenceRule(rule, null), false);
});

function fixture(t) {
  const current = { id: 'job-2', recurrence_id: 'series-1', recurrence_rule: rule, recurrence_index: 2,
    status: 'in-progress', customer_id: 'customer-1', title: 'Kurs', description: 'Termin', date: '2026-10-21' };
  const calls = [];
  t.mock.method(pool, 'connect', async () => ({
    query: async (sql, params = []) => {
      const statement = sql.trim();
      calls.push({ sql: statement, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(statement)) return { rows: [] };
      if (statement.startsWith('SELECT j.status,')) return { rows: [{ ...current }] };
      if (statement.startsWith('SELECT * FROM job_entries WHERE recurrence_id')) {
        return { rows: [{ ...current, id: 'job-1', recurrence_index: 1, status: 'completed' }, { ...current }] };
      }
      if (statement.startsWith('UPDATE job_entries SET')) {
        current.description = params[0];
        return { rows: [{ ...current }] };
      }
      if (statement.startsWith('SELECT j.*,')) return { rows: [{ ...current }] };
      throw new Error(`Unerwartete Datenbankabfrage: ${statement}`);
    },
    release() {},
  }));
  return { current, calls };
}

async function update(body) {
  const handler = jobsRouter.stack.find(layer => layer.route?.path === '/:id' && layer.route.methods.put).route.stack[0].handle;
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await handler({ params: { id: 'job-2' }, body }, response);
  return response;
}

test('Inhalt einer Serie mit abgeschlossenem Termin bleibt bei unveränderter Regel bearbeitbar', async t => {
  const { current, calls } = fixture(t);
  const response = await update({ description: 'Neue Beschreibung', recurrence: { ...rule, id: 'series-1', weekdays: [3, 1], occurrenceIndex: 2 } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.description, 'Neue Beschreibung');
  assert.equal(current.description, 'Neue Beschreibung');
  assert.ok(calls.some(call => call.sql === 'COMMIT'));
  assert.ok(!calls.some(call => /UPDATE job_recurrences|DELETE FROM job|INSERT INTO job/.test(call.sql)));
});

test('Echte Regeländerung und Entfernen bleiben bei geschützten Terminen gesperrt', async t => {
  const { current, calls } = fixture(t);
  for (const recurrence of [{ ...rule, duration: 4 }, null]) {
    const response = await update({ description: 'Nicht speichern', recurrence });
    assert.equal(response.statusCode, 409);
    assert.match(response.payload.error, /abgeschlossene oder abgerechnete/);
  }
  assert.equal(current.description, 'Termin');
  assert.ok(!calls.some(call => call.sql.startsWith('UPDATE')));
  assert.equal(calls.filter(call => call.sql === 'ROLLBACK').length, 2);
});
