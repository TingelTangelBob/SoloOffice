import assert from 'node:assert/strict';
import test from 'node:test';
import { createSerialStateWriter } from '../../.test-dist/utils/serialStateWriter.js';
import { documentTextSavePatch, documentTextResetPatch } from '../../.test-dist/utils/documentTemplateWrites.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const company = () => ({ name: 'Firma', currency: 'CHF', documentTemplates: [
  { id: 'legacy', documentType: 'invoice', textMode: 'custom', introText: 'Alt', accentColor: '#112233' },
  { id: 'quote', documentType: 'quote', textMode: 'custom', introText: 'Angebot' },
] });

test('Design A und B werden trotz vorzeitig bereiter Antwort B in Auftragsreihenfolge gespeichert', async () => {
  let current = company();
  const gates = [deferred(), deferred()];
  const calls = [];
  const write = createSerialStateWriter({
    current: () => current,
    save: async patch => { const index = calls.push(patch) - 1; await gates[index].promise; return { ...current, ...patch }; },
    commit: saved => { current = saved; },
  });
  const a = write({ name: 'A' });
  const b = write({ name: 'B' });
  await tick();
  assert.equal(calls.length, 1);
  gates[1].resolve();
  await tick();
  assert.equal(calls.length, 1, 'B beginnt erst nach Bestätigung A');
  gates[0].resolve();
  await Promise.all([a, b]);
  assert.equal(current.name, 'B');
  assert.equal(current.currency, 'CHF');
});

test('Textspeichern und anschließendes Design verwenden den bestätigten aktuellen Vorlagenbestand', async () => {
  let current = company();
  const gate = deferred();
  let requests = 0;
  const write = createSerialStateWriter({
    current: () => current,
    save: async patch => { if (++requests === 1) await gate.promise; return { ...current, ...patch }; },
    commit: saved => { current = saved; },
  });
  const text = write(latest => documentTextSavePatch(latest, [], 'invoice', { introText: 'Neu' }, new Date()));
  const design = write(latest => ({ documentTemplates: latest.documentTemplates.map(template => ({ ...template, accentColor: '#abcdef' })) }));
  gate.resolve();
  await Promise.all([text, design]);
  assert.equal(current.documentTemplates[0].textMode, 'global');
  assert.equal(current.documentTextTemplates.find(item => item.documentType === 'invoice').introText, 'Neu');
  assert.equal(current.documentTemplates[0].accentColor, '#abcdef');
  assert.equal(current.documentTemplates[1].textMode, 'custom', 'andere Textart bleibt erhalten');
});

test('Textreset aktiviert globale Texte auch für Altvorlagen und erhält das Design', () => {
  const before = company();
  const patch = documentTextResetPatch(before, []);
  assert.ok(patch.documentTemplates.every(template => template.textMode === 'global'));
  assert.equal(patch.documentTemplates[0].accentColor, '#112233');
  assert.notEqual(patch.documentTextTemplates.find(template => template.documentType === 'invoice').introText, 'Alt');
  assert.equal(before.documentTemplates[0].textMode, 'custom');
});

test('Speicherfehler blockiert keine späteren Änderungen', async () => {
  let current = { value: 0 };
  const write = createSerialStateWriter({ current: () => current, save: async patch => {
    if (patch.value === 1) throw new Error('Fehler');
    return { ...current, ...patch };
  }, commit: saved => { current = saved; } });
  await assert.rejects(write({ value: 1 }), /Fehler/);
  await write({ value: 2 });
  assert.equal(current.value, 2);
});

test('Workspace verlassen: alte Antwort wird verworfen und wartende Anfrage nicht gestartet', async () => {
  let active = true;
  let current = { value: 0 };
  const gate = deferred();
  let calls = 0;
  const write = createSerialStateWriter({ current: () => current, active: () => active, save: async patch => {
    calls++; await gate.promise; return { ...current, ...patch };
  }, commit: saved => { current = saved; } });
  const first = write({ value: 1 });
  const second = write({ value: 2 });
  const rejected = assert.rejects(second, /Arbeitsbereich/);
  await tick();
  active = false;
  gate.resolve();
  await first;
  await rejected;
  assert.equal(calls, 1);
  assert.equal(current.value, 0);
});
