/**
 * Eine Quelle für die Forderungsaufstellung einer Mahnung: offener Rechnungsbetrag,
 * Mahngebühren, Verzugszinsen und Gesamtforderung. Mahndialog, Mahnliste,
 * Mahn-PDF und Mahn-E-Mail verwenden ausschließlich diese Funktionen.
 *
 * Mahngebühren und Verzugszinsen sind Schadensersatz und keine umsatzsteuerpflichtige
 * Leistung. Auf beide Beträge wird deshalb keine Umsatzsteuer gerechnet.
 */

/** Übliche Vorbelegung für neue Workspaces und die Demo. */
export const REMINDER_DEFAULT_FEES = Object.freeze([0, 2.5, 5]);
/**
 * Vorbelegung des Basiszinssatzes in Prozent. Die Bundesbank legt ihn zum 1.1. und 1.7.
 * neu fest; der Wert muss vor dem Livegang gegen die Bundesbank geprüft werden.
 */
export const DEFAULT_BASE_INTEREST_RATE = 1.27;
/** Aufschlag nach § 288 Abs. 1 und 2 BGB in Prozentpunkten. */
export const CONSUMER_SURCHARGE_POINTS = 5;
export const BUSINESS_SURCHARGE_POINTS = 9;

const MS_PER_DAY = 86400000;

function roundCents(value) {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value) * 100 + 1e-9) / 100;
}

function toNumber(value, fallback = 0) {
  const number = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Kalendertag als `YYYY-MM-DD`; Date-Werte nach lokalem Kalendertag, Strings nach den ersten zehn Zeichen. */
export function toCalendarDay(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return null;
}

function dayNumber(day) {
  const [year, month, date] = day.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, date) / MS_PER_DAY);
}

/** Aufschlag über dem Basiszinssatz: Unternehmen 9, Privatpersonen (und unbekannt) 5 Prozentpunkte. */
export function interestSurchargePoints(customerType) {
  return customerType === 'organization' ? BUSINESS_SURCHARGE_POINTS : CONSUMER_SURCHARGE_POINTS;
}

/**
 * Verzugszinsen = offener Betrag x Jahreszins x Verzugstage / 365 (Schaltjahr egal),
 * kaufmännisch auf Cent gerundet. Der Verzug beginnt am Tag nach der Fälligkeit.
 * Ein Zahlungstag zählt noch als Zinstag für den bezahlten Teil; der offene Betrag
 * sinkt erst ab dem Folgetag. Ohne `payments` gilt `openAmount` über den ganzen Zeitraum.
 *
 * @param {{ openAmount?: number, invoiceTotal?: number, payments?: Array<{ date: string | Date, amount: number }>,
 *   dueDate: string | Date, asOfDate: string | Date, annualRatePercent: number }} input
 * @returns {{ amount: number, days: number }}
 */
export function calculateDefaultInterest(input) {
  const due = toCalendarDay(input.dueDate);
  const asOf = toCalendarDay(input.asOfDate);
  const rate = toNumber(input.annualRatePercent);
  if (!due || !asOf) return { amount: 0, days: 0 };
  const days = Math.max(0, dayNumber(asOf) - dayNumber(due));
  if (days === 0 || rate <= 0) return { amount: 0, days };

  const payments = Array.isArray(input.payments) ? input.payments : [];
  if (payments.length === 0 || input.invoiceTotal === undefined) {
    const open = Math.max(0, toNumber(input.openAmount));
    return { amount: roundCents(open * (rate / 100) * days / 365), days };
  }

  // Segmentweise: Jede Zahlung im Verzugszeitraum beendet einen Abschnitt mit höherem offenem Betrag.
  const dueNumber = dayNumber(due);
  const asOfNumber = dayNumber(asOf);
  const dated = payments
    .map(payment => ({ day: toCalendarDay(payment.date), amount: Math.max(0, toNumber(payment.amount)) }))
    .filter(payment => payment.day && payment.amount > 0)
    .map(payment => ({ at: dayNumber(payment.day), amount: payment.amount }))
    .sort((left, right) => left.at - right.at);
  let open = Math.max(0, toNumber(input.invoiceTotal));
  let cursor = dueNumber;
  let sum = 0;
  for (const payment of dated) {
    if (payment.at <= dueNumber) {
      open = Math.max(0, open - payment.amount);
      continue;
    }
    const until = Math.min(payment.at, asOfNumber);
    sum += open * (until - cursor);
    cursor = until;
    open = Math.max(0, open - payment.amount);
    if (cursor >= asOfNumber) break;
  }
  if (cursor < asOfNumber) sum += open * (asOfNumber - cursor);
  return { amount: roundCents(sum * (rate / 100) / 365), days };
}

/** Summe der Mahngebühren bis einschließlich `stage` (0 = noch nicht gemahnt). */
export function cumulativeReminderFee(settings, stage) {
  const fees = [settings?.reminderFeeStage1, settings?.reminderFeeStage2, settings?.reminderFeeStage3]
    .map(fee => Math.max(0, toNumber(fee)));
  const limit = Math.min(3, Math.max(0, Math.trunc(toNumber(stage))));
  return roundCents(fees.slice(0, limit).reduce((sum, fee) => sum + fee, 0));
}

/**
 * Gesamtforderung einer Mahnung.
 *
 * @param {{
 *   invoice: { total?: number, paidAmount?: number, outstandingAmount?: number, status?: string, dueDate: string | Date },
 *   stage: number,
 *   settings: { reminderFeeStage1?: number, reminderFeeStage2?: number, reminderFeeStage3?: number,
 *     reminderInterestEnabled?: boolean, reminderBaseInterestRate?: number },
 *   customerType?: 'person' | 'organization',
 *   asOfDate: string | Date,
 *   payments?: Array<{ date: string | Date, amount: number }>,
 * }} input
 */
export function calculateReminderClaim(input) {
  const { invoice, stage, settings } = input;
  const total = toNumber(invoice.total);
  const paid = Math.min(total, Math.max(0, toNumber(invoice.paidAmount ?? (invoice.status === 'paid' ? total : 0))));
  const outstanding = roundCents(Math.max(0, toNumber(invoice.outstandingAmount, total - paid)));
  const fee = cumulativeReminderFee(settings, stage);

  const interestEnabled = settings?.reminderInterestEnabled === true;
  const baseRate = toNumber(settings?.reminderBaseInterestRate, DEFAULT_BASE_INTEREST_RATE);
  const surchargePoints = interestSurchargePoints(input.customerType);
  const ratePercent = roundCents(baseRate + surchargePoints);
  let interest = { amount: 0, days: 0 };
  if (interestEnabled) {
    interest = calculateDefaultInterest({
      openAmount: outstanding,
      invoiceTotal: input.payments?.length ? total : undefined,
      payments: input.payments,
      dueDate: invoice.dueDate,
      asOfDate: input.asOfDate,
      annualRatePercent: ratePercent,
    });
  }
  return {
    stage: Math.min(3, Math.max(0, Math.trunc(toNumber(stage)))),
    outstanding,
    fee,
    interestEnabled,
    interest: interest.amount,
    interestDays: interest.days,
    interestRatePercent: ratePercent,
    baseRatePercent: baseRate,
    surchargePoints,
    total: roundCents(outstanding + fee + interest.amount),
  };
}

/** Beschriftung der Zinszeile, z. B. „12 Tage zu 6,27 % p. a.“. */
export function describeInterest(claim) {
  const rate = claim.interestRatePercent.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${claim.interestDays} ${claim.interestDays === 1 ? 'Tag' : 'Tage'} zu ${rate} % p. a.`;
}

/**
 * Prüft eine vom Client gelieferte Aufstellung für die E-Mail und rechnet die Summe neu,
 * damit keine widersprüchlichen Beträge versendet werden. Ungültiges liefert `null`.
 */
export function normalizeReminderClaim(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const outstanding = toNumber(raw.outstanding, NaN);
  const fee = toNumber(raw.fee, NaN);
  const interest = toNumber(raw.interest, 0);
  if (![outstanding, fee, interest].every(Number.isFinite) || outstanding < 0 || fee < 0 || interest < 0) return null;
  const interestEnabled = raw.interestEnabled === true;
  const days = Math.max(0, Math.trunc(toNumber(raw.interestDays, 0)));
  const rate = toNumber(raw.interestRatePercent, 0);
  const claim = {
    stage: Math.min(3, Math.max(0, Math.trunc(toNumber(raw.stage, 0)))),
    outstanding: roundCents(outstanding),
    fee: roundCents(fee),
    interestEnabled,
    interest: interestEnabled ? roundCents(interest) : 0,
    interestDays: days,
    interestRatePercent: rate,
    baseRatePercent: toNumber(raw.baseRatePercent, 0),
    surchargePoints: toNumber(raw.surchargePoints, 0),
  };
  claim.total = roundCents(claim.outstanding + claim.fee + claim.interest);
  return claim;
}
