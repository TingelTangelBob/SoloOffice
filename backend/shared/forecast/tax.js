import { resolveTaxParams } from '../taxParams/index.js';
const finiteNonNegative = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const roundEuroDown = value => Math.floor(finiteNonNegative(value));
const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;

function tariffSingle(taxableIncome, params) {
  const x = roundEuroDown(taxableIncome);
  const tax = params.incomeTax;
  if (x <= tax.basicAllowance) return 0;
  const divisor = tax.progressionDivisor;
  let amount;
  if (x <= tax.zone2End) {
    const y = (x - tax.basicAllowance) / divisor;
    amount = (tax.zone2Quadratic * y + tax.zone2Linear) * y;
  } else if (x <= tax.zone3End) {
    const z = (x - tax.zone2End) / divisor;
    amount = (tax.zone3Quadratic * z + tax.zone3Linear) * z + tax.zone3Offset;
  } else if (x <= tax.zone4End) {
    amount = tax.zone4Rate * x - tax.zone4Offset;
  } else {
    amount = tax.zone5Rate * x - tax.zone5Offset;
  }
  return Math.max(0, Math.floor(amount));
}

function isJoint(assessment) {
  return assessment === 'joint' || assessment === 'together' || assessment === 'splitting';
}

/** Einkommensteuer nach § 32a EStG, mit vereinfachter Splittingberechnung. */
export function incomeTax(taxableIncome, assessment = 'single', params = resolveTaxParams(2026).params) {
  if (!params?.incomeTax) return 0;
  const income = finiteNonNegative(taxableIncome);
  if (!isJoint(assessment)) return tariffSingle(income, params);
  return 2 * tariffSingle(income / 2, params);
}

/** Solidaritätszuschlag auf die festgesetzte Einkommensteuer. */
export function solidarity(incomeTaxAmount, assessment, params) {
  const tax = finiteNonNegative(incomeTaxAmount);
  const rules = params?.solidarity;
  if (!rules) return 0;
  const joint = isJoint(assessment);
  const exemption = joint ? rules.exemptionJoint : rules.exemptionSingle;
  if (tax <= exemption) return 0;
  return Math.floor(Math.min(rules.mitigationRate * (tax - exemption), rules.rate * tax) * 100 + 1e-9) / 100;
}

/** Gewerbesteuer und §35-Anrechnung; der Messbetrag wird nicht abgerundet. */
export function tradeTax(profit, multiplier, incomeTaxAmount, commercialIncomeShare, params) {
  const rules = params?.tradeTax;
  if (!rules) return { tradeTax: 0, tradeAssessment: 0, tradeCredit: 0 };
  const tradeProfit = finiteNonNegative(profit);
  const multiplierPercent = Number.isFinite(multiplier) && multiplier > 0
    ? multiplier
    : rules.defaultMultiplierPercent;
  const roundedTradeIncome = Math.floor(tradeProfit / rules.roundingUnit) * rules.roundingUnit;
  const taxableTradeIncome = Math.max(0, roundedTradeIncome - rules.allowance);
  const tradeAssessment = roundMoney(taxableTradeIncome * rules.assessmentRate);
  const amount = roundMoney(tradeAssessment * multiplierPercent / 100);
  const share = Number.isFinite(commercialIncomeShare) ? Math.min(1, Math.max(0, commercialIncomeShare)) : 0;
  const tradeCredit = roundMoney(Math.min(amount, tradeAssessment * rules.creditMultiplier, finiteNonNegative(incomeTaxAmount) * share));
  return { tradeTax: Math.max(0, amount), tradeAssessment, tradeCredit: Math.max(0, tradeCredit) };
}

function marginalRateAt(taxableIncome, assessment, params) {
  const income = finiteNonNegative(taxableIncome);
  const joint = isJoint(assessment);
  const x = roundEuroDown(joint ? income / 2 : income);
  const tax = params.incomeTax;
  const divisor = tax.progressionDivisor;
  let slope = 0;
  if (x > tax.basicAllowance && x <= tax.zone2End) {
    const y = (x - tax.basicAllowance) / divisor;
    slope = (2 * tax.zone2Quadratic * y + tax.zone2Linear) / divisor;
  } else if (x > tax.zone2End && x <= tax.zone3End) {
    const z = (x - tax.zone2End) / divisor;
    slope = (2 * tax.zone3Quadratic * z + tax.zone3Linear) / divisor;
  } else if (x > tax.zone3End && x <= tax.zone4End) {
    slope = tax.zone4Rate;
  } else if (x > tax.zone4End) {
    slope = tax.zone5Rate;
  }
  return slope;
}

function isCommercial(profile) {
  return ['commercial', 'craft_a', 'craft_b'].includes(profile?.businessKind);
}

function childAllowance(profile, params, baseIncome, assessment) {
  const count = Number.isInteger(profile?.children) ? Math.max(0, profile.children) : 0;
  if (!count) return { deduction: 0, benefit: 0, used: false };
  const rules = params.incomeTax;
  const sharedParents = isJoint(assessment) ? 2 : 1;
  const allowance = count * rules.childAllowancePerParent * sharedParents;
  const benefit = count * rules.childBenefitMonthly * params.forecast.monthsPerYear * sharedParents / 2;
  const taxWithout = incomeTax(baseIncome, assessment, params);
  const taxWith = incomeTax(Math.max(0, baseIncome - allowance), assessment, params);
  if (taxWithout - taxWith > benefit) return { deduction: allowance, benefit, used: true };
  return { deduction: 0, benefit: 0, used: false };
}

/** Erstellt eine unverbindliche jährliche Steuerprognose aus Profil und Sozialprognose. */
export function calculateTaxes(profitAnnual, profile = {}, social = {}, params) {
  const warnings = [];
  if (!params?.incomeTax || !params?.solidarity || !params?.tradeTax) {
    return {
      taxableIncome: 0, incomeTaxBeforeCredit: 0, incomeTax: 0, solidarity: 0, churchTax: 0,
      tradeTax: 0, tradeAssessment: 0, tradeCredit: 0, total: 0, marginalRate: 0,
      warnings: ['Steuerparameter fehlen; eine Steuerprognose ist nicht möglich.'],
    };
  }

  const profit = finiteNonNegative(profitAnnual);
  const assessment = profile.assessment || 'single';
  const ownOtherIncome = finiteNonNegative(profile.otherIncomeAnnual);
  const partnerIncome = finiteNonNegative(profile.partnerIncomeAnnual);
  if (!isJoint(assessment) && partnerIncome > 0) warnings.push('Partnereinkünfte werden bei Einzelveranlagung nicht einbezogen.');
  const incomeBeforeDeductions = profit + ownOtherIncome + (isJoint(assessment) ? partnerIncome : 0);
  const deductible = finiteNonNegative(social?.deductible);
  const allowance = isJoint(assessment)
    ? params.incomeTax.specialExpenseAllowance * 2
    : params.incomeTax.specialExpenseAllowance;
  const singleParentDeduction = profile.singleParent && !isJoint(assessment) && profile.children > 0
    ? params.incomeTax.singleParentAllowance + Math.max(0, finiteNonNegative(profile.children) - 1) * params.incomeTax.singleParentExtraChild
    : 0;
  const preChildTaxableIncome = Math.max(0, incomeBeforeDeductions - deductible - allowance - singleParentDeduction);
  if (profile.children > 0) warnings.push('Kinderfreibetrag und Kindergeld werden vereinfacht mit hälftigem Anspruch bei Einzelveranlagung geschätzt; abweichende Ansprüche und Kinderwirkung bei Soli/Kirchensteuer sind nicht vollständig berücksichtigt.');
  const child = childAllowance(profile, params, preChildTaxableIncome, assessment);
  const taxableIncome = Math.max(0, preChildTaxableIncome - child.deduction);

  const taxBeforeCredit = incomeTax(taxableIncome, assessment, params) + child.benefit;
  const commercial = isCommercial(profile);
  if (!profile.businessKind) {
    warnings.push('Unternehmensart fehlt; die Gewerbesteuer konnte nicht eingeordnet werden.');
  }
  const multiplierMissing = commercial && (!Number.isFinite(profile.tradeMultiplier) || profile.tradeMultiplier <= 0);
  if (multiplierMissing) warnings.push('Hebesatz fehlt oder ist null; für die Gewerbesteuer-Schätzung wird der Richtwert verwendet.');
  const shareDenominator = Math.max(0, incomeBeforeDeductions);
  const commercialShare = commercial && shareDenominator > 0 ? Math.min(1, profit / shareDenominator) : 0;
  const trade = commercial
    ? tradeTax(profit, profile.tradeMultiplier, taxBeforeCredit, commercialShare, params)
    : { tradeTax: 0, tradeAssessment: 0, tradeCredit: 0 };
  const incomeTaxAfterCredit = Math.max(0, taxBeforeCredit - trade.tradeCredit);

  const solidarityAmount = solidarity(incomeTaxAfterCredit, assessment, params);
  let churchTaxAmount = 0;
  if (profile.churchTaxConsentAt && profile.churchTaxLiable === true && typeof profile.state === 'string') {
    const state = profile.state.toUpperCase();
    const rate = params.churchTax.reducedStates.includes(state)
      ? params.churchTax.reducedRate
      : params.churchTax.standardRate;
    churchTaxAmount = roundMoney(incomeTaxAfterCredit * rate);
    warnings.push('Kirchensteuer ist ohne landesabhängige Kappung geschätzt.');
  } else if (profile.churchTaxLiable === true && profile.churchTaxConsentAt && !profile.state) {
    warnings.push('Bundesland fehlt; die Kirchensteuer-Schätzung wurde ausgelassen.');
  }

  const marginalRate = marginalRateAt(taxableIncome, assessment, params);

  return {
    taxableIncome,
    incomeTaxBeforeCredit: taxBeforeCredit,
    incomeTax: incomeTaxAfterCredit,
    solidarity: solidarityAmount,
    churchTax: churchTaxAmount,
    tradeTax: trade.tradeTax,
    tradeAssessment: trade.tradeAssessment,
    tradeCredit: trade.tradeCredit,
    total: roundMoney(incomeTaxAfterCredit + solidarityAmount + churchTaxAmount + trade.tradeTax),
    marginalRate,
    warnings,
  };
}
