import test from 'node:test';
import assert from 'node:assert/strict';
import params from '../shared/taxParams/2026.js';
import { calculateTaxes, incomeTax, solidarity, tradeTax } from '../shared/forecast/tax.js';

test('Betrieblicher Verlust mindert weitere Einkünfte in der vereinfachten Jahresrechnung', () => {
  const result = calculateTaxes(-10000, { businessKind: 'commercial', assessment: 'single', otherIncomeAnnual: 30000 }, { deductible: 0 }, params);
  assert.equal(result.taxableIncome, 20000 - params.incomeTax.specialExpenseAllowance);
  assert.equal(result.incomeTax, incomeTax(result.taxableIncome, 'single', params));
  assert.equal(result.tradeTax, 0);
  assert.equal(result.tradeCredit, 0);
});

test('Einkommensteuertarif rundet das zvE ab und trifft die Tarifgrenzen', () => {
  const { incomeTax: rules } = params;
  assert.equal(incomeTax(rules.basicAllowance - 1, 'single', params), 0);
  assert.equal(incomeTax(rules.basicAllowance, 'single', params), 0);
  assert.equal(incomeTax(rules.basicAllowance + 1, 'single', params), 0);
  for (const boundary of [rules.zone2End, rules.zone3End, rules.zone4End]) {
    const below = incomeTax(boundary - 1, 'single', params);
    const at = incomeTax(boundary, 'single', params);
    const above = incomeTax(boundary + 1, 'single', params);
    assert.ok(below <= at && at <= above, `Tarif muss an ${boundary} monoton sein`);
    assert.ok(above - below < 3, `Tarif darf an ${boundary} keinen Sprung haben`);
  }
  assert.equal(incomeTax(24383, 'single', params), 2688);
  assert.equal(incomeTax(36799, 'single', params), 6214);
  assert.equal(incomeTax(77964, 'single', params), 21609);
  assert.equal(incomeTax(77964.99, 'single', params), 21609);
});

test('Splittingtarif halbiert und verdoppelt die Tarifsteuer', () => {
  for (const amount of [0, 12348, 30000, 77964, 300000]) {
    assert.equal(incomeTax(amount, 'joint', params), 2 * incomeTax(amount / 2, 'single', params));
  }
  assert.equal(incomeTax(-50, 'single', params), 0);
  assert.equal(incomeTax(Number.NaN, 'single', params), 0);
});

test('Solidaritätszuschlag hält Freigrenze, Milderungszone und Satzende ein', () => {
  const { solidarity: rules } = params;
  assert.equal(solidarity(rules.exemptionSingle, 'single', params), 0);
  assert.equal(solidarity(21609, 'single', params), 149.82);
  const transitionEnd = rules.mitigationRate * rules.exemptionSingle / (rules.mitigationRate - rules.rate);
  assert.ok(Math.abs(transitionEnd - 37838.28125) < 0.000001);
  assert.equal(solidarity(50000, 'single', params), 2750);
  assert.equal(solidarity(rules.exemptionJoint, 'joint', params), 0);
});

test('Gewerbesteuer rundet nur den Gewerbeertrag und begrenzt §35 dreifach', () => {
  const result = tradeTax(60000, 400, 10000, 1, params);
  assert.equal(result.tradeAssessment, 1242.5);
  assert.equal(result.tradeTax, 4970);
  assert.equal(result.tradeCredit, 4970);

  const cappedByActualTax = tradeTax(60000, 500, 10000, 1, params);
  assert.equal(cappedByActualTax.tradeTax, 6212.5);
  assert.equal(cappedByActualTax.tradeCredit, 4970);

  const cappedByCommercialShare = tradeTax(60000, 400, 1000, 0.2, params);
  assert.equal(cappedByCommercialShare.tradeCredit, 200);
  assert.equal(tradeTax(24500, 400, 1000, 1, params).tradeTax, 0);
  assert.deepEqual(tradeTax(60000, null, 10000, 1, params), {
    tradeTax: 5479.43, tradeAssessment: 1242.5, tradeCredit: 4970,
  });
});

test('Gesamtprognose mindert Gewinn nicht um Sozialabgaben oder Gewerbesteuer', () => {
  const result = calculateTaxes(60000, {
    assessment: 'single', businessKind: 'commercial', tradeMultiplier: 400,
  }, { deductible: 0 }, params);
  assert.equal(result.taxableIncome, 59964);
  assert.equal(result.tradeTax, 4970);
  assert.equal(result.tradeCredit, 4970);
  assert.equal(result.incomeTax, result.incomeTaxBeforeCredit - 4970);

  const freelance = calculateTaxes(60000, {
    assessment: 'single', businessKind: 'freelance', tradeMultiplier: 400,
  }, { deductible: 0 }, params);
  assert.equal(freelance.tradeTax, 0);
  assert.equal(freelance.tradeAssessment, 0);
});

test('Hebesatz null nutzt den Parameterrichtwert mit Warnung', () => {
  const result = calculateTaxes(60000, {
    assessment: 'single', businessKind: 'commercial', tradeMultiplier: 0,
  }, {}, params);
  assert.equal(result.tradeTax,
    Math.round(result.tradeAssessment * params.tradeTax.defaultMultiplierPercent) / 100);
  assert.match(result.warnings.join(' '), /Hebesatz fehlt oder ist null/);
});

test('Kirchensteuer erfordert Einwilligung, Pflichtangabe und Bundesland', () => {
  const base = { assessment: 'single', businessKind: 'freelance' };
  const noConsent = calculateTaxes(60000, { ...base, churchTaxLiable: true, state: 'BY' }, {}, params);
  assert.equal(noConsent.churchTax, 0);
  const notLiable = calculateTaxes(60000, { ...base, churchTaxConsentAt: '2026-01-01', churchTaxLiable: false, state: 'BY' }, {}, params);
  assert.equal(notLiable.churchTax, 0);
  const noState = calculateTaxes(60000, { ...base, churchTaxConsentAt: '2026-01-01', churchTaxLiable: true }, {}, params);
  assert.equal(noState.churchTax, 0);
  assert.match(noState.warnings.join(' '), /Bundesland fehlt/);
  const bavaria = calculateTaxes(60000, { ...base, churchTaxConsentAt: '2026-01-01', churchTaxLiable: true, state: 'BY' }, {}, params);
  assert.equal(bavaria.churchTax, bavaria.incomeTax * params.churchTax.reducedRate);
  assert.match(bavaria.warnings.join(' '), /ohne landesabhängige Kappung/);
});

test('Eigene Einkünfte zählen immer; Partnereinkünfte nur bei Zusammenveranlagung', () => {
  const single = calculateTaxes(30000, {
    assessment: 'single', businessKind: 'freelance', otherIncomeAnnual: 20000, partnerIncomeAnnual: 50000,
  }, { deductible: 0 }, params);
  assert.equal(single.taxableIncome, 49964);
  assert.match(single.warnings.join(' '), /Partnereinkünfte/);
  const joint = calculateTaxes(30000, {
    assessment: 'joint', businessKind: 'freelance', otherIncomeAnnual: 20000, partnerIncomeAnnual: 50000,
  }, { deductible: 0 }, params);
  assert.equal(joint.taxableIncome, 99928);
});

test('Kinderfreibetrag wird nur bei günstigerem Ergebnis abgezogen und Kindergeld hinzugerechnet', () => {
  const lowIncome = calculateTaxes(30000, {
    assessment: 'joint', businessKind: 'freelance', children: 1,
  }, { deductible: 0 }, params);
  assert.equal(lowIncome.taxableIncome, 29928);
  assert.equal(lowIncome.incomeTaxBeforeCredit, incomeTax(lowIncome.taxableIncome, 'joint', params));

  const highIncome = calculateTaxes(300000, {
    assessment: 'joint', businessKind: 'freelance', children: 1,
  }, { deductible: 0 }, params);
  assert.equal(highIncome.taxableIncome, 300000 - 72 - params.incomeTax.childAllowancePerParent * 2);
  assert.equal(highIncome.incomeTaxBeforeCredit,
    incomeTax(highIncome.taxableIncome, 'joint', params) + params.incomeTax.childBenefitMonthly * params.forecast.monthsPerYear);
});

test('Ungültige und negative Beträge liefern nichtnegative Steuerwerte', () => {
  const result = calculateTaxes(Number.NaN, {}, { deductible: -10 }, params);
  assert.equal(result.taxableIncome, 0);
  assert.equal(result.total, 0);
  assert.ok(result.marginalRate >= 0);
});
