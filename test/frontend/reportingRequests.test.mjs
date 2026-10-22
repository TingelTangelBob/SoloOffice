import test from 'node:test';
import assert from 'node:assert/strict';
import { changeReportingYear, createRequestScope, runScopedRequest } from '../../.test-dist/utils/reportingRequests.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('reporting year changes its default journal range in one state transition', () => {
  assert.deepEqual(changeReportingYear({ selectedYear: 2026, startDate: '2026-01-01', endDate: '2026-12-31', selectedCustomer: 'customer-a' }, 2025), {
    selectedYear: 2025, startDate: '2025-01-01', endDate: '2025-12-31', selectedCustomer: 'customer-a',
  });
});

test('reporting year preserves custom or open date ranges', () => {
  for (const range of [{ startDate: '2026-03-01', endDate: '2026-03-31' }, { startDate: '', endDate: '' }]) {
    const filters = { selectedYear: 2026, selectedCustomer: '', ...range };
    assert.deepEqual(changeReportingYear(filters, 2024), { ...filters, selectedYear: 2024 });
  }
});

test('late filter or workspace results cannot overwrite the current journal or loading state', async () => {
  const oldScope = createRequestScope();
  const currentScope = createRequestScope();
  const old = deferred();
  const current = deferred();
  const changes = [];
  const handlers = [value => changes.push(['data', value]), error => changes.push(['error', error]), () => changes.push(['loading', false])];
  const first = runScopedRequest(oldScope, () => old.promise, ...handlers);
  oldScope.invalidate(); // Effect cleanup on year, customer, date, workspace or refresh change.
  const second = runScopedRequest(currentScope, () => current.promise, ...handlers);
  current.resolve('new-workspace-2025');
  await second;
  old.resolve('old-workspace-2026');
  await first;
  assert.deepEqual(changes, [['data', 'new-workspace-2025'], ['loading', false]]);
});

test('errors and finalizers from abandoned reporting requests are ignored', async () => {
  const scope = createRequestScope();
  const request = deferred();
  const changes = [];
  const pending = runScopedRequest(scope, () => request.promise,
    value => changes.push(value), error => changes.push(error), () => changes.push('settled'));
  scope.invalidate();
  request.reject(new Error('late failure'));
  await pending;
  assert.deepEqual(changes, []);
});

test('an active reporting error clears loading and reaches the caller', async () => {
  const error = new Error('current failure');
  const changes = [];
  await runScopedRequest(createRequestScope(), async () => { throw error; },
    value => changes.push(value), value => changes.push(value), () => changes.push('settled'));
  assert.deepEqual(changes, [error, 'settled']);
});
