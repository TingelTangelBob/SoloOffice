import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../../database.js';
import userPreferencesRouter from '../../routes/userPreferences.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Dashboard-Preference-Integrationstests benötigen eine ausdrücklich als Test benannte Datenbank.');
}

const users = [randomUUID(), randomUUID()];
function handler(method, path) {
  const route = userPreferencesRouter.stack.find(layer => layer.route?.path === path && layer.route.methods[method]);
  return route?.route.stack.at(-1)?.handle;
}
async function request(method, path, userId, body = {}) {
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await handler(method, path)({ auth: { userId }, body }, response, error => { throw error; });
  return response;
}

after(async () => {
  await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
  await pool.end();
});

test('GET/PUT Dashboard-Einstellungen bleiben auf den jeweiligen Benutzer begrenzt', async () => {
  await query('INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3),($4,$5,$6)', [
    users[0], `${users[0]}@example.invalid`, 'test', users[1], `${users[1]}@example.invalid`, 'test',
  ]);
  const initial = await request('get', '/dashboard', users[0]);
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.payload.preferences.includeUnpaidInvoices, false);

  const changed = await request('put', '/dashboard', users[0], { preferences: {
    year: 'all', includeUnpaidInvoices: true, comparePrevious: true,
    items: [{ id: 'revenue', visible: false }],
  } });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.payload.preferences.comparePrevious, false);
  assert.equal(changed.payload.preferences.items[0].id, 'revenue');
  assert.equal(changed.payload.preferences.version, 2);
  // Neue Kacheln werden nicht ungefragt sichtbar.
  assert.equal(changed.payload.preferences.items.find(item => item.id === 'open-invoices').visible, false);

  // Ein Wert im Format von e140e0f (ohne `version`) direkt in der Datenbank
  // wird beim Lesen migriert, ohne die gespeicherte Reihenfolge zu verlieren.
  await query('UPDATE users SET dashboard_preferences = $2::jsonb WHERE id = $1', [users[1], JSON.stringify({
    items: [{ id: 'recent-invoices', visible: true }, { id: 'revenue', visible: false }],
    includeUnpaidInvoices: false, comparePrevious: false, year: null,
  })]);
  const legacy = (await request('get', '/dashboard', users[1])).payload.preferences;
  assert.deepEqual(legacy.items.slice(0, 2), [{ id: 'recent-invoices', visible: true }, { id: 'revenue', visible: false }]);
  assert.equal(legacy.items.find(item => item.id === 'top-customers').visible, true);
  assert.equal(legacy.items.find(item => item.id === 'recent-receipts').visible, false);

  const sized = await request('put', '/dashboard', users[0], { preferences: {
    version: 2, includeUnpaidInvoices: true,
    items: [{ id: 'income-expense', visible: true, size: 'full' }, { id: 'unbekannt', visible: true }],
  } });
  assert.deepEqual(sized.payload.preferences.items[0], { id: 'income-expense', visible: true, size: 'full' });
  assert.ok(!sized.payload.preferences.items.some(item => item.id === 'unbekannt'));
  assert.equal((await request('get', '/dashboard', users[1])).payload.preferences.includeUnpaidInvoices, false);
  assert.equal((await request('get', '/dashboard', users[0])).payload.preferences.includeUnpaidInvoices, true);
});
