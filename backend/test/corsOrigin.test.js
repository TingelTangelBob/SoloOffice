import test from 'node:test';
import assert from 'node:assert/strict';

import { createCorsOriginValidator } from '../utils/corsOrigin.js';

function validate(allowedOrigins, origin) {
  return new Promise(resolve => {
    createCorsOriginValidator(allowedOrigins)(origin, (error, allowed) => resolve({ error, allowed }));
  });
}

test('konfigurierte und ursprungslose Anfragen sind erlaubt', async () => {
  assert.deepEqual(await validate(['https://solooffice.example'], 'https://solooffice.example'), {
    error: null,
    allowed: true,
  });
  assert.deepEqual(await validate(['https://solooffice.example'], undefined), {
    error: null,
    allowed: true,
  });
});

test('fremde Ursprünge erhalten einen definierten 403-Fehler', async () => {
  const result = await validate(['https://solooffice.example'], 'https://evil.example');
  assert.equal(result.allowed, undefined);
  assert.equal(result.error?.status, 403);
  assert.equal(result.error?.code, 'CORS_ORIGIN_DENIED');
  assert.equal(result.error?.message, 'Anfrageursprung nicht erlaubt');
});
