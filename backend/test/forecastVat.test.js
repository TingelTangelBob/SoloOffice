import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForecast } from '../shared/forecast/index.js';
import { defaultTaxProfile } from '../shared/financeDefaults.js';

const profile = (vatStatus = 'regular') => ({ ...defaultTaxProfile(2026), businessKind: 'teacher', startedOn: '2024-01-01',
  vatStatus, birthYear: 1980, healthInsurance: 'family', pensionStatus: 'none', pensionMode: 'income' });
const monthRows = values => Array.from({ length: 12 }, (_, index) => ({ month: `2026-${String(index + 1).padStart(2, '0')}`,
  liability: values[index]?.liability || 0, estimatedLiability: values[index]?.estimatedLiability ?? values[index]?.liability ?? 0,
  complete: values[index]?.complete ?? true }));
const vatResult = ({ months = monthRows([]), periods = [], payments = [], incompleteEntries = 0, applicable = true, vatStatus = 'regular', nextDue = null } = {}) => ({
  year: 2026, applicable, vatStatus, months, periods, payments, nextDue,
  annual: { paid: periods.reduce((sum, item) => sum + (item.paid || 0), 0), refunded: periods.reduce((sum, item) => sum + (item.refunded || 0), 0) },
  completeness: { incompleteEntries },
});

test('berechnete Monatswerte übernehmen abgeschlossene und laufende Monate', () => {
  const vat = vatResult({ months: monthRows([{ liability: 100 }, { liability: 30, complete: false, estimatedLiability: 45 }]), incompleteEntries: 1 });
  const result = buildForecast({ year: 2026, profile: profile(), now: '2026-02-15', vat });
  assert.equal(result.vatBasis, 'estimate');
  assert.equal(result.vatIncompleteEntries, 1);
  assert.equal(result.monthly[0].vatReserve, 100);
  assert.equal(result.monthly[1].vatReserve, 45);
  assert.equal(result.vatReserveGrossEstimate, 145);
});

test('vollständige USt-Daten ergeben calculated und setzen Monatswerte direkt', () => {
  const vat = vatResult({ months: monthRows([{ liability: 19 }, { liability: 7 }]) });
  const result = buildForecast({ year: 2026, profile: profile(), now: '2026-02-28', vat });
  assert.equal(result.vatBasis, 'calculated');
  assert.equal(result.monthly[0].vatReserve, 19);
  assert.equal(result.monthly[1].vatReserve, 7);
});

test('Restreserve zieht betriebliche USt-Zahlungen ab, rechnet Erstattungen hinzu und ignoriert private ust-Levies', () => {
  const vat = vatResult({ months: monthRows([{ liability: 100 }]), periods: [{ paid: 50, refunded: 20 }],
    payments: [{ kind: 'advance', paidOn: '2026-01-20', amount: 50 }] });
  const result = buildForecast({ year: 2026, profile: profile(), now: '2026-01-31', vat,
    levyPayments: [{ kind: 'ust', year: 2026, paidOn: '2026-01-10', amount: 500 }] });
  assert.equal(result.paidUst, 50);
  assert.equal(result.paidAdvances.ust, 50);
  assert.equal(result.paidAdvanceMonths[0].ust, 50);
  assert.equal(result.vatRemainingReserve, 70);
});

test('offene laufende Periode erscheint als betriebliche USt-Fälligkeit mit geschätztem Saldo', () => {
  const vat = vatResult({ months: monthRows([{ liability: 100, complete: false, estimatedLiability: 130 }]),
    periods: [{ key: '2026-01', state: 'running', dueDate: '2026-02-10', complete: false, liability: 100, estimatedLiability: 130, paid: 20, refunded: 0 }] });
  const result = buildForecast({ year: 2026, profile: profile(), now: '2026-01-31', vat });
  const levy = result.upcomingLevies.find(item => item.id === 'forecast:ust:2026-01');
  assert.equal(levy.kind, 'ust');
  assert.equal(levy.amount, 110);
  assert.match(levy.notes, /Schätzung/);
});

test('§ 19 lässt Umsatzsteuer, Vorsteuer, Erstattungen und USt-Zahlungen aus Forecast-Summen heraus', () => {
  const result = buildForecast({ year: 2026, profile: profile('small_business'), now: '2026-02-15',
    levyPayments: [{ kind: 'ust', year: 2026, paidOn: '2026-01-15', amount: 900 }],
    vat: vatResult({ applicable: true, vatStatus: 'small_business',
      months: monthRows([{ liability: 500, estimatedLiability: 900 }]),
      periods: [{ key: '2026-Q1', paid: 300, refunded: 200, liability: 500 }],
      payments: [
        { kind: 'advance', paidOn: '2026-01-10', amount: 300 },
        { kind: 'refund', paidOn: '2026-01-20', amount: 200 },
      ],
    }) });
  assert.equal(result.vatReserveGrossEstimate, 0);
  assert.equal(result.vatRemainingReserve, 0);
  assert.equal(result.paidUst, 0);
  assert.equal(result.paidAdvances.ust, 0);
  assert.equal(result.paidAdvanceMonths.reduce((sum, item) => sum + item.ust, 0), 0);
  assert.equal(result.monthly.reduce((sum, item) => sum + item.vatReserve, 0), 0);
  assert.equal(result.upcomingLevies.some(item => item.kind === 'ust'), false);
});

test('ohne USt-Ergebnis bleibt die grobe Rücklage als gekennzeichnete Fallback-Prognose erhalten', () => {
  const result = buildForecast({ year: 2026, profile: profile(), now: '2026-01-31',
    entries: [{ entryType: 'income', entryDate: '2026-01-10', amount: 119, taxRate: 19 }] });
  assert.equal(result.vatBasis, 'rough');
  assert.ok(result.vatReserveGrossEstimate > 0);
  assert.equal(result.paidUst, 0);
  assert.equal(result.vatRemainingReserve, result.vatReserveGrossEstimate);
});
