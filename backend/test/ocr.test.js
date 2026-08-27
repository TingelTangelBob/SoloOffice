import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBase64Content } from '../services/ocrService.js';

test('Beleginhalt akzeptiert Base64 und Data-URLs', () => {
  assert.equal(decodeBase64Content('SGFsbG8=').toString('utf8'), 'Hallo');
  assert.equal(decodeBase64Content('data:text/plain;base64,U29sb09mZmljZQ==').toString('utf8'), 'SoloOffice');
});

test('Leerer und ungültiger Beleginhalt wird abgewiesen', () => {
  assert.throws(() => decodeBase64Content(''), /Beleginhalt fehlt/);
  assert.throws(() => decodeBase64Content('%%%'), /leer oder ungültig/);
});
