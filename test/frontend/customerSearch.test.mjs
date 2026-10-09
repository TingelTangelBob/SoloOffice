import assert from 'node:assert/strict';
import test from 'node:test';
import { searchCustomers } from '../../.test-dist/utils/customerSearch.js';

test('Kundensuche öffnet Treffer direkt auf der jeweiligen Kundendetailseite', () => {
  const results = searchCustomers([
    { id: 'customer-1', name: 'Mara Beispiel', customerNumber: 'K-12', email: 'mara@example.test' },
    { id: 'customer-2', name: 'Tim Muster', customerNumber: 'K-13' },
  ], '  MARA ', 'Kunde');

  assert.deepEqual(results, [{
    id: 'customer-1',
    title: 'Mara Beispiel',
    subtitle: 'Kunde K-12',
    page: 'customer',
    filter: 'customer-1',
  }]);
  assert.deepEqual(searchCustomers([{ id: 'customer-1', name: 'Mara Beispiel' }], '', 'Kunde'), []);
});
