import test from 'node:test';
import assert from 'node:assert/strict';
import { isTakeoverAlreadyUsedError } from '../utils/migrationSessions.js';

test('Unique-Fehler des atomaren Workspace-Claims werden als bereits verwendeter Start erkannt', () => {
  assert.equal(isTakeoverAlreadyUsedError({ code: '23505' }), true);
  assert.equal(isTakeoverAlreadyUsedError({ code: '40001' }), false);
  assert.equal(isTakeoverAlreadyUsedError(new Error('Datenbank nicht erreichbar')), false);
});
