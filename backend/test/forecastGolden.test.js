import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTaxProfile } from '../shared/financeDefaults.js';
import { resolveTaxParams } from '../shared/taxParams/index.js';
import { calculateSocial, chamberContribution } from '../shared/forecast/social.js';
import { calculateTaxes, incomeTax, solidarity, tradeTax } from '../shared/forecast/tax.js';

const { params } = resolveTaxParams(2026);
const closeTo = (actual, expected, tolerance = 0.01) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `erwartet ${expected}, erhalten ${actual}`);
};
const profile = (overrides = {}) => ({
  ...defaultTaxProfile(2026),
  healthInsurance: 'gkv_voluntary',
  sickPay: true,
  additionalHealthRate: 2.9,
  birthYear: 1980,
  children: 0,
  childrenUnder25: 0,
  pensionStatus: 'teacher',
  pensionMode: 'income',
  businessKind: 'freelance',
  ...overrides,
});

// Unabhängige Referenzwerte aus calc.py; die Fallwerte sind auf volle Euro gerundet.
const lecturerCases = [
  { profit: 12000, health: 2768, care: 664, pension: 2232, social: 5665, taxable: 6410, incomeTax: 0, total: 5665 },
  { profit: 20000, health: 3500, care: 840, pension: 3720, social: 8060, taxable: 12044, incomeTax: 0, total: 8060 },
  { profit: 30000, health: 5250, care: 1260, pension: 5580, social: 12090, taxable: 18084, incomeTax: 1103, total: 13193 },
  { profit: 45000, health: 7875, care: 1890, pension: 8370, social: 18135, taxable: 27144, incomeTax: 3426, total: 21561 },
  { profit: 60000, health: 10500, care: 2520, pension: 11160, social: 24180, taxable: 36204, incomeTax: 6032, total: 30212 },
];

for (const expected of lecturerCases) {
  test(`Golden Dozent ${expected.profit} €: KV, PV, RV, SV, zvE, ESt und Gesamt`, () => {
    const p = profile();
    const social = calculateSocial(expected.profit, p, params);
    const taxes = calculateTaxes(expected.profit, p, social, params);
    closeTo(social.health, expected.health, 0.5);
    closeTo(social.care, expected.care, 0.5);
    closeTo(social.pension, expected.pension, 0.5);
    closeTo(social.total, expected.social, 0.5);
    closeTo(taxes.taxableIncome, expected.taxable, 0.5);
    assert.equal(taxes.incomeTax, expected.incomeTax);
    closeTo(social.total + taxes.total, expected.total, 0.5);
  });
}

test('Golden Dozent ohne RV bei 30.000 €: zvE 23.664 €, ESt 2.500 €, Quote 30 %', () => {
  const p = profile({ pensionStatus: 'none' });
  const social = calculateSocial(30000, p, params);
  const taxes = calculateTaxes(30000, p, social, params);
  closeTo(social.health, 5250, 0.5);
  closeTo(social.care, 1260, 0.5);
  assert.equal(social.pension, 0);
  closeTo(social.total, 6510, 0.5);
  assert.equal(taxes.taxableIncome, 23664);
  assert.equal(taxes.incomeTax, 2500);
  closeTo(social.total + taxes.total, 9010, 0.5);
  closeTo((social.total + taxes.total) / 30000 * 100, 30, 0.05);
});

// Steuerzonen, jeweils mit Randwerten knapp unter/auf/über der Tarifgrenze.
const tariffCases = [
  [12347, 0], [12348, 0], [12349, 0],
  [17798, 1034], [17799, 1034], [17800, 1035],
  [69877, 18212], [69878, 18213], [69879, 18213],
  [277824, 105550], [277825, 105550], [277826, 105551],
];
for (const [income, expected] of tariffCases) {
  test(`ESt-Tarif-Golden an Zonengrenze: zvE ${income} € → ${expected} €`, () => {
    assert.equal(incomeTax(income, 'single', params), expected);
  });
}

test('ESt-Golden aus c-RESULT: 24.384 € zvE ergeben 2.688 €', () => {
  assert.equal(incomeTax(24384, 'single', params), 2688);
});
test('Splitting-Golden aus c-RESULT: gemeinsames zvE 51.928 € ergibt 6.214 €', () => {
  assert.equal(incomeTax(51928, 'joint', params), 6214);
});
test('Zusammenveranlagung ist doppelte Steuer auf die Hälfte des gemeinsamen zvE', () => {
  assert.equal(incomeTax(51928, 'joint', params), 2 * incomeTax(25964, 'single', params));
});
test('ESt-Golden aus c-RESULT: 77.964 € zvE ergeben 21.609 €', () => {
  assert.equal(incomeTax(77964, 'single', params), 21609);
});

test('Soli bleibt an der Einzel-Freigrenze von 20.350 € bei null', () => {
  assert.equal(solidarity(20350, 'single', params), 0);
});
test('Soli setzt direkt über der Einzel-Freigrenze ein', () => {
  closeTo(solidarity(20351, 'single', params), 0.11, 0.02);
});
test('Soli-Golden aus c-RESULT: ESt 21.609 € ergibt 149,82 €', () => {
  closeTo(solidarity(21609, 'single', params), 149.82, 0.01);
});
test('Soli-Milderungszone endet rechnerisch bei rund 37.838,28 € ESt', () => {
  const end = params.solidarity.mitigationRate * params.solidarity.exemptionSingle
    / (params.solidarity.mitigationRate - params.solidarity.rate);
  closeTo(end, 37838.28125, 0.00001);
  closeTo(solidarity(37838, 'single', params), 2081.07, 0.02);
});
test('Soli nutzt bei Zusammenveranlagung die doppelte Freigrenze', () => {
  assert.equal(solidarity(40700, 'joint', params), 0);
  assert.ok(solidarity(40701, 'joint', params) > 0);
});

test('GewSt-Golden: 60.000 € bei Hebesatz 400 % ergeben 4.970 €', () => {
  const result = tradeTax(60000, 400, 10000, 1, params);
  assert.deepEqual(result, { tradeTax: 4970, tradeAssessment: 1242.5, tradeCredit: 4970 });
});
test('GewSt: Freibetrag 24.500 € greift nach Abrundung des Gewerbeertrags', () => {
  assert.equal(tradeTax(24500, 400, 10000, 1, params).tradeTax, 0);
});
test('GewSt: 24.599 € Gewerbeertrag wird zuerst auf 24.500 € abgerundet', () => {
  assert.equal(tradeTax(24599, 400, 10000, 1, params).tradeTax, 0);
});
test('GewSt: 24.600 € Gewerbeertrag ergibt 14 € und Messbetrag 3,5 €', () => {
  assert.deepEqual(tradeTax(24600, 400, 10000, 1, params), {
    tradeTax: 14, tradeAssessment: 3.5, tradeCredit: 14,
  });
});
test('GewSt-Messbetrag wird nicht auf volle Euro abgerundet', () => {
  assert.equal(tradeTax(24600, 400, 10000, 1, params).tradeAssessment, 3.5);
});
test('§35-Anrechnung ist durch die tatsächlich gezahlte GewSt begrenzt', () => {
  const result = tradeTax(60000, 500, 10000, 1, params);
  assert.equal(result.tradeTax, 6212.5);
  assert.equal(result.tradeCredit, 4970);
});
test('§35-Anrechnung ist durch die anteilige ESt begrenzt', () => {
  assert.equal(tradeTax(60000, 500, 500, 0.5, params).tradeCredit, 250);
});
test('§35 berücksichtigt nur den Anteil der gewerblichen Einkünfte', () => {
  assert.equal(tradeTax(60000, 400, 1000, 0.25, params).tradeCredit, 250);
});
test('Freiberufler erhalten in der Steuerberechnung keine GewSt', () => {
  const p = profile({ tradeMultiplier: 400 });
  const social = calculateSocial(60000, p, params);
  const taxes = calculateTaxes(60000, p, social, params);
  assert.equal(taxes.tradeTax, 0);
  assert.equal(taxes.tradeAssessment, 0);
});

test('GKV/PV Mindestbemessung greift bei Gewinn unter 15.820 € jährlich', () => {
  const social = calculateSocial(12000, profile(), params);
  closeTo(social.healthAssessmentMonthly, 1318.33, 0.01);
  closeTo(social.health, 2768.49, 0.01);
});
test('GKV/PV Mindestbemessung greift genau an der Jahresgrenze 15.820 €', () => {
  const social = calculateSocial(15820, profile(), params);
  closeTo(social.healthAssessmentMonthly, 1318.33, 0.01);
});
test('GKV-Bemessung liegt knapp über der Mindestgrenze beim tatsächlichen Gewinn', () => {
  const social = calculateSocial(15821, profile(), params);
  closeTo(social.healthAssessmentMonthly, 15821 / 12, 0.01);
});
test('GKV-Bemessung wird an der BBG 69.750 € gedeckelt', () => {
  const social = calculateSocial(100000, profile(), params);
  closeTo(social.healthAssessmentMonthly, 5812.5, 0.01);
  closeTo(social.health, 12206.25, 0.01);
});
test('GKV-Bemessung liegt an der BBG 69.750 €', () => {
  const social = calculateSocial(69750, profile(), params);
  closeTo(social.healthAssessmentMonthly, 5812.5, 0.01);
});
test('GKV-Satz ohne Krankengeld nutzt 14,0 % plus Zusatzbeitrag', () => {
  const social = calculateSocial(30000, profile({ sickPay: false }), params);
  closeTo(social.health, 5070, 0.01);
});
test('Pflegebeitrag ohne Kinderlosenzuschlag ist 3,6 %', () => {
  const social = calculateSocial(30000, profile({ birthYear: 1990, children: 1 }), params);
  closeTo(social.care, 1080, 0.01);
});
test('PV-Kinderlosenzuschlag von 0,6 Prozentpunkten greift ab 23 Jahren', () => {
  const social = calculateSocial(30000, profile({ birthYear: 2003 }), params);
  closeTo(social.care, 1260, 0.01);
});
test('PV-Kinderabschlag greift ab dem zweiten Kind unter 25', () => {
  const social = calculateSocial(30000, profile({ birthYear: 1980, children: 2, childrenUnder25: 2 }), params);
  closeTo(social.care, 1005, 0.01);
});
test('PV-Kinderabschlag ist auf vier berücksichtigte Kinder begrenzt', () => {
  const social = calculateSocial(30000, profile({ birthYear: 1980, children: 5, childrenUnder25: 5 }), params);
  closeTo(social.care, 780, 0.01);
});

test('RV-Einkommensmodus nutzt Mindestbemessungsgrundlage 603 € je Monat', () => {
  const social = calculateSocial(3000, profile(), params);
  closeTo(social.pension, 1345.90, 0.01);
});
test('RV-Einkommensmodus wird an der Beitragsbemessungsgrenze gedeckelt', () => {
  const social = calculateSocial(120000, profile(), params);
  closeTo(social.pension, 18860.40, 0.01);
});
test('RV-Regelbeitrag 735,63 € monatlich ergibt 8.827,56 € jährlich', () => {
  const social = calculateSocial(30000, profile({ pensionMode: 'standard' }), params);
  closeTo(social.pension, 8827.56, 0.01);
});
test('RV-halber Regelbeitrag 367,82 € monatlich ergibt 4.413,84 € jährlich', () => {
  const social = calculateSocial(30000, profile({ pensionMode: 'half' }), params);
  closeTo(social.pension, 4413.84, 0.01);
});
test('RV-Mindestbeitrag aus 112,16 € monatlich wird als Nutzerparameter verwendet', () => {
  const social = calculateSocial(30000, profile({ pensionMode: 'minimum' }), params);
  closeTo(social.pension, 1345.92, 0.01);
});

test('KSK verwendet gemeldetes Jahreseinkommen statt GKV-Mindestbemessungsgrundlage', () => {
  const p = profile({ healthInsurance: 'gkv_ksk', pensionStatus: 'ksk', kskIncomeAnnual: 12000 });
  const social = calculateSocial(90000, p, params);
  closeTo(social.healthAssessmentMonthly, 1000, 0.01);
  closeTo(social.health, 1050, 0.01);
  closeTo(social.care, 288, 0.01);
  closeTo(social.pension, 1116, 0.01);
});
test('KSK-Mindestbemessung für den Versichertenanteil greift bei 3.900 € Meldung', () => {
  const p = profile({ healthInsurance: 'gkv_ksk', pensionStatus: 'ksk', kskIncomeAnnual: 3900 });
  const social = calculateSocial(50000, p, params);
  closeTo(social.healthAssessmentMonthly, 325, 0.01);
});
test('KSK trägt den Kinderlosenzuschlag voll, auch wenn der Grundsatz anteilig ist', () => {
  const p = profile({ healthInsurance: 'gkv_ksk', pensionStatus: 'ksk', kskIncomeAnnual: 12000, birthYear: 1980 });
  const social = calculateSocial(12000, p, params);
  closeTo(social.care, 288, 0.01);
});

test('AV-Regelbeitrag 102,83 € monatlich wird jährlich berücksichtigt', () => {
  const social = calculateSocial(30000, profile({ unemploymentEnabled: true, startedOn: '2020-01-01', unemploymentAppliedOn: '2020-02-01' }), params);
  closeTo(social.unemployment, 1233.96, 0.01);
});
test('AV-Gründerbeitrag 51,41 € monatlich gilt in den ersten zwei Kalenderjahren', () => {
  const social = calculateSocial(30000, profile({ unemploymentEnabled: true, startedOn: '2025-06-01', unemploymentAppliedOn: '2025-07-01' }), params);
  closeTo(social.unemployment, 616.92, 0.01);
});
test('AV bleibt getrennt vom RV-Beitrag und erhöht nur den sonstigen Vorsorgeabzug', () => {
  const common = {
    healthInsurance: 'family', pensionMode: 'standard',
    startedOn: '2020-01-01', unemploymentAppliedOn: '2020-02-01',
  };
  const withoutAv = calculateSocial(30000, profile({ ...common, unemploymentEnabled: false }), params);
  const withAv = calculateSocial(30000, profile({ ...common, unemploymentEnabled: true }), params);
  assert.equal(withAv.pension, 8827.56);
  assert.equal(withAv.unemployment, 1233.96);
  closeTo(withAv.deductible - withoutAv.deductible, 1233.96, 0.01);
});

test('Kirchensteuer bleibt ohne protokollierte Einwilligung null', () => {
  const p = profile({ churchTaxLiable: true, churchTaxConsentAt: null, state: 'BE' });
  const taxes = calculateTaxes(60000, p, calculateSocial(60000, p, params), params);
  assert.equal(taxes.churchTax, 0);
});
test('Kirchensteuer wird mit Einwilligung und Bundesland mit 9 % geschätzt', () => {
  const p = profile({ churchTaxLiable: true, churchTaxConsentAt: '2026-01-01T00:00:00Z', state: 'BE' });
  const taxes = calculateTaxes(60000, p, calculateSocial(60000, p, params), params);
  closeTo(taxes.churchTax, taxes.incomeTax * 0.09, 0.01);
});
test('Kirchensteuer in BY nutzt 8 % statt 9 %', () => {
  const p = profile({ churchTaxLiable: true, churchTaxConsentAt: '2026-01-01T00:00:00Z', state: 'BY' });
  const taxes = calculateTaxes(60000, p, calculateSocial(60000, p, params), params);
  closeTo(taxes.churchTax, taxes.incomeTax * 0.08, 0.01);
});
test('Kirchensteuer ohne Bundesland wird ausgelassen und mit Warnung markiert', () => {
  const p = profile({ churchTaxLiable: true, churchTaxConsentAt: '2026-01-01T00:00:00Z', state: null });
  const taxes = calculateTaxes(60000, p, calculateSocial(60000, p, params), params);
  assert.equal(taxes.churchTax, 0);
  assert.ok(taxes.warnings.some(warning => warning.includes('Bundesland fehlt')));
});

test('Kammerbeitrag none bleibt null', () => {
  assert.deepEqual(chamberContribution(60000, profile({ chamber: 'none' }), params), { annual: 0, warnings: [] });
});
test('IHK-Kleinbeitragsbefreiung erfordert bestätigte Berechtigung bis 5.200 €', () => {
  const result = chamberContribution(5000, profile({ chamber: 'ihk', chamberFounderEligible: true }), params);
  assert.equal(result.annual, 0);
});
test('IHK unter 5.200 € ohne bestätigte Berechtigung wird nicht automatisch befreit', () => {
  const result = chamberContribution(5000, profile({ chamber: 'ihk', chamberBasicAnnual: 100 }), params);
  assert.equal(result.annual, 100);
  assert.ok(result.warnings.length > 0);
});
