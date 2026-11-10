// Erzeugt den Abschnitt „Fachstatus“ in docs/zustandsautomaten.md aus dem
// gemeinsamen Register backend/shared/stateMachines.js.
//
//   node scripts/state-machine-docs.mjs          schreibt den Abschnitt neu
//   node scripts/state-machine-docs.mjs --check  prüft nur, ob er aktuell ist
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STATE_MACHINES, isTerminal } from '../backend/shared/stateMachines.js';

export const DOC_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/zustandsautomaten.md');
export const BEGIN = '<!-- BEGIN GENERIERT: node scripts/state-machine-docs.mjs -->';
export const END = '<!-- END GENERIERT -->';

const TRIGGER_LABELS = { manual: 'von Hand', action: 'Aktion', automatic: 'automatisch' };
const KIND_LABELS = {
  workflow: 'Ablauf mit Übergängen',
  log: 'Protokollwert, ändert sich nicht',
  external: 'Bestand liegt außerhalb von SoloOffice',
};
const id = state => state.replace(/[^a-zA-Z0-9_]/g, '_');

function diagram(machine) {
  const lines = ['```mermaid', 'stateDiagram-v2'];
  for (const [state, definition] of Object.entries(machine.states)) lines.push(`  state "${definition.label}" as ${id(state)}`);
  if (machine.initial) lines.push(`  [*] --> ${id(machine.initial)}`);
  const grouped = new Map();
  for (const transition of machine.transitions) {
    const key = `${transition.from}\u0000${transition.to}`;
    grouped.set(key, [...(grouped.get(key) || []), TRIGGER_LABELS[transition.trigger]]);
  }
  for (const [key, triggers] of grouped) {
    const [from, to] = key.split('\u0000');
    lines.push(`  ${id(from)} --> ${id(to)}: ${[...new Set(triggers)].join(' / ')}`);
  }
  lines.push('```');
  return lines;
}

export function renderStateMachines() {
  const out = [];
  for (const [name, machine] of Object.entries(STATE_MACHINES)) {
    out.push(`### ${machine.label} (\`${name}\`)`, '');
    out.push(`- Art: ${KIND_LABELS[machine.kind]}`);
    out.push(`- Speicherort: ${machine.db ? `\`${machine.db.table}.${machine.db.column}\`` : 'keine eigene Statusspalte'}${machine.tsType ? ` · Typ \`${machine.tsType}\`` : ''}`);
    if (machine.initial) out.push(`- Startzustand: ${machine.states[machine.initial].label} (\`${machine.initial}\`)`);
    out.push('', '| Wert | Anzeige | Farbton | Endzustand |', '|---|---|---|---|');
    for (const [state, definition] of Object.entries(machine.states)) {
      out.push(`| \`${state}\` | ${definition.label} | ${definition.tone} | ${machine.kind === 'workflow' && isTerminal(name, state) ? 'ja' : '–'} |`);
    }
    if (machine.transitions.length) {
      out.push('', ...diagram(machine), '', '| Von | Nach | Auslöser | Wodurch | Bedingung |', '|---|---|---|---|---|');
      for (const transition of machine.transitions) {
        out.push(`| \`${transition.from}\` | \`${transition.to}\` | ${TRIGGER_LABELS[transition.trigger]} | ${transition.label} | ${transition.guard || '–'} |`);
      }
    }
    if (machine.notes.length) out.push('', ...machine.notes.map(note => `- ${note}`));
    out.push('');
  }
  return out.join('\n').trimEnd();
}

export function replaceGenerated(document, generated = renderStateMachines()) {
  const start = document.indexOf(BEGIN);
  const end = document.indexOf(END);
  if (start < 0 || end < start) throw new Error('Markierungen für den erzeugten Abschnitt fehlen in docs/zustandsautomaten.md.');
  return `${document.slice(0, start + BEGIN.length)}\n\n${generated}\n\n${document.slice(end)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const current = readFileSync(DOC_PATH, 'utf8');
  const next = replaceGenerated(current);
  if (process.argv.includes('--check')) {
    if (current !== next) {
      console.error('docs/zustandsautomaten.md ist veraltet. Bitte `node scripts/state-machine-docs.mjs` ausführen.');
      process.exit(1);
    }
    console.log('docs/zustandsautomaten.md ist aktuell.');
  } else {
    writeFileSync(DOC_PATH, next);
    console.log('docs/zustandsautomaten.md aktualisiert.');
  }
}
