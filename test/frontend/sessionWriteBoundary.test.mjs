import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionWriteBoundary } from '../../.test-dist/utils/sessionWriteBoundary.js';
import { createSerialStateWriter } from '../../.test-dist/utils/serialStateWriter.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Sessionwechsel sperrt sofort, bevor Cookies oder Demo-Workspace umgestellt werden', async () => {
  const boundary = createSessionWriteBoundary();
  const oldScope = boundary.capture();
  const responseBody = deferred();
  const change = boundary.transition(() => responseBody.promise);
  assert.equal(boundary.isCurrent(oldScope), false);
  assert.equal(boundary.matches(oldScope), true, 'alte Antwort bleibt bis zum bestätigten Wechsel diesem Kontext zugeordnet');
  await assert.rejects(boundary.transition(() => undefined), /läuft bereits/);
  responseBody.resolve();
  await change;
  assert.equal(boundary.matches(oldScope), false);
  assert.equal(boundary.isCurrent(boundary.capture()), true);
});

test('Fehlgeschlagener Wechsel lässt den bisherigen Kontext anschließend wieder speichern', async () => {
  const boundary = createSessionWriteBoundary();
  const scope = boundary.capture();
  await assert.rejects(boundary.transition(() => { throw new Error('Passwort falsch'); }), /Passwort/);
  assert.equal(boundary.isCurrent(scope), true);
});

test('Erfolgreicher Reset bei gleicher Workspace-ID invalidiert ebenfalls alte Speicherungen', async () => {
  const boundary = createSessionWriteBoundary();
  const scope = boundary.capture();
  await boundary.transition(() => undefined);
  assert.equal(boundary.isCurrent(scope), false);
});

test('Alte Queue führt während und nach einem Sessionwechsel keinen zweiten HTTP-Write aus', async () => {
  const boundary = createSessionWriteBoundary();
  const scope = boundary.capture();
  const firstResponse = deferred();
  const sessionResponse = deferred();
  const writes = [];
  const commits = [];
  const write = createSerialStateWriter({
    current: () => ({}),
    active: () => boundary.matches(scope),
    save: async patch => {
      if (!boundary.isCurrent(scope)) throw new Error('Sitzungswechsel');
      writes.push(patch);
      await firstResponse.promise;
      return patch;
    },
    commit: saved => commits.push(saved),
  });
  const first = write({ value: 'A' });
  const second = write({ value: 'B' });
  const secondRejected = assert.rejects(second, /Sitzungswechsel/);
  await tick();
  const change = boundary.transition(() => sessionResponse.promise);
  firstResponse.resolve();
  await first;
  await secondRejected;
  assert.deepEqual(writes, [{ value: 'A' }]);
  assert.deepEqual(commits, [{ value: 'A' }], 'bestätigte alte Antwort bleibt bei gescheitertem Wechsel verfügbar');
  sessionResponse.resolve();
  await change;
  await assert.rejects(write({ value: 'C' }), /Arbeitsbereich/);
  assert.equal(writes.length, 1);
});

test('Nach abgeschlossenem Sessionwechsel eintreffende alte Antwort wird nicht committet', async () => {
  const boundary = createSessionWriteBoundary();
  const scope = boundary.capture();
  const response = deferred();
  let committed = false;
  const write = createSerialStateWriter({ current: () => ({}), active: () => boundary.matches(scope),
    save: async () => { await response.promise; return {}; }, commit: () => { committed = true; } });
  const pending = write({});
  await tick();
  await boundary.transition(() => undefined);
  response.resolve();
  await pending;
  assert.equal(committed, false);
});
