const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const annual = (monthly, params) => roundMoney(monthly * params.forecast.monthsPerYear);
const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);
const hasNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

function ageInYear(profile, params) {
  if (!Number.isInteger(profile.birthYear)) return null;
  // Das Profil speichert nur das Geburtsjahr. Der Geburtstag im Beitragsjahr
  // kann daher nicht genauer bestimmt werden.
  return (profile.year ?? params.year) - profile.birthYear;
}

function isFounderYear(profile, params, numberOfCalendarYears) {
  if (!profile.startedOn) return null;
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(profile.startedOn);
  if (!match) return null;
  const parsed = new Date(`${profile.startedOn}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== profile.startedOn) return null;
  const yearsSinceStart = (profile.year ?? params.year) - Number(match[1]);
  return yearsSinceStart >= 0 && yearsSinceStart < numberOfCalendarYears;
}

function gkvAssessmentMonthly(profitAnnual, profile, params) {
  const social = params.social;
  const months = params.forecast.monthsPerYear;
  const otherMonthly = Math.max(0, Number(profile.otherContributoryIncomeAnnual) || 0) / months;
  return clamp(profitAnnual / months + otherMonthly, social.healthMinimumMonthly, social.healthCapMonthly);
}

function careRate(profile, params, warnings) {
  const social = params.social;
  let rate = social.careRate;
  const age = ageInYear(profile, params);
  if (profile.children === 0) {
    if (age === null) warnings.push('Das Alter ist unbekannt; ein möglicher Kinderlosenzuschlag zur Pflegeversicherung ist nicht eingerechnet.');
    else if (age >= social.careChildlessAge) rate += social.careChildlessExtra;
  }
  const under25 = Math.min(Math.max(0, Number(profile.childrenUnder25) || 0), Math.max(0, Number(profile.children) || 0));
  const discountedChildren = Math.min(
    Math.max(0, under25 - 1),
    social.careMaximumDiscountChildren,
  );
  rate -= discountedChildren * social.careChildDiscount;
  return rate;
}

function gkvContributions(profitAnnual, profile, params, warnings) {
  const social = params.social;
  const assessment = gkvAssessmentMonthly(profitAnnual, profile, params);
  const healthRate = (profile.sickPay ? social.healthGeneralRate : social.healthReducedRate)
    + (Number(profile.additionalHealthRate) || 0) / 100;
  const health = annual(assessment * healthRate, params);
  const care = annual(assessment * careRate(profile, params, warnings), params);
  if (profile.birthYear !== null && profile.birthYear !== undefined) {
    warnings.push('Das Alter wird anhand des Geburtsjahrs angenähert; der Geburtstag im Beitragsjahr ist nicht bekannt.');
  }
  return { health, care, assessment };
}

function kskContributions(profile, params, warnings) {
  const social = params.social;
  if (!hasNumber(profile.kskIncomeAnnual)) {
    warnings.push('Das gemeldete Jahreseinkommen für die KSK fehlt; für die KSK wurden keine Beiträge geschätzt.');
    return { health: 0, care: 0, pension: 0, assessment: 0 };
  }
  const reportedAnnual = Math.max(0, Number(profile.kskIncomeAnnual));
  const assessment = clamp(
    reportedAnnual / params.forecast.monthsPerYear,
    social.kskHealthMinimumMonthly,
    social.healthCapMonthly,
  );
  const age = ageInYear(profile, params);
  if (profile.children === 0 && age === null) {
    warnings.push('Das Alter ist unbekannt; ein möglicher Kinderlosenzuschlag zur Pflegeversicherung ist nicht eingerechnet.');
  }
  let kskCareRate = social.careRate * social.kskInsuredShare;
  if (profile.children === 0 && age !== null && age >= social.careChildlessAge) {
    // Der Kinderlosenzuschlag wird in der KSK voll vom Versicherten getragen.
    kskCareRate += social.careChildlessExtra;
  }
  const under25 = Math.min(Math.max(0, Number(profile.childrenUnder25) || 0), Math.max(0, Number(profile.children) || 0));
  const discountedChildren = Math.min(
    Math.max(0, under25 - 1),
    social.careMaximumDiscountChildren,
  );
  // Der Kinderabschlag wird ebenfalls voll beim Versichertenanteil abgezogen.
  kskCareRate -= discountedChildren * social.careChildDiscount;
  if (reportedAnnual < social.kskMinimumAnnual) {
    const founder = isFounderYear(profile, params, social.kskFounderYears);
    warnings.push(founder === true
      ? 'Das gemeldete Einkommen liegt unter der KSK-Mindestgrenze; die Gründerregel gilt laut Profilzeitraum, eine automatische Befreiung wird nicht angenommen.'
      : 'Das gemeldete Einkommen liegt unter der KSK-Mindestgrenze; eine mögliche Ausnahme ist nicht automatisch geprüft.');
  }
  if (age !== null) warnings.push('Das Alter wird anhand des Geburtsjahrs angenähert; der Geburtstag im Beitragsjahr ist nicht bekannt.');
  const healthBaseRate = profile.sickPay ? social.healthGeneralRate : social.healthReducedRate;
  const pensionAssessment = Math.min(reportedAnnual / params.forecast.monthsPerYear, social.pensionCapMonthly);
  return {
    health: annual(assessment * (healthBaseRate * social.kskInsuredShare + (Number(profile.additionalHealthRate) || 0) / 100 * social.kskInsuredShare), params),
    care: annual(assessment * kskCareRate, params),
    pension: annual(pensionAssessment * social.pensionRate * social.kskInsuredShare, params),
    assessment,
  };
}

function pensionContribution(profitAnnual, profile, params, warnings, ksk) {
  const social = params.social;
  if (profile.pensionStatus === 'none' || profile.pensionStatus === 'exempt') return 0;
  if (profile.pensionStatus === 'unclear') {
    warnings.push('Der Rentenversicherungsstatus ist ungeklärt; es wird kein Beitrag angesetzt.');
    return 0;
  }
  if (profile.pensionStatus === 'ksk') return profile.healthInsurance === 'gkv_ksk' ? ksk.pension
    : kskContributions(profile, params, warnings).pension;
  if (profile.pensionStatus === 'voluntary' && profile.pensionMode !== 'notice') {
    warnings.push('Für die freiwillige Rentenversicherung wird ein individuell eingetragener Monatsbeitrag benötigt.');
    return 0;
  }

  const founder = isFounderYear(profile, params, social.pensionFounderCalendarYears);
  switch (profile.pensionMode) {
    case 'standard':
      return annual(social.pensionStandardMonthly, params);
    case 'half':
      if (founder === false) warnings.push('Der halbe Regelbeitrag ist laut hinterlegtem Tätigkeitsbeginn außerhalb des vorgesehenen Gründerzeitraums; der Profilwert wird als Schätzung weiterverwendet.');
      if (founder === null) warnings.push('Der Tätigkeitsbeginn fehlt; die zeitliche Voraussetzung für den halben Regelbeitrag ist nicht geprüft.');
      return annual(social.pensionHalfMonthly, params);
    case 'income':
      return annual(clamp(profitAnnual / params.forecast.monthsPerYear, social.pensionMinimumBaseMonthly, social.pensionCapMonthly) * social.pensionRate, params);
    case 'minimum':
      return annual(social.pensionMinimumMonthly, params);
    case 'notice':
      if (!hasNumber(profile.pensionNoticeMonthly)) {
        warnings.push('Der Rentenversicherungsbeitrag laut Bescheid fehlt; es wird kein Beitrag angesetzt.');
        return 0;
      }
      return annual(Math.max(0, Number(profile.pensionNoticeMonthly)), params);
    default:
      warnings.push('Der Rentenversicherungsmodus ist unbekannt; es wird kein Rentenversicherungsbeitrag angesetzt.');
      return 0;
  }
}

function unemploymentContribution(profile, params, warnings) {
  if (!profile.unemploymentEnabled) return 0;
  const social = params.social;
  const founder = isFounderYear(profile, params, social.unemploymentFounderYears);
  const started = profile.startedOn ? new Date(`${profile.startedOn}T00:00:00Z`) : null;
  if (!profile.startedOn) warnings.push('Der Tätigkeitsbeginn fehlt; ein möglicher Gründerbeitrag zur Arbeitslosenversicherung ist nicht geprüft.');
  else if (Number.isNaN(started?.getTime())) warnings.push('Der Tätigkeitsbeginn ist ungültig; die Gründerfrist zur Arbeitslosenversicherung ist nicht geprüft.');
  if (profile.unemploymentAppliedOn && started && !Number.isNaN(started.getTime())) {
    const applied = new Date(`${profile.unemploymentAppliedOn}T00:00:00Z`);
    const months = (applied.getUTCFullYear() - started.getUTCFullYear()) * params.forecast.monthsPerYear
      + applied.getUTCMonth() - started.getUTCMonth();
    if (Number.isNaN(applied.getTime()) || months > social.unemploymentApplicationMonths) {
      warnings.push('Der Antrag auf Arbeitslosenversicherung könnte außerhalb der Dreimonatsfrist liegen; die Frist ist nicht automatisch geprüft.');
    }
  } else if (!profile.unemploymentAppliedOn) {
    warnings.push('Die Antragsfrist für die freiwillige Arbeitslosenversicherung beträgt drei Monate ab Tätigkeitsbeginn; ein Antragsdatum ist nicht hinterlegt.');
  }
  return annual(founder === true ? social.unemploymentFounderMonthly : social.unemploymentMonthly, params);
}

function deductibleAmount(health, care, pension, unemployment, profile, params, warnings) {
  const baseHealth = profile.healthInsurance === 'pkv'
    ? (hasNumber(profile.privateHealthBasicMonthly) ? Math.max(0, Number(profile.privateHealthBasicMonthly)) * params.forecast.monthsPerYear : null)
    : health * (profile.sickPay ? params.deductions.healthSickPayDeductionFactor : 1);
  if (profile.healthInsurance === 'pkv' && baseHealth === null) {
    warnings.push('Der abziehbare Basisanteil der privaten Krankenversicherung fehlt; nur der Pflegebeitrag wird berücksichtigt.');
  }
  const baseHealthAndCare = (baseHealth ?? 0) + care;
  const pensionMaximum = profile.assessment === 'joint'
    ? params.deductions.pensionMaximumJoint
    : params.deductions.pensionMaximumSingle;
  const pensionDeduction = Math.min(pension, pensionMaximum);
  const otherMaximum = profile.assessment === 'joint'
    ? params.deductions.otherMaximumSelfEmployed * 2
    : params.deductions.otherMaximumSelfEmployed;
  const otherRoom = Math.max(0, otherMaximum - baseHealthAndCare);
  const unemploymentDeduction = Math.min(unemployment, otherRoom);
  return roundMoney(baseHealthAndCare + pensionDeduction + unemploymentDeduction);
}

/** Berechnet eine jährliche Sozialversicherungs-Schätzung aus Profil und Jahresparametern. */
export function calculateSocial(profitAnnual, profile, params) {
  if (!Number.isFinite(profitAnnual)) throw new RangeError('Der Jahresgewinn muss eine Zahl sein.');
  if (!profile || !params?.social || !params?.deductions) throw new TypeError('Steuerprofil und Jahresparameter werden benötigt.');
  const warnings = [];
  let health = 0;
  let care = 0;
  let healthAssessmentMonthly = 0;
  const ksk = profile.healthInsurance === 'gkv_ksk' || profile.pensionStatus === 'ksk'
    ? kskContributions(profile, params, warnings)
    : { health: 0, care: 0, pension: 0, assessment: 0 };

  if (profile.healthInsurance === 'family') {
    // Keine Anspruchsprüfung: Beitragsfreiheit wird ausschließlich als Profilangabe übernommen.
  } else if (profile.healthInsurance === 'pkv') {
    health = annual(Math.max(0, Number(profile.privateHealthMonthly) || 0), params);
    care = annual(Math.max(0, Number(profile.privateCareMonthly) || 0), params);
  } else if (profile.healthInsurance === 'gkv_voluntary') {
    ({ health, care, assessment: healthAssessmentMonthly } = gkvContributions(profitAnnual, profile, params, warnings));
  } else if (profile.healthInsurance === 'gkv_ksk') {
    health = ksk.health;
    care = ksk.care;
    healthAssessmentMonthly = ksk.assessment;
  } else {
    warnings.push('Die Krankenversicherung ist nicht angegeben; es werden keine Kranken- oder Pflegebeiträge geschätzt.');
  }

  const pension = pensionContribution(profitAnnual, profile, params, warnings, ksk);
  const unemployment = unemploymentContribution(profile, params, warnings);
  let healthBackpaymentRisk = null;
  if (profile.healthInsurance === 'gkv_voluntary') {
    if (!hasNumber(profile.healthNoticeMonthly) || !hasNumber(profile.careNoticeMonthly)) {
      warnings.push('Mindestens ein Kranken- oder Pflegeversicherungsbeitrag laut Bescheid fehlt; ein Nachzahlungsrisiko kann nicht geschätzt werden.');
    } else {
      healthBackpaymentRisk = roundMoney(health + care - annual(Number(profile.healthNoticeMonthly) + Number(profile.careNoticeMonthly), params));
    }
  }

  const total = roundMoney(health + care + pension + unemployment);
  const deductible = deductibleAmount(health, care, pension, unemployment, profile, params, warnings);
  return {
    health: roundMoney(health),
    care: roundMoney(care),
    pension: roundMoney(pension),
    unemployment: roundMoney(unemployment),
    total,
    deductible,
    healthAssessmentMonthly: roundMoney(healthAssessmentMonthly),
    healthBackpaymentRisk,
    warnings: [...new Set(warnings)],
  };
}

/** Schätzt IHK- oder HWK-Beiträge anhand der Nutzerangaben. */
export function chamberContribution(profitAnnual, profile, params) {
  if (!Number.isFinite(profitAnnual)) throw new RangeError('Der Jahresgewinn muss eine Zahl sein.');
  if (!profile || !params?.chambers) throw new TypeError('Steuerprofil und Jahresparameter werden benötigt.');
  const warnings = [];
  if (profile.chamber === 'none') return { annual: 0, warnings };
  const assessedProfit = Math.max(0, profitAnnual);
  const basic = Math.max(0, Number(profile.chamberBasicAnnual) || 0);
  const levyRate = Math.max(0, Number(profile.chamberLevyRate) || 0) / 100;
  let annualContribution = basic + (profile.chamber === 'ihk' ? Math.max(0, assessedProfit - params.chambers.ihkLevyAllowance) : assessedProfit) * levyRate;
  if (profile.chamber === 'ihk') {
    const yearsSinceStart = isFounderYear(profile, params, params.chambers.ihkFounderLevyExemptYears);
    const isEarlyFounderPeriod = yearsSinceStart === true;
    const founderEligible = profile.chamberFounderEligible === true;
    if (assessedProfit <= params.chambers.ihkExemptionProfit && founderEligible) {
      annualContribution = 0;
    } else if (founderEligible && isEarlyFounderPeriod && assessedProfit <= params.chambers.ihkFounderProfitLimit) {
      const yearNumber = (profile.year ?? params.year) - Number(profile.startedOn.slice(0, 4)) + 1;
      annualContribution = yearNumber <= params.chambers.ihkFounderExemptYears ? 0 : basic;
    }
    if (profile.chamberFounderEligible && yearsSinceStart === null) {
      warnings.push('Der Tätigkeitsbeginn fehlt oder ist ungültig; eine IHK-Gründerbefreiung wird nicht angesetzt.');
    }
    if (assessedProfit <= params.chambers.ihkExemptionProfit && !founderEligible) {
      warnings.push('Eine mögliche IHK-Beitragsfreiheit bei niedrigem Gewinn hängt von weiteren Voraussetzungen ab; sie wurde mangels bestätigter Berechtigung nicht angesetzt.');
    }
    if (founderEligible && yearsSinceStart === false) {
      warnings.push('Die bestätigte IHK-Gründerberechtigung liegt außerhalb des hinterlegten Gründerzeitraums; es wird kein Gründerabschlag angesetzt.');
    }
    if (founderEligible && assessedProfit > params.chambers.ihkFounderProfitLimit && isEarlyFounderPeriod) {
      warnings.push('Der Gewinn überschreitet die hinterlegte IHK-Gewinngrenze für die Gründerentlastung.');
    }
  } else if (profile.chamber === 'hwk') {
    const withinPeriod = isFounderYear(profile, params, params.chambers.hwkFounderReducedYears);
    if (profile.chamberFounderEligible === true && withinPeriod && profitAnnual <= params.chambers.hwkFounderProfitLimit) {
      const yearNumber = (profile.year ?? params.year) - Number(profile.startedOn.slice(0, 4)) + 1;
      annualContribution = yearNumber <= params.chambers.hwkFounderExemptYears ? 0
        : yearNumber < params.chambers.hwkFounderReducedYears ? basic * params.chambers.hwkFounderReducedBasicFactor : basic;
    }
    warnings.push('Der HWK-Beitrag ist kammerabhängig und wird aus den eingetragenen Nutzerwerten und bestätigten Gründerangaben geschätzt.');
  } else {
    warnings.push('Die Kammerart ist unbekannt; es werden keine Kammerbeiträge geschätzt.');
    annualContribution = 0;
  }
  return { annual: roundMoney(annualContribution), warnings };
}
