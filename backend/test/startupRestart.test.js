import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DATABASE_RLS_RESTART_EXIT_CODE,
  DATABASE_RLS_RESTART_MESSAGE,
  isDatabaseRlsRestart,
} from '../utils/startupRestart.js';

test('RLS-Neustart besitzt einen eigenen erwarteten Exit-Code', () => {
  assert.equal(DATABASE_RLS_RESTART_EXIT_CODE, 75);
});

test('nur der exakte RLS-Startfehler fordert einen kontrollierten Neustart an', () => {
  assert.equal(isDatabaseRlsRestart(new Error(DATABASE_RLS_RESTART_MESSAGE)), true);
  assert.equal(isDatabaseRlsRestart(new Error('Anderer Startfehler')), false);
  assert.equal(isDatabaseRlsRestart(DATABASE_RLS_RESTART_MESSAGE), false);
});
