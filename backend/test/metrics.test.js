import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  getMetricsSnapshot,
  metricPath,
  metricsAccessStatus,
  metricsMiddleware,
  resetMetricsForTests,
} from '../utils/metrics.js';

test('Metriken sind ohne konfiguriertes Token geschlossen', () => {
  assert.equal(metricsAccessStatus('', undefined), 'unconfigured');
  assert.equal(metricsAccessStatus(undefined, undefined), 'unconfigured');
});

test('Metriken verlangen das exakte Bearer-Token', () => {
  assert.equal(metricsAccessStatus('geheim', 'Bearer geheim'), 'authorized');
  assert.equal(metricsAccessStatus('geheim', 'Bearer falsch'), 'unauthorized');
  assert.equal(metricsAccessStatus('geheim', 'geheim'), 'unauthorized');
});

test('bekannte Routen verwenden ihr Muster statt konkreter IDs', () => {
  assert.equal(metricPath({ method: 'GET', baseUrl: '/api/customers', route: { path: '/:id' } }), 'GET /api/customers/:id');
  assert.equal(metricPath({ method: 'GET', path: '/frei-waehlbar' }), 'GET UNMATCHED');
});

test('Metriken trennen Client- und Serverfehler', () => {
  resetMetricsForTests();
  const record = statusCode => {
    const response = new EventEmitter();
    response.statusCode = statusCode;
    metricsMiddleware(
      { method: 'GET', baseUrl: '/api/test', route: { path: '/' } },
      response,
      () => response.emit('finish'),
    );
  };
  record(200);
  record(404);
  record(503);

  const counter = getMetricsSnapshot().requests['GET /api/test/'];
  assert.equal(counter.requests, 3);
  assert.equal(counter.clientErrors, 1);
  assert.equal(counter.errors, 1);
  assert.ok(counter.durationMs >= 0);
});

test('unbekannte Pfade erzeugen keinen unbegrenzten Metrikschlüsselraum', () => {
  resetMetricsForTests();
  for (let index = 0; index < 500; index += 1) {
    const response = new EventEmitter();
    response.statusCode = 404;
    metricsMiddleware(
      { method: 'GET', path: `/angriff/${index}` },
      response,
      () => response.emit('finish'),
    );
  }
  assert.deepEqual(Object.keys(getMetricsSnapshot().requests), ['GET UNMATCHED']);
});

test('bekannte Routen werden oberhalb der konfigurierten Grenze zusammengefasst', () => {
  const previousLimit = process.env.METRICS_MAX_PATHS;
  process.env.METRICS_MAX_PATHS = '10';
  resetMetricsForTests();
  try {
    for (let index = 0; index < 20; index += 1) {
      const response = new EventEmitter();
      response.statusCode = 200;
      metricsMiddleware(
        { method: 'GET', baseUrl: '/api', route: { path: `/route-${index}` } },
        response,
        () => response.emit('finish'),
      );
    }
    const requests = getMetricsSnapshot().requests;
    assert.equal(Object.keys(requests).length, 10);
    assert.equal(requests.OTHER.requests, 11);
  } finally {
    if (previousLimit === undefined) delete process.env.METRICS_MAX_PATHS;
    else process.env.METRICS_MAX_PATHS = previousLimit;
  }
});
