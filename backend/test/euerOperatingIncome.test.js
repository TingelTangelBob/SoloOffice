import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseIncomeCategory } from '../routes/euerEntries.js';
import * as migration064 from '../migrations/064_euer_operating_income.js';

test('Rechnungszahlungen werden Betriebseinnahmen, manuelle Einnahmen bleiben sonstige', () => {
  assert.equal(normaliseIncomeCategory({ entryType: 'income', sourceType: 'invoice_payment', category: 'other_income' }).category, 'operating_income');
  assert.equal(normaliseIncomeCategory({ entryType: 'income', sourceType: 'manual', category: 'other_income' }).category, 'other_income');
  assert.equal(normaliseIncomeCategory({ entryType: 'income', category: 'operating_income' }).category, 'other_income');
  assert.equal(normaliseIncomeCategory({ entryType: 'expense', sourceType: 'manual', category: 'office' }).category, 'office');
});

test('Migration 064 stellt nur verknüpfte Rechnungszahlungen um', async () => {
  const statements = [];
  const client = { query: async (sql, params) => { statements.push({ sql: String(sql), params }); return { rows: [{ workspace_id: 'w1' }] }; } };
  await migration064.up(client);
  const update = statements.find(item => item.sql.startsWith('UPDATE euer_entries'));
  assert.match(update.sql, /source_type = 'invoice_payment'/);
  assert.match(update.sql, /entry_type = 'income'/);
  assert.deepEqual(update.params, ['operating_income', 'w1', 'other_income']);
  assert.ok(statements.some(item => item.sql.includes('euer_forecasts_category_check') && item.sql.includes('operating_income')));
});
