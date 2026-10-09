import test from 'node:test';
import assert from 'node:assert/strict';
import params from '../shared/taxParams/2026.js';
import { calculateSocial, chamberContribution } from '../shared/forecast/social.js';

function profile(overrides = {}) {
  return {
    year: 2026,
    startedOn: '2024-06-15',
    assessment: 'single',
    otherContributoryIncomeAnnual: 0,
    birthYear: 1980,
    children: 0,
    childrenUnder25: 0,
    healthInsurance: 'gkv_voluntary',
    sickPay: true,
    additionalHealthRate: 2.9,
    privateHealthMonthly: 0,
    privateCareMonthly: 0,
    privateHealthBasicMonthly: null,
    healthNoticeMonthly: null,
    careNoticeMonthly: null,
    pensionStatus: 'none',
    pensionMode: 'income',
    pensionNoticeMonthly: null,
    unemploymentEnabled: false,
    unemploymentAppliedOn: null,
    kskIncomeAnnual: null,
    chamber: 'none',
    chamberBasicAnnual: 0,
    chamberLevyRate: 0,
    chamberFounderEligible: false,
    ...overrides,
  };
}

test('GKV nutzt die Mindestbemessungsgrundlage bei niedrigem Gewinn', () => {
  const result = calculateSocial(6_000, profile(), params);
  assert.equal(result.healthAssessmentMonthly, params.social.healthMinimumMonthly);
  assert.equal(result.health, 2_768.49);
});

test('GKV berücksichtigt weitere beitragspflichtige Einkünfte bis zur BBG', () => {
  const result = calculateSocial(40_000, profile({ otherContributoryIncomeAnnual: 40_000 }), params);
  assert.equal(result.healthAssessmentMonthly, params.social.healthCapMonthly);
});

test('GKV bleibt bei hohem Gewinn auf die KV/PV-BBG begrenzt', () => {
  const result = calculateSocial(120_000, profile(), params);
  assert.equal(result.healthAssessmentMonthly, params.social.healthCapMonthly);
});

test('Verlust führt bei freiwilliger GKV weiterhin zur Mindestbemessung', () => {
  const result = calculateSocial(-2_000, profile(), params);
  assert.equal(result.healthAssessmentMonthly, params.social.healthMinimumMonthly);
});

test('Kinderlose unter 23 zahlen keinen Kinderlosenzuschlag', () => {
  const result = calculateSocial(30_000, profile({ birthYear: 2004 }), params);
  assert.equal(result.care, 1_080);
});

test('Kinderlose ab 23 zahlen den Kinderlosenzuschlag', () => {
  const result = calculateSocial(30_000, profile({ birthYear: 2003 }), params);
  assert.equal(result.care, 1_260);
});

test('unbekanntes Alter löst eine Warnung aus und erfindet keinen Kinderlosenzuschlag', () => {
  const result = calculateSocial(30_000, profile({ birthYear: null }), params);
  assert.equal(result.care, 1_080);
  assert.ok(result.warnings.some(warning => warning.includes('Alter ist unbekannt')));
});

test('PV-Abschlag beginnt beim zweiten unter 25-jährigen Kind', () => {
  const one = calculateSocial(30_000, profile({ children: 1, childrenUnder25: 1 }), params);
  const two = calculateSocial(30_000, profile({ children: 2, childrenUnder25: 2 }), params);
  assert.equal(one.care, 1_080);
  assert.equal(two.care, 1_005);
});

test('PV-Abschlag ist auf die Kinder zwei bis fünf begrenzt', () => {
  const result = calculateSocial(30_000, profile({ children: 6, childrenUnder25: 6 }), params);
  assert.equal(result.care, 780);
});

test('KSK nutzt das gemeldete Einkommen statt des EÜR-Gewinns und die Mindestbasis', () => {
  const result = calculateSocial(100_000, profile({
    healthInsurance: 'gkv_ksk', pensionStatus: 'ksk', kskIncomeAnnual: 2_400,
  }), params);
  assert.equal(result.healthAssessmentMonthly, params.social.kskHealthMinimumMonthly);
  assert.equal(result.health, 341.25);
  assert.equal(result.pension, 2_400 * params.social.pensionRate * params.social.kskInsuredShare);
  assert.ok(result.warnings.some(warning => warning.includes('KSK-Mindestgrenze')));
});

test('KSK-Beiträge begrenzen KV und RV mit ihren jeweiligen BBG', () => {
  const result = calculateSocial(1_000, profile({
    healthInsurance: 'gkv_ksk', pensionStatus: 'ksk', kskIncomeAnnual: 200_000,
  }), params);
  assert.equal(result.healthAssessmentMonthly, params.social.healthCapMonthly);
  assert.equal(result.health, 6_103.12);
  assert.equal(result.pension, 9_430.2);
});

test('KSK trägt Kinderlosenzuschlag und Kinderabschläge in voller Höhe', () => {
  const childless = calculateSocial(30_000, profile({
    healthInsurance: 'gkv_ksk', pensionStatus: 'ksk', kskIncomeAnnual: 30_000,
  }), params);
  const parent = calculateSocial(30_000, profile({
    healthInsurance: 'gkv_ksk', pensionStatus: 'ksk', kskIncomeAnnual: 30_000,
    children: 2, childrenUnder25: 2,
  }), params);
  assert.equal(childless.care, 720);
  assert.equal(parent.care, 465);
});

test('KSK bekommt keine GKV-Nachzahlungsprognose aus Bescheiddifferenzen', () => {
  const result = calculateSocial(100_000, profile({
    healthInsurance: 'gkv_ksk', pensionStatus: 'ksk', kskIncomeAnnual: 30_000,
    healthNoticeMonthly: 500, careNoticeMonthly: 100,
  }), params);
  assert.equal(result.healthBackpaymentRisk, null);
  assert.ok(!result.warnings.some(warning => warning.includes('Nachzahlungsrisiko')));
});

test('RV none und exempt ergeben keinen Beitrag', () => {
  for (const pensionStatus of ['none', 'exempt']) {
    assert.equal(calculateSocial(30_000, profile({ pensionStatus }), params).pension, 0);
  }
});

test('RV-Regelbeitrag und halber Regelbeitrag nutzen die zentralen Monatswerte', () => {
  const standard = calculateSocial(12_000, profile({ pensionStatus: 'teacher', pensionMode: 'standard' }), params);
  const half = calculateSocial(12_000, profile({ pensionStatus: 'teacher', pensionMode: 'half' }), params);
  assert.equal(standard.pension, params.social.pensionStandardMonthly * 12);
  assert.equal(half.pension, params.social.pensionHalfMonthly * 12);
});

test('ungeklärter RV-Status wird nicht automatisch als Pflicht eingestuft', () => {
  const result = calculateSocial(30_000, profile({ pensionStatus: 'unclear' }), params);
  assert.equal(result.pension, 0);
  assert.ok(result.warnings.some(warning => warning.includes('ungeklärt')));
});

test('einkommensgerechte RV nutzt Mindestbasis und RV-BBG', () => {
  const minimum = calculateSocial(1_000, profile({ pensionStatus: 'teacher', pensionMode: 'income' }), params);
  const capped = calculateSocial(120_000, profile({ pensionStatus: 'craft', pensionMode: 'income' }), params);
  assert.equal(minimum.pension, 1_345.9);
  assert.equal(capped.pension, 18_860.4);
});

test('RV im Modus Bescheid nutzt ausschließlich den Bescheidbetrag', () => {
  const result = calculateSocial(100_000, profile({
    pensionStatus: 'teacher', pensionMode: 'notice', pensionNoticeMonthly: 280,
  }), params);
  assert.equal(result.pension, 3_360);
});

test('RV im Modus Bescheid ohne Betrag erzeugt eine Warnung', () => {
  const result = calculateSocial(30_000, profile({ pensionStatus: 'teacher', pensionMode: 'notice' }), params);
  assert.equal(result.pension, 0);
  assert.ok(result.warnings.some(warning => warning.includes('Bescheid fehlt')));
});

test('Arbeitslosenversicherung nutzt den Gründerbeitrag im Gründungsjahr und Folgejahr', () => {
  const result = calculateSocial(30_000, profile({
    startedOn: '2025-07-01', unemploymentEnabled: true, unemploymentAppliedOn: '2025-08-01',
  }), params);
  assert.equal(result.unemployment, params.social.unemploymentFounderMonthly * 12);
});

test('Arbeitslosenversicherung weist auf fehlendes Antragsdatum hin', () => {
  const result = calculateSocial(30_000, profile({ unemploymentEnabled: true }), params);
  assert.ok(result.warnings.some(warning => warning.includes('Antragsfrist')));
});

test('RV zählt zum Altersvorsorgeabzug, AV nur zum verbleibenden sonstigen Höchstbetrag', () => {
  const result = calculateSocial(30_000, profile({
    pensionStatus: 'teacher', pensionMode: 'income', unemploymentEnabled: true,
    unemploymentAppliedOn: '2024-07-01', healthNoticeMonthly: 500, careNoticeMonthly: 100,
  }), params);
  const expected = result.health * params.deductions.healthSickPayDeductionFactor
    + result.care + result.pension + Math.min(result.unemployment, Math.max(0, params.deductions.otherMaximumSelfEmployed - result.health * params.deductions.healthSickPayDeductionFactor - result.care));
  assert.equal(result.deductible, Math.round(expected * 100) / 100);
  assert.ok(result.deductible >= result.pension);
});

test('PKV nutzt feste KV/PV-Beiträge und warnt bei fehlendem Basisanteil', () => {
  const result = calculateSocial(80_000, profile({
    healthInsurance: 'pkv', privateHealthMonthly: 500, privateCareMonthly: 90,
  }), params);
  assert.equal(result.health, 6_000);
  assert.equal(result.care, 1_080);
  assert.ok(result.warnings.some(warning => warning.includes('Basisanteil')));
});

test('PKV übernimmt den angegebenen Basisanteil für den Abzug', () => {
  const result = calculateSocial(80_000, profile({
    healthInsurance: 'pkv', privateHealthMonthly: 500, privateCareMonthly: 90,
    privateHealthBasicMonthly: 350,
  }), params);
  assert.equal(result.deductible, 350 * 12 + 90 * 12);
});

test('GKV ohne Bescheidwerte liefert kein erfundenes Null-Nachzahlungsrisiko', () => {
  const result = calculateSocial(30_000, profile(), params);
  assert.equal(result.healthBackpaymentRisk, null);
  assert.ok(result.warnings.some(warning => warning.includes('Bescheid fehlt')));
});

test('GKV-Nachzahlungsrisiko vergleicht Jahresbeiträge mit den Monatsbescheiden', () => {
  const result = calculateSocial(30_000, profile({ healthNoticeMonthly: 300, careNoticeMonthly: 100 }), params);
  assert.equal(result.healthBackpaymentRisk, result.health + result.care - 4_800);
});

test('Familienversicherung wird ohne Anspruchsprüfung mit null angesetzt', () => {
  const result = calculateSocial(100_000, profile({ healthInsurance: 'family' }), params);
  assert.equal(result.health, 0);
  assert.equal(result.care, 0);
  assert.equal(result.healthBackpaymentRisk, null);
});

test('IHK-Gründerbefreiung gilt in den ersten zwei Jahren bei bestätigter Berechtigung', () => {
  const result = chamberContribution(20_000, profile({
    startedOn: '2025-01-01', chamber: 'ihk', chamberBasicAnnual: 200,
    chamberLevyRate: 0.2, chamberFounderEligible: true,
  }), params);
  assert.equal(result.annual, 0);
});

test('IHK-Jahr drei befreit nur die Umlage bei bestätigter Berechtigung und Gewinnlimit', () => {
  const result = chamberContribution(20_000, profile({
    startedOn: '2024-01-01', chamber: 'ihk', chamberBasicAnnual: 200,
    chamberLevyRate: 0.2, chamberFounderEligible: true,
  }), params);
  assert.equal(result.annual, 200);
});

test('IHK setzt keine Gründerentlastung oberhalb der Gewinngrenze an', () => {
  const result = chamberContribution(30_000, profile({
    startedOn: '2025-01-01', chamber: 'ihk', chamberBasicAnnual: 200,
    chamberLevyRate: 0.2, chamberFounderEligible: true,
  }), params);
  assert.equal(result.annual, 229.32);
  assert.ok(result.warnings.some(warning => warning.includes('Gewinngrenze')));
});

test('IHK-Beitragsfreiheit bei niedrigem Gewinn erfordert bestätigte Berechtigung', () => {
  const result = chamberContribution(5_000, profile({
    chamber: 'ihk', chamberBasicAnnual: 200, chamberLevyRate: 0,
  }), params);
  assert.equal(result.annual, 200);
  assert.ok(result.warnings.some(warning => warning.includes('Beitragsfreiheit')));
});

test('HWK schätzt nur aus den eingegebenen Kammerwerten und warnt vor lokaler Abweichung', () => {
  const result = chamberContribution(40_000, profile({
    chamber: 'hwk', chamberBasicAnnual: 160, chamberLevyRate: 0.5,
  }), params);
  assert.equal(result.annual, 360);
  assert.ok(result.warnings.some(warning => warning.includes('kammerabhängig')));
});

test('HWK-Erstjahresbefreiung wird nur mit bestätigter Berechtigung und Gewinnlimit angesetzt', () => {
  const result = chamberContribution(20_000, profile({
    startedOn: '2026-01-15', chamber: 'hwk', chamberBasicAnnual: 180,
    chamberLevyRate: 0.3, chamberFounderEligible: true,
  }), params);
  assert.equal(result.annual, 0);
  assert.ok(result.warnings.some(warning => warning.includes('kammerabhängig')));
});

test('Kammerumlage wird bei negativem Gewinn nicht negativ berechnet', () => {
  const result = chamberContribution(-10_000, profile({
    chamber: 'hwk', chamberBasicAnnual: 120, chamberLevyRate: 1,
  }), params);
  assert.equal(result.annual, 120);
});

test('HWK-Gründerentlastung staffelt Jahr zwei/drei/vier und läuft aus', () => {
  for (const [startedOn, expected] of [['2025-01-01',90],['2024-01-01',90],['2023-01-01',180],['2022-01-01',240]]) {
    const result = chamberContribution(20000, profile({startedOn, chamber:'hwk', chamberBasicAnnual:180, chamberLevyRate:0.3, chamberFounderEligible:true}), params);
    assert.equal(result.annual, expected);
  }
});
test('KSK-Rentenbeitrag bleibt bei privater Krankenversicherung erhalten', () => {
  const result = calculateSocial(30000, profile({healthInsurance:'pkv', pensionStatus:'ksk', kskIncomeAnnual:30000}), params);
  assert.equal(result.pension, 2790);
});
test('Freiwillige RV übernimmt keine Einkommenspflicht ohne individuellen Beitrag', () => {
  const result = calculateSocial(30000, profile({pensionStatus:'voluntary', pensionMode:'income'}), params);
  assert.equal(result.pension, 0);
  assert.match(result.warnings.join(' '), /individuell/);
});
