import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReceiptCurrency, isReceiptCurrencyCode } from '../../.test-dist/utils/receiptCurrency.js';
import { getCurrencySymbol, formatCurrency } from '../../.test-dist/utils/formatters.js';

test('receipt currencies normalize entered ISO codes and persist the displayed EUR default', () => {
  for (const value of [undefined, '', '  ']) assert.equal(normalizeReceiptCurrency(value), 'EUR');
  for (const code of ['cad', ' jpy ', 'pln', 'USD', 'CHF', 'GBP']) {
    const normalized = code.trim().toUpperCase();
    assert.equal(normalizeReceiptCurrency(code), normalized);
    assert.equal(isReceiptCurrencyCode(code), true);
  }
  for (const value of ['EU', 'EURO', '12X', '€']) assert.equal(isReceiptCurrencyCode(value), false);
});

test('amount labels and amounts use the same selected company currency', () => {
  for (const currency of ['EUR', 'USD', 'CHF', 'GBP', 'CAD', 'JPY']) {
    const expected = new Intl.NumberFormat('de-DE', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0).find(part => part.type === 'currency').value;
    assert.equal(getCurrencySymbol('de-DE', 'european', currency), expected);
    const expectedAmount = new Intl.NumberFormat('de-DE', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(42.5);
    assert.equal(formatCurrency(42.5, 'de-DE', 'european', currency), expectedAmount);
  }
});
