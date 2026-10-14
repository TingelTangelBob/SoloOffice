import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { directoryPage, platformUsers, platformWorkspaces, workspaceInsight } from '../services/controlPlaneDirectory.js';
import { pool } from '../database.js';
import { getRequestContext } from '../utils/requestContext.js';

after(() => pool.end());
test('Plattformverzeichnis begrenzt Pagination und zeigt keine Zugangsdaten', async () => {
  assert.deepEqual(directoryPage({ limit: 10000, offset: -5, q: ' Test ' }), { limit: 200, offset: 0, q: 'Test' });
  const seen = [];
  const db = { query: async (sql, values) => {
    seen.push([sql, values]);
    assert.doesNotMatch(sql, /password|token_hash|totp|content|SELECT\s+\*/i);
    if (sql.includes('AS total')) return { rows: [{ total: 1 }] };
    return { rows: [{ id: 'u1', email: 'fixture@example.invalid', first_name: 'Max', last_name: 'Test', is_active: true, workspace_count: 2 }] };
  } };
  const result = await platformUsers({ q: "x' OR true --" }, db);
  assert.equal(result.total, 1);
  assert.equal(result.users[0].workspaceCount, 2);
  assert.equal(result.users[0].active, true);
  assert.equal(seen[0][1][0], "%x' OR true --%");
  assert.equal(seen[0][0].includes("x' OR true --"), false);
});
test('Workspace-Metadaten unterscheiden aktiv und gesperrt', async () => {
  const db = { query: async sql => sql.includes('AS total') ? { rows: [{ total: 1 }] } : { rows: [{ id: 'w1', name: 'Test', slug: 'test', suspended_at: new Date(), member_count: 3 }] } };
  const result = await platformWorkspaces({}, db);
  assert.equal(result.workspaces[0].status, 'suspended');
  assert.equal(result.workspaces[0].memberCount, 3);
});
test('Workspace-Einblick setzt RLS-Kontext und liest nur Beleggrößen', async () => {
  const id = '42a6c2c9-13e6-4a63-9d2b-5455fd936285';
  const db = { query: async (sql, args) => {
    assert.equal(args[0], id);
    assert.doesNotMatch(sql, /BYPASSRLS|DISABLE ROW LEVEL|password|token_hash|SELECT\s+\*/i);
    if (sql.includes('FROM receipts')) {
      assert.equal(getRequestContext().workspaceId, id);
      assert.ok(sql.includes('SUM(size)'));
      return { rows: [{ bytes: '1234' }] };
    }
    if (sql.includes('workspace_members')) return { rows: [{ id: 'u1', email: 'fixture@example.invalid', is_active: true, role: 'owner' }] };
    if (sql.includes('FROM sessions')) return { rows: [{ last: null }] };
    return { rows: [{ id, name: 'Fixture', slug: 'fixture', suspended_at: null }] };
  } };
  const result = await workspaceInsight(id, db);
  assert.equal(result.members[0].role, 'owner');
  assert.equal(result.storageBytes, 1234);
  assert.equal(result.storageScope, 'receipt-files');
  assert.equal(result.lastActivityAt, null);
});
