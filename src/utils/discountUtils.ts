import { InvoiceItem, Invoice, JobMaterial, JobTimeEntry, NumberFormat } from '../types';
import { formatCurrency } from './formatters.js';
import { calculateDocumentMoney } from '../../backend/utils/documentMoney.js';

export interface DiscountCalculation {
  subtotal: number;
  itemDiscountAmount: number;
  globalDiscountAmount: number;
  totalDiscountAmount: number;
  discountedSubtotal: number;
  taxAmount: number;
  total: number;
  taxBreakdown: ReturnType<typeof calculateDocumentMoney>['taxBreakdown'];
  validationError?: string;
}

/**
 * Berechnet den Rabattbetrag für einen einzelnen Artikel
 */
export function calculateItemDiscount(
  quantity: number,
  unitPrice: number,
  discountType?: 'percentage' | 'fixed',
  discountValue?: number
): number {
  const result = calculateInvoiceWithDiscounts({
    items: [{ id: 'preview', description: 'Position', quantity, unitPrice, taxRate: 0, total: 0, order: 1, discountType, discountValue }],
  });
  return result.itemDiscountAmount;
}

/**
 * Berechnet den Gesamtrabatt
 */
export function calculateGlobalDiscount(
  subtotal: number,
  globalDiscountType?: 'percentage' | 'fixed',
  globalDiscountValue?: number
): number {
  const result = calculateInvoiceWithDiscounts({
    items: [{ id: 'preview', description: 'Position', quantity: 1, unitPrice: subtotal, taxRate: 0, total: 0, order: 1 }],
    globalDiscountType,
    globalDiscountValue,
  });
  return result.globalDiscountAmount;
}

/**
 * Berechnet alle Rabatte und Gesamtsummen für eine Rechnung
 */
export function calculateInvoiceWithDiscounts(invoice: Partial<Invoice>): DiscountCalculation {
  try {
    return calculateDocumentMoney({
      ...invoice,
      items: Array.isArray(invoice.items) ? invoice.items : [],
    }, {
      documentType: invoice.documentType === 'credit_note' ? 'credit_note' : 'invoice',
      allowIncomplete: true,
    });
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'INVALID_DOCUMENT_DATA') throw error;
    // Unzulässige Eingaben bleiben editierbar. Die Oberfläche zeigt den Fehler
    // anstelle einer Summe; Speichern verwendet weiterhin die strikte Prüfung.
    return { ...calculateDocumentMoney({ items: [] }), validationError: error.message };
  }
}

/**
 * Aktualisiert ein InvoiceItem mit berechneten Rabattbeträgen
 */
export function updateItemWithDiscount(item: InvoiceItem): InvoiceItem {
  const result = calculateInvoiceWithDiscounts({ items: [{ ...item, discountAmount: item.discountType ? item.discountAmount : 0 }] });
  return {
    ...item,
    discountAmount: result.itemDiscountAmount,
    total: result.discountedSubtotal,
  };
}

/**
 * Formatiert Rabattinformationen für die Anzeige
 */
export function formatDiscountDisplay(
  discountType?: 'percentage' | 'fixed',
  discountValue?: number,
  discountAmount?: number,
  locale = 'de-DE',
  numberFormat?: NumberFormat,
  currency?: string,
): string {
  if (!discountType || !discountValue || discountValue <= 0) {
    return '';
  }

  if (discountType === 'percentage') {
    return `${discountValue}% (${formatCurrency(discountAmount || 0, locale, numberFormat, currency)})`;
  } else {
    return formatCurrency(discountValue, locale, numberFormat, currency);
  }
}

/**
 * Validiert Rabatteinstellungen
 */
export function validateDiscount(
  discountType?: 'percentage' | 'fixed',
  discountValue?: number,
  maxAmount?: number,
  locale = 'de-DE',
  numberFormat?: NumberFormat,
  currency?: string,
): { isValid: boolean; error?: string } {
  if (!discountType || !discountValue) {
    return { isValid: true }; // Kein Rabatt ist gültig
  }

  if (discountValue < 0) {
    return { isValid: false, error: 'Rabattwert kann nicht negativ sein' };
  }

  if (discountType === 'percentage' && discountValue > 100) {
    return { isValid: false, error: 'Prozentrabatt kann nicht über 100% liegen' };
  }

  if (discountType === 'fixed' && maxAmount && discountValue > maxAmount) {
    return { isValid: false, error: `Festbetrag kann nicht höher als ${formatCurrency(maxAmount, locale, numberFormat, currency)} sein` };
  }

  return { isValid: true };
}

/**
 * Berechnet Rabatte für Job-Materialien
 */
export function calculateJobMaterialDiscount(material: JobMaterial): JobMaterial {
  const discountAmount = calculateItemDiscount(
    material.quantity,
    material.unitPrice,
    material.discountType,
    material.discountValue
  );

  const materialTotal = material.quantity * material.unitPrice;
  
  return {
    ...material,
    discountAmount,
    total: materialTotal - discountAmount
  };
}

/**
 * Berechnet Rabatte für Job-Zeiteinträge
 */
export function calculateJobTimeEntryDiscount(timeEntry: JobTimeEntry): JobTimeEntry {
  const discountAmount = calculateItemDiscount(
    timeEntry.hoursWorked,
    timeEntry.hourlyRate,
    timeEntry.discountType,
    timeEntry.discountValue
  );

  const entryTotal = timeEntry.hoursWorked * timeEntry.hourlyRate;
  
  return {
    ...timeEntry,
    discountAmount,
    total: entryTotal - discountAmount
  };
}
