import test from 'node:test';
import assert from 'node:assert/strict';
import { mapForecast, validateForecast } from '../routes/euerForecasts.js';

test('EÜR-Prognose validiert freie Planwerte getrennt nach Art, Datum, Text, Kategorie und Betrag', () => {
  assert.deepEqual(validateForecast({ entryType: 'expense', date: '2026-11-15', description: 'Software', category: 'software', amount: '24.50' }), {
    entryType: 'expense', date: '2026-11-15', description: 'Software', category: 'software', amount: 24.5,
  });
  assert.equal(typeof validateForecast({ entryType: 'cash', date: '2026-11-15', description: 'Plan', amount: 1 }), 'string');
  assert.equal(typeof validateForecast({ entryType: 'income', date: '2026-02-30', description: 'Plan', amount: 1 }), 'string');
  assert.equal(typeof validateForecast({ entryType: 'expense', date: '2026-11-15', description: '', amount: 1 }), 'string');
  assert.equal(typeof validateForecast({ entryType: 'expense', date: '2026-11-15', description: 'Plan', category: 'rent;DROP', amount: 1 }), 'string');
  assert.equal(typeof validateForecast({ entryType: 'expense', date: '2026-11-15', description: 'Plan', amount: -1 }), 'string');
});

test('EÜR-Prognose mappt DATE und Betrag stabil auf API-Felder', () => {
  assert.deepEqual(mapForecast({ id: 'plan', entry_type: 'income', forecast_date: '2026-12-01', description: 'Auftrag', category: null, amount: '300.00' }), {
    id: 'plan', entryType: 'income', date: '2026-12-01', description: 'Auftrag', category: null, amount: 300,
    createdAt: undefined, updatedAt: undefined,
  });
});
