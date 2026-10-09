import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTaxParams, TAX_PARAMS_REGISTRY } from '../shared/taxParams/index.js';
import { defaultTaxProfile } from '../shared/financeDefaults.js';
test('2026-Parameter enthalten Versionsstand und nachvollziehbare Quellen', () => {
  const resolved = resolveTaxParams(2026);
  assert.equal(resolved.warning, null);
  assert.equal(resolved.params.incomeTax.basicAllowance, 12348);
  assert.equal(resolved.params.social.healthCapAnnual, 69750);
  assert.ok(resolved.params.sources.every(source => source.url.startsWith('https://') && source.status));
});
test('fehlende Jahresparameter werden nur mit Warnung verwendet', () => {
  for (const year of [2025, 2027]) {
    const result = resolveTaxParams(year);
    assert.equal(result.parameterYear, 2026);
    assert.match(result.warning, new RegExp(String(year)));
  }
  assert.deepEqual(Object.keys(TAX_PARAMS_REGISTRY), ['2026']);
});
test('ungültige Jahre und stillschweigende Tätigkeitsannahmen werden vermieden', () => {
  for (const value of [NaN, 2026.5, 1, 2201, '2026']) assert.throws(() => resolveTaxParams(value));
  const profile = defaultTaxProfile(2026);
  assert.equal(profile.businessKind, null);
  assert.equal(profile.healthInsurance, null);
  assert.equal(profile.pensionStatus, 'unclear');
  assert.equal(profile.churchTaxLiable, null);
});
