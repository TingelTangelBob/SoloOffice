import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDocumentMoney } from '../utils/documentMoney.js';

const item = (overrides = {}) => ({ description: 'Leistung', quantity: 1, unitPrice: 100, taxRate: 19, ...overrides });

test('Summen und Rabattbeträge werden berechnet und nicht aus dem Client übernommen', () => {
  const result = calculateDocumentMoney({ items: [item({ discountType: 'percentage', discountValue: 10, discountAmount: 99, total: 1 })], subtotal: 1, taxAmount: 1, total: 1 });
  assert.equal(result.subtotal, 100);
  assert.equal(result.items[0].discountAmount, 10);
  assert.equal(result.items[0].total, 90);
  assert.equal(result.taxAmount, 17.1);
  assert.equal(result.total, 107.1);
});

test('globale Rabatte werden centgenau über gemischte Steuersätze verteilt', () => {
  const result = calculateDocumentMoney({ items: [item(), item({ taxRate: 7 })], globalDiscountType: 'percentage', globalDiscountValue: 10, globalDiscountAmount: 150 });
  assert.equal(result.globalDiscountAmount, 20);
  assert.equal(result.taxBreakdown[19].taxableAmount, 90);
  assert.equal(result.taxBreakdown[7].taxableAmount, 90);
  assert.equal(result.taxAmount, 23.4);
  assert.equal(result.total, 203.4);
  const small = calculateDocumentMoney({ items: [item({ unitPrice: 0.01, taxRate: 19 }), item({ unitPrice: 0.01, taxRate: 7 })], globalDiscountType: 'fixed', globalDiscountValue: 0.01 });
  assert.equal(small.taxBreakdown[7].taxableAmount + small.taxBreakdown[19].taxableAmount, 0.01);
  assert.equal(small.total, 0.01);
});

test('Gutschriften verwenden dieselben Rabatte und Steuern mit umgekehrtem Vorzeichen', () => {
  const source = { items: [item({ discountType: 'fixed', discountValue: 10 })], globalDiscountType: 'percentage', globalDiscountValue: 10 };
  const invoice = calculateDocumentMoney(source);
  const credit = calculateDocumentMoney(source, { documentType: 'credit_note' });
  for (const field of ['subtotal', 'taxAmount', 'total', 'globalDiscountAmount', 'itemDiscountAmount']) assert.equal(credit[field], -invoice[field]);
  const storedCredit = calculateDocumentMoney({ ...source, items: credit.items }, { documentType: 'credit_note' });
  assert.equal(storedCredit.total, credit.total);
});

test('unzulässige Zahlen, Mengen, Steuersätze und Rabatte werden kontrolliert abgewiesen', () => {
  for (const overrides of [
    { quantity: 0 }, { quantity: -1 }, { quantity: 1.001 }, { quantity: '2oops' },
    { unitPrice: NaN }, { unitPrice: Infinity }, { unitPrice: -1 },
    { taxRate: -1 }, { taxRate: 101 }, { taxRate: '19x' }, { description: '' },
    { discountType: 'percentage', discountValue: 101 },
    { discountType: 'fixed', discountValue: 101 }, { discountType: 'other' },
  ]) assert.throws(() => calculateDocumentMoney({ items: [item(overrides)] }), { code: 'INVALID_DOCUMENT_DATA', statusCode: 400 });
  assert.throws(() => calculateDocumentMoney({ items: [null] }), { statusCode: 400 });
  assert.throws(() => calculateDocumentMoney({ items: 'falsch' }), { statusCode: 400 });
});

test('Multiplikation und Summen runden reproduzierbar auf die gespeicherten Centwerte', () => {
  const result = calculateDocumentMoney({ items: [item({ quantity: 0.5, unitPrice: 0.01, taxRate: 0 }), item({ unitPrice: 0.1, taxRate: 0 }), item({ unitPrice: 0.2, taxRate: 0 })] });
  assert.equal(result.items[0].total, 0.01);
  assert.equal(result.subtotal, 0.31);
  assert.equal(result.total, 0.31);
});
