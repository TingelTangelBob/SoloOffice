import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  JOB_INVOICED_STATUS, jobBulkDeleteProblem, jobDeleteProblem, jobEditProblem,
} from '../shared/jobChangeRules.js';

const sharedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shared');

test('abgerechnete Aufträge sind für Bearbeiten und Löschen gesperrt, mit Serverwortlaut', () => {
  assert.equal(JOB_INVOICED_STATUS, 'invoiced');
  assert.deepEqual(jobEditProblem('invoiced'), {
    status: 403,
    error: 'Abgerechnete Aufträge können nicht bearbeitet werden.',
    message: 'Abgerechnete Aufträge bleiben unverändert, damit die Rechnung stimmig bleibt.',
  });
  assert.deepEqual(jobDeleteProblem('invoiced'), {
    status: 403,
    error: 'Abgerechnete Aufträge können nicht gelöscht werden.',
    message: 'Abgerechnete Aufträge bleiben erhalten, damit die Rechnung stimmig bleibt.',
  });
});

test('nicht abgerechnete Aufträge sind erlaubt', () => {
  for (const status of ['draft', 'in-progress', 'completed']) {
    assert.equal(jobEditProblem(status), null, status);
    assert.equal(jobDeleteProblem(status), null, status);
  }
});

test('Sammellöschung nennt die abgerechneten IDs und blockiert die ganze Anfrage', () => {
  assert.equal(jobBulkDeleteProblem([{ id: 'a', status: 'draft' }, { id: 'b', status: 'completed' }]), null);
  assert.deepEqual(jobBulkDeleteProblem([
    { id: 'a', status: 'draft' },
    { id: 'b', status: 'invoiced' },
    { id: 'c', status: 'invoiced' },
  ]), {
    status: 403,
    error: 'Abgerechnete Aufträge können nicht gelöscht werden.',
    message: 'Einige ausgewählte Aufträge wurden bereits abgerechnet und bleiben unverändert.',
    invoicedJobIds: ['b', 'c'],
  });
});

test('Rückgaben sind Kopien; Aufrufer können die Vorlage nicht verändern', () => {
  const problem = jobEditProblem('invoiced');
  problem.status = 500;
  assert.equal(jobEditProblem('invoiced').status, 403);
});

// Die Demo liegt im Frontend. Das Backend-Image enthält kein src/, dort wird
// dieser Quelltext-Vergleich übersprungen; die Frontend-Suite prüft die Demo.
const demoSource = path.resolve(sharedDir, '../../src/services/demoApi.ts');
test('Server und Demo nutzen die gemeinsame Regel, keine eigene Kopie', { skip: !existsSync(demoSource) && 'src/ fehlt im Backend-Image' }, () => {
  const jobsRoute = readFileSync(path.resolve(sharedDir, '../routes/jobs.js'), 'utf8');
  const demo = readFileSync(demoSource, 'utf8');
  for (const source of [jobsRoute, demo]) {
    assert.match(source, /jobChangeRules\.js'/);
    assert.match(source, /jobEditProblem\(/);
    assert.match(source, /jobDeleteProblem\(/);
    assert.match(source, /jobBulkDeleteProblem\(/);
  }
  assert.doesNotMatch(jobsRoute, /Cannot (edit|delete) invoiced job/);
  assert.doesNotMatch(jobsRoute, /Abgerechnete Aufträge können nicht gelöscht werden/);
});
