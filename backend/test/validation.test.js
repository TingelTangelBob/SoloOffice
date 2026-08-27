import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPositiveNumber,
  isValidDate,
  isValidUUID,
  validateDiscountFields,
  validateSchema,
} from '../utils/validation.js';

test('Grundtypen werden streng validiert', () => {
  assert.equal(isValidUUID('8c0d9c77-6b26-4279-866e-11042e056cbc'), true);
  assert.equal(isValidUUID('8c0d9c77'), false);
  assert.equal(isValidDate('2026-08-27'), true);
  assert.equal(isValidDate('kein-datum'), false);
  assert.equal(isPositiveNumber('0'), true);
  assert.equal(isPositiveNumber('-0.01'), false);
});

test('Schemafehler nennen das betroffene Feld', () => {
  const result = validateSchema({ email: 'ungueltig', amount: -1 }, {
    email: { required: true, type: 'email' },
    amount: { type: 'number', min: 0 },
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map(error => error.field), ['email', 'amount']);
});

test('Rabatte verhindern negative und zu hohe Werte', () => {
  assert.deepEqual(validateDiscountFields({ globalDiscountType: 'percentage', globalDiscountValue: 101 }), {
    valid: false,
    message: 'Ungültiger Rabatt: Prozentwert muss zwischen 0 und 100 liegen',
  });
  assert.equal(validateDiscountFields({ items: [{ discountType: 'fixed', discountValue: 2.5 }] }).valid, true);
  assert.match(validateDiscountFields({ items: [{ discountType: 'fixed', discountValue: -1 }] }).message, /Position 1/);
});
