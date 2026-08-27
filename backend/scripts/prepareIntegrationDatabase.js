import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createTables, pool } from '../database.js';

const RESTART_MESSAGE = 'Datenbank-RLS wurde abgesichert. Backend wird einmal neu gestartet.';
const RESTART_MARKER = 'SOLOOFFICE_INTEGRATION_DB_RESTARTED';
const databaseName = String(process.env.DB_NAME || '');

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(databaseName)) {
  throw new Error('Integrationstests dürfen nur gegen eine als Test/Integration benannte Datenbank laufen.');
}

async function prepareOnce() {
  try {
    await createTables();
    return false;
  } catch (error) {
    if (error instanceof Error && error.message === RESTART_MESSAGE) return true;
    throw error;
  } finally {
    await pool.end();
  }
}

const restartRequired = await prepareOnce();

if (restartRequired) {
  if (process.env[RESTART_MARKER] === 'true') {
    throw new Error('Die Datenbank verlangte nach dem kontrollierten Neustart erneut einen RLS-Neustart.');
  }

  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, [RESTART_MARKER]: 'true' },
    stdio: 'inherit',
  });

  if (child.error) throw child.error;
  if (child.status !== 0) process.exitCode = child.status ?? 1;
}
