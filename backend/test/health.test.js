import test from 'node:test';
import assert from 'node:assert/strict';

import { livenessPayload, readinessResult } from '../utils/health.js';

test('Liveness benötigt keine Datenbankdetails', () => {
  assert.deepEqual(livenessPayload(), { status: 'UP' });
});

test('Readiness meldet eine erreichbare Datenbank minimal', () => {
  assert.deepEqual(readinessResult({ healthy: true, poolStats: { totalCount: 7 } }), {
    statusCode: 200,
    payload: { status: 'READY', database: { status: 'connected' } },
  });
});

test('öffentliche Readiness gibt keine internen Datenbankfehler preis', () => {
  const result = readinessResult({
    healthy: false,
    error: 'password authentication failed for user internal_admin',
    poolStats: { totalCount: 20, waitingCount: 99 },
  });
  assert.equal(result.statusCode, 503);
  assert.equal(result.payload.code, 'DATABASE_UNAVAILABLE');
  assert.equal(JSON.stringify(result).includes('internal_admin'), false);
  assert.equal(JSON.stringify(result).includes('waitingCount'), false);
});

test('der kompatible Health-Endpunkt behält sein bisheriges Statusformat', () => {
  assert.deepEqual(readinessResult({ healthy: true }, { legacy: true }), {
    statusCode: 200,
    payload: { status: 'OK', message: 'Server is running', database: { status: 'connected' } },
  });
});
