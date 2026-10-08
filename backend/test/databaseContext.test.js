import test from 'node:test';
import assert from 'node:assert/strict';

import { instrumentClient } from '../database.js';
import { runWithRequestContext } from '../utils/requestContext.js';

function fakeClient() {
  const calls = [];
  return { calls, query: async (text) => { calls.push(String(text)); return { rows: [] }; } };
}

const isContextCall = text => text.startsWith('SELECT set_config($1, $2, false)');

test('BEGIN mit Isolationsstufe läuft vor dem Kontextwechsel und bleibt erste Transaktionsanweisung', async () => {
  const client = instrumentClient(fakeClient());
  await runWithRequestContext({ workspaceId: '', userId: '' }, () => client.query('SELECT 1'));
  client.calls.length = 0;
  await runWithRequestContext({ workspaceId: 'ws-a', userId: 'user-a' }, async () => {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query('SELECT 2');
  });
  assert.equal(client.calls[0], 'BEGIN ISOLATION LEVEL SERIALIZABLE');
  assert.ok(isContextCall(client.calls[1]), 'der Kontext wird erst innerhalb der Transaktion gesetzt');
  assert.equal(client.calls[2], 'SELECT 2');
});

test('ROLLBACK verwirft den gemerkten Workspace-Kontext', async () => {
  const client = instrumentClient(fakeClient());
  await runWithRequestContext({ workspaceId: 'ws-a', userId: 'user-a' }, async () => {
    await client.query('BEGIN');
    await client.query('SELECT 1');
    await client.query('ROLLBACK');
    await client.query('SELECT 2');
  });
  assert.equal(client.calls.filter(isContextCall).length, 2, 'nach ROLLBACK wird der Kontext erneut gesetzt');
});

test('COMMIT behält den gemerkten Workspace-Kontext', async () => {
  const client = instrumentClient(fakeClient());
  await runWithRequestContext({ workspaceId: 'ws-a', userId: 'user-a' }, async () => {
    await client.query('BEGIN');
    await client.query('SELECT 1');
    await client.query('COMMIT');
    await client.query('SELECT 2');
  });
  assert.equal(client.calls.filter(isContextCall).length, 1);
});
