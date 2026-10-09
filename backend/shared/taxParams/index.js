import params2026 from './2026.js';
export const TAX_PARAMS_REGISTRY = Object.freeze({ 2026: params2026 });
export function resolveTaxParams(year) {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new RangeError('Ungültiges Steuerjahr.');
  const available = Object.keys(TAX_PARAMS_REGISTRY).map(Number).sort((a, b) => a - b);
  const exact = TAX_PARAMS_REGISTRY[year];
  const params = exact || TAX_PARAMS_REGISTRY[available.filter(value => value <= year).at(-1) ?? available[0]];
  return { params, requestedYear: year, parameterYear: params.year, warning: exact ? null : `Für ${year} fehlen geprüfte Werte. Die Schätzung verwendet Werte aus ${params.year} (Stand ${params.asOf}).` };
}
