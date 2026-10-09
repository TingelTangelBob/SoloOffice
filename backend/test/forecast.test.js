import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForecast } from '../shared/forecast/index.js';
import { defaultTaxProfile } from '../shared/financeDefaults.js';
import { resolveTaxParams } from '../shared/taxParams/index.js';

const baseProfile = year => ({ ...defaultTaxProfile(year), businessKind: 'teacher', startedOn: `${year - 2}-01-01`,
  vatStatus: 'regular', birthYear: 1980, healthInsurance: 'family', pensionStatus: 'none', pensionMode: 'income' });
const income = (entryDate, amount, taxRate = 0) => ({ entryType: 'income', entryDate, amount, taxRate, status: 'active' });
const expense = (entryDate, amount, taxRate = 0, sourceType = 'manual') => ({ entryType: 'expense', entryDate, amount, taxRate, sourceType, status: 'active' });

test('schließt vergangene Jahre aus erfassten aktiven Istwerten ohne Hochrechnung', () => {
  const result = buildForecast({ year: 2025, profile: baseProfile(2025), now: '2026-10-09',
    entries: [income('2025-02-01', 12000), expense('2025-03-01', 2000), income('2024-01-01', 99999), { ...income('2025-04-01', 800), status: 'void' }] });
  assert.equal(result.revenueYtd, 12000);
  assert.equal(result.profitYtd, 10000);
  assert.equal(result.profitAnnual, 10000);
  assert.equal(result.method, 'linear');
  assert.ok(result.monthly.every(point => !point.forecast));
});

test('rechnet das laufende Jahr tagesanteilig hoch und markiert aktuelle Resttage als Prognose', () => {
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-03-15', entries: [income('2026-01-10', 1000), income('2026-02-10', 2000)] });
  assert.equal(result.revenueAnnual, Math.round(3000 / 74 * 365 * 100) / 100);
  assert.equal(result.method, 'linear');
  assert.equal(result.monthly[1].forecast, false);
  assert.equal(result.monthly[2].forecast, true);
  assert.equal(result.monthly[3].forecast, true);
});

test('nutzt saisonale Vorjahreswerte nur bei belegten zwölf Kalendermonaten', () => {
  const previousEntries = Array.from({ length: 12 }, (_, index) => income(`2025-${String(index + 1).padStart(2, '0')}-10`, index === 6 ? 12000 : 100));
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-01-15', entries: [income('2026-01-10', 500)], previousEntries });
  assert.equal(result.method, 'seasonal');
  assert.ok(result.revenueAnnual > 500);
  assert.ok(result.monthly[6].revenue > result.monthly[1].revenue);
});

test('zählt gebuchte und künftige Fixkosten je einmal und lässt sie privat aus dem Gewinn', () => {
  const recurring = { id: 'biz-1', name: 'Software', scope: 'business', status: 'active', amountGross: 500, taxRate: 0,
    interval: 'monthly', intervalCount: 1, intervalUnit: 'months', startDate: '2026-01-01', nextDueDate: '2026-02-01', priceChanges: [], pauses: [] };
  const privateExpense = { ...recurring, id: 'private-1', scope: 'private_levy', nextDueDate: '2026-02-01' };
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-01-15', entries: [income('2026-01-05', 10000), expense('2026-01-06', 1000), expense('2026-01-07', 500, 0, 'recurring_expense')], expenses: [recurring, privateExpense] });
  assert.equal(result.fixedCostsAnnual, 6000);
  const variableEstimate = result.calculationSteps.find(item => item.label === 'Variable betriebliche Ausgaben').amount;
  assert.equal(result.profitAnnual, result.revenueAnnual - variableEstimate - result.fixedCostsAnnual);
  assert.equal(result.upcomingExpenses.length, 22);
  assert.equal(result.upcomingExpenses.filter(item => item.scope === 'private_levy').length, 11);
});

test('wendet Preiswechsel, Pausen und ein vorhandenes geplantes Laufdatum an', () => {
  const template = { id: 'rent', name: 'Miete', scope: 'business', status: 'active', amountGross: 100, taxRate: 19,
    interval: 'monthly', intervalCount: 1, intervalUnit: 'months', startDate: '2026-01-01', nextDueDate: '2026-01-01',
    priceChanges: [{ validFrom: '2026-03-01', amountGross: 150 }], pauses: [{ from: '2026-04-01', until: '2026-04-30' }] };
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-01-15', expenses: [template],
    runs: [{ id: 'planned-run', expenseId: 'rent', dueDate: '2026-02-01', amountGross: 100, status: 'planned' }] });
  assert.equal(result.upcomingExpenses.filter(item => item.dueDate === '2026-02-01').length, 1);
  assert.equal(result.upcomingExpenses.find(item => item.dueDate === '2026-03-01').amountGross, 150);
  assert.equal(result.upcomingExpenses.some(item => item.dueDate === '2026-04-01'), false);
});

test('berechnet grobe Vorsteuer aus Bruttobeträgen mit Satz/(100+Satz)', () => {
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-01-31',
    entries: [income('2026-01-05', 119, 19), expense('2026-01-06', 119, 19)] });
  assert.equal(result.vatReserveGrossEstimate, 0);
});

test('kennzeichnet einen negativen Umsatzsteuer-Richtwert getrennt als möglichen Vorsteuerüberhang', () => {
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-01-31', entries: [expense('2026-01-06', 119, 19)] });
  assert.ok(result.vatReserveGrossEstimate < 0);
  assert.ok(result.warnings.some(item => item.includes('Vorsteuerüberhang')));
});

test('zeigt bei fehlenden Jahresparametern verwendete Version und Warnung', () => {
  const result = buildForecast({ year: 2027, profile: baseProfile(2027), now: '2027-02-01' });
  assert.equal(result.parameterYear, 2026);
  assert.equal(result.paramsVersion, '2026.1');
  assert.ok(result.generatedAt);
  assert.ok(result.warnings.some(item => item.includes('Für 2027 fehlen geprüfte Werte')));
});

test('wendet im Gründungsjahr den zentralen §19-Umsatzrichtwert an', () => {
  const profile = { ...baseProfile(2026), vatStatus: 'small_business', startedOn: '2026-01-01', previousYearRevenue: 0 };
  const result = buildForecast({ year: 2026, profile, now: '2026-01-31', entries: [income('2026-01-01', 2100)] });
  assert.equal(result.smallBusiness.currentLimit, 25000);
  assert.equal(result.smallBusiness.current, 'green');
});

test('meldet benannte Profilfelder und behauptet für Kapitalgesellschaften keine Einkommensteuer', () => {
  const profile = { ...baseProfile(2026), businessKind: null, startedOn: null, vatStatus: null, birthYear: null,
    healthInsurance: null, pensionStatus: 'unclear', legalForm: 'gmbh' };
  const result = buildForecast({ year: 2026, profile, now: '2026-01-31', entries: [income('2026-01-01', 50000)] });
  assert.equal(result.taxes.total, 0);
  assert.ok(result.warnings.some(item => item.includes('keine Einkommensteuer geschätzt')));
  assert.equal(result.profileComplete, false);
  for (const field of ['Tätigkeit', 'Beginn der Selbstständigkeit', 'Umsatzsteuerstatus', 'Geburtsjahr', 'Krankenversicherung', 'Rentenversicherungsstatus', 'Kapitalgesellschaft']) {
    assert.ok(result.missingFields.some(item => item.includes(field)), field);
  }
});

test('behandelt gezahlte private Abgaben separat von EÜR-Ausgaben', () => {
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-02-01', entries: [income('2026-01-01', 12000), expense('2026-01-02', 1000)],
    levyPayments: [{ id: 'levy', kind: 'kv', year: 2026, period: '2026-01', dueDate: '2026-01-20', paidOn: '2026-01-20', amount: 400, source: 'manual', expenseRunId: null, notes: '' }] });
  assert.equal(result.paidLevies, 400);
  assert.equal(result.profitYtd, 11000);
});

test('weist vergangene ungebuchte Fälligkeiten aus und zählt Kammerkosten als Nutzereingabe', () => {
  const profile = { ...baseProfile(2026), chamber: 'ihk', chamberBasicAnnual: 300, chamberLevyRate: 0 };
  const result = buildForecast({ year: 2026, profile, now: '2026-02-15', expenses: [{ id: 'late', name: 'Alt', scope: 'business', status: 'active', amountGross: 50,
    interval: 'monthly', intervalCount: 1, intervalUnit: 'months', startDate: '2026-01-01', nextDueDate: '2026-01-01', priceChanges: [], pauses: [] }] });
  assert.ok(result.warnings.some(item => item.includes('noch nicht als bezahlt gebucht')));
  assert.equal(result.calculationSteps.find(item => item.label.includes('Kammerbeitrag')).amount, 300);
});

test('verankert 2026-Fälligkeiten am Vorlagenstart trotz nextDueDate in 2027', () => {
  const template = { id: 'old', name: 'Altvertrag', scope: 'business', status: 'active', amountGross: 100, startDate: '2025-01-15',
    nextDueDate: '2027-01-15', intervalCount: 1, intervalUnit: 'months', endDate: null, cancelledOn: null, pauses: [], priceChanges: [] };
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-01-01', expenses: [template] });
  assert.equal(result.upcomingExpenses.filter(run => run.dueDate.startsWith('2026-')).length, 12);
  assert.equal(result.fixedCostsAnnual, 1200);
});

test('ignoriert cancelledOn als Wirksamkeitsende und stoppt ausschließlich am endDate', () => {
  const template = { id: 'notice', name: 'Kündigungsfrist', scope: 'business', status: 'active', amountGross: 10, startDate: '2026-01-01',
    nextDueDate: '2026-01-01', intervalCount: 1, intervalUnit: 'months', cancelledOn: '2026-02-10', noticePeriodDays: 0,
    endDate: '2026-04-01', pauses: [], priceChanges: [] };
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-01-01', expenses: [template] });
  assert.deepEqual(result.upcomingExpenses.map(run => run.dueDate), ['2026-02-01', '2026-03-01']);
});

test('nimmt eine endliche Pause nach ihrem Ende wieder auf; unbegrenzte Pause bleibt aus', () => {
  const common = { name: 'Pausiert', scope: 'business', amountGross: 20, startDate: '2026-01-01', nextDueDate: '2026-01-01',
    intervalCount: 1, intervalUnit: 'months', endDate: null, priceChanges: [] };
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-01-01', expenses: [
    { ...common, id: 'finite', status: 'paused', pauses: [{ from: '2026-02-01', until: '2026-03-31' }] },
    { ...common, id: 'indefinite', status: 'paused', pauses: [{ from: '2026-02-01', until: null }] },
  ] });
  assert.ok(result.upcomingExpenses.some(run => run.expenseId === 'finite' && run.dueDate === '2026-04-01'));
  assert.equal(result.upcomingExpenses.some(run => run.expenseId === 'finite' && run.dueDate === '2026-02-01'), false);
  assert.equal(result.upcomingExpenses.some(run => run.expenseId === 'indefinite'), false);
});

test('verwirft stale planned runs nach Enddatum oder Intervalländerung und lässt skipped aus Serien', () => {
  const template = { id: 'changed', name: 'Geändert', scope: 'business', status: 'active', amountGross: 30, startDate: '2026-01-01',
    nextDueDate: '2026-01-01', intervalCount: 2, intervalUnit: 'months', endDate: '2026-03-01', pauses: [], priceChanges: [] };
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-01-01', expenses: [template], runs: [
    { id: 'stale', expenseId: 'changed', dueDate: '2026-05-01', amountGross: 900, status: 'planned', scope: 'business' },
    { id: 'skip', expenseId: 'changed', dueDate: '2026-03-01', amountGross: 900, status: 'skipped', scope: 'business' },
  ] });
  assert.equal(result.upcomingExpenses.some(run => run.id === 'stale' || run.id === 'skip'), false);
  assert.equal(result.series.some(series => series.id === 'expense:changed'), false);
});

test('Preiswechsel ohne Steuersatz übernimmt den Steuersatz der Vorlage', () => {
  const template = { id: 'tax-rate', name: 'Lizenz', scope: 'business', status: 'active', amountGross: 119, taxRate: 19,
    startDate: '2026-01-01', nextDueDate: '2026-01-01', intervalCount: 1, intervalUnit: 'months', endDate: null, pauses: [],
    priceChanges: [{ validFrom: '2026-02-01', amountGross: 238 }] };
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-01-01', expenses: [template] });
  assert.equal(result.upcomingExpenses.find(run => run.dueDate === '2026-02-01').amountGross, 238);
});

test('Jahres- und Monatswerte stimmen bei saisonaler Kurve centgenau überein', () => {
  const history = Array.from({ length: 12 }, (_, index) => income(`2025-${String(index + 1).padStart(2, '0')}-10`, [100, 100, 100, 100, 100, 100, 9000, 100, 100, 100, 100, 12000][index]));
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-03-15', entries: [income('2026-01-12', 200), income('2026-02-12', 300), income('2026-03-10', 400)], previousEntries: history });
  assert.equal(result.method, 'seasonal');
  assert.ok(result.monthly[2].forecast, 'Der aktuelle Monat enthält Resttage als Prognose.');
  assert.equal(Math.round(result.monthly.reduce((sum, month) => sum + month.revenue, 0) * 100), Math.round(result.revenueAnnual * 100));
  const monthlyCosts = result.monthly.reduce((sum, month) => sum + month.expenses + month.fixedCosts, 0);
  assert.ok(Math.abs(monthlyCosts - (result.revenueAnnual - result.profitAnnual)) <= 0.02);
});

test('behandelt nicht belegte Vorjahresmonate nicht als saisonale Nullwerte', () => {
  const history = [income('2025-01-10', 100), income('2025-07-10', 1000)];
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-02-01', entries: [income('2026-01-10', 200)], previousEntries: history });
  assert.equal(result.method, 'linear');
});

test('beginnt die Jahreshochrechnung im Gründungsjahr am Tätigkeitsbeginn', () => {
  const profile = { ...baseProfile(2026), startedOn: '2026-10-01' };
  const result = buildForecast({ year: 2026, profile, now: '2026-10-15', entries: [income('2026-09-30', 9000), income('2026-10-10', 1000)] });
  assert.equal(result.revenueYtd, 1000);
  assert.equal(result.monthly[8].revenue, 0);
  assert.equal(result.monthly[9].forecast, true);
  assert.ok(result.monthly.slice(0, 9).every(month => month.revenue === 0));
});

test('§19-Ampel zeigt Ist-Umsatz und eigenen Jahresrichtwert im Gründungsjahr', () => {
  const profile = { ...baseProfile(2026), vatStatus: 'small_business', startedOn: '2026-01-01', previousYearRevenue: 0 };
  const result = buildForecast({ year: 2026, profile, now: '2026-02-01', entries: [income('2026-01-01', 3000)] });
  const threshold = result.thresholds.find(item => item.id === 'small_business');
  assert.equal(threshold.value, 3000);
  assert.equal(result.smallBusiness.currentValue, 3000);
  assert.equal(result.smallBusiness.forecastValue, result.revenueAnnual);
  assert.equal(result.smallBusiness.currentLimit, 25000);
  assert.ok(threshold.bands.some(item => item.to === 25000));
});

test('fehlende Bescheide warnen, blockieren aber nicht das Profil', () => {
  const profile = { ...baseProfile(2026), healthInsurance: 'gkv_voluntary', healthNoticeMonthly: null, careNoticeMonthly: null,
    pensionStatus: 'teacher', pensionMode: 'notice', pensionNoticeMonthly: null };
  const result = buildForecast({ year: 2026, profile, now: '2026-01-31' });
  assert.equal(result.profileComplete, true);
  assert.ok(result.warnings.some(item => item.includes('Nachzahlungsrisiko')));
});

test('Abgabenquote darf über 100 Prozent liegen und Nullrestumsatz wird gewarnt', () => {
  const profile = { ...baseProfile(2026), pensionStatus: 'teacher', pensionMode: 'standard' };
  const result = buildForecast({ year: 2026, profile, now: '2026-01-01', entries: [income('2026-01-01', 1)] });
  assert.ok(result.reserveRatio > 1);
  assert.ok(result.warnings.some(item => item.includes('Finanzierungslücke')));
  const zero = buildForecast({ year: 2026, profile, now: '2026-12-31' });
  assert.ok(zero.warnings.some(item => item.includes('keine prognostizierten Resteinnahmen')));
});

test('sortiert Gewinnbandgrenzen auch bei negativem Jahresgewinn', () => {
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-12-31', entries: [expense('2026-01-01', 10000)] });
  assert.ok(result.profitBand.low <= result.profitAnnual);
  assert.ok(result.profitBand.high >= result.profitAnnual);
});

test('leitet Vorjahresumsatz aus Vorjahres-EÜR ab und fragt ihn nicht doppelt ab', () => {
  const profile = { ...baseProfile(2026), vatStatus: 'small_business', startedOn: '2024-01-01', previousYearRevenue: null };
  const result = buildForecast({ year: 2026, profile, now: '2026-01-31', previousEntries: [income('2025-02-01', 5000)] });
  assert.equal(result.profileComplete, true);
  assert.equal(result.smallBusiness.previousValue, 5000);
});

test('verdoppelt ESt-Stufengrenzen beim Splitting und zeigt KSK-Bemessung im KV-Schwellenwert', () => {
  const profile = { ...baseProfile(2026), assessment: 'joint', healthInsurance: 'gkv_ksk', pensionStatus: 'ksk', kskIncomeAnnual: 18000 };
  const result = buildForecast({ year: 2026, profile, now: '2026-01-31' });
  assert.equal(result.thresholds.find(item => item.id === 'est').bands[0].to, 2 * resolveTaxParams(2026).params.incomeTax.basicAllowance);
  assert.equal(result.thresholds.find(item => item.id === 'kv').value, 18000);
});

test('zieht bezahlte Umsatzsteuer vom Richtwert ab und verspricht bei Überzahlung keine Erstattung', () => {
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-01-31', entries: [income('2026-01-10', 119, 19)],
    levyPayments: [{ id: 'ust', kind: 'ust', year: 2026, period: '2026-01', dueDate: '2026-01-20', paidOn: '2026-01-20', amount: 500, source: 'manual', expenseRunId: null, notes: '' }] });
  assert.equal(result.paidUst, 500);
  assert.equal(result.vatRemainingReserve, Math.round((result.vatReserveGrossEstimate - 500) * 100) / 100);
  assert.ok(result.warnings.some(item => item.includes('keine Erstattung zugesagt')));
});


test('§19 unterscheidet grüne Ist-Ampel und höhere Jahresprognose', () => {
  const profile = { ...baseProfile(2026), vatStatus: 'small_business', startedOn: '2026-01-01' };
  const result = buildForecast({ year: 2026, profile, now: '2026-01-31', entries: [income('2026-01-01', 3000)] });
  assert.equal(result.smallBusiness.current, 'green');
  assert.ok(result.smallBusiness.forecastValue > result.smallBusiness.currentLimit);
});

test('Sozialbeiträge beginnen erst im Tätigkeitsmonat und Monatsbeträge summieren sich auf das Jahr', () => {
  const profile = { ...baseProfile(2026), startedOn: '2026-10-01', healthInsurance: 'gkv_voluntary', pensionStatus: 'teacher', pensionMode: 'standard' };
  const result = buildForecast({ year: 2026, profile, now: '2026-10-15' });
  assert.ok(result.monthly.slice(0, 9).every(item => item.social === 0));
  for (const [key, total] of [['social', result.social.total], ['taxReserve', result.taxes.total], ['vatReserve', result.vatReserveGrossEstimate]]) {
    assert.equal(Math.round(result.monthly.reduce((sum, item) => sum + item[key], 0) * 100), Math.round(total * 100));
  }
  const notStarted = buildForecast({ year: 2026, profile: { ...profile, startedOn: '2027-01-01' }, now: '2026-10-15' });
  assert.equal(notStarted.social.total, 0);
});

test('unbefristete Pause lässt frühere Fälligkeiten im Warnhinweis erhalten', () => {
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-10-09', expenses: [{ id: 'pause', scope: 'business', status: 'paused',
    amountGross: 10, startDate: '2026-09-01', intervalCount: 1, intervalUnit: 'months', pauses: [{ from: '2026-10-01', until: null }] }] });
  assert.ok(result.warnings.some(item => item.includes('2026-09-01')));
  assert.equal(result.upcomingExpenses.length, 0);
});

test('KSK-Rente mit PKV setzt nicht die GKV-KSK-Schwelle und zeigt gemeldetes RV-Einkommen', () => {
  const profile = { ...baseProfile(2026), healthInsurance: 'pkv', pensionStatus: 'ksk', kskIncomeAnnual: 18000 };
  const result = buildForecast({ year: 2026, profile, now: '2026-12-31', entries: [income('2026-01-01', 50000)] });
  assert.equal(result.thresholds.find(item => item.id === 'rv').value, 18000);
  assert.match(result.thresholds.find(item => item.id === 'kv').message, /kein einkommensabhängiger/);
});

test('Einzelfixkosten werden im Zahlungsmonat gezeigt, Vorauszahlungen schreibfrei aus Profil ergänzt', () => {
  const profile = { ...baseProfile(2026), incomeTaxAdvanceQuarterly: 200 };
  const result = buildForecast({ year: 2026, profile, now: '2026-10-09', runs: [{ id: 'run', expenseId: 'rent', name: 'Miete', scope: 'business',
    status: 'confirmed', amountGross: 100, dueDate: '2026-05-01', paidOn: '2026-06-02' }], levyPayments: [{ id: 'paid', kind: 'est_vz', year: 2026,
    period: '2026-03', dueDate: '2026-03-10', paidOn: '2026-03-10', amount: 200 }] });
  const series = result.series.find(item => item.id === 'expense:rent');
  assert.equal(series.points[4].value, 0);
  assert.equal(series.points[5].value, 100);
  assert.equal(result.upcomingLevies.length, 3);
  assert.equal(result.upcomingLevies.at(-1).dueDate, '2026-12-10');
  assert.equal(result.paidLevies, 200);
});

 test('bewahrt lokale PostgreSQL-DATE-Werte am Jahres- und Monatsanfang', () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  try {
    const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-03-01',
      entries: [income(new Date(2026, 0, 1), 100), income(new Date(2026, 1, 1), 200)] });
    assert.equal(result.revenueYtd, 300);
    assert.equal(result.monthly[0].revenue, 100);
    assert.equal(result.monthly[1].revenue, 200);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('Kachelvertrag trennt bezahlte Vorauszahlungen von Sozialbeiträgen und liefert echte Nenner', () => {
  const result = buildForecast({ year: 2026, profile: { ...baseProfile(2026), previousYearRevenue: 0 }, now: '2026-10-09',
    entries: [income('2026-09-01', 10000)], levyPayments: [
      { kind: 'kv', year: 2026, paidOn: '2026-09-01', amount: 400 },
      { kind: 'est_vz', year: 2026, paidOn: '2026-09-10', amount: 300 },
      { kind: 'ust', year: 2026, paidOn: '2026-08-10', amount: 100 },
    ] });
  assert.deepEqual(result.paidAdvances, { est_vz: 300, gewst_vz: 0, ust: 100 });
  assert.equal(result.paidNonVatLevies, 700);
  assert.equal(result.paidAdvanceMonths.find(item => item.month === '2026-09').est_vz, 300);
  assert.equal(result.paidAdvanceMonths.find(item => item.month === '2026-08').ust, 100);
  assert.equal(result.previousYearRevenueKnown, true);
  assert.equal(result.vatStatus, 'regular');
  assert.equal(result.expectedRemainingInflows, result.revenueAnnual - result.revenueYtd);
});

test('Dashboard-Fälligkeiten enthalten offene Vergangenheit und nächste Termine ohne zusätzliche Gewinnabzüge', () => {
  const recurring = { id: 'due-business', name: 'Miete', scope: 'business', status: 'active', amountGross: 100,
    startDate: '2026-01-01', intervalCount: 1, intervalUnit: 'months', endDate: '2026-12-01',
    noticePeriodDays: 30, priceChanges: [], pauses: [] };
  const result = buildForecast({ year: 2026, profile: baseProfile(2026), now: '2026-10-09', expenses: [recurring],
    runs: [{ id: 'confirmed', expenseId: recurring.id, dueDate: '2026-01-01', status: 'confirmed', amountGross: 100 }] });
  assert.equal(result.dueExpenses[0].dueDate, '2026-02-01');
  assert.equal(result.dueExpenses.at(-1).dueDate, '2026-11-01');
  assert.equal(result.fixedCostsAnnual, 100, 'nur künftige Fälligkeit ist geplante Ausgabe; offene Vergangenheit bleibt Datenhinweis');
  assert.equal(result.expenseNotices[0].noticeDeadline, '2026-11-01');
});
