import test from 'node:test';
import assert from 'node:assert/strict';

import { createGracefulShutdown } from '../utils/gracefulShutdown.js';

test('graceful shutdown stoppt HTTP und Datenbank genau einmal', async () => {
  let closeCalls = 0;
  let idleCalls = 0;
  let databaseCalls = 0;
  let maintenanceCalls = 0;
  const httpServer = {
    close(callback) {
      closeCalls += 1;
      queueMicrotask(() => callback());
    },
    closeIdleConnections() {
      idleCalls += 1;
    },
  };
  const shutdown = createGracefulShutdown({
    httpServer,
    closeDatabase: async () => { databaseCalls += 1; },
    clearMaintenance: () => { maintenanceCalls += 1; },
    timeoutMs: 100,
  });

  const first = shutdown('SIGTERM');
  const second = shutdown('SIGINT');
  assert.equal(first, second);
  assert.deepEqual(await first, { signal: 'SIGTERM', forced: false });
  assert.equal(closeCalls, 1);
  assert.equal(idleCalls, 1);
  assert.equal(databaseCalls, 1);
  assert.equal(maintenanceCalls, 1);
});

test('graceful shutdown beendet hängende Verbindungen nach dem Timeout', async () => {
  let forcedConnections = 0;
  const shutdown = createGracefulShutdown({
    httpServer: {
      close() {},
      closeAllConnections() { forcedConnections += 1; },
    },
    closeDatabase: async () => undefined,
    timeoutMs: 5,
  });

  assert.deepEqual(await shutdown('SIGTERM'), { signal: 'SIGTERM', forced: true });
  assert.equal(forcedConnections, 1);
});

test('Fehler beim Schließen des HTTP-Servers werden weitergegeben', async () => {
  const expected = new Error('close failed');
  const shutdown = createGracefulShutdown({
    httpServer: { close(callback) { callback(expected); } },
    closeDatabase: async () => undefined,
    timeoutMs: 100,
  });
  await assert.rejects(shutdown('SIGTERM'), expected);
});
