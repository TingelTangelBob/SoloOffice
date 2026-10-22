import test from 'node:test';
import assert from 'node:assert/strict';
import companyRouter from '../routes/company.js';

async function updateCompany(body, headers = {}, auth = { workspaceId: 'workspace-a', userId: 'user-a' }) {
  const handlers = companyRouter.stack.find(layer => layer.route?.path === '/' && layer.route.methods.put)?.route.stack;
  assert.ok(handlers?.length);
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  const request = { body, auth, get: name => headers[name] };
  const next = async (index = 0) => {
    if (handlers[index]) await handlers[index].handle(request, response, () => next(index + 1));
  };
  await next();
  return response;
}

test('Company-API weist leere Pflichtwerte vor Datenbankänderungen mit Feldfehlern ab', async () => {
  const response = await updateCompany({ name: '  ' });
  assert.equal(response.statusCode, 400);
  assert.match(response.payload.error, /Firmennamen/);
  assert.equal(response.payload.fieldErrors.name, 'Bitte einen Firmennamen eingeben.');
});

test('Company-Route weist fremden Sitzungskontext vor Validierung und Datenbankzugriff ab', async () => {
  const headers = { 'X-SoloOffice-Workspace': 'workspace-b', 'X-SoloOffice-User': 'user-a' };
  const response = await updateCompany({ name: '  ' }, headers);
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload.code, 'COMPANY_CONTEXT_CHANGED');
  headers['X-SoloOffice-Workspace'] = 'workspace-a';
  assert.equal((await updateCompany({ name: '  ' }, headers)).statusCode, 400);
});
