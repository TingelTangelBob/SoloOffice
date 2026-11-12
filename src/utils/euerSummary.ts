/**
 * EÜR-Aufstellung nach dem Zufluss-Abfluss-Prinzip (§ 4 Abs. 3 EStG).
 *
 * Gespeichert wird je Buchung der Bruttobetrag (`amount`). Daran ändert sich
 * nichts. Diese Funktion zerlegt die Summen nur für die Darstellung:
 *
 * - Regelbesteuerung: Einnahmen und Ausgaben netto; vereinnahmte Umsatzsteuer,
 *   gezahlte Vorsteuer, an das Finanzamt gezahlte und erstattete Umsatzsteuer
 *   erscheinen als eigene Positionen. Der Überschuss bleibt die Summe aller
 *   Einnahmen minus aller Ausgaben und ist damit unverändert.
 * - Kleinunternehmer (§ 19 UStG): keine Umsatzsteuer auf Einnahmen, kein
 *   Vorsteuerabzug; Ausgaben zählen brutto.
 */
export interface EuerSummaryEntry {
  entryType: 'income' | 'expense';
  category?: string;
  amount: number;
  taxRate?: number | null;
  vatTreatment?: string | null;
  netAmount?: number | null;
  vatAmount?: number | null;
  inputTaxDeductible?: boolean | null;
  status?: string;
}

export interface EuerSummary {
  smallBusiness: boolean;
  /** Regelbesteuerung: netto ohne Umsatzsteuer. Kleinunternehmer: Summe der Einnahmen. */
  income: number;
  /** Regelbesteuerung: vereinnahmte Umsatzsteuer aus Einnahmen. */
  vatCollected: number;
  /** Vom Finanzamt erstattete Umsatzsteuer. */
  vatRefunded: number;
  /** Regelbesteuerung: netto ohne abziehbare Vorsteuer. Kleinunternehmer: brutto. */
  expenses: number;
  /** Gezahlte abziehbare Vorsteuer. */
  inputTax: number;
  /** An das Finanzamt gezahlte Umsatzsteuer. */
  vatPaid: number;
  /** Alle Einnahmen einschließlich Umsatzsteuer (Bruttosumme). */
  totalIncome: number;
  /** Alle Ausgaben einschließlich Vorsteuer und Umsatzsteuerzahlungen. */
  totalExpenses: number;
  profit: number;
  count: number;
}

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const NO_VAT_SPLIT = new Set(['exempt', 'no_vat', 'reverse_charge_eu', 'reverse_charge_domestic']);

/** Netto/Umsatzsteuer einer Buchung; Netto + Umsatzsteuer ergibt immer den Bruttobetrag. */
export function splitEuerEntryVat(entry: EuerSummaryEntry): { net: number; vat: number } {
  const gross = cents(Number(entry.amount) || 0);
  if (entry.vatTreatment && NO_VAT_SPLIT.has(entry.vatTreatment)) return { net: gross, vat: 0 };
  let net: number | null = null;
  if (entry.netAmount != null && entry.vatAmount != null && Number.isFinite(Number(entry.netAmount))) {
    net = cents(Number(entry.netAmount));
  } else {
    const rate = Number(entry.taxRate);
    if (Number.isFinite(rate) && rate > 0) net = cents(gross / (1 + rate / 100));
  }
  if (net == null) return { net: gross, vat: 0 };
  return { net, vat: cents(gross - net) };
}

export function summarizeEuer(entries: readonly EuerSummaryEntry[], options: { smallBusiness: boolean }): EuerSummary {
  const result: EuerSummary = {
    smallBusiness: options.smallBusiness, income: 0, vatCollected: 0, vatRefunded: 0, expenses: 0, inputTax: 0, vatPaid: 0,
    totalIncome: 0, totalExpenses: 0, profit: 0, count: 0,
  };
  for (const entry of entries) {
    if (entry.status === 'voided') continue;
    const gross = Number(entry.amount) || 0;
    result.count += 1;
    if (entry.entryType === 'income') result.totalIncome += gross; else result.totalExpenses += gross;
    if (options.smallBusiness) {
      if (entry.entryType === 'income') result.income += gross; else result.expenses += gross;
      continue;
    }
    if (entry.category === 'vat_payment') { result.vatPaid += gross; continue; }
    if (entry.category === 'vat_refund') { result.vatRefunded += gross; continue; }
    const { net, vat } = splitEuerEntryVat(entry);
    if (entry.entryType === 'income') {
      result.income += net;
      result.vatCollected += vat;
    } else if (entry.inputTaxDeductible === false) {
      // Nicht abziehbare Vorsteuer ist Teil der Betriebsausgabe.
      result.expenses += net + vat;
    } else {
      result.expenses += net;
      result.inputTax += vat;
    }
  }
  for (const key of ['income', 'vatCollected', 'vatRefunded', 'expenses', 'inputTax', 'vatPaid', 'totalIncome', 'totalExpenses'] as const) {
    result[key] = cents(result[key]);
  }
  result.profit = cents(result.totalIncome - result.totalExpenses);
  return result;
}
