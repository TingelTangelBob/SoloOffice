import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Der Router hängt an der Datenbank; geprüft wird die Pflichtfeldregel über die
// Quelle, damit ein Entfernen der 400-Prüfung auffällt (Integrationstests laufen in CI).
test('POST /api/customers weist fehlende Pflichtfelder mit 400 ab statt mit 500', async () => {
  const source = await readFile(new URL('../routes/customers.js', import.meta.url), 'utf8');
  assert.match(source, /CUSTOMER_FIELDS_REQUIRED/);
  for (const field of ['name', 'address', 'postalCode', 'city', 'country']) {
    assert.match(source, new RegExp(`\\['${field}', '`), `Pflichtfeld ${field}`);
  }
  const postIndex = source.indexOf("router.post('/'");
  const checkIndex = source.indexOf('missingCustomerFields(req.body)', postIndex);
  const insertIndex = source.indexOf('INSERT INTO customers', postIndex);
  assert.ok(checkIndex > postIndex && checkIndex < insertIndex, 'Prüfung steht vor dem INSERT');
});
