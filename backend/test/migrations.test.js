import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { migrations } from '../migrations/index.js';

const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));

test('alle registrierten Migrationen sind vollständig und aufsteigend benannt', async () => {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter(fileName => /^\d{3}_.+\.js$/.test(fileName))
    .sort();
  const migrationNames = migrations.map(migration => migration.name);

  for (const [index, migration] of migrations.entries()) {
    assert.equal(typeof migration.name, 'string', `Migration an Position ${index + 1} hat keinen Namen`);
    assert.notEqual(migration.name.trim(), '', `Migration an Position ${index + 1} hat einen leeren Namen`);
    assert.equal(typeof migration.up, 'function', `Migration ${migration.name} hat keine up-Funktion`);
  }

  assert.equal(new Set(migrationNames).size, migrations.length, 'Migrationsnamen müssen eindeutig sein');
  assert.deepEqual(
    migrationNames,
    migrationFiles.map(fileName => fileName.slice(0, -3)),
    'Migrationsnamen müssen den Dateinamen entsprechen und alle Dateien müssen registriert sein',
  );

  const migrationNumbers = migrationNames.map(name => Number(name.slice(0, 3)));
  assert.ok(
    migrationNumbers.every((number, index) => index === 0 || number > migrationNumbers[index - 1]),
    'Migrationen müssen streng aufsteigend registriert sein',
  );
});
