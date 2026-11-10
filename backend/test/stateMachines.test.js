import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STATE_MACHINES, STATE_TONES, canTransition, checkManualTransition, isKnownState, isTerminal,
  manualTargets, manualTargetsForSelection, stateLabel, stateTone, statesOf,
} from '../shared/stateMachines.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
const migrations = readdirSync(migrationsDir).filter(name => /^\d+_.*\.js$/.test(name)).sort()
  .map(name => readFileSync(path.join(migrationsDir, name), 'utf8'));

// Liest die zuletzt gültige CHECK-Werteliste einer Statusspalte aus den Migrationen.
function checkValues(table, column) {
  let values = null;
  const inList = `CHECK \\(\\s*${column} IN \\(([^)]*)\\)`;
  for (const source of migrations) {
    const parts = source.split(/CREATE TABLE (?:IF NOT EXISTS )?/);
    for (const part of parts.slice(1)) {
      if (!new RegExp(`^${table}\\b`).test(part)) continue;
      const match = part.match(new RegExp(inList));
      if (match) values = match[1];
    }
    const altered = source.match(new RegExp(`ADD CONSTRAINT ${table}_${column}_check\\s+${inList}`));
    if (altered) values = altered[1];
  }
  return values?.match(/'([^']+)'/g)?.map(value => value.slice(1, -1)) ?? null;
}

test('Zustandsregister ist in sich stimmig', () => {
  for (const [name, machine] of Object.entries(STATE_MACHINES)) {
    const states = statesOf(name);
    assert.ok(states.length >= 2, `${name}: mindestens zwei Zustände`);
    if (machine.initial !== null) assert.ok(isKnownState(name, machine.initial), `${name}: Startzustand unbekannt`);
    for (const state of states) {
      assert.ok(machine.states[state].label.trim(), `${name}.${state}: Beschriftung fehlt`);
      assert.ok(STATE_TONES.includes(machine.states[state].tone), `${name}.${state}: unbekannter Farbton`);
    }
    const seen = new Set();
    for (const transition of machine.transitions) {
      assert.ok(isKnownState(name, transition.from), `${name}: unbekannter Ausgangszustand ${transition.from}`);
      assert.ok(isKnownState(name, transition.to), `${name}: unbekannter Zielzustand ${transition.to}`);
      assert.notEqual(transition.from, transition.to, `${name}: Übergang auf sich selbst`);
      assert.ok(['manual', 'action', 'automatic'].includes(transition.trigger), `${name}: unbekannter Auslöser`);
      assert.ok(transition.label.trim(), `${name}: Übergang ohne Beschreibung`);
      const key = `${transition.from}>${transition.to}>${transition.trigger}>${transition.label}`;
      assert.ok(!seen.has(key), `${name}: doppelter Übergang ${key}`);
      seen.add(key);
    }
    if (machine.kind !== 'workflow') assert.equal(machine.transitions.length, 0, `${name}: Protokollwerte haben keine Übergänge`);
  }
});

test('Statuswerte des Registers entsprechen den CHECK-Bedingungen der Migrationen', () => {
  for (const [name, machine] of Object.entries(STATE_MACHINES)) {
    if (!machine.db) continue;
    const values = checkValues(machine.db.table, machine.db.column);
    assert.ok(values, `${name}: keine CHECK-Bedingung für ${machine.db.table}.${machine.db.column} gefunden`);
    assert.deepEqual([...statesOf(name)].sort(), [...values].sort(), `${name}: Register und Datenbank weichen ab`);
  }
});

test('Beschriftung und Farbton liefern nie einen Rohschlüssel', () => {
  assert.equal(stateLabel('invoice', 'reminded_2x'), '2x gemahnt');
  assert.equal(stateLabel('recurringInvoiceRun', 'failure'), 'Fehlgeschlagen');
  assert.equal(stateLabel('invoice', 'gibt_es_nicht'), 'Unbekannt');
  assert.equal(stateLabel('invoice', undefined), 'Unbekannt');
  assert.equal(stateLabel('invoice', 'toString'), 'Unbekannt');
  assert.equal(stateTone('quote', 'gibt_es_nicht'), 'neutral');
});

test('Rechnung: Entwurf ist nie Ziel, Bezahlt und Mahnstufen nie von Hand wählbar', () => {
  for (const from of statesOf('invoice')) {
    assert.ok(!manualTargets('invoice', from).includes('draft'));
    assert.ok(!manualTargets('invoice', from).includes('paid'));
    assert.ok(!manualTargets('invoice', from).some(state => state.startsWith('reminded_')));
    assert.ok(!canTransition('invoice', from, 'draft') || from === 'draft');
  }
  assert.deepEqual(manualTargets('invoice', 'draft'), ['sent', 'overdue']);
  assert.deepEqual(manualTargets('invoice', 'paid'), []);
  assert.ok(canTransition('invoice', 'reminded_1x', 'reminded_2x', ['action']));
  assert.ok(!canTransition('invoice', 'sent', 'reminded_2x'));
  assert.deepEqual(manualTargetsForSelection('invoice', ['draft', 'reminded_3x']), ['sent', 'overdue']);
  assert.deepEqual(manualTargetsForSelection('invoice', ['paid']), []);
  assert.deepEqual(manualTargetsForSelection('invoice', []), []);
});

test('Angebot: Abgerechnet entsteht nur durch Umwandlung und ist endgültig', () => {
  assert.equal(checkManualTransition('quote', 'draft', 'sent'), null);
  assert.equal(checkManualTransition('quote', 'accepted', 'accepted'), null);
  assert.equal(checkManualTransition('quote', 'accepted', 'draft'), null);
  assert.equal(checkManualTransition('quote', 'accepted', 'billed').code, 'action_required');
  assert.match(checkManualTransition('quote', 'accepted', 'billed').message, /In Rechnung umwandeln/);
  assert.equal(checkManualTransition('quote', 'billed', 'draft').code, 'terminal_state');
  assert.equal(checkManualTransition('quote', 'draft', 'unsinn').code, 'unknown_state');
  assert.equal(checkManualTransition('quote', 'draft', 42).code, 'unknown_state');
  assert.ok(isTerminal('quote', 'billed'));
  assert.ok(canTransition('quote', 'accepted', 'billed', ['action']));
  assert.deepEqual(manualTargetsForSelection('quote', ['billed']), []);
  assert.deepEqual(manualTargetsForSelection('quote', ['billed', 'sent']), ['draft', 'accepted', 'rejected', 'expired']);
});

test('Auftrag: abgerechnete Aufträge lassen sich nicht von Hand ändern', () => {
  assert.deepEqual(manualTargets('job', 'invoiced'), []);
  assert.deepEqual(manualTargets('job', 'draft'), ['in-progress', 'completed', 'invoiced']);
  assert.equal(checkManualTransition('job', 'invoiced', 'draft').code, 'not_allowed');
  assert.ok(canTransition('job', 'invoiced', 'completed', ['action']));
});

test('Unbekannter Automat wird gemeldet statt still übergangen', () => {
  assert.throws(() => statesOf('gibt_es_nicht'), /Unbekannter Zustandsautomat/);
});
