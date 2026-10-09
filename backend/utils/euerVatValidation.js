import { VAT_TREATMENTS } from '../shared/vat/index.js';
import { assertDateOnly } from '../shared/recurrence.js';

const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const nullableNumber = value => value === undefined || value === null || value === '' ? null : Number(value);

/** Prüft und normalisiert die optionalen USt-Daten einer EÜR-Buchung. */
export function normalizeEuerVatFields(data, entryType, amount, taxRate) {
  const input = {
    documentDate: data.documentDate ?? null,
    vatTreatment: data.vatTreatment ?? null,
    netAmount: nullableNumber(data.netAmount),
    vatAmount: nullableNumber(data.vatAmount),
    inputTaxDeductible: data.inputTaxDeductible ?? null,
  };
  if (input.documentDate !== null) {
    try { input.documentDate = assertDateOnly(input.documentDate, 'Belegdatum'); }
    catch { return { error: 'Ungültiges Belegdatum.' }; }
  }
  if (input.vatTreatment !== null && !VAT_TREATMENTS.includes(input.vatTreatment)) return { error: 'Ungültige Umsatzsteuer-Behandlung.' };
  if (input.inputTaxDeductible !== null && typeof input.inputTaxDeductible !== 'boolean') return { error: 'Der Vorsteuerabzug muss Ja, Nein oder offen sein.' };
  for (const [key, value] of [['netAmount', input.netAmount], ['vatAmount', input.vatAmount]]) {
    if (value !== null && (!Number.isFinite(value) || value < 0 || money(value) !== value)) return { error: 'Netto- und Umsatzsteuerbeträge müssen gültige Beträge mit höchstens zwei Nachkommastellen sein.' };
    if (value !== null) input[key] = money(value);
  }
  if (input.inputTaxDeductible !== null && entryType !== 'expense') return { error: 'Vorsteuer kann nur bei Ausgaben als abziehbar markiert werden.' };
  if (input.vatTreatment === null) return { values: input };

  const net = input.netAmount;
  const vat = input.vatAmount;
  const rate = Number(taxRate ?? 0);
  if (input.vatTreatment === 'taxable') {
    if (net === null || vat === null || Math.abs(money(net + vat) - money(amount)) > 0.01) return { error: 'Bei steuerpflichtigen Buchungen müssen Netto und Umsatzsteuer zusammen dem Bruttobetrag entsprechen.' };
    if (Math.abs(money(net * rate / 100) - vat) > 0.01) return { error: 'Der Umsatzsteuerbetrag passt nicht zum angegebenen Steuersatz.' };
  } else if (input.vatTreatment === 'reverse_charge_eu' || input.vatTreatment === 'reverse_charge_domestic') {
    if (entryType !== 'expense') return { error: 'Reverse Charge ist hier nur für Ausgaben zulässig.' };
    if (net === null || vat === null || Math.abs(money(net) - money(amount)) > 0.01 || Math.abs(money(net * rate / 100) - vat) > 0.01) return { error: 'Bei Reverse Charge muss Netto dem gezahlten Betrag entsprechen und die Umsatzsteuer zum Steuersatz passen.' };
  } else if (input.vatTreatment === 'exempt' || input.vatTreatment === 'no_vat') {
    if (vat !== null && vat !== 0) return { error: 'Bei steuerfreien Buchungen oder ohne Umsatzsteuer muss der Umsatzsteuerbetrag 0 € betragen.' };
  }
  return { values: input };
}
