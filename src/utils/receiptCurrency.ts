/** Leere OCR-Angaben werden bei Anzeige und Speicherung einheitlich als EUR behandelt. */
export function normalizeReceiptCurrency(value?: string): string {
  return value?.trim().toUpperCase() || 'EUR';
}

export function isReceiptCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(normalizeReceiptCurrency(value));
}
