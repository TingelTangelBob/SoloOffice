import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

async function loadLayout() {
  const temporaryDirectory = await mkdtemp(path.join('/tmp', 'solooffice-customer-layout-'));
  const bundle = await rolldown({ input: path.resolve('src/utils/customerListLayout.ts'), platform: 'browser' });
  const output = path.join(temporaryDirectory, 'customer-layout.mjs');
  await bundle.write({ file: output, format: 'esm' });
  await bundle.close();
  return { module: await import(pathToFileURL(output).href), temporaryDirectory };
}

test('Kundenliste wechselt abhängig vom verfügbaren Platz zwischen Tabelle und Karten', async t => {
  const { module, temporaryDirectory } = await loadLayout();
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  assert.deepEqual(module.getCustomerListLayout(719), { showTable: false, showAddressColumn: false });
  assert.deepEqual(module.getCustomerListLayout(819), { showTable: false, showAddressColumn: false });
  assert.deepEqual(module.getCustomerListLayout(820), { showTable: true, showAddressColumn: false });
  assert.deepEqual(module.getCustomerListLayout(1039), { showTable: true, showAddressColumn: false });
  assert.deepEqual(module.getCustomerListLayout(1040), { showTable: true, showAddressColumn: true });
});

test('Kundenformular verknüpft Name und Notizen mit ihren Eingabefeldern', async () => {
  const source = await readFile(new URL('../../src/components/CustomerManagement.tsx', import.meta.url), 'utf8');

  assert.match(source, /<label htmlFor="customer-name"[\s\S]*?<input\s+id="customer-name"/);
  assert.match(source, /<label htmlFor="customer-notes"[\s\S]*?<textarea\s+id="customer-notes"/);
});

test('Kundenkarten zeigen lange Namen und E-Mail-Adressen ohne Einzeilenkürzung', async () => {
  const source = await readFile(new URL('../../src/components/CustomerManagement.tsx', import.meta.url), 'utf8');

  assert.match(source, /title={customer\.name} className="block break-words/);
  assert.match(source, /title={customer\.email \|\| undefined} className="min-w-0 break-all"/);
});
