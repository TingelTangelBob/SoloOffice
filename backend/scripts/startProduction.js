import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { DATABASE_RLS_RESTART_EXIT_CODE } from '../utils/startupRestart.js';

const serverPath = fileURLToPath(new URL('../server.js', import.meta.url));
let child = null;
let databaseRestartUsed = false;
let shuttingDown = false;

function launchServer() {
  child = spawn(process.execPath, [serverPath], {
    env: process.env,
    stdio: 'inherit',
  });

  child.once('error', error => {
    console.error(`Backend-Prozess konnte nicht gestartet werden: ${error.message}`);
    process.exit(1);
  });

  child.once('exit', (code, signal) => {
    child = null;

    if (!shuttingDown && code === DATABASE_RLS_RESTART_EXIT_CODE && !databaseRestartUsed) {
      databaseRestartUsed = true;
      console.warn('Datenbank-RLS ist aktiv; Backend-Verbindungen werden kontrolliert neu aufgebaut.');
      launchServer();
      return;
    }

    if (!shuttingDown && code === DATABASE_RLS_RESTART_EXIT_CODE) {
      console.error('Das Backend hat den einmaligen RLS-Neustart erneut angefordert.');
    } else if (!shuttingDown && signal) {
      console.error(`Backend-Prozess wurde unerwartet durch ${signal} beendet.`);
    }

    process.exit(Number.isInteger(code) ? code : shuttingDown ? 0 : 1);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    shuttingDown = true;
    if (child && !child.killed) child.kill(signal);
    else process.exit(0);
  });
}

launchServer();
