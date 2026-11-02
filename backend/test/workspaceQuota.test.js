import test from 'node:test';
import assert from 'node:assert/strict';
import { assertWorkspaceCapacity, configuredWorkspaceLimit, getWorkspaceCapacity, WorkspaceLimitError } from '../services/workspaceQuota.js';

test('Workspace-Limit ist ohne Env-Wert deaktiviert und lehnt ungültige Werte ab', () => {
  assert.equal(configuredWorkspaceLimit({}), 0);
  assert.equal(configuredWorkspaceLimit({ REGISTRATION_MAX_WORKSPACES: '12' }), 12);
  assert.throws(() => configuredWorkspaceLimit({ REGISTRATION_MAX_WORKSPACES: '-1' }), /ganze Zahl/);
  assert.throws(() => configuredWorkspaceLimit({ REGISTRATION_MAX_WORKSPACES: 'unbegrenzt' }), /ganze Zahl/);
});

test('Verbrauch und verbleibendes Kontingent werden als Instanzkapazität ausgegeben', async () => {
  const previous = process.env.REGISTRATION_MAX_WORKSPACES;
  process.env.REGISTRATION_MAX_WORKSPACES = '4';
  try {
    const capacity = await getWorkspaceCapacity({ query: async () => ({ rows: [{ used: 3 }] }) });
    assert.deepEqual(capacity, { used: 3, limit: 4, remaining: 1 });
  } finally {
    if (previous === undefined) delete process.env.REGISTRATION_MAX_WORKSPACES;
    else process.env.REGISTRATION_MAX_WORKSPACES = previous;
  }
});

test('Workspace-Anlage wird bei erreichtem Limit mit verständlichem 429-Code abgewiesen', async () => {
  const previous = process.env.REGISTRATION_MAX_WORKSPACES;
  process.env.REGISTRATION_MAX_WORKSPACES = '2';
  const calls = [];
  try {
    await assert.rejects(assertWorkspaceCapacity({ query: async sql => {
      calls.push(sql);
      if (sql.includes('COUNT(*)')) return { rows: [{ used: 2 }] };
      return { rows: [] };
    } }), error => error instanceof WorkspaceLimitError
      && error.status === 429
      && error.code === 'WORKSPACE_LIMIT_REACHED'
      && /maximale Zahl an Workspaces/.test(error.message));
    assert.equal(calls.some(sql => sql.includes('pg_advisory_xact_lock')), true);
  } finally {
    if (previous === undefined) delete process.env.REGISTRATION_MAX_WORKSPACES;
    else process.env.REGISTRATION_MAX_WORKSPACES = previous;
  }
});
