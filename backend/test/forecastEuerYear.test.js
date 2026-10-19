import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForecast } from '../shared/forecast/index.js';
import { defaultTaxProfile } from '../shared/financeDefaults.js';

const profile = () => ({ ...defaultTaxProfile(2026), businessKind: 'teacher', startedOn: '2020-01-01',
  vatStatus: 'small_business', birthYear: 1980, healthInsurance: 'family', pensionStatus: 'none', pensionMode: 'income' });

test('EÜR-Jahreszuordnung übernimmt eine im Folgejahr gezahlte Buchung in den Vorjahres-Forecastabschluss', () => {
  const result = buildForecast({ year: 2025, profile: profile(), now: '2026-01-10', entries: [
    { entryType: 'expense', entryDate: '2026-01-05', euerYear: 2025, sourceType: 'vat_payment', amount: 75, status: 'active' },
  ] });

  assert.equal(result.profitYtd, -75);
  assert.equal(result.profitAnnual, -75);
  assert.equal(result.monthly[11].expenses, 75);
  assert.equal(result.monthly.reduce((sum, month) => sum + month.expenses, 0), 75);
});

test('noch zukünftige Zahlung wird trotz EÜR-Jahreszuordnung nicht als Ist-Ausgabe gezählt', () => {
  const result = buildForecast({ year: 2025, profile: profile(), now: '2026-01-10', entries: [
    { entryType: 'expense', entryDate: '2026-01-11', euerYear: 2025, sourceType: 'vat_payment', amount: 75, status: 'active' },
  ] });

  assert.equal(result.profitYtd, 0);
  assert.equal(result.monthly.reduce((sum, month) => sum + month.expenses, 0), 0);
});

test('Vorjahres-Saisonverteilung beachtet EÜR-zugeordnete Zahlung und legt sie in den Abschlussmonat', () => {
  const previousEntries = Array.from({ length: 12 }, (_, index) => ({
    entryType: 'income', entryDate: `2024-${String(index + 1).padStart(2, '0')}-15`, amount: 100, status: 'active',
  }));
  previousEntries.push({ entryType: 'income', entryDate: '2025-01-05', euerYear: 2024, amount: 20, status: 'active' });
  const result = buildForecast({ year: 2025, profile: profile(), now: '2025-02-01',
    entries: [{ entryType: 'income', entryDate: '2025-01-15', amount: 100, status: 'active' }], previousEntries });

  assert.equal(result.method, 'seasonal');
  assert.ok(result.monthly[11].revenue > result.monthly[1].revenue);
  assert.equal(result.monthly.length, 12);
});
