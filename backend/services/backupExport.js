import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createBackupManifest } from '../utils/backupIntegrity.js';

/** Der Aufrufer übergibt einen eigenen, bereits mit Workspace-Kontext versehenen Client. */
export async function readBackupSnapshot(client, tables, prepareRecord = (_table, record) => record) {
  if (!tables.length || tables.some(table => !/^[a-z][a-z0-9_]*$/.test(table))) {
    throw new Error('Die Liste der Sicherungstabellen ist ungültig.');
  }
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const data = {};
    for (const table of tables) {
      const result = await client.query(`SELECT * FROM ${table}`);
      data[table] = result.rows.map(record => prepareRecord(table, record));
    }
    const manifest = createBackupManifest(data);
    await client.query('COMMIT');
    return { data, manifest };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

/** Nur vollständig geschriebene Dateien werden unter einem downloadbaren Namen sichtbar. */
export async function writeBackupAtomically(filepath, content) {
  const temporaryPath = path.join(path.dirname(filepath), `.${path.basename(filepath)}.${randomUUID()}.tmp`);
  let file;
  try {
    file = await fs.open(temporaryPath, 'wx', 0o600);
    await file.writeFile(content);
    await file.sync();
    await file.close();
    file = undefined;
    // link veröffentlicht atomar, ohne eine bereits vorhandene Sicherung zu überschreiben.
    await fs.link(temporaryPath, filepath);
  } finally {
    if (file) await file.close().catch(() => {});
    await fs.rm(temporaryPath, { force: true });
  }
}
