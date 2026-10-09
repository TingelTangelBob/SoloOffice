import { resolveTaxParams } from '../taxParams/index.js';

const tone = (value, limit, params) => value < limit * params.vat.warningRatio
  ? 'success' : value <= limit ? 'warning' : 'danger';

function band(id, label, from, to, resultTone, rate) {
  return { id, label, from, to, tone: resultTone, ...(rate === undefined ? {} : { rate }) };
}

/** Liefert nachvollziehbare Stufen für die wichtigsten Schwellen des Profils. */
export function calculateThresholds({ profit = 0, taxableIncome = profit, revenue = 0, currentRevenue = revenue, previousRevenue = null, profile = {}, params } = {}) {
  const resolved = params || resolveTaxParams(profile.year || new Date().getUTCFullYear()).params;
  const p = resolved;
  const splitScale = ['joint', 'together', 'splitting'].includes(profile.assessment) ? 2 : 1;
  const isKskHealth = profile.healthInsurance === 'gkv_ksk';
  const healthMinimumMonthly = isKskHealth ? p.social.kskHealthMinimumMonthly : p.social.healthMinimumMonthly;
  const estBands = [
    band('est-basic', 'Grundfreibetrag', 0, p.incomeTax.basicAllowance * splitScale, 'success', 0),
    band('est-zone-2', 'Progressionszone', p.incomeTax.basicAllowance * splitScale, p.incomeTax.zone2End * splitScale, 'neutral'),
    band('est-zone-3', 'Progressionszone', p.incomeTax.zone2End * splitScale, p.incomeTax.zone3End * splitScale, 'neutral'),
    band('est-zone-4', '42-%-Zone', p.incomeTax.zone3End * splitScale, p.incomeTax.zone4End * splitScale, 'warning', p.incomeTax.zone4Rate),
    band('est-zone-5', '45-%-Zone', p.incomeTax.zone4End * splitScale, null, 'danger', p.incomeTax.zone5Rate),
  ];
  const thresholds = [
    { id: 'est', label: 'Zu versteuerndes Einkommen', value: Math.max(0, taxableIncome), bands: estBands, message: 'Die Tarifstufe beruht auf dem prognostizierten zu versteuernden Einkommen.' },
    { id: 'kv', label: 'Beitragsbemessungsgrenze KV/PV', value: Math.max(0,
      isKskHealth
        ? Number(profile.kskIncomeAnnual) || 0
        : profit + (Number(profile.otherContributoryIncomeAnnual) || 0)), bands: [
      band('kv-minimum', 'Mindestbemessung', 0, healthMinimumMonthly * p.forecast.monthsPerYear, 'neutral'),
      band('kv-range', 'Beitragsbereich', healthMinimumMonthly * p.forecast.monthsPerYear, p.social.healthCapAnnual, 'warning'),
      band('kv-cap', 'Oberhalb der Beitragsbemessungsgrenze', p.social.healthCapAnnual, null, 'success'),
    ], message: profile.healthInsurance === 'pkv' || profile.healthInsurance === 'family' ? 'Für die gewählte Versicherung wird kein einkommensabhängiger KV-Beitrag abgeleitet; die GKV-Grenzen dienen nur zur Orientierung.' : 'Die tatsächliche Bemessung hängt auch von weiteren beitragspflichtigen Einnahmen ab.' },
    { id: 'rv', label: 'Beitragsbemessungsgrenze RV', value: Math.max(0, profile.pensionStatus === 'ksk' ? Number(profile.kskIncomeAnnual) || 0 : profit), bands: [
      band('rv-range', 'Beitragsbereich', 0, p.social.pensionCapAnnual, 'warning'),
      band('rv-cap', 'Oberhalb der Beitragsbemessungsgrenze', p.social.pensionCapAnnual, null, 'success'),
    ], message: 'Status und Beitragsmodus richten sich nach den Profilangaben.' },
    { id: 'small_business', label: 'Kleinunternehmerregelung', value: Math.max(0, currentRevenue), bands: [
      band('small-business-safe', 'Unterhalb des Richtwerts', 0, (typeof profile.startedOn === 'string' && Number(profile.startedOn.slice(0, 4)) === profile.year ? p.vat.smallBusinessFounderLimit : p.vat.smallBusinessCurrentLimit) * p.vat.warningRatio, 'success'),
      band('small-business-near', 'Nahe am Richtwert', (typeof profile.startedOn === 'string' && Number(profile.startedOn.slice(0, 4)) === profile.year ? p.vat.smallBusinessFounderLimit : p.vat.smallBusinessCurrentLimit) * p.vat.warningRatio, typeof profile.startedOn === 'string' && Number(profile.startedOn.slice(0, 4)) === profile.year ? p.vat.smallBusinessFounderLimit : p.vat.smallBusinessCurrentLimit, 'warning'),
      band('small-business-over', 'Oberhalb des Richtwerts', typeof profile.startedOn === 'string' && Number(profile.startedOn.slice(0, 4)) === profile.year ? p.vat.smallBusinessFounderLimit : p.vat.smallBusinessCurrentLimit, null, 'danger'),
    ], message: 'Die Umsatzgrenze wird anhand der Profilangabe und erfassten Einnahmen eingeordnet.' },
    { id: 'trade', label: 'Gewerbesteuer-Freibetrag', value: Math.max(0, profit), bands: [
      band('trade-free', 'Bis zum Freibetrag', 0, p.tradeTax.allowance, 'success'),
      band('trade-over', 'Oberhalb des Freibetrags', p.tradeTax.allowance, null, 'warning'),
    ], message: 'Gilt nur für gewerbliche Tätigkeiten; Hebesatz und §-35-Anrechnung beeinflussen die Schätzung.' },
    { id: 'ksk', label: 'KSK-Mindestwert', value: Math.max(0, Number(profile.kskIncomeAnnual) || 0), bands: [
      band('ksk-low', 'Unterhalb des Richtwerts', 0, p.social.kskMinimumAnnual, 'warning'),
      band('ksk-ok', 'Ab dem Richtwert', p.social.kskMinimumAnnual, null, 'success'),
    ], message: 'Mögliche Ausnahmen werden nicht automatisch geprüft.' },
    { id: 'ihk', label: 'IHK-Einordnung', value: Math.max(0, profit), bands: [
      band('ihk-exemption', 'Bis zum Gewinnrichtwert', 0, p.chambers.ihkExemptionProfit, 'success'),
      band('ihk-small-profit', 'Zwischen den Gewinnrichtwerten', p.chambers.ihkExemptionProfit, p.chambers.ihkLevyAllowance, 'neutral'),
      band('ihk-levy-allowance', 'Oberhalb des Umlagefreibetrags', p.chambers.ihkLevyAllowance, p.chambers.ihkFounderProfitLimit, 'warning'),
      band('ihk-founder', 'Oberhalb des Gründer-Richtwerts', p.chambers.ihkFounderProfitLimit, null, 'neutral'),
    ], message: 'Kammerbeiträge hängen von den eingetragenen Angaben und der zuständigen Kammer ab.' },
    { id: 'bookkeeping_revenue', label: 'Buchführungsgrenze Umsatz', value: Math.max(0, revenue), bands: [
      band('bookkeeping-revenue-ok', 'Bis zum Richtwert', 0, p.bookkeeping.revenueLimit, 'success'),
      band('bookkeeping-revenue-over', 'Oberhalb des Richtwerts', p.bookkeeping.revenueLimit, null, 'warning'),
    ], message: 'Einordnung nach hinterlegtem Umsatzrichtwert; daraus folgt keine automatische Buchführungspflicht.' },
    { id: 'bookkeeping_profit', label: 'Buchführungsgrenze Gewinn', value: Math.max(0, profit), bands: [
      band('bookkeeping-profit-ok', 'Bis zum Richtwert', 0, p.bookkeeping.profitLimit, 'success'),
      band('bookkeeping-profit-over', 'Oberhalb des Richtwerts', p.bookkeeping.profitLimit, null, 'warning'),
    ], message: 'Einordnung nach hinterlegtem Gewinnrichtwert; daraus folgt keine automatische Buchführungspflicht.' },
  ];
  const prior = previousRevenue ?? profile.previousYearRevenue;
  const priorLimit = p.vat.smallBusinessPreviousLimit;
  const founder = typeof profile.startedOn === 'string' && Number(profile.startedOn.slice(0, 4)) === profile.year;
  const currentLimit = founder ? p.vat.smallBusinessFounderLimit : p.vat.smallBusinessCurrentLimit;
  const status = (value, limit) => ({ success: 'green', warning: 'yellow', danger: 'red' }[tone(Math.max(0, value), limit, p)]);
  return {
    thresholds,
    smallBusiness: {
      previous: prior == null ? 'yellow' : status(Number(prior), priorLimit),
      current: status(Math.max(0, currentRevenue), currentLimit),
      previousValue: prior == null ? 0 : Number(prior), currentValue: Math.max(0, currentRevenue), currentLimit,
      forecastValue: Math.max(0, revenue),
    },
  };
}
