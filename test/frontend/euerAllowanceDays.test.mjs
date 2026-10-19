import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateAllowanceWorkdays,
  getAllowanceYearRange,
  isHomeOfficeAllowanceEntry,
  parseAllowanceDayBasis,
  readLegacyAllowanceDayCount,
  serializeAllowanceDayBasis,
} from '../../.test-dist/utils/euerAllowanceDays.js';

test('gespeicherte Jahres- und Wochenposten werden ebenso wie Altposten wiedergefunden', () => {
  const entry = { entryType: 'expense', category: 'allowance', status: 'active', description: 'Homeoffice-Tagespauschale 2026' };
  for (const mode of ['annual', 'weekly']) {
    const notes = serializeAllowanceDayBasis({ version: 1, year: 2026, mode, days: 2,
      from: '2026-01-01', to: '2026-01-02', weekdays: mode === 'weekly' ? [1,2,3,4,5] : [], vacationDays: 0, otherDays: 0 });
    assert.equal(isHomeOfficeAllowanceEntry({ ...entry, notes }, 2026), true);
    assert.equal(isHomeOfficeAllowanceEntry({ ...entry, notes, status: 'voided' }, 2026), false);
    assert.equal(isHomeOfficeAllowanceEntry({ ...entry, notes }, 2025), false);
  }
  assert.equal(isHomeOfficeAllowanceEntry({ ...entry, notes: 'Tagesnachweis (Datum=Art): 2026-01-01=home_majority.' }, 2026), true);
  assert.equal(isHomeOfficeAllowanceEntry({ ...entry, notes: 'Tage mit überwiegender Tätigkeit in der häuslichen Wohnung ohne Besuch der ersten Tätigkeitsstätte: 2' }, 2026), true);
  assert.equal(isHomeOfficeAllowanceEntry({ ...entry, description: 'Andere Pauschale 2026', notes: 'Eigene Berechnung' }, 2026), false);
});

test('Jahresbereich zählt einschließlich den Schalttag und begrenzt auf heute', () => {
  assert.deepEqual(getAllowanceYearRange(2024, '2024-02-29'), {
    from: '2024-01-01', to: '2024-02-29', maxDays: 60,
  });
  assert.deepEqual(getAllowanceYearRange(2027, '2026-10-19'), {
    from: '2027-01-01', to: '2026-10-19', maxDays: 0,
  });
});

test('Wochenhilfe zählt Teilwochen inklusiv und schneidet zukünftige Tage am Stichtag ab', () => {
  const result = calculateAllowanceWorkdays({ year: 2024, from: '2024-02-28', to: '2024-03-04',
    weekdays: [1, 2, 3, 4, 5], vacationDays: 1, otherDays: 0, today: '2024-03-01' });
  assert.deepEqual(result, { baseDays: 3, days: 2, error: null });
});

test('Vergangener Teilzeitraum bleibt begrenzt, wenn der Stichtag in einem Folgejahr liegt', () => {
  const result = calculateAllowanceWorkdays({ year: 2024, from: '2024-02-28', to: '2024-03-04',
    weekdays: [1, 2, 3, 4, 5], vacationDays: 0, otherDays: 0, today: '2026-10-19' });
  assert.deepEqual(result, { baseDays: 4, days: 4, error: null });
});

test('Wochentage folgen JS UTC-Konvention und Wochenenden lassen sich ausdrücklich auswählen', () => {
  const result = calculateAllowanceWorkdays({ year: 2026, from: '2026-01-03', to: '2026-01-05',
    weekdays: [0, 6], vacationDays: 0, otherDays: 0, today: '2026-01-05' });
  assert.deepEqual(result, { baseDays: 2, days: 2, error: null });
});

test('ungültige Datumswerte, doppelte Wochentage und zu hohe Abzüge liefern keine erfundenen Tage', () => {
  const base = { year: 2026, from: '2026-01-01', to: '2026-01-05', weekdays: [1, 2, 3, 4, 5],
    vacationDays: 0, otherDays: 0, today: '2026-01-10' };
  assert.deepEqual(calculateAllowanceWorkdays({ ...base, from: '2026-02-31' }), {
    baseDays: 0, days: 0, error: 'Bitte gültige Datumswerte eingeben.',
  });
  assert.notEqual(calculateAllowanceWorkdays({ ...base, weekdays: [1, 1] }).error, null);
  assert.notEqual(calculateAllowanceWorkdays({ ...base, vacationDays: 5 }).error, null);
  assert.deepEqual(calculateAllowanceWorkdays({ ...base, vacationDays: 5 }), {
    baseDays: 3, days: 0, error: 'Die abzuziehenden freien Tage übersteigen die berechneten Arbeitstage.',
  });
  assert.deepEqual(calculateAllowanceWorkdays({ ...base, today: '2025-12-31', vacationDays: 1 }), {
    baseDays: 0, days: 0, error: 'Die abzuziehenden freien Tage übersteigen die berechneten Arbeitstage.',
  });
});

test('weekly Snapshot roundtript und wird bei manipulierten Werten oder fremdem Jahr verworfen', () => {
  const basis = { version: 1, year: 2024, mode: 'weekly', days: 2, from: '2024-02-28', to: '2024-03-01',
    weekdays: [1, 2, 3, 4, 5], vacationDays: 1, otherDays: 0 };
  const note = serializeAllowanceDayBasis(basis);
  assert.deepEqual(parseAllowanceDayBasis(note, 2024), basis);
  assert.equal(parseAllowanceDayBasis(serializeAllowanceDayBasis({ ...basis, days: 3 }), 2024), null);
  assert.equal(parseAllowanceDayBasis(note, 2025), null);
  assert.equal(parseAllowanceDayBasis(`${note} extra`, 2024), null);
});

test('annual Snapshot akzeptiert Null für Stornoanzeige, aber keine unmögliche Jahressumme', () => {
  const basis = { version: 1, year: 2024, mode: 'annual', days: 0, from: '2024-01-01', to: '2024-12-31',
    weekdays: [], vacationDays: 0, otherDays: 0 };
  assert.deepEqual(parseAllowanceDayBasis(serializeAllowanceDayBasis(basis), 2024), basis);
  assert.equal(parseAllowanceDayBasis(serializeAllowanceDayBasis({ ...basis, days: 366 }), 2024)?.days, 366);
  assert.equal(parseAllowanceDayBasis(serializeAllowanceDayBasis({ ...basis, days: 367 }), 2024), null);
  assert.equal(parseAllowanceDayBasis(serializeAllowanceDayBasis({ ...basis, weekdays: [1, 1] }), 2024), null);
  assert.equal(parseAllowanceDayBasis(serializeAllowanceDayBasis({ ...basis, vacationDays: 1 }), 2024), null);
});

test('Legacy-Tagesnachweis zählt nur eindeutige, gültige Tage bis zum Stichtag', () => {
  const notes = [
    'Berechnung aus Eingaben.',
    'Tagesnachweis (Datum=Art): 2026-01-02=home_majority, 2026-01-03=home_no_other_workspace, 2026-12-31=home_majority.',
  ].join('\n');
  assert.equal(readLegacyAllowanceDayCount(notes, 2026, '2026-01-03'), 2);
  assert.equal(readLegacyAllowanceDayCount(notes, 2025, '2026-01-03'), null);
  assert.equal(readLegacyAllowanceDayCount('Keine Tagesdaten.', 2026, '2026-12-31'), null);
  assert.equal(readLegacyAllowanceDayCount('Tagesnachweis (Datum=Art): 2026-02-31=home_majority.', 2026, '2026-12-31'), null);
  assert.equal(readLegacyAllowanceDayCount('Tagesnachweis (Datum=Art): 2026-01-02=home_majority, 2026-01-02=home_majority.', 2026, '2026-12-31'), null);
});
