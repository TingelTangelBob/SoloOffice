import test from 'node:test';
import assert from 'node:assert/strict';
import { requireCompanyWriteContext } from '../middleware/companyWriteContext.js';

function guard(headers = {}, auth = { workspaceId: 'workspace-a', userId: 'user-a' }) {
  const result = { next: false, status: 200, body: null };
  requireCompanyWriteContext({ auth, get: name => headers[name] }, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  }, () => { result.next = true; });
  return result;
}

test('Gebundener Company-Write darf ausschließlich seine authentifizierte Firma ändern', () => {
  const headers = { 'X-SoloOffice-Workspace': 'workspace-a', 'X-SoloOffice-User': 'user-a' };
  assert.equal(guard(headers).next, true);
  const otherWorkspace = guard(headers, { workspaceId: 'workspace-b', userId: 'user-a' });
  assert.equal(otherWorkspace.next, false);
  assert.equal(otherWorkspace.status, 409);
  assert.equal(otherWorkspace.body.code, 'COMPANY_CONTEXT_CHANGED');
  const otherUser = guard(headers, { workspaceId: 'workspace-a', userId: 'user-b' });
  assert.equal(otherUser.next, false);
  assert.equal(otherUser.status, 409);
});

test('Unvollständige Bindung wird abgewiesen; bestehende API-Clients ohne Bindung bleiben kompatibel', () => {
  assert.equal(guard({ 'X-SoloOffice-Workspace': 'workspace-a' }).status, 409);
  assert.equal(guard({ 'X-SoloOffice-User': 'user-a' }).status, 409);
  assert.equal(guard({ 'X-SoloOffice-Workspace': '', 'X-SoloOffice-User': '' }).status, 409);
  assert.equal(guard().next, true);
});
