import test from 'node:test';
import assert from 'node:assert/strict';
import companyRouter from '../routes/company.js';

async function updateCompany(body) {
  const handler = companyRouter.stack.find(layer => layer.route?.path === '/' && layer.route.methods.put)?.route.stack[0].handle;
  assert.equal(typeof handler, 'function');
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({ body }, response);
  return response;
}

test('Company-API weist leere Pflichtwerte vor Datenbankänderungen mit Feldfehlern ab', async () => {
  const response = await updateCompany({ name: '  ' });
  assert.equal(response.statusCode, 400);
  assert.match(response.payload.error, /Firmennamen/);
  assert.equal(response.payload.fieldErrors.name, 'Bitte einen Firmennamen eingeben.');
});
