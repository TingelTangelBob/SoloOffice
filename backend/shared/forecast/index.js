import { resolveTaxParams } from '../taxParams/index.js';
import { calculateSocial, chamberContribution } from './social.js';
import { calculateTaxes } from './tax.js';
import { calculateThresholds } from './thresholds.js';
import { addDays, assertDateOnly, nextOccurrence, occurrenceOnOrAfter, isRecurringExpenseDue } from '../recurrence.js';

const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const amount = value => Number.isFinite(Number(value)) ? Number(value) : 0;
// PostgreSQL DATE ist lokale Mitternacht und darf nicht über UTC den Kalendertag wechseln.
const datePart = value => value instanceof Date ? assertDateOnly(value) : String(value || '').slice(0, 10);
const validYear = date => /^\d{4}-\d{2}-\d{2}$/.test(date) ? Number(date.slice(0, 4)) : null;
const monthOf = date => Number(date.slice(5, 7));
const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
const monthEnd = (year, month) => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

function activeEntry(entry) {
  return (entry.status || 'active') === 'active';
}

function totals(entries, year, cutoff, startDate = null) {
  const monthly = Array.from({ length: 12 }, () => ({ revenue: 0, expenses: 0, fixed: 0, vatIncome: 0, vatExpense: 0 }));
  for (const entry of entries || []) {
    const date = datePart(entry.entryDate ?? entry.entry_date);
    if (validYear(date) !== year || date > cutoff || (startDate && date < startDate) || !activeEntry(entry)) continue;
    const month = monthly[monthOf(date) - 1];
    const value = Math.max(0, amount(entry.amount));
    const rate = Math.max(0, amount(entry.taxRate ?? entry.tax_rate));
    if ((entry.entryType ?? entry.entry_type) === 'income') {
      month.revenue += value;
      if (rate > 0) month.vatIncome += value * rate / (100 + rate);
    } else {
      month.expenses += value;
      if ((entry.sourceType ?? entry.source_type) === 'recurring_expense') month.fixed += value;
      if (rate > 0) month.vatExpense += value * rate / (100 + rate);
    }
  }
  return monthly.map(item => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, round(value)])));
}

function expensePrice(expense, date) {
  let price = { amount: amount(expense.amountGross ?? expense.amount), taxRate: expense.taxRate == null ? null : amount(expense.taxRate) };
  for (const change of expense.priceChanges || expense.price_changes || []) {
    if (String(change.validFrom) <= date) price = { amount: amount(change.amountGross ?? change.amount), taxRate: change.taxRate == null ? price.taxRate : amount(change.taxRate) };
  }
  return price;
}

function dueDates(expense, year, fromDate) {
  const start = datePart(expense.startDate ?? expense.start_date);
  const interval = Math.max(1, Number(expense.intervalCount ?? expense.intervalValue ?? expense.interval_value) || 1);
  const unit = expense.intervalUnit ?? expense.interval_unit ?? (expense.interval === 'yearly' ? 'year' : 'month');
  const recurrenceUnit = unit === 'weeks' ? 'week' : unit === 'months' ? 'month' : unit;
  let due = occurrenceOnOrAfter(start, `${year}-01-01`, interval, recurrenceUnit);
  const list = [];
  for (let count = 0; count < 500 && due.slice(0, 4) === String(year); count += 1) {
    if (due >= fromDate && isRecurringExpenseDue(expense, due)) list.push(due);
    due = nextOccurrence(start, due, interval, recurrenceUnit);
  }
  return list;
}

function fixedSchedule(expenses, runs, year, nowDate, warnings) {
  const planned = [];
  const due = [];
  const monthly = Array(12).fill(0);
  for (const expense of expenses || []) {
    const business = (expense.scope || 'business') === 'business';
    for (const dueDate of dueDates(expense, year, `${year}-01-01`)) {
      const run = (runs || []).find(item => item.expenseId === expense.id && datePart(item.dueDate) === dueDate);
      if (run?.status === 'skipped') continue;
      if (run?.status === 'confirmed') continue; // Betrag und EÜR-Istwert stammen aus dem bestätigten Snapshot.
      if (dueDate <= nowDate) {
        if (!run || run.status === 'planned') {
          warnings.push(`Vergangene Fixkostenfälligkeit am ${dueDate} ist noch nicht als bezahlt gebucht.`);
          if (business) due.push({ ...run, id: run?.id || `${expense.id}:${dueDate}`, expenseId: expense.id, dueDate,
            amountGross: run?.amountGross ?? expensePrice(expense, dueDate).amount, status: 'planned',
            paidOn: null, euerEntryId: null, levyPaymentId: null, name: expense.name, scope: 'business' });
        }
        continue;
      }
      {
        const price = expensePrice(expense, dueDate);
        if (business) monthly[monthOf(dueDate) - 1] += price.amount;
        planned.push({ ...run, id: run?.id || `${expense.id}:${dueDate}`, expenseId: expense.id, dueDate, amountGross: price.amount,
          status: 'planned', paidOn: null, euerEntryId: null, levyPaymentId: null, name: expense.name, scope: business ? 'business' : 'private_levy' });
      }
    }
  }
  // Veraltete geplante Runs werden absichtlich nicht als Fallback addiert: sie
  // können nach Intervall-, Enddatum- oder Pausenänderungen ungültig sein.
  return { monthly: monthly.map(round), planned, due };
}

function profileMissing(profile) {
  const missing = [];
  if (!profile.businessKind) missing.push('Tätigkeit');
  if (!profile.startedOn) missing.push('Beginn der Selbstständigkeit');
  if (!profile.vatStatus) missing.push('Umsatzsteuerstatus');
  if (!Number.isInteger(profile.birthYear)) missing.push('Geburtsjahr');
  if (!profile.healthInsurance) missing.push('Krankenversicherung');
  if (!profile.pensionStatus || profile.pensionStatus === 'unclear') missing.push('Rentenversicherungsstatus');
  if ((profile.healthInsurance === 'gkv_ksk' || profile.pensionStatus === 'ksk') && profile.kskIncomeAnnual == null) missing.push('Gemeldetes KSK-Jahreseinkommen');
  if (['commercial', 'craft_a', 'craft_b'].includes(profile.businessKind) && !(amount(profile.tradeMultiplier) > 0)) missing.push('Gewerbesteuer-Hebesatz');
  if (profile.businessKind === 'teacher' && profile.vatStatus === 'education_exempt' && !profile.educationCertificateUntil) missing.push('Bescheinigung § 4 Nr. 21');
  if (profile.vatStatus === 'small_business' && profile.previousYearRevenue == null && profile.year > Number(String(profile.startedOn || '').slice(0, 4))) missing.push('Vorjahresumsatz');
  if (profile.churchTaxLiable === true && (!profile.churchTaxConsentAt || !profile.state)) missing.push('Kirchensteuer-Einwilligung oder Bundesland');
  return missing;
}

function ytdTotals(months) {
  return months.reduce((result, item) => {
    result.revenue += item.revenue;
    result.expenses += item.expenses;
    result.fixed += item.fixed;
    result.vatIncome += item.vatIncome;
    result.vatExpense += item.vatExpense;
    return result;
  }, { revenue: 0, expenses: 0, fixed: 0, vatIncome: 0, vatExpense: 0 });
}

function distribute(total, weights, eligible) {
  const result = Array(weights.length).fill(0);
  const indexes = eligible.filter(index => weights[index] > 0);
  const normalized = indexes.length ? indexes : eligible;
  const denominator = normalized.reduce((sum, index) => sum + (indexes.length ? weights[index] : 1), 0);
  let assigned = 0;
  normalized.forEach((index, position) => {
    const value = position === normalized.length - 1 ? round(total - assigned)
      : round(total * (indexes.length ? weights[index] : 1) / denominator);
    result[index] = value;
    assigned = round(assigned + value);
  });
  return result;
}

function historicalComplete(entries, year, months) {
  // Saisonale Gewichte werden nur verwendet, wenn Transaktionen alle zwölf
  // Kalendermonate abdecken; fehlende Monatsdaten werden nicht als Null gelesen.
  const covered = new Set((entries || []).filter(activeEntry).map(item => datePart(item.entryDate ?? item.entry_date))
    .filter(date => validYear(date) === year).map(date => monthOf(date)));
  return covered.size === months;
}

function forecastSocial(profit, profile, params) {
  const year = Number(profile.year ?? params.year);
  const started = profile.startedOn && validYear(datePart(profile.startedOn));
  const activeMonths = started > year ? 0 : started === year
    ? Math.max(0, params.forecast.monthsPerYear - monthOf(datePart(profile.startedOn)) + 1)
    : params.forecast.monthsPerYear;
  if (!activeMonths) return { health: 0, care: 0, pension: 0, unemployment: 0, total: 0,
    deductible: 0, healthAssessmentMonthly: 0, healthBackpaymentRisk: null,
    warnings: ['Die Tätigkeit beginnt nach dem gewählten Jahr; dafür werden keine Sozialbeiträge angesetzt.'] };
  const normalized = calculateSocial(profit / activeMonths * params.forecast.monthsPerYear, profile, params);
  if (activeMonths === params.forecast.monthsPerYear) return normalized;
  const ratio = activeMonths / params.forecast.monthsPerYear;
  return { ...normalized, health: round(normalized.health * ratio), care: round(normalized.care * ratio),
    pension: round(normalized.pension * ratio), unemployment: round(normalized.unemployment * ratio),
    total: round(normalized.total * ratio), deductible: round(normalized.deductible * ratio),
    healthBackpaymentRisk: normalized.healthBackpaymentRisk == null ? null : round(normalized.healthBackpaymentRisk * ratio),
    warnings: [...normalized.warnings, 'Die Sozialbeiträge wurden mit aktiven Kalendermonaten hochgerechnet; Teiljahresgrenzen sind vereinfacht und sollten geprüft werden.'] };
}

function estimateAnnual({ current, previous, previousEntries, year, nowDate, params, startedOn }) {
  const calendarNow = Number(nowDate.slice(0, 4));
  const months = params.forecast.monthsPerYear;
  const actualRevenue = current.map(item => item.revenue);
  const actualVariable = current.map(item => Math.max(0, item.expenses - item.fixed));
  const revenueYtd = actualRevenue.reduce((sum, value) => sum + value, 0);
  const variableYtd = actualVariable.reduce((sum, value) => sum + value, 0);
  if (year < calendarNow) return { revenue: revenueYtd, variableExpenses: variableYtd, method: 'linear', revenueMonthly: actualRevenue, variableMonthly: actualVariable };
  if (year > calendarNow) return { revenue: 0, variableExpenses: 0, method: 'linear', revenueMonthly: Array(months).fill(0), variableMonthly: Array(months).fill(0) };

  const start = startedOn && validYear(startedOn) === year ? startedOn : `${year}-01-01`;
  const tomorrow = new Date(Date.parse(`${nowDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const projectionStart = [tomorrow, start].sort().at(-1);
  const today = Date.parse(`${nowDate}T00:00:00Z`);
  const yearEnd = Date.parse(`${year + 1}-01-01T00:00:00Z`);
  const activeStart = Date.parse(`${start}T00:00:00Z`);
  const elapsedDays = Math.max(0, Math.floor((today - activeStart) / 86400000) + 1);
  const remainingDays = Math.max(0, Math.floor((yearEnd - Date.parse(`${projectionStart}T00:00:00Z`)) / 86400000));
  const eligibleMonths = Array.from({ length: months }, (_, index) => index)
    .filter(index => Date.parse(`${year}-${String(index + 1).padStart(2, '0')}-01T00:00:00Z`) < yearEnd
      && monthEnd(year, index + 1) >= projectionStart);
  const historicalYear = year - 1;
  const seasonEligible = historicalComplete(previousEntries, historicalYear, months)
    && (!startedOn || startedOn < `${historicalYear}-01-01`);
  const currentDay = monthOf(nowDate);
  const dayOfMonth = Number(nowDate.slice(8, 10));
  const makeWeights = (key) => {
    const weights = Array(months).fill(0);
    for (let index = 0; index < months; index += 1) {
      const month = index + 1;
      const from = month === currentDay ? `${historicalYear}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}` : null;
      const source = key === 'revenue' ? 'income' : 'expense';
      let weight = 0;
      for (const entry of previousEntries || []) {
        const date = datePart(entry.entryDate ?? entry.entry_date);
        if (validYear(date) !== historicalYear || monthOf(date) !== month || !activeEntry(entry)) continue;
        if (from && date <= from) continue;
        if ((entry.entryType ?? entry.entry_type) !== source) continue;
        if (key === 'variable' && (entry.sourceType ?? entry.source_type) === 'recurring_expense') continue;
        weight += Math.max(0, amount(entry.amount));
      }
      weights[index] = round(weight);
    }
    return weights;
  };
  const historicalRevenue = previous.reduce((sum, item) => sum + item.revenue, 0);
  const historicalDay = Math.min(Number(nowDate.slice(8, 10)), Number(monthEnd(historicalYear, currentDay).slice(8, 10)));
  const historicalCutoff = `${historicalYear}-${String(currentDay).padStart(2, '0')}-${String(historicalDay).padStart(2, '0')}`;
  const historicalYtd = (key) => (previousEntries || []).filter(entry => {
    const date = datePart(entry.entryDate ?? entry.entry_date);
    return validYear(date) === historicalYear && date <= historicalCutoff && activeEntry(entry)
      && (entry.entryType ?? entry.entry_type) === (key === 'revenue' ? 'income' : 'expense')
      && (key !== 'variable' || (entry.sourceType ?? entry.source_type) !== 'recurring_expense');
  }).reduce((sum, entry) => sum + Math.max(0, amount(entry.amount)), 0);
  const historicalRevenueYtd = historicalYtd('revenue');
  const historicalVariableYtd = historicalYtd('variable');
  const projectedMonthly = (actualMonthly, ytd, histYtd, weights) => {
    const useSeasonalWeights = seasonEligible && histYtd > 0;
    const projectedTotal = useSeasonalWeights
      ? Math.max(0, round((ytd / histYtd) * weights.reduce((sum, value) => sum + value, 0)))
      : elapsedDays > 0 ? Math.max(0, round(ytd / elapsedDays * remainingDays)) : 0;
    const forecastByMonth = useSeasonalWeights
      ? distribute(projectedTotal, weights, eligibleMonths)
      : distribute(projectedTotal, Array.from({ length: months }, (_, index) => {
        const startDay = index + 1 === monthOf(projectionStart) ? Number(projectionStart.slice(8, 10)) : 1;
        return Math.max(0, Number(monthEnd(year, index + 1).slice(8, 10)) - startDay + 1);
      }), eligibleMonths);
    return actualMonthly.map((value, index) => round(value + forecastByMonth[index]));
  };
  const revenueMonthly = projectedMonthly(actualRevenue, revenueYtd, historicalRevenueYtd, makeWeights('revenue'));
  const variableMonthly = projectedMonthly(actualVariable, variableYtd, historicalVariableYtd, makeWeights('variable'));
  const seasonal = seasonEligible && historicalRevenueYtd > 0;
  return { revenue: round(revenueMonthly.reduce((sum, value) => sum + value, 0)),
    variableExpenses: round(variableMonthly.reduce((sum, value) => sum + value, 0)), method: seasonal ? 'seasonal' : 'linear',
    revenueMonthly, variableMonthly };
}

function vatEstimate(profile, revenue, vatOutput, vatInput, params, warnings) {
  if (profile.vatStatus === 'small_business') return 0;
  if (profile.vatStatus === 'education_exempt') {
    if (!profile.educationCertificateUntil) warnings.push('Die Bescheinigung zur Bildungsbefreiung fehlt; eine Umsatzsteuer-Rücklage wird nicht angesetzt.');
    return 0;
  }
  if (profile.vatStatus !== 'regular') return 0;
  const estimatedOutput = vatOutput > 0 ? vatOutput : 0;
  const estimatedInput = vatInput > 0 ? vatInput : 0;
  const result = round(estimatedOutput - estimatedInput);
  if (result < 0) warnings.push('Die grobe Umsatzsteuer-Schätzung ergibt möglicherweise einen Vorsteuerüberhang; eine Erstattung ist nicht zugesagt.');
  if (estimatedOutput === 0 && revenue > 0) warnings.push('Für erfasste Einnahmen liegen keine Umsatzsteuersätze vor; die Umsatzsteuer-Rücklage kann zu niedrig sein.');
  void params;
  return result;
}

function findProfileMissing(profile, legalForm, complete) {
  if (['gmbh', 'ug', 'ag', 'eg'].includes(String(legalForm || '').toLowerCase())) {
    return { complete: false, fields: [...complete, 'Kapitalgesellschaft: Einkommensteuer nicht geschätzt'] };
  }
  return { complete: complete.length === 0, fields: complete };
}

/** Pure annual forecast over canonical camelCase finance data. */
export function buildForecast({ year, profile = {}, entries = [], expenses = [], runs = [], levyPayments = [], previousEntries = [], vat = null, now = new Date() } = {}) {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new RangeError('Ungültiges Prognosejahr.');
  // Der Stichtag ist ein Zeitpunkt, keine PostgreSQL-DATE-Spalte.
  const nowDate = now instanceof Date ? now.toISOString().slice(0, 10) : datePart(now);
  const { params, parameterYear, warning: paramsWarning } = resolveTaxParams(year);
  const warnings = [];
  if (paramsWarning) warnings.push(paramsWarning);
  const effectiveProfile = { ...profile, year };
  const calendarNow = Number(nowDate.slice(0, 4));
  const startedOn = profile.startedOn ? datePart(profile.startedOn) : null;
  const yearStartDate = startedOn && validYear(startedOn) > year ? `${year + 1}-01-01`
    : startedOn && validYear(startedOn) === year ? startedOn : null;
  const currentMonths = totals(entries, year, year < calendarNow ? monthEnd(year, params.forecast.monthsPerYear) : year > calendarNow ? `${year}-00-00` : nowDate,
    yearStartDate);
  const previousMonths = totals(previousEntries, year - 1, `${year - 1}-${String(params.forecast.monthsPerYear).padStart(2, '0')}-${String(monthEnd(year - 1, params.forecast.monthsPerYear).slice(8, 10)).padStart(2, '0')}`);
  const annual = estimateAnnual({ current: currentMonths, previous: previousMonths, previousEntries, year, nowDate, params, startedOn });
  const actual = ytdTotals(currentMonths);
  const schedule = fixedSchedule(expenses, runs, year, nowDate, warnings);
  if (profile.healthInsurance === 'pkv' && (!(amount(profile.privateHealthMonthly) > 0 || amount(profile.privateCareMonthly) > 0) || profile.privateHealthBasicMonthly == null)) warnings.push('PKV-Beiträge oder der Basisanteil fehlen; die Sozialprognose kann unvollständig sein.');
  if (profile.healthInsurance === 'gkv_voluntary' && (profile.healthNoticeMonthly == null || profile.careNoticeMonthly == null)) warnings.push('Kranken- oder Pflegeversicherungsbescheid fehlt; ein mögliches Nachzahlungsrisiko kann nicht eingeschätzt werden.');
  if (['teacher', 'craft', 'single_client'].includes(profile.pensionStatus) && profile.pensionMode === 'notice' && profile.pensionNoticeMonthly == null) warnings.push('Der Rentenversicherungsbescheid fehlt; ein mögliches Nachzahlungsrisiko kann nicht eingeschätzt werden.');
  if (profile.businessKind === 'teacher' && profile.vatStatus === 'education_exempt'
    && (!profile.educationCertificateUntil || profile.educationCertificateUntil < nowDate)) warnings.push('Die Bescheinigung zur Bildungsbefreiung fehlt oder ist abgelaufen; die individuelle Einordnung ist nicht geprüft.');
  if (expenses.some(item => (item.scope || 'business') === 'business')
    && entries.some(item => (item.entryType ?? item.entry_type) === 'expense' && activeEntry(item)
      && (item.sourceType ?? item.source_type) !== 'recurring_expense' && validYear(datePart(item.entryDate ?? item.entry_date)) === year)) {
    warnings.push('Manuelle oder andere EÜR-Ausgaben können wiederkehrende Fixkosten bereits enthalten; mögliche Doppelzählungen sind nicht automatisch erkennbar.');
  }
  const plannedFixedAnnual = schedule.monthly.reduce((sum, value) => sum + value, 0);
  const fixedActualAnnual = actual.fixed;
  const fixedAnnual = round(fixedActualAnnual + plannedFixedAnnual);
  const revenueAnnual = annual.revenue;
  const variableAnnual = annual.variableExpenses;
  const expensesAnnual = round(variableAnnual + fixedAnnual);
  const profitYtd = round(actual.revenue - actual.expenses);
  const profitAnnual = round(revenueAnnual - expensesAnnual);
  const social = forecastSocial(profitAnnual, effectiveProfile, params);
  const legalForm = String(profile.legalForm || '').toLowerCase();
  const isCapitalCompany = ['gmbh', 'ug', 'ag', 'eg'].includes(legalForm);
  const taxes = isCapitalCompany
    ? { taxableIncome: 0, incomeTaxBeforeCredit: 0, incomeTax: 0, solidarity: 0, churchTax: 0, tradeTax: 0, tradeAssessment: 0, tradeCredit: 0, total: 0, marginalRate: 0,
      warnings: ['Für diese Kapitalgesellschaft wird keine Einkommensteuer geschätzt.'] }
    : calculateTaxes(profitAnnual, effectiveProfile, social, params);
  const chamber = chamberContribution(profitAnnual, effectiveProfile, params);
  warnings.push(...social.warnings, ...taxes.warnings, ...chamber.warnings);
  if (['teacher', 'craft', 'single_client'].includes(profile.pensionStatus) && ['standard', 'half', 'notice'].includes(profile.pensionMode)) {
    warnings.push('Der Rentenbeitrag wird nach dem gewählten Regel-, halben oder Bescheidwert angesetzt; eine gewinnabhängige Stufe wird daraus nicht abgeleitet.');
  }
  const hasPreviousYearData = (previousEntries || []).some(entry => validYear(datePart(entry.entryDate ?? entry.entry_date)) === year - 1);
  const inferredPreviousRevenue = effectiveProfile.previousYearRevenue ?? (hasPreviousYearData ? ytdTotals(previousMonths).revenue : null);
  const companyProfile = findProfileMissing({ ...effectiveProfile, previousYearRevenue: inferredPreviousRevenue }, profile.legalForm,
    profileMissing({ ...effectiveProfile, previousYearRevenue: inferredPreviousRevenue }));
  if (companyProfile.fields.length) warnings.push(`Für eine vollständigere Prognose fehlen Angaben: ${companyProfile.fields.join(', ')}.`);
  const roughVatAnnual = vatEstimate(effectiveProfile, revenueAnnual,
    actual.vatIncome + Math.max(0, revenueAnnual - actual.revenue) * (actual.revenue ? actual.vatIncome / actual.revenue : 0),
    actual.vatExpense + Math.max(0, expensesAnnual - actual.expenses) * (actual.expenses ? actual.vatExpense / actual.expenses : 0), params, warnings);
  const vatApplicable = Boolean(vat?.applicable && ['regular', 'education_exempt'].includes(vat.vatStatus));
  const vatIncompleteEntries = vat ? Math.max(0, Number(vat.completeness?.incompleteEntries) || 0) : 0;
  const vatBasis = !vat ? 'rough' : (vatApplicable && vatIncompleteEntries > 0 ? 'estimate' : 'calculated');
  const vatNextDue = vat?.nextDue ?? null;
  const pastVatMonthly = Array.from({ length: params.forecast.monthsPerYear }, (_, index) => {
    const month = monthKey(year, index + 1);
    if (!vatApplicable || month > nowDate.slice(0, 7)) return null;
    const item = vat.months?.find(candidate => candidate.month === month);
    if (!item) return 0;
    return amount(item.complete ? item.liability : item.estimatedLiability);
  });
  const vatFutureMonthly = Array(params.forecast.monthsPerYear).fill(0);
  let vatAnnual = roughVatAnnual;
  let paidUst = 0;
  if (vatApplicable) {
    const remainingRevenue = Math.max(0, revenueAnnual - actual.revenue);
    const remainingExpenses = Math.max(0, expensesAnnual - actual.expenses);
    const futureEstimate = vatEstimate(effectiveProfile, remainingRevenue,
      remainingRevenue * (actual.revenue ? actual.vatIncome / actual.revenue : 0),
      remainingExpenses * (actual.expenses ? actual.vatExpense / actual.expenses : 0), params, warnings);
    const futureMonths = Array.from({ length: params.forecast.monthsPerYear }, (_, index) => index)
      .filter(index => pastVatMonthly[index] === null);
    const projected = distribute(futureEstimate, Array(12).fill(1), futureMonths);
    for (const index of futureMonths) vatFutureMonthly[index] = projected[index];
    const recordedMonths = pastVatMonthly.map(value => value === null ? 0 : value);
    vatAnnual = round(recordedMonths.reduce((sum, value) => sum + value, 0) + futureEstimate);
    paidUst = round((vat.periods || []).reduce((sum, period) => sum + Math.max(0, amount(period.paid)), 0));
  }
  const vatRemainingReserve = vatApplicable
    ? round(pastVatMonthly.reduce((sum, value) => sum + (value ?? 0), 0) - paidUst
      + Math.max(0, amount(vat.annual?.refunded ?? (vat.periods || []).reduce((sum, period) => sum + Math.max(0, amount(period.refunded)), 0)))
      + vatFutureMonthly.reduce((sum, value) => sum + value, 0))
    : vat ? 0 : vatAnnual;
  const paid = levyPayments.filter(item => Number(item.year) === year && item.paidOn && datePart(item.paidOn) <= nowDate);
  const paidLevies = round(paid.filter(item => item.kind !== 'ust').reduce((sum, item) => sum + Math.max(0, amount(item.amount)), 0));
  if (!vat) paidUst = 0;
  if (paidUst > 0 && vatRemainingReserve < 0) warnings.push('Erfasste Umsatzsteuerzahlungen übersteigen den Jahresrichtwert; daraus wird keine Erstattung zugesagt.');
  const paidAdvances = { est_vz: 0, gewst_vz: 0, ust: 0 };
  const paidAdvanceMonths = Array.from({ length: params.forecast.monthsPerYear }, (_, index) => ({
    month: monthKey(year, index + 1), est_vz: 0, gewst_vz: 0, ust: 0,
  }));
  for (const payment of paid.filter(item => item.kind !== 'ust')) {
    if (!Object.hasOwn(paidAdvances, payment.kind)) continue;
    paidAdvances[payment.kind] = round(paidAdvances[payment.kind] + amount(payment.amount));
    const paidDate = datePart(payment.paidOn);
    if (validYear(paidDate) === year) {
      const month = paidAdvanceMonths[monthOf(paidDate) - 1];
      month[payment.kind] = round(month[payment.kind] + amount(payment.amount));
    }
  }
  paidAdvances.ust = paidUst;
  for (const payment of vat?.payments || []) {
    if (!vatApplicable || payment.kind === 'refund' || !payment.paidOn || datePart(payment.paidOn) > nowDate) continue;
    const paidDate = datePart(payment.paidOn);
    if (validYear(paidDate) !== year) continue;
    const month = paidAdvanceMonths[monthOf(paidDate) - 1];
    month.ust = round(month.ust + amount(payment.amount));
  }
  const expenseNotices = expenses.filter(item => (item.scope || 'business') === 'business').map(item => {
    const endDate = item.endDate ? datePart(item.endDate) : null;
    const noticePeriodDays = Math.max(0, amount(item.noticePeriodDays));
    return { id: item.id, name: item.name, noticePeriodDays, endDate,
      noticeDeadline: endDate ? addDays(endDate, -noticePeriodDays) : null };
  });
  const dueExpenses = [...schedule.due, ...schedule.planned.filter(item => item.scope === 'business')]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const annualBurden = round(social.total + taxes.total);
  const expectedLevies = round(paid.filter(item => item.kind !== 'ust').reduce((sum, item) => sum + Math.max(0, amount(item.amount)), 0));
  const remainingReserve = round(Math.max(0, annualBurden - expectedLevies));
  const expectedRemainingInflows = year === calendarNow ? Math.max(0, revenueAnnual - actual.revenue) : year > calendarNow ? 0 : 0;
  const reserveRatio = expectedRemainingInflows > 0 ? remainingReserve / expectedRemainingInflows : 0;
  if (expectedRemainingInflows === 0 && remainingReserve > 0) warnings.push('Es gibt keine prognostizierten Resteinnahmen, denen die verbleibende Abgabenrücklage gegenübergestellt werden kann.');
  if (reserveRatio > 1) warnings.push('Der prognostizierte Abgabenbedarf übersteigt die erwarteten Resteinnahmen; es besteht eine Finanzierungslücke.');
  const combinedMarginalRate = (() => {
    const delta = params.forecast.marginalStep;
    const socialNext = forecastSocial(profitAnnual + delta, effectiveProfile, params);
    const taxNext = isCapitalCompany ? taxes : calculateTaxes(profitAnnual + delta, effectiveProfile, socialNext, params);
    return round(Math.max(0, (socialNext.total + taxNext.total - social.total - taxes.total) / delta));
  })();
  const thresholdData = calculateThresholds({ profit: profitAnnual, taxableIncome: taxes.taxableIncome, revenue: revenueAnnual, currentRevenue: actual.revenue,
    previousRevenue: inferredPreviousRevenue, profile: { ...effectiveProfile, previousYearRevenue: inferredPreviousRevenue }, params });
  const monthIndexes = Array.from({ length: params.forecast.monthsPerYear }, (_, index) => index);
  const weights = monthIndexes.map(() => 1);
  const socialMonths = monthIndexes.filter(index => !startedOn || monthEnd(year, index + 1) >= startedOn);
  const socialByMonth = distribute(social.total, weights, socialMonths);
  const taxByMonth = distribute(taxes.total, weights, monthIndexes);
  const vatByMonth = vatApplicable
    ? monthIndexes.map(index => round((pastVatMonthly[index] ?? 0) + vatFutureMonthly[index]))
    : vat ? Array(12).fill(0) : distribute(vatAnnual, weights, monthIndexes);
  const monthly = Array.from({ length: params.forecast.monthsPerYear }, (_, index) => {
    const monthNumber = index + 1;
    const key = monthKey(year, monthNumber);
    const actualMonth = currentMonths[index];
    const revenue = annual.revenueMonthly[index] || 0;
    const variableExpense = annual.variableMonthly[index] || 0;
    const fixed = round(actualMonth.fixed + schedule.monthly[index]);
    const activityStart = startedOn && validYear(startedOn) === year ? startedOn : `${year}-01-01`;
    const remainingStart = [activityStart, nowDate].sort().at(-1);
    const forecast = (year > calendarNow || (year === calendarNow && monthEnd(year, monthNumber) >= remainingStart))
      && monthEnd(year, monthNumber) >= activityStart;
    const socialMonthly = socialByMonth[index];
    const taxMonthly = taxByMonth[index];
    const vatMonthly = vatByMonth[index];
    return { month: key, revenue, expenses: variableExpense, fixedCosts: fixed, social: round(socialMonthly), taxReserve: round(taxMonthly), vatReserve: round(vatMonthly),
      available: round(revenue - variableExpense - fixed - socialMonthly - taxMonthly - vatMonthly), forecast };
  });
  const series = [
    { id: 'fixed_costs', label: 'Fixkosten', points: monthly.map(item => ({ label: item.month, value: item.fixedCosts, forecast: item.forecast })), kind: 'bar', tooltip: 'Betriebliche Fixkosten; geplante künftige Fälligkeiten werden aus Vorlagen berechnet.' },
    { id: 'social', label: 'Sozialbeiträge', points: monthly.map(item => ({ label: item.month, value: item.social, forecast: item.forecast })), kind: 'bar', tooltip: 'Auf aktive Kalendermonate verteilte Jahresprognose; geleistete Zahlungen sind separat erfasst.' },
    { id: 'tax_reserve', label: 'Steuerrücklage', points: monthly.map(item => ({ label: item.month, value: item.taxReserve, forecast: item.forecast })), kind: 'bar', tooltip: 'Gleichmäßig verteilte Steuerprognose.' },
    { id: 'vat_reserve', label: 'Umsatzsteuer', points: monthly.map(item => ({ label: item.month, value: item.vatReserve, forecast: item.forecast })), kind: 'bar', tooltip: vatBasis === 'calculated'
      ? 'Aus deinen erfassten Belegen berechnet.'
      : vatBasis === 'estimate' ? `Schätzung – ${vatIncompleteEntries} Buchungen ohne USt-Angaben.`
        : 'Schätzung aus erfassten Bruttowerten und Steuersätzen.' },
    { id: 'available', label: 'Verfügbar', points: monthly.map(item => ({ label: item.month, value: item.available, forecast: item.forecast })), kind: 'line', tooltip: 'Umsatz abzüglich variabler Ausgaben, Fixkosten und geschätzter Abgaben; die Diagrammauswahl wird separat berücksichtigt.' },
  ];
  const businessRunMap = new Map();
  for (const run of [...(runs || []).filter(item => (item.scope || 'business') === 'business' && item.status === 'confirmed'), ...schedule.planned.filter(item => item.scope === 'business')]) {
    businessRunMap.set(`${run.expenseId}:${datePart(run.dueDate)}`, run);
  }
  const businessRuns = [...businessRunMap.values()];
  const expenseNames = new Map((expenses || []).map(item => [item.id, item.name]));
  for (const expenseId of new Set(businessRuns.map(run => run.expenseId))) {
    const expenseRuns = businessRuns.filter(run => run.expenseId === expenseId);
    const name = expenseRuns.find(run => run.name)?.name || expenseNames.get(expenseId) || 'Fixkosten';
    const values = Array(12).fill(0);
    const forecasts = Array(12).fill(false);
    for (const run of expenseRuns) {
      const date = datePart(run.status === 'confirmed' ? run.paidOn : run.dueDate);
      if (validYear(date) !== year) continue;
      const monthIndex = monthOf(date) - 1;
      values[monthIndex] += amount(run.amountGross);
      forecasts[monthIndex] ||= run.status === 'planned';
    }
    series.push({ id: `expense:${expenseId}`, label: name, points: values.map((value, index) => ({ label: monthKey(year, index + 1), value: round(value), forecast: forecasts[index] })),
      kind: 'bar', tooltip: 'Kostenserie aus gebuchten und geplanten Fälligkeiten dieser Vorlage.' });
  }
  const paidByMonth = Array(12).fill(0);
  for (const payment of paid.filter(item => item.kind !== 'ust')) {
    const paidDate = datePart(payment.paidOn);
    if (validYear(paidDate) === year) paidByMonth[monthOf(paidDate) - 1] += amount(payment.amount);
  }
  series.push({ id: 'paid_levies', label: 'Gezahlte Abgaben', points: paidByMonth.map((value, index) => ({ label: monthKey(year, index + 1), value: round(value), forecast: false })),
    kind: 'bar', tooltip: 'Tatsächlich als bezahlt erfasste private Abgaben nach Zahlungsmonat; getrennt von den erwarteten Monatswerten.' });
  const upcomingLevies = levyPayments.filter(item => item.kind !== 'ust' && Number(item.year) === year && (!item.paidOn || datePart(item.paidOn) > nowDate));
  for (const period of vat?.periods || []) {
    if (!vatApplicable || !['closed', 'running'].includes(period.state) || !period.dueDate) continue;
    const expected = period.complete ? amount(period.liability) : amount(period.estimatedLiability);
    const openAmount = round(expected - amount(period.paid) + amount(period.refunded));
    if (openAmount <= 0.01) continue;
    upcomingLevies.push({ id: `forecast:ust:${period.key}`, kind: 'ust', year, period: period.key,
      dueDate: period.dueDate, paidOn: null, amount: openAmount, source: 'notice', expenseRunId: null,
      notes: period.complete ? 'Aus erfassten Belegen berechnet.' : 'Schätzung aus erfassten Belegen.' });
  }
  for (const [kind, field, dates] of [
    ['est_vz', 'incomeTaxAdvanceQuarterly', params.advancePayments.incomeTaxDates],
    ['gewst_vz', 'tradeTaxAdvanceQuarterly', params.advancePayments.tradeTaxDates],
  ]) {
    if (!(amount(profile[field]) > 0)) continue;
    for (const [month, day] of dates) {
      const period = monthKey(year, month);
      if (levyPayments.some(item => Number(item.year) === year && item.kind === kind && item.period === period)) continue;
      upcomingLevies.push({ id: `forecast:${kind}:${period}`, kind, year, period,
        dueDate: `${period}-${String(day).padStart(2, '0')}`, paidOn: null, amount: amount(profile[field]),
        source: 'notice', expenseRunId: null, notes: 'Terminrichtwert aus dem Profil; Bescheid und mögliche Fristverschiebungen prüfen.' });
    }
  }
  upcomingLevies.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const calculationSteps = [
    { label: 'Prognostizierter Umsatz', amount: revenueAnnual }, { label: 'Variable betriebliche Ausgaben', amount: variableAnnual },
    { label: 'Fixkosten', amount: fixedAnnual }, { label: 'Prognostizierter Gewinn', amount: profitAnnual },
    { label: 'Sozialbeiträge', amount: social.total }, { label: 'Steuern', amount: taxes.total }, { label: 'Kammerbeitrag (Nutzereingabe)', amount: chamber.annual },
    { label: 'Umsatzsteuer', amount: vatAnnual }, { label: 'Bereits gezahlte Abgaben', amount: paidLevies },
  ];
  return {
    year, parameterYear, paramsVersion: params.version, paramsAsOf: params.asOf, generatedAt: new Date(now).toISOString(),
    profileComplete: companyProfile.complete, missingFields: companyProfile.fields, warnings: [...new Set(warnings)], method: annual.method,
    profitYtd, profitAnnual, profitBand: { low: Math.min(round(profitAnnual * (1 - params.forecast.defaultBandRatio)), round(profitAnnual * (1 + params.forecast.defaultBandRatio))), high: Math.max(round(profitAnnual * (1 - params.forecast.defaultBandRatio)), round(profitAnnual * (1 + params.forecast.defaultBandRatio))) },
    revenueYtd: actual.revenue, revenueAnnual, social, taxes, annualBurden, paidLevies, paidUst, remainingReserve,
    reserveRatio, expectedRemainingInflows, vatStatus: profile.vatStatus ?? null,
    previousYearRevenueKnown: inferredPreviousRevenue !== null, paidNonVatLevies: expectedLevies,
    paidAdvances, paidAdvanceMonths, dueExpenses, expenseNotices, combinedMarginalRate, vatReserveGrossEstimate: vatAnnual, vatRemainingReserve,
    vatBasis, vatIncompleteEntries, vatNextDue,
    thresholds: thresholdData.thresholds, smallBusiness: thresholdData.smallBusiness, series, upcomingLevies,
    upcomingExpenses: schedule.planned, fixedCostsMonthly: round(fixedAnnual / params.forecast.monthsPerYear), fixedCostsAnnual: fixedAnnual, calculationSteps, monthly,
  };
}
