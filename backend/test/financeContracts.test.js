import test from 'node:test';
import assert from 'node:assert/strict';
import { migrations } from '../migrations/index.js';
import levyPaymentsRouter, { validate as validateLevyPayment } from '../routes/levyPayments.js';
import recurringExpensesRouter from '../routes/recurringExpenses.js';
import { validateExpense } from '../services/recurringExpenses.js';

const routePaths = router => router.stack.filter(layer => layer.route).map(layer => layer.route.path);

test('Fixkosten- und Erweiterungsmigrationen sind gezielt und fortlaufend registriert', () => {
  const financeMigrations = migrations.filter(migration => /^05[123]_/.test(migration.name));
  assert.deepEqual(financeMigrations.map(migration => migration.name), [
    '051_tax_profiles', '052_recurring_expenses', '053_workspace_extensions',
  ]);
  assert.ok(financeMigrations.every(migration => typeof migration.up === 'function' && typeof migration.down === 'function'));
});

test('Geschäftliche Fixkosten und private Abgaben haben getrennte Vertragswerte', () => {
  const business = validateExpense({ name: 'Miete', category: 'rent', amount: 500, startDate: '2026-01-01' }, '2026-01-01');
  const privateLevy = validateExpense({ name: 'KV', category: 'kv', scope: 'private_levy', amount: 300, startDate: '2026-01-01' }, '2026-01-01');
  const misclassifiedBusiness = validateExpense({ name: 'KV', category: 'kv', amount: 300, startDate: '2026-01-01' }, '2026-01-01');
  const misclassifiedPrivate = validateExpense({ name: 'Miete', category: 'rent', scope: 'private_levy', amount: 300, startDate: '2026-01-01' }, '2026-01-01');
  assert.equal(typeof business, 'object');
  assert.equal(business.scope, 'business');
  assert.equal(typeof privateLevy, 'object');
  assert.equal(privateLevy.scope, 'private_levy');
  assert.equal(typeof misclassifiedBusiness, 'string');
  assert.equal(typeof misclassifiedPrivate, 'string');
  assert.ok(routePaths(recurringExpensesRouter).includes('/runs/:runId/confirm'));
});

test('Abgabenvertrag akzeptiert kein Auseinanderlaufen von kanonischem Jahr und Periode', () => {
  const mismatch = validateLevyPayment({ kind: 'kv', year: 2027, period: '2026-04', amount: 100 });
  const canonical = validateLevyPayment({ kind: 'kv', year: 2027, period: '2027-04', amount: 100 });
  assert.match(mismatch, /passen nicht zusammen/);
  assert.equal(typeof canonical, 'object');
  assert.equal(canonical.periodStart, '2027-04-01');
  assert.ok(routePaths(levyPaymentsRouter).includes('/:id'));
});
