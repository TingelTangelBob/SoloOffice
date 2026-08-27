import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { normalizeRequestId, requestTracing } from '../middleware/requestTracing.js';
import { getRequestContext, runWithRequestContext } from '../utils/requestContext.js';

class TestResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = {};
    this.statusCode = 200;
  }

  setHeader(name, value) {
    this.headers[name] = value;
  }
}

test('Request-IDs werden validiert und begrenzt', () => {
  assert.equal(normalizeRequestId(' trace-123 '), 'trace-123');
  assert.equal(normalizeRequestId('mit leerzeichen'), null);
  assert.equal(normalizeRequestId('a'.repeat(129)), null);
});

test('Verschachtelte Request-Kontexte behalten die Trace-ID', () => {
  runWithRequestContext({ requestId: 'trace-1' }, () => {
    runWithRequestContext({ workspaceId: 'workspace-1' }, () => {
      assert.deepEqual(getRequestContext(), { requestId: 'trace-1', workspaceId: 'workspace-1' });
    });
  });
});

test('Tracing setzt Header und Kontext vor dem nächsten Middleware-Schritt', () => {
  const req = {
    method: 'GET',
    originalUrl: '/api/customers?suche=privat',
    get: name => name === 'x-request-id' ? 'client-trace-42' : undefined,
  };
  const res = new TestResponse();
  let nextCalled = false;

  requestTracing(req, res, () => {
    nextCalled = true;
    assert.equal(getRequestContext()?.requestId, 'client-trace-42');
  });

  assert.equal(nextCalled, true);
  assert.equal(req.requestId, 'client-trace-42');
  assert.equal(res.headers['X-Request-ID'], 'client-trace-42');
  res.emit('finish');
});
