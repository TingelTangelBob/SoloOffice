import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { STATE_MACHINES, STATE_TONES, statesOf } from '../../backend/shared/stateMachines.js';
import { DOC_PATH, replaceGenerated } from '../../scripts/state-machine-docs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => readFileSync(path.join(root, file), 'utf8');

test('TypeScript-Statustypen entsprechen dem Zustandsregister', () => {
  const types = read('src/types/index.ts');
  for (const [name, machine] of Object.entries(STATE_MACHINES)) {
    if (!machine.tsType) continue;
    const match = types.match(new RegExp(`export type ${machine.tsType} = ([^;]+);`));
    assert.ok(match, `${name}: Typ ${machine.tsType} fehlt in src/types/index.ts`);
    const values = match[1].match(/'([^']+)'/g).map(value => value.slice(1, -1));
    assert.deepEqual(values.sort(), [...statesOf(name)].sort(), `${name}: Typ ${machine.tsType} und Register weichen ab`);
  }
});

test('Typdeklaration des Registers nennt jeden Automaten und jeden Farbton', () => {
  const declaration = read('backend/shared/stateMachines.d.ts');
  for (const name of Object.keys(STATE_MACHINES)) assert.ok(declaration.includes(`'${name}'`), `${name} fehlt in stateMachines.d.ts`);
  for (const tone of STATE_TONES) assert.ok(declaration.includes(`'${tone}'`), `${tone} fehlt in stateMachines.d.ts`);
});

test('Jeder Farbton hat Etikett- und Punktfarbe', () => {
  const display = read('src/utils/statusDisplay.ts');
  for (const block of ['BADGE_CLASSES', 'DOT_CLASSES']) {
    const body = display.slice(display.indexOf(`const ${block}`), display.indexOf('};', display.indexOf(`const ${block}`)));
    for (const tone of STATE_TONES) assert.match(body, new RegExp(`\\b${tone}: '[^']+'`), `${block}: ${tone} fehlt`);
  }
});

test('Komponenten führen keine eigenen Beschriftungstabellen für Rechnungs-, Angebots- und Auftragsstatus', () => {
  for (const file of ['InvoiceManagement', 'QuoteManagement', 'JobManagement', 'Dashboard', 'ReminderManagement',
    'ReminderSendModal', 'ReportingManagement', 'CustomerDetail', 'InvoiceHistoryDialog', 'Calendar',
    'CreditNoteManagement', 'RecurringInvoiceManagement']) {
    const source = read(`src/components/${file}.tsx`);
    assert.doesNotMatch(source, /'(?:1x gemahnt|2x gemahnt|Abgelaufen|In Bearbeitung|Fehlgeschlagen)'/, `${file}.tsx beschriftet Status selbst`);
  }
});

test('docs/zustandsautomaten.md ist aus dem Register erzeugt und aktuell', () => {
  const current = readFileSync(DOC_PATH, 'utf8');
  assert.equal(current, replaceGenerated(current), 'Bitte `node scripts/state-machine-docs.mjs` ausführen.');
});
