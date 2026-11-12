/**
 * Einnahmenkategorie einer EÜR-Buchung. Zahlungen auf eigene Rechnungen sind
 * „Betriebseinnahmen (Rechnungen)“ (`operating_income`), alle übrigen Einnahmen
 * „Sonstige Einnahmen“ (`other_income`). Entspricht `normaliseIncomeCategory`
 * im Backend (`backend/routes/euerEntries.js`).
 */
export function normaliseIncomeCategory<T extends object>(entry: T): T {
  const { entryType, sourceType, category } = entry as { entryType?: unknown; sourceType?: unknown; category?: unknown };
  if (entryType !== 'income') return entry;
  if ((sourceType || 'manual') === 'invoice_payment') return { ...entry, category: 'operating_income' };
  if (category === 'operating_income') return { ...entry, category: 'other_income' };
  return entry;
}
