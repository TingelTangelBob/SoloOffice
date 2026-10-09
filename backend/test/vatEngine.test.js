import test from 'node:test';
import assert from 'node:assert/strict';
import { fromNet, isVatEntryComplete, resolveVatAccounting, splitGross, suggestVatFromRate } from '../shared/vat/index.js';

test('rechnet Brutto- und Nettobeträge centgenau', () => {
  assert.deepEqual(splitGross(119, 19), { netAmount: 100, vatAmount: 19 });
  assert.deepEqual(splitGross(107, 7), { netAmount: 100, vatAmount: 7 });
  assert.deepEqual(fromNet(19.99, 19), { grossAmount: 23.79, vatAmount: 3.8 });
});

test('leitet den Versteuerungsmodus nur bei fehlender Profileinstellung aus der Tätigkeit ab', () => {
  assert.deepEqual(resolveVatAccounting({ vatAccounting: null, businessKind: 'teacher' }), { accounting: 'cash', source: 'default' });
  assert.deepEqual(resolveVatAccounting({ vatAccounting: null, businessKind: 'retail' }), { accounting: 'accrual', source: 'default' });
  assert.deepEqual(resolveVatAccounting({ vatAccounting: 'accrual', businessKind: 'teacher' }), { accounting: 'accrual', source: 'profile' });
});

test('macht aus Altbuchungen nur bei bekanntem positivem Satz einen Vorschlag', () => {
  assert.deepEqual(suggestVatFromRate({ id: 'a', entryType: 'expense', amount: 119, taxRate: 19 }, { vatStatus: 'regular' }), {
    entryId: 'a', vatTreatment: 'taxable', taxRate: 19, netAmount: 100, vatAmount: 19, inputTaxDeductible: true,
  });
  assert.equal(suggestVatFromRate({ id: 'b', entryType: 'income', amount: 100, taxRate: 0 }), null);
  assert.equal(suggestVatFromRate({ id: 'c', entryType: 'income', amount: 100, taxRate: null }), null);
  assert.equal(suggestVatFromRate({ id: 'd', entryType: 'income', amount: 119, taxRate: 19 }, { vatStatus: 'small_business' }), null);
});

test('prüft vollständige Angaben passend zu Einnahme, Ausgabe und § 19', () => {
  assert.equal(isVatEntryComplete({ entryType: 'income', vatTreatment: 'taxable', taxRate: 19, netAmount: 100, vatAmount: 19 }, { vatStatus: 'regular' }), true);
  assert.equal(isVatEntryComplete({ entryType: 'expense', vatTreatment: 'taxable', inputTaxDeductible: null }, { vatStatus: 'regular' }), false);
  assert.equal(isVatEntryComplete({ entryType: 'expense', vatTreatment: 'reverse_charge_eu', taxRate: 19, netAmount: 100, vatAmount: 19, inputTaxDeductible: false }, { vatStatus: 'regular' }), true);
  assert.equal(isVatEntryComplete({ entryType: 'expense', vatTreatment: 'reverse_charge_eu' }, { vatStatus: 'small_business' }), false);
  assert.equal(isVatEntryComplete({ entryType: 'expense', vatTreatment: null }, { vatStatus: 'small_business' }), true);
});
