import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCreditNoteStatus } from '../utils/invoicePolicy.js';

test('Gutschriftstatus bildet nur Entwurf und Versand ab, keine Scheinzahlung', () => {
  assert.equal(validateCreditNoteStatus('draft'), undefined);
  assert.equal(validateCreditNoteStatus('sent'), undefined);
  assert.equal(validateCreditNoteStatus('sent', 'draft'), undefined);

  for (const status of ['paid', 'overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x']) {
    assert.throws(() => validateCreditNoteStatus(status), { statusCode: 409 });
  }
  assert.throws(() => validateCreditNoteStatus('paid', 'sent'), { statusCode: 409 });
  assert.throws(() => validateCreditNoteStatus('draft', 'sent'), { statusCode: 409 });

  // Historische Zustände dürfen unverändert gelesen und gespeichert werden;
  // ein Wechsel in oder aus einem unbelegten Abrechnungsstatus bleibt gesperrt.
  assert.equal(validateCreditNoteStatus('paid', 'paid'), undefined);
});
