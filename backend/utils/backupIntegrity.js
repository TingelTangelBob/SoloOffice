import { createHash } from 'node:crypto';

export function backupTableHash(records) {
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

export function createBackupManifest(data) {
  return {
    version: 1,
    status: 'complete',
    tables: Object.fromEntries(Object.entries(data).map(([table, records]) => [
      table, { records: records.length, sha256: backupTableHash(records) },
    ])),
  };
}

// Prüfsummen erkennen unvollständige/beschädigte Archive; sie sind keine Signatur.
export function hasValidBackupManifest(backup) {
  const manifest = backup.manifest;
  if (!manifest || manifest.version !== 1 || manifest.status !== 'complete'
      || !manifest.tables || typeof manifest.tables !== 'object' || Array.isArray(manifest.tables)) return false;
  const tables = Object.keys(backup.data);
  if (tables.length !== Object.keys(manifest.tables).length) return false;
  return tables.every(table => {
    const entry = manifest.tables[table];
    return entry?.records === backup.data[table].length
      && entry.sha256 === backupTableHash(backup.data[table]);
  });
}
