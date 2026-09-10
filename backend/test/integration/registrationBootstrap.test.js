import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../database.js';
import { lockRegistrationBootstrap } from '../../services/registrationBootstrap.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Integrationstests dürfen nur gegen eine als Test/Integration benannte Datenbank laufen.');
}

after(async () => {
  await pool.end();
});

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

test('Bootstrap-Lock blockiert eine zweite Verbindung bis zum Transaktionsende', async () => {
  const firstClient = await pool.connect();
  const secondClient = await pool.connect();
  let secondLock;

  try {
    await firstClient.query('BEGIN');
    await lockRegistrationBootstrap(firstClient);

    await secondClient.query('BEGIN');
    secondLock = lockRegistrationBootstrap(secondClient);

    let secondWaiting = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const activity = await firstClient.query(`
        SELECT wait_event_type, wait_event
        FROM pg_stat_activity
        WHERE pid = $1
      `, [secondClient.processID]);
      const state = activity.rows[0];
      if (state?.wait_event_type === 'Lock' && state.wait_event === 'advisory') {
        secondWaiting = true;
        break;
      }
      await wait(10);
    }

    assert.equal(secondWaiting, true, 'Die zweite Verbindung wartet nicht auf den Advisory-Lock.');

    let secondFinished = false;
    secondLock.then(() => {
      secondFinished = true;
    });
    await wait(25);
    assert.equal(secondFinished, false, 'Der Lock wurde vor COMMIT/ROLLBACK freigegeben.');

    await firstClient.query('ROLLBACK');
    await secondLock;
    await secondClient.query('ROLLBACK');
  } finally {
    await firstClient.query('ROLLBACK').catch(() => undefined);
    await secondClient.query('ROLLBACK').catch(() => undefined);
    firstClient.release();
    secondClient.release();
  }
});
