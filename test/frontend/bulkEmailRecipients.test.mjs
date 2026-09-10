import test from 'node:test';
import assert from 'node:assert/strict';
import { getActiveEmailRecipients } from '../../.test-dist/utils/bulkEmailRecipients.js';

test('Mehrfachversand löst Empfänger pro Kunde ohne gemeinsame Adressliste auf', () => {
  const first = { email: ' first@example.invalid ', additionalEmails: [
    { email: 'first@example.invalid', isActive: true },
    { email: 'accounting@example.invalid', isActive: true },
    { email: 'inactive@example.invalid', isActive: false },
    { email: '', isActive: true },
  ] };
  assert.deepEqual(getActiveEmailRecipients(first), ['first@example.invalid', 'accounting@example.invalid']);
  assert.deepEqual(getActiveEmailRecipients({ email: 'second@example.invalid' }), ['second@example.invalid']);
  assert.deepEqual(getActiveEmailRecipients(null), []);
  assert.deepEqual(getActiveEmailRecipients({}), []);
});
