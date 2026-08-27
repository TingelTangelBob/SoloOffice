import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';

import {
  BACKUP_ARCHIVE_LIMITS,
  BackupArchiveError,
  parseBackupArchive,
  validateBackupData,
} from '../utils/backupArchive.js';

const allowedTables = ['company', 'customers'];

function archive(database = { version: '2.0', data: { customers: [{ id: 'kunde-1' }] } }, metadata = { version: '2.0' }) {
  const zip = new AdmZip();
  zip.addFile('database.json', Buffer.from(JSON.stringify(database)));
  zip.addFile('metadata.json', Buffer.from(JSON.stringify(metadata)));
  return zip;
}

function expectArchiveError(callback, code, statusCode = 400) {
  assert.throws(callback, error => (
    error instanceof BackupArchiveError
      && error.code === code
      && error.statusCode === statusCode
  ));
}

test('SoloOffice-ZIP-Backups werden strukturiert gelesen', () => {
  const parsed = parseBackupArchive(archive().toBuffer(), { allowedTables });
  assert.equal(parsed.totalRecords, 1);
  assert.equal(parsed.backupData.data.customers[0].id, 'kunde-1');
  assert.equal(parsed.metadata.version, '2.0');
});

test('fehlende oder zusätzliche ZIP-Einträge werden abgewiesen', () => {
  const missing = new AdmZip();
  missing.addFile('database.json', Buffer.from('{}'));
  expectArchiveError(
    () => parseBackupArchive(missing.toBuffer(), { allowedTables }),
    'BACKUP_ARCHIVE_STRUCTURE_INVALID',
  );

  const additional = archive();
  additional.addFile('../fremd.txt', Buffer.from('nicht erlaubt'));
  expectArchiveError(
    () => parseBackupArchive(additional.toBuffer(), { allowedTables }),
    'BACKUP_ARCHIVE_STRUCTURE_INVALID',
  );
});

test('beschädigtes JSON erhält einen sicheren Validierungsfehler', () => {
  const zip = new AdmZip();
  zip.addFile('database.json', Buffer.from('{ungueltig'));
  zip.addFile('metadata.json', Buffer.from('{}'));
  expectArchiveError(
    () => parseBackupArchive(zip.toBuffer(), { allowedTables }),
    'BACKUP_JSON_INVALID',
  );
});

test('unbekannte Tabellen werden nicht stillschweigend ignoriert', () => {
  const zip = archive({ data: { system_secrets: [{ value: 'x' }] } });
  expectArchiveError(
    () => parseBackupArchive(zip.toBuffer(), { allowedTables }),
    'BACKUP_TABLE_UNSUPPORTED',
  );
});

test('Datensatz- und Entpackgrenzen werden vor dem Restore erzwungen', () => {
  const recordLimited = {
    ...BACKUP_ARCHIVE_LIMITS,
    records: 1,
  };
  const tooManyRecords = archive({ data: { customers: [{ id: '1' }, { id: '2' }] } });
  expectArchiveError(
    () => parseBackupArchive(tooManyRecords.toBuffer(), { allowedTables, limits: recordLimited }),
    'BACKUP_RECORD_LIMIT_EXCEEDED',
    413,
  );

  const sizeLimited = {
    ...BACKUP_ARCHIVE_LIMITS,
    databaseBytes: 10,
  };
  expectArchiveError(
    () => parseBackupArchive(archive().toBuffer(), { allowedTables, limits: sizeLimited }),
    'BACKUP_ARCHIVE_EXPANDED_TOO_LARGE',
    413,
  );
});

test('leere Uploads werden verständlich abgewiesen', () => {
  expectArchiveError(
    () => parseBackupArchive(Buffer.alloc(0), { allowedTables }),
    'BACKUP_ARCHIVE_EMPTY',
  );
});

test('dieselben Strukturregeln gelten für JSON-Restores', () => {
  assert.deepEqual(
    validateBackupData({ data: { company: [{}], customers: [] } }, { allowedTables }),
    { totalRecords: 1 },
  );
  expectArchiveError(
    () => validateBackupData({ data: { customers: 'kein Array' } }, { allowedTables }),
    'BACKUP_DATA_INVALID',
  );
  assert.deepEqual(
    validateBackupData(
      { data: { migrations: [{ name: 'historisch' }] } },
      { allowedTables, ignoredTables: ['migrations'] },
    ),
    { totalRecords: 1 },
  );
});
