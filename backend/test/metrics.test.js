import test from 'node:test';
import assert from 'node:assert/strict';
import { metricsAccessStatus } from '../utils/metrics.js';

test('Metriken sind ohne konfiguriertes Token geschlossen', () => {
  assert.equal(metricsAccessStatus('', undefined), 'unconfigured');
  assert.equal(metricsAccessStatus(undefined, undefined), 'unconfigured');
});

test('Metriken verlangen das exakte Bearer-Token', () => {
  assert.equal(metricsAccessStatus('geheim', 'Bearer geheim'), 'authorized');
  assert.equal(metricsAccessStatus('geheim', 'Bearer falsch'), 'unauthorized');
  assert.equal(metricsAccessStatus('geheim', 'geheim'), 'unauthorized');
});
