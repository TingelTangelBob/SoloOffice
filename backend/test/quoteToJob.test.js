import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUOTE_JOB_ERRORS, jobTitleFromQuote, materialsFromQuoteItems, quoteStatusAfterJobConversion, quoteToJobData, quoteToJobProblem,
} from '../shared/quoteToJob.js';

const quote = {
  id: 'q1', quoteNumber: 'AN-2026-007', customerId: 'c1', customerName: 'Muster GmbH', status: 'accepted', notes: ' Zahlbar in zwei Raten ',
  items: [
    { description: 'Zweite Position', quantity: '2', unitPrice: '50.00', taxRate: '19', total: '100.00', order: 2 },
    { description: ' Beratung ', quantity: 3, unitPrice: 100, taxRate: 19, total: 270, order: 1, discountType: 'percentage', discountValue: 10, discountAmount: 30 },
  ],
};

test('Positionen werden sortiert und mit Rabatt als Materialpositionen übernommen', () => {
  let counter = 0;
  const materials = materialsFromQuoteItems(quote.items, () => `m${++counter}`);
  assert.deepEqual(materials, [
    { id: 'm1', description: 'Beratung', quantity: 3, unitPrice: 100, taxRate: 19, total: 270, discountType: 'percentage', discountValue: 10, discountAmount: 30 },
    { id: 'm2', description: 'Zweite Position', quantity: 2, unitPrice: 50, taxRate: 19, total: 100 },
  ]);
});

test('Auftragsdaten übernehmen Kunde, Notiz und Verknüpfung, Datum als Kalendertag', () => {
  const data = quoteToJobData(quote, { today: '2026-11-12', newId: () => 'x' });
  assert.equal(data.customerId, 'c1');
  assert.equal(data.customerName, 'Muster GmbH');
  assert.equal(data.title, 'Angebot AN-2026-007: Beratung u. a.');
  assert.equal(data.description, 'Leistungen gemäß Angebot AN-2026-007');
  assert.equal(data.date, '2026-11-12');
  assert.equal(data.status, 'draft');
  assert.equal(data.notes, 'Zahlbar in zwei Raten');
  assert.equal(data.sourceQuoteId, 'q1');
  assert.equal(data.sourceQuoteNumber, 'AN-2026-007');
  assert.equal(data.materials.length, 2);
  assert.equal(data.hoursWorked, 0);
});

test('Titel ohne Positionen und bei sehr langer Bezeichnung', () => {
  assert.equal(jobTitleFromQuote({ quoteNumber: 'AN-1', items: [] }), 'Angebot AN-1');
  const long = jobTitleFromQuote({ quoteNumber: 'AN-1', items: [{ description: 'x'.repeat(400) }] });
  assert.equal(long.length, 255);
});

test('ungültiges Datum und fehlende ID-Vergabe werden abgelehnt', () => {
  assert.throws(() => quoteToJobData(quote, { today: '12.11.2026', newId: () => 'x' }), /Datum/);
  assert.throws(() => quoteToJobData(quote, { today: '2026-11-12' }), /ID/);
});

test('Umwandlung nur für versendete oder angenommene Angebote, nur einmal', () => {
  assert.equal(quoteToJobProblem({ status: 'sent' }), null);
  assert.equal(quoteToJobProblem({ status: 'accepted' }), null);
  for (const status of ['draft', 'rejected', 'expired']) {
    assert.equal(quoteToJobProblem({ status }).error, QUOTE_JOB_ERRORS.WRONG_STATUS);
  }
  assert.equal(quoteToJobProblem({ status: 'billed' }).code, 'QUOTE_BILLED');
  assert.equal(quoteToJobProblem({ status: 'accepted', convertedToInvoiceId: 'i1' }).code, 'QUOTE_BILLED');
  const twice = quoteToJobProblem({ status: 'accepted' }, 'j1');
  assert.equal(twice.status, 409);
  assert.equal(twice.code, 'QUOTE_ALREADY_CONVERTED');
});

test('ein versendetes Angebot gilt nach der Umwandlung als angenommen', () => {
  assert.equal(quoteStatusAfterJobConversion('sent'), 'accepted');
  assert.equal(quoteStatusAfterJobConversion('accepted'), 'accepted');
});
