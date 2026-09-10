import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateInvoiceWithDiscounts, updateItemWithDiscount } from '../../.test-dist/utils/discountUtils.js';
import { calculateTaxBreakdown } from '../../.test-dist/utils/pdf/taxCalculations.js';
import { documentRequestBody } from '../../.test-dist/utils/documentPayload.js';
import { calculateDocumentMoney } from '../../backend/utils/documentMoney.js';

test('Editor und PDF verwenden bei Rabatten, gemischten Steuern und Gutschriften dieselben Centbeträge wie die API', () => {
  for (const documentType of ['invoice', 'credit_note']) {
    const invoice = { documentType, items: [
      { id: '1', description: 'Beratung', quantity: 1.25, unitPrice: 39.99, taxRate: 19, discountType: 'percentage', discountValue: 5 },
      { id: '2', description: 'Material', quantity: 3, unitPrice: 7.31, taxRate: 7 },
    ], globalDiscountType: 'fixed', globalDiscountValue: 1.11 };
    const server = calculateDocumentMoney(invoice);
    const editor = calculateInvoiceWithDiscounts(invoice);
    assert.equal(editor.total, server.total);
    assert.equal(editor.taxAmount, server.taxAmount);
    assert.deepEqual(calculateTaxBreakdown(invoice.items, invoice), server.taxBreakdown);
  }
});

test('unvollständige Editorpositionen liefern eine Vorschau und Rundung erfolgt vor der Summe', () => {
  assert.equal(calculateInvoiceWithDiscounts({ items: [{ description: '', quantity: 0, unitPrice: 0, taxRate: 19 }] }).total, 0);
  assert.equal(updateItemWithDiscount({ id: '1', description: 'Test', quantity: 0.5, unitPrice: 0.01, taxRate: 0 }).total, 0.01);
  assert.equal(updateItemWithDiscount({ id: '1', description: 'Test', quantity: 1, unitPrice: 100, taxRate: 19, discountType: undefined, discountValue: undefined, discountAmount: 10 }).discountAmount, 0);
});

test('Entfernen eines Rabatts wird übertragen, ein reiner Statuswechsel enthält keine Finanzänderung', () => {
  const form = { globalDiscountType: undefined, globalDiscountValue: undefined, globalDiscountAmount: 0, notes: 'Text' };
  assert.deepEqual(JSON.parse(documentRequestBody(form)), { globalDiscountType: null, globalDiscountValue: null, globalDiscountAmount: 0, notes: 'Text' });
  assert.deepEqual(JSON.parse(documentRequestBody({ status: 'sent' })), { status: 'sent' });
  assert.equal(form.globalDiscountType, undefined);
});

test('zu große Positions- und Gesamtsummen bleiben editierbar und liefern einen sichtbaren Fehler', () => {
  for (const items of [
    [{ id: '1', description: 'Große Position', quantity: 1000000, unitPrice: 1000000, taxRate: 19 }],
    [{ id: '1', description: 'Summe', quantity: 1, unitPrice: 60000000, taxRate: 0 }, { id: '2', description: 'Summe', quantity: 1, unitPrice: 60000000, taxRate: 0 }],
    [{ id: '1', description: 'Bruttobetrag', quantity: 1, unitPrice: 90000000, taxRate: 19 }],
  ]) {
    assert.match(calculateInvoiceWithDiscounts({ items }).validationError, /Betragsbereich/);
    assert.throws(() => calculateDocumentMoney({ items }), { statusCode: 400 });
    assert.equal(updateItemWithDiscount(items[0]).unitPrice, items[0].unitPrice);
  }
  const typed = { id: '1', description: 'Eingabe bleibt erhalten', quantity: 1, unitPrice: 100, taxRate: 19, discountType: 'percentage', discountValue: 101 };
  assert.equal(updateItemWithDiscount(typed).discountValue, 101);
  assert.throws(() => calculateDocumentMoney({ items: [updateItemWithDiscount(typed)] }), { statusCode: 400 });
});

test('widersprüchliche Altbeträge werden nicht stillschweigend mit neu berechneten Steuerzeilen ausgegeben', () => {
  const legacy = { id: 'legacy', documentType: 'credit_note', subtotal: -100, taxAmount: -19, total: -109,
    globalDiscountType: 'fixed', globalDiscountValue: 10, globalDiscountAmount: -10,
    items: [{ description: 'Beratung', quantity: 1, unitPrice: -100, taxRate: 19, total: -100 }] };
  assert.throws(() => calculateTaxBreakdown(legacy.items, legacy), /gespeicherten Dokumentbeträge/);
  assert.equal(legacy.total, -109);
});
