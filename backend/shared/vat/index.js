import { calculateDocumentMoney } from '../../utils/documentMoney.js';
import { assertDateOnly } from '../recurrence.js';
import { resolveTaxParams } from '../taxParams/index.js';
import { euerAttributionYear, paymentDueDate, parseVatPeriodKey, specialPrepaymentDueDate, vatPeriodKeyFor, vatPeriods } from './periods.js';

export * from './periods.js';

export const VAT_TREATMENTS = Object.freeze(['taxable', 'exempt', 'no_vat', 'reverse_charge_eu', 'reverse_charge_domestic']);
export const VAT_PAYMENT_KINDS = Object.freeze(['advance', 'special_prepayment', 'annual_payment', 'refund']);

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const zeroKennzahlen = () => ({ kz81: 0, kz86: 0, kz87: 0, kz35: 0, kz36: 0, kz48: 0, kz46: 0, kz47: 0, kz84: 0, kz85: 0, kz66: 0, kz67: 0, kz39: 0, tax19: 0, tax7: 0, kz83: 0 });
const add = (target, key, value) => { target[key] = round2(target[key] + (Number(value) || 0)); };
const inYear = (date, year) => date && date.slice(0, 4) === String(year);
const amount = value => Number.isFinite(Number(value)) ? round2(Number(value)) : 0;
const dateOf = value => value == null || value === '' ? null : assertDateOnly(value);
const isActive = entry => entry?.status !== 'voided';

export function resolveVatAccounting(profile = {}) {
  if (profile.vatAccounting === 'cash' || profile.vatAccounting === 'accrual') return { accounting: profile.vatAccounting, source: 'profile' };
  const kind = String(profile.businessKind || '').toLowerCase();
  return { accounting: ['teacher', 'freelance', 'artist'].includes(kind) ? 'cash' : 'accrual', source: 'default' };
}

export function splitGross(gross, rate) {
  const total = Number(gross);
  const percent = Number(rate);
  if (!Number.isFinite(total) || !Number.isFinite(percent) || percent < 0) return { netAmount: 0, vatAmount: 0 };
  const netAmount = round2(total / (1 + percent / 100));
  return { netAmount, vatAmount: round2(total - netAmount) };
}

export function fromNet(net, rate) {
  const base = Number(net);
  const percent = Number(rate);
  if (!Number.isFinite(base) || !Number.isFinite(percent) || percent < 0) return { grossAmount: 0, vatAmount: 0 };
  const vatAmount = round2(base * percent / 100);
  return { grossAmount: round2(base + vatAmount), vatAmount };
}

export function suggestVatFromRate(entry = {}, profile = {}) {
  const rate = Number(entry.taxRate);
  const gross = Number(entry.amount);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(gross) || gross < 0 || profile.vatStatus === 'small_business') return null;
  const split = splitGross(gross, rate);
  return { entryId: String(entry.id ?? ''), vatTreatment: 'taxable', taxRate: rate, netAmount: split.netAmount, vatAmount: split.vatAmount,
    inputTaxDeductible: entry.entryType === 'expense' && profile.vatStatus === 'regular' ? true : null };
}

export function isVatEntryComplete(entry = {}, profile = {}) {
  if (profile.vatStatus === 'small_business') return !['reverse_charge_eu', 'reverse_charge_domestic'].includes(entry.vatTreatment);
  if (!entry.vatTreatment || !VAT_TREATMENTS.includes(entry.vatTreatment)) return false;
  if (entry.entryType === 'income' && ['reverse_charge_eu', 'reverse_charge_domestic'].includes(entry.vatTreatment)) return false;
  if (['taxable', 'reverse_charge_eu', 'reverse_charge_domestic'].includes(entry.vatTreatment)
      && (!Number.isFinite(Number(entry.netAmount)) || !Number.isFinite(Number(entry.vatAmount)) || !Number.isFinite(Number(entry.taxRate)))) return false;
  if (['taxable', 'reverse_charge_eu', 'reverse_charge_domestic'].includes(entry.vatTreatment) && entry.entryType === 'expense' && entry.inputTaxDeductible == null) return false;
  if (entry.entryType === 'income' && entry.vatTreatment === 'exempt' && !Number.isFinite(Number(entry.netAmount))) return false;
  return true;
}

function createLine(sourceType, sourceId, label, date, rate, net, tax, kennzahl, extras = {}) {
  return { sourceType, sourceId: String(sourceId ?? ''), label: String(label || 'Buchung'), date, rate: Number.isFinite(Number(rate)) ? Number(rate) : null,
    net: amount(net), tax: amount(tax), kennzahl, ...extras };
}

function applyOutput(k, line, vatParams) {
  const { rate, net, tax, kennzahl } = line;
  if (kennzahl === 'kz48') add(k, 'kz48', net);
  else if (kennzahl === 'kz87') add(k, 'kz87', net);
  else if (rate === vatParams.standardRate) { add(k, 'kz81', net); add(k, 'tax19', tax); }
  else if (rate === vatParams.reducedRate) { add(k, 'kz86', net); add(k, 'tax7', tax); }
  else if (rate > 0) { add(k, 'kz35', net); add(k, 'kz36', tax); }
}

function calculateInvoice(invoice) {
  try {
    const result = calculateDocumentMoney({ ...invoice, items: Array.isArray(invoice.items) ? invoice.items : [] }, { documentType: invoice.documentType, allowIncomplete: true });
    return result;
  } catch {
    return null;
  }
}

function periodIndexFor(periods, date) {
  return periods.findIndex(period => date >= period.start && date <= period.end);
}

export function computeVat(input = {}) {
  const year = Number(input.year);
  if (!Number.isInteger(year)) throw new TypeError('Ein gültiges Steuerjahr ist erforderlich.');
  const profile = input.profile || {};
  const { params, parameterYear, warning: parameterWarning } = resolveTaxParams(year);
  const vatParams = params.vat;
  const status = ['small_business', 'regular', 'education_exempt'].includes(profile.vatStatus) ? profile.vatStatus : null;
  const { accounting, source: accountingSource } = resolveVatAccounting(profile);
  const periodType = ['monthly', 'quarterly', 'annual'].includes(profile.vatPeriod) ? profile.vatPeriod : 'quarterly';
  const permanentExtension = profile.vatPermanentExtension === true;
  const now = dateOf(input.now ?? new Date());
  const periods = vatPeriods(year, periodType).map(period => ({ ...period, statutoryDueDate: null, dueDate: null,
    state: period.start > now ? 'future' : period.end < now ? 'closed' : 'running', kennzahlen: zeroKennzahlen(), outputTax: 0, reverseChargeTax: 0,
    inputTax: 0, liability: 0, estimatedLiability: 0, paid: 0, refunded: 0, balance: 0, paymentStatus: 'none', overdue: false,
    complete: true, incompleteEntryIds: [], legacyInvoiceIds: [], items: [], paymentIds: [] }));
  const entries = (Array.isArray(input.entries) ? input.entries : []).filter(isActive);
  const invoices = (Array.isArray(input.invoices) ? input.invoices : []).filter(invoice => invoice && invoice.status !== 'draft');
  const suggestions = [];
  const incompleteIds = new Set();
  const incompleteByPeriod = new Map();
  const incompleteByMonth = new Map();
  let zeroRatedUnclassified = 0;
  let legacyPaidInvoices = 0;
  const addItem = (date, line, { output = false, inputTax = false, reverse = false } = {}) => {
    const index = periodIndexFor(periods, date);
    if (index < 0) return;
    const period = periods[index];
    period.items.push(line);
    if (output) applyOutput(period.kennzahlen, line, vatParams);
    if (inputTax) { add(period.kennzahlen, 'kz66', line.tax); add(period, 'inputTax', line.tax); }
    if (reverse) {
      const eu = line.kennzahl === 'kz46';
      add(period.kennzahlen, eu ? 'kz46' : 'kz84', line.net);
      add(period.kennzahlen, eu ? 'kz47' : 'kz85', line.tax);
      add(period, 'reverseChargeTax', line.tax);
      if (line.deductible) { add(period.kennzahlen, 'kz67', line.tax); add(period, 'inputTax', line.tax); }
    }
  };
  const markIncomplete = (entryId, date) => {
    const idx = periodIndexFor(periods, date);
    if (idx < 0) return;
    const id = String(entryId ?? 'unbekannt');
    incompleteIds.add(id);
    const period = periods[idx];
    period.complete = false;
    if (!period.incompleteEntryIds.includes(id)) period.incompleteEntryIds.push(id);
    const estimate = suggestions.find(item => item.entryId === id);
    const monthKey = date.slice(0, 7);
    if (!incompleteByMonth.has(monthKey)) incompleteByMonth.set(monthKey, new Set());
    incompleteByMonth.get(monthKey).add(id);
    if (estimate) {
      const estimateAmount = estimate.entryType === 'expense' ? -estimate.vatAmount : estimate.vatAmount;
      incompleteByPeriod.set(periods[idx].key, round2((incompleteByPeriod.get(periods[idx].key) || 0) + estimateAmount));
      incompleteByMonth.set(`${monthKey}:estimate`, round2((incompleteByMonth.get(`${monthKey}:estimate`) || 0) + estimateAmount));
    }
  };

  const invoiceById = new Map(invoices.map(invoice => [String(invoice.id), invoice]));
  const paymentEntries = entries.filter(entry => entry.sourceType === 'invoice_payment' && entry.entryType === 'income');
  const outputEntries = [];
  if (status !== 'small_business') {
    if (accounting === 'accrual') {
      for (const invoice of invoices) {
        if (invoice.documentType === 'credit_note') continue;
        const date = dateOf(invoice.serviceDate || invoice.issueDate);
        if (!date || !inYear(date, year)) continue;
        const money = calculateInvoice(invoice);
        if (!money || !Array.isArray(invoice.items) || invoice.items.length === 0) { markIncomplete(invoice.id, date); continue; }
        for (const [rateText, bucket] of Object.entries(money.taxBreakdown)) {
          const rate = Number(rateText);
          const line = createLine('invoice', invoice.id, invoice.invoiceNumber || 'Rechnung', date, rate, bucket.taxableAmount, bucket.taxAmount,
            rate === 0 && status === 'education_exempt' ? 'kz48' : rate === 0 ? 'zeroRatedUnclassified' : 'output');
          if (rate === 0 && status === 'regular') { zeroRatedUnclassified += 1; }
          else addItem(date, line, { output: true });
        }
      }
      for (const invoice of invoices.filter(item => item.documentType === 'credit_note')) {
        const date = dateOf(invoice.issueDate);
        if (!date || !inYear(date, year)) continue;
        const money = calculateInvoice(invoice);
        if (!money || !Array.isArray(invoice.items) || invoice.items.length === 0) { markIncomplete(invoice.id, date); continue; }
        for (const [rateText, bucket] of Object.entries(money.taxBreakdown)) {
          const rate = Number(rateText);
          addItem(date, createLine('credit_note', invoice.id, invoice.invoiceNumber || 'Gutschrift', date, rate, bucket.taxableAmount, bucket.taxAmount,
            rate === 0 && status === 'education_exempt' ? 'kz48' : rate === 0 ? 'zeroRatedUnclassified' : 'output'), { output: !(rate === 0 && status === 'regular') });
        }
      }
    } else {
      const seen = new Set();
      for (const entry of paymentEntries) {
        const invoice = invoiceById.get(String(entry.sourceId));
        const date = dateOf(entry.entryDate);
        if (!invoice || !date || !inYear(date, year)) continue;
        const money = calculateInvoice(invoice);
        const total = Number(invoice.total ?? money?.total);
        if (!money || !Array.isArray(invoice.items) || invoice.items.length === 0 || !(total > 0)) { markIncomplete(invoice.id, date); continue; }
        const ratio = Number(entry.amount) / total;
        for (const [rateText, bucket] of Object.entries(money.taxBreakdown)) {
          const rate = Number(rateText);
          const line = createLine('invoice_payment', invoice.id, invoice.invoiceNumber || 'Rechnungszahlung', date, rate,
            round2(bucket.taxableAmount * ratio), round2(bucket.taxAmount * ratio), rate === 0 && status === 'education_exempt' ? 'kz48' : rate === 0 ? 'zeroRatedUnclassified' : 'output');
          if (rate === 0 && status === 'regular') zeroRatedUnclassified += 1;
          else addItem(date, line, { output: true });
        }
        seen.add(String(invoice.id));
      }
      for (const invoice of invoices) {
        if (invoice.documentType !== 'invoice' || !['paid', 'partially_paid'].includes(invoice.status) || seen.has(String(invoice.id))) continue;
        legacyPaidInvoices += 1;
        const date = dateOf(invoice.serviceDate || invoice.issueDate);
        if (date && inYear(date, year)) {
          const idx = periodIndexFor(periods, date);
          if (idx >= 0) { periods[idx].complete = false; periods[idx].legacyInvoiceIds.push(String(invoice.id)); }
        }
      }
      for (const invoice of invoices.filter(item => item.documentType === 'credit_note' && item.status === 'paid')) {
        const date = dateOf(invoice.issueDate);
        if (!date || !inYear(date, year)) continue;
        const money = calculateInvoice(invoice);
        if (money) for (const [rateText, bucket] of Object.entries(money.taxBreakdown)) addItem(date,
          createLine('credit_note', invoice.id, invoice.invoiceNumber || 'Gutschrift', date, Number(rateText), bucket.taxableAmount, bucket.taxAmount, 'output'), { output: true });
      }
    }
  }
  for (const entry of entries) {
    if (entry.sourceType === 'vat_payment' || ['vat_payment', 'vat_refund'].includes(entry.category) || entry.sourceType === 'invoice_payment') continue;
    const date = dateOf(entry.entryType === 'expense' ? entry.documentDate || entry.entryDate : accounting === 'accrual' ? entry.documentDate || entry.entryDate : entry.entryDate);
    if (!date || !inYear(date, year)) continue;
    const treatment = entry.vatTreatment;
    if (entry.entryType === 'income' && status !== 'small_business') {
      if (treatment === 'taxable' && isVatEntryComplete(entry, profile)) {
        const line = createLine('euer_income', entry.id, entry.description, date, entry.taxRate, entry.netAmount, entry.vatAmount, 'output');
        addItem(date, line, { output: true }); outputEntries.push(entry);
      } else if (treatment === 'exempt') addItem(date, createLine('euer_income', entry.id, entry.description, date, 0, entry.netAmount ?? entry.amount, 0, 'kz48'), { output: true });
      else if (treatment == null || treatment === 'taxable') { const suggestion = treatment == null ? suggestVatFromRate(entry, profile) : null; if (suggestion) suggestions.push({ ...suggestion, entryType: 'income' }); markIncomplete(entry.id, date); }
    }
    if (entry.entryType === 'expense') {
      if (status !== 'small_business' && treatment === 'taxable' && isVatEntryComplete(entry, profile) && entry.inputTaxDeductible === true) addItem(date, createLine('euer_expense', entry.id, entry.description, date, entry.taxRate, entry.netAmount, entry.vatAmount, 'kz66', { deductible: true }), { inputTax: true });
      else if (treatment === 'reverse_charge_eu' || treatment === 'reverse_charge_domestic') {
        if (entry.netAmount == null || entry.vatAmount == null || entry.inputTaxDeductible == null) { markIncomplete(entry.id, date); continue; }
        addItem(date, createLine('euer_expense', entry.id, entry.description, date, entry.taxRate, entry.netAmount, entry.vatAmount,
          treatment === 'reverse_charge_eu' ? 'kz46' : 'kz84', { deductible: status !== 'small_business' && entry.inputTaxDeductible }), { reverse: true });
      } else if (status !== 'small_business' && (treatment == null || (treatment === 'taxable' && !isVatEntryComplete(entry, profile)))) {
        const suggestion = suggestVatFromRate(entry, profile); if (suggestion) suggestions.push({ ...suggestion, entryType: 'expense' }); markIncomplete(entry.id, date);
      }
    }
  }

  const special = { amount: null, source: 'not_applicable', dueDate: null, paid: 0 };
  if (periodType === 'monthly' && permanentExtension) {
    const dec = periods.find(period => period.key === `${year}-12`);
    const configured = profile.vatSpecialPrepayment;
    const previous = input.previousYearAdvanceTotal;
    if (configured != null && Number.isFinite(Number(configured))) { special.amount = amount(configured); special.source = 'profile'; }
    else if (previous != null && Number.isFinite(Number(previous))) { special.amount = round2(Number(previous) / vatParams.specialPrepaymentDivisor); special.source = 'previous_year'; }
    else special.source = 'missing';
    special.dueDate = specialPrepaymentDueDate(year, params);
    if (dec && special.amount != null) { add(dec.kennzahlen, 'kz39', special.amount); dec.items.push(createLine('euer_expense', 'special-prepayment', 'Sondervorauszahlung', special.dueDate, null, special.amount, 0, 'kz39')); }
  }

  for (const period of periods) {
    period.statutoryDueDate = period.type === 'annual' ? null : paymentDueDate(period, { permanentExtension: false, params });
    period.dueDate = period.type === 'annual' ? null : paymentDueDate(period, { permanentExtension, params });
    const k = period.kennzahlen;
    k.kz83 = round2(k.tax19 + k.tax7 + k.kz36 + k.kz47 + k.kz85 - k.kz66 - k.kz67 - k.kz39);
    period.outputTax = round2(k.tax19 + k.tax7 + k.kz36);
    period.liability = k.kz83;
    period.estimatedLiability = round2(period.liability + (incompleteByPeriod.get(period.key) || 0));
  }

  const payments = (Array.isArray(input.payments) ? input.payments : []).filter(item => item && amount(item.amount) > 0);
  const yearLevel = { paid: 0, refunded: 0, paymentIds: [] };
  for (const payment of payments) {
    const paidOn = dateOf(payment.paidOn);
    if (!paidOn) continue;
    const key = payment.periodKey && parseVatPeriodKey(payment.periodKey) ? payment.periodKey : null;
    const targetPeriod = key ? periods.find(period => period.key === key) : null;
    const appliesToYear = payment.taxYear === year || (targetPeriod && targetPeriod.key.startsWith(String(year)));
    if (!appliesToYear) continue;
    // Sondervorauszahlung und Jahresabschluss betreffen das Jahr, nicht den
    // Status eines einzelnen Voranmeldungszeitraums (Kz 39 verrechnet die SVZ im Dezember).
    if (payment.kind === 'special_prepayment') { add(special, 'paid', payment.amount); yearLevel.paymentIds.push(String(payment.id)); continue; }
    const annualPeriod = periods.find(period => period.type === 'annual');
    const target = targetPeriod || (payment.kind === 'annual_payment' || payment.kind === 'refund' ? annualPeriod : null);
    if (!target) {
      if (payment.kind === 'refund') add(yearLevel, 'refunded', payment.amount); else add(yearLevel, 'paid', payment.amount);
      yearLevel.paymentIds.push(String(payment.id));
      continue;
    }
    if (payment.kind === 'refund') add(target, 'refunded', payment.amount); else add(target, 'paid', payment.amount);
    target.paymentIds.push(String(payment.id));
  }
  for (const period of periods) {
    period.balance = round2(period.liability - period.paid + period.refunded);
    if (period.state !== 'closed') period.paymentStatus = 'not_due';
    else if (period.liability > 0.005) {
      if (period.paid >= period.liability) period.paymentStatus = period.paid - period.liability > 0.01 ? 'overpaid' : 'paid';
      else period.paymentStatus = period.paid > 0 ? 'partial' : 'open';
    } else if (period.liability < -0.005) period.paymentStatus = period.refunded >= Math.abs(period.liability) - 0.01 ? 'settled' : 'refund_open';
    else period.paymentStatus = 'none';
    period.overdue = ['open', 'partial'].includes(period.paymentStatus) && !!period.dueDate && now > period.dueDate;
  }

  const euer = { year, smallBusinessIncome: 0, exemptIncome: 0, taxableIncomeNet: 0, vatCollected: 0, vatRefunded: 0, inputTaxPaid: 0,
    vatPaidToOffice: 0, grossMinusNetEffect: 0, payments: [], unbookedPaymentIds: [] };
  for (const entry of entries) {
    const paidDate = dateOf(entry.entryDate);
    // Rechnungszahlungen werden unten anteilig über die Rechnung zugeordnet.
    if (!paidDate || !inYear(paidDate, year) || entry.sourceType === 'vat_payment' || entry.sourceType === 'invoice_payment'
      || ['vat_payment', 'vat_refund'].includes(entry.category)) continue;
    if (entry.entryType === 'income') {
      if (status === 'small_business') add(euer, 'smallBusinessIncome', entry.amount);
      // Altbuchungen ohne USt-Angabe werden nicht still als steuerfrei eingeordnet.
      else if (entry.vatTreatment === 'exempt' || entry.vatTreatment === 'no_vat') add(euer, 'exemptIncome', entry.amount);
      else if (entry.vatTreatment === 'taxable') { add(euer, 'taxableIncomeNet', entry.netAmount); add(euer, 'vatCollected', entry.vatAmount); }
    }
    if (status !== 'small_business' && entry.entryType === 'expense' && entry.vatTreatment === 'taxable' && entry.inputTaxDeductible === true) add(euer, 'inputTaxPaid', entry.vatAmount);
  }
  for (const entry of paymentEntries) {
    const paidDate = dateOf(entry.entryDate);
    if (!paidDate || !inYear(paidDate, year)) continue;
    const invoice = invoiceById.get(String(entry.sourceId));
    const money = invoice ? calculateInvoice(invoice) : null;
    const total = Number(invoice?.total ?? money?.total);
    if (!money || !(total > 0)) {
      if (status === 'small_business') add(euer, 'smallBusinessIncome', entry.amount);
      else if (Number(entry.taxRate) === 0) add(euer, 'exemptIncome', entry.amount);
      else if (entry.vatTreatment === 'taxable' && Number.isFinite(Number(entry.netAmount)) && Number.isFinite(Number(entry.vatAmount))) {
        add(euer, 'taxableIncomeNet', entry.netAmount); add(euer, 'vatCollected', entry.vatAmount);
      }
      continue;
    }
    const ratio = Number(entry.amount) / total;
    for (const [rateText, bucket] of Object.entries(money.taxBreakdown)) {
      const rate = Number(rateText);
      const net = round2(bucket.taxableAmount * ratio);
      const tax = round2(bucket.taxAmount * ratio);
      if (status === 'small_business') add(euer, 'smallBusinessIncome', round2((bucket.taxableAmount + bucket.taxAmount) * ratio));
      else if (rate === 0) add(euer, 'exemptIncome', net);
      else { add(euer, 'taxableIncomeNet', net); add(euer, 'vatCollected', tax); }
    }
  }
  for (const payment of payments) {
    const paidOn = dateOf(payment.paidOn);
    if (!paidOn) continue;
    if (payment.kind === 'refund' && inYear(paidOn, year)) add(euer, 'vatRefunded', payment.amount);
    if (payment.kind === 'refund') continue;
    const attribution = euerAttributionYear(payment, { permanentExtension, params });
    const paymentYear = payment.euerYear ?? attribution.year;
    const relevant = ['advance', 'special_prepayment', 'annual_payment'].includes(payment.kind);
    if (!relevant || paymentYear !== year) continue;
    add(euer, 'vatPaidToOffice', payment.amount);
    const item = { paymentId: String(payment.id), kind: payment.kind, paidOn, amount: amount(payment.amount), euerYear: paymentYear,
      // Maßgeblich ist das tatsächlich verwendete EÜR-Jahr (gespeicherte Buchung vor Neuberechnung).
      tenDayRule: paymentYear !== Number(paidOn.slice(0, 4)), reason: paymentYear !== Number(paidOn.slice(0, 4)) ? attribution.reason : null,
      booked: !!payment.euerEntryId };
    euer.payments.push(item);
    if (!item.booked) euer.unbookedPaymentIds.push(item.paymentId);
  }
  euer.grossMinusNetEffect = round2(euer.vatCollected + euer.vatRefunded - euer.inputTaxPaid - euer.vatPaidToOffice);

  const annualK = zeroKennzahlen();
  for (const period of periods) for (const key of Object.keys(annualK)) add(annualK, key, period.kennzahlen[key]);
  const total = key => round2(periods.reduce((sum, period) => sum + period[key], 0));
  const annualLiability = total('liability');
  const annualPaid = round2(total('paid') + yearLevel.paid + special.paid);
  const annualRefunded = round2(total('refunded') + yearLevel.refunded);
  const annual = { kennzahlen: annualK, liability: annualLiability, estimatedLiability: total('estimatedLiability'), paid: annualPaid, refunded: annualRefunded,
    balance: round2(annualLiability - annualPaid + annualRefunded), specialPrepayment: special };
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}`;
    const period = periods.find(item => item.start.slice(0, 7) <= month && item.end.slice(0, 7) >= month);
    const items = period?.items.filter(item => item.date?.slice(0, 7) === month) || [];
    const outputTax = round2(items.filter(item => item.kennzahl === 'output').reduce((sum, item) => sum + item.tax, 0));
    const reverseCharge = round2(items.filter(item => ['kz46', 'kz84'].includes(item.kennzahl)).reduce((sum, item) => sum + item.tax, 0));
    const inputTax = round2(items.filter(item => item.kennzahl === 'kz66' || (['kz46', 'kz84'].includes(item.kennzahl) && item.deductible)).reduce((sum, item) => sum + item.tax, 0));
    const kz39 = index === 11 ? (period?.kennzahlen.kz39 || 0) : 0;
    const liability = round2(outputTax + reverseCharge - inputTax - kz39);
    const incompleteCount = incompleteByMonth.get(month)?.size || 0;
    return { month, outputTax, inputTax, liability, estimatedLiability: round2(liability + (incompleteByMonth.get(`${month}:estimate`) || 0)),
      complete: incompleteCount === 0, incompleteCount };
  });
  const applicable = status === 'regular' || status === 'education_exempt' || entries.some(entry => entry.entryType === 'expense' && isActive(entry) && ['reverse_charge_eu', 'reverse_charge_domestic'].includes(entry.vatTreatment));
  const limitations = [...(params.limitations || []), 'Bemessungsgrundlagen werden centgenau ausgewiesen; amtliche Vordrucke können volle Euro verlangen.',
    'Auswertungen dienen als Orientierung und beruhen auf den erfassten Daten; keine Steuerberatung und keine ELSTER-Übermittlung.'];
  const warnings = [];
  if (parameterWarning) warnings.push(parameterWarning);
  if (!status) warnings.push('Der Umsatzsteuerstatus fehlt; eine vollständige Berechnung ist nicht möglich.');
  if (status === 'small_business' && entries.some(entry => ['reverse_charge_eu', 'reverse_charge_domestic'].includes(entry.vatTreatment))) warnings.push('Reverse-Charge-Leistungen können auch bei § 19 Umsatzsteuer auslösen; ein Vorsteuerabzug wird hier nicht angesetzt.');
  if (zeroRatedUnclassified) warnings.push(`${zeroRatedUnclassified} Umsätze mit 0 % sind keiner steuerlichen Behandlung zugeordnet.`);
  if (legacyPaidInvoices) warnings.push(`${legacyPaidInvoices} bezahlte Rechnungen haben keinen erfassten Zahlungseingang und bleiben unvollständig.`);
  if (incompleteIds.size) warnings.push(`${incompleteIds.size} Buchungen haben unvollständige USt-Angaben; Vorschläge sind Schätzungen aus vorhandenen Daten.`);
  if (invoices.some(invoice => invoice.status !== 'draft' && Number(invoice.taxAmount) > 0) && status === 'small_business') warnings.push('Bei § 19 enthalten Rechnungen mit ausgewiesener Umsatzsteuer ein mögliches § 14c-Risiko; es wird nicht berechnet.');
  if (status === 'education_exempt') warnings.push('Bei steuerfreien Bildungsleistungen ist ein Vorsteuerabzug nur nach ausdrücklicher Kennzeichnung der jeweiligen Ausgabe berücksichtigt.');
  if (accounting === 'cash') warnings.push('Ist-Versteuerung setzt eine entsprechende Genehmigung voraus; die Auswertung ersetzt diese Prüfung nicht.');
  if (accounting === 'cash' && invoices.some(invoice => invoice.documentType === 'credit_note' && invoice.status === 'paid')) warnings.push('Bezahlte Gutschriften werden nach Ausstellungsdatum berücksichtigt; die Zuordnung zu Zahlungen wird nicht automatisch geprüft.');
  if (special.source === 'missing') warnings.push('Für die Sondervorauszahlung fehlen Profilbetrag und Vorjahresvorauszahlungen.');
  const nextPeriod = periods.find(period => period.dueDate && ['open', 'partial'].includes(period.paymentStatus));
  // Offener Saldo des Zeitraums; bei unvollständigen Daten inklusive Vorschlagswerten.
  const nextDue = nextPeriod ? { periodKey: nextPeriod.key, label: nextPeriod.label, dueDate: nextPeriod.dueDate,
    amount: round2((nextPeriod.complete ? nextPeriod.liability : nextPeriod.estimatedLiability) - nextPeriod.paid + nextPeriod.refunded),
    estimated: !nextPeriod.complete } : null;
  return { year, applicable, vatStatus: status, accounting, accountingSource, periodType, permanentExtension, parameterYear, paramsVersion: params.version,
    paramsAsOf: params.asOf, periods, months, annual, completeness: { complete: periods.every(period => period.complete), incompleteEntries: incompleteIds.size,
      incompleteEntryIds: [...incompleteIds], suggestions: suggestions.map(({ entryType, ...suggestion }) => suggestion), legacyPaidInvoices, zeroRatedUnclassified },
    euer, nextDue, warnings, limitations };
}
