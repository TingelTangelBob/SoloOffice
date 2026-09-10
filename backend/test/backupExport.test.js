import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readBackupSnapshot, writeBackupAtomically } from '../services/backupExport.js';
import { validateBackupData } from '../utils/backupArchive.js';

test('ein Tabellenfehler bricht den gesamten Snapshot ab und gibt keine Teildaten zurück', async () => {
  const calls = [];
  const failure = new Error('Tabelle nicht lesbar');
  const client = { async query(sql) {
    calls.push(sql);
    if (sql === 'SELECT * FROM invoices') throw failure;
    return { rows: [{ id: 'kunde-1' }] };
  } };
  await assert.rejects(readBackupSnapshot(client, ['customers', 'invoices', 'invoice_items']), failure);
  assert.equal(calls[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.ok(!calls.includes('COMMIT'));
  assert.ok(!calls.includes('SELECT * FROM invoice_items'));
});

test('vollständiger Snapshot enthält auch leere Tabellen und Hashes der bereinigten Daten', async () => {
  const calls = [];
  const client = { async query(sql) {
    calls.push(sql);
    return { rows: sql === 'SELECT * FROM smtp_settings' ? [{ id: 'smtp', password: 'intern' }] : [] };
  } };
  const snapshot = await readBackupSnapshot(client, ['customers', 'smtp_settings'], (_table, record) => ({ ...record, password: null }));
  assert.equal(calls.at(-1), 'COMMIT');
  assert.deepEqual(snapshot.data.customers, []);
  assert.equal(snapshot.data.smtp_settings[0].password, null);
  assert.deepEqual(validateBackupData({ version: '3.0', ...snapshot }, { allowedTables: ['customers', 'smtp_settings'] }), { totalRecords: 1 });
  snapshot.data.smtp_settings = [];
  assert.throws(() => validateBackupData({ version: '3.0', ...snapshot }, { allowedTables: ['customers', 'smtp_settings'] }), { code: 'BACKUP_INTEGRITY_INVALID' });
});

test('neue Sicherungen ohne Manifest werden abgewiesen; alte Formate bleiben lesbar', () => {
  const data = { customers: [] };
  const options = { allowedTables: ['customers'] };
  assert.throws(() => validateBackupData({ version: '3.0', data }, options), { code: 'BACKUP_INTEGRITY_INVALID' });
  assert.deepEqual(validateBackupData({ version: '2.0', data }, options), { totalRecords: 0 });
});

test('Dateiveröffentlichung ist vollständig, privat und überschreibt keine Sicherung', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'solooffice-backup-test-'));
  const filename = path.join(directory, 'backup.json');
  try {
    await writeBackupAtomically(filename, '{"complete":true}');
    assert.equal(await fs.readFile(filename, 'utf8'), '{"complete":true}');
    assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
    await assert.rejects(writeBackupAtomically(filename, '{"replacement":true}'), { code: 'EEXIST' });
    assert.equal(await fs.readFile(filename, 'utf8'), '{"complete":true}');
    assert.deepEqual(await fs.readdir(directory), ['backup.json']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
