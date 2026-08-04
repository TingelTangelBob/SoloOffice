import { InvoiceItem, Invoice, JobMaterial, JobTimeEntry, NumberFormat } from '../types';
import { formatCurrency } from './formatters';

export interface DiscountCalculation {
  subtotal: number;
  itemDiscountAmount: number;
  globalDiscountAmount: number;
  totalDiscountAmount: number;
  discountedSubtotal: number;
  taxAmount: number;
  total: number;
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
  if (!discountType || !discountValue || discountValue <= 0) {
    return 0;
  }

  const itemTotal = quantity * unitPrice;

  if (discountType === 'percentage') {
    // Prozentrabatt: maximal 100%
    const percentage = Math.min(Math.max(discountValue, 0), 100);
    return (itemTotal * percentage) / 100;
  } else if (discountType === 'fixed') {
    // Festbetrag: nicht höher als der Artikelpreis
    return Math.min(Math.max(discountValue, 0), itemTotal);
  }

  return 0;
}

/**
 * Berechnet den Gesamtrabatt
 */
export function calculateGlobalDiscount(
  subtotal: number,
  globalDiscountType?: 'percentage' | 'fixed',
  globalDiscountValue?: number
): number {
  if (!globalDiscountType || !globalDiscountValue || globalDiscountValue <= 0) {
    return 0;
  }

  if (globalDiscountType === 'percentage') {
    // Prozentrabatt: maximal 100%
    const percentage = Math.min(Math.max(globalDiscountValue, 0), 100);
    return (subtotal * percentage) / 100;
  } else if (globalDiscountType === 'fixed') {
    // Festbetrag: nicht höher als die Zwischensumme
    return Math.min(Math.max(globalDiscountValue, 0), subtotal);
  }

  return 0;
}

/**
 * Berechnet alle Rabatte und Gesamtsummen für eine Rechnung
 */
export function calculateInvoiceWithDiscounts(invoice: Partial<Invoice>): DiscountCalculation {
  const items = invoice.items || [];
  
  // Berechne Zwischensumme und Artikelrabatte
  let subtotal = 0;
  let itemDiscountAmount = 0;
  
  // Gruppiere Items nach Steuersatz für die Steuerberechnung
  const taxBreakdown: Record<number, { taxableAmount: number; taxAmount: number }> = {};

  items.forEach(item => {
    const itemTotal = item.quantity * item.unitPrice;
    const discount = calculateItemDiscount(
      item.quantity,
      item.unitPrice,
      item.discountType,
      item.discountValue
    );
    
    subtotal += itemTotal;
    itemDiscountAmount += discount;
    
    // Berechne steuerpflichtigen Betrag nach Artikelrabatt
    const taxableItemAmount = itemTotal - discount;
    const taxRate = item.taxRate || 0;
    const itemTaxAmount = (taxableItemAmount * taxRate) / 100;
    
    if (taxBreakdown[taxRate]) {
      taxBreakdown[taxRate].taxableAmount += taxableItemAmount;
      taxBreakdown[taxRate].taxAmount += itemTaxAmount;
    } else {
      taxBreakdown[taxRate] = {
        taxableAmount: taxableItemAmount,
        taxAmount: itemTaxAmount
      };
    }
  });

  // Berechne Zwischensumme nach Artikelrabatten
  const subtotalAfterItemDiscounts = subtotal - itemDiscountAmount;

  // Berechne Gesamtrabatt (wird auf die bereits rabattierte Zwischensumme angewendet)
  const globalDiscountAmount = calculateGlobalDiscount(
    subtotalAfterItemDiscounts,
    invoice.globalDiscountType,
    invoice.globalDiscountValue
  );

  // Endgültige Zwischensumme nach allen Rabatten
  const discountedSubtotal = subtotalAfterItemDiscounts - globalDiscountAmount;

  // Neuberechnung der Steuern basierend auf dem Gesamtrabatt
  // Der Gesamtrabatt wird proportional auf alle Steuersätze verteilt
  let totalTaxAmount = 0;
  
  if (globalDiscountAmount > 0 && subtotalAfterItemDiscounts > 0) {
    // Proportionale Verteilung des Gesamtrabatts
    const discountRatio = globalDiscountAmount / subtotalAfterItemDiscounts;
    
    Object.keys(taxBreakdown).forEach(taxRateStr => {
      const taxRate = Number(taxRateStr);
      const breakdown = taxBreakdown[taxRate];
      
      // Reduziere den steuerpflichtigen Betrag proportional
      const reducedTaxableAmount = breakdown.taxableAmount * (1 - discountRatio);
      const reducedTaxAmount = (reducedTaxableAmount * taxRate) / 100;
      
      breakdown.taxableAmount = reducedTaxableAmount;
      breakdown.taxAmount = reducedTaxAmount;
      totalTaxAmount += reducedTaxAmount;
    });
  } else {
    // Keine Gesamtrabatte, verwende ursprüngliche Steuerberechnung
    totalTaxAmount = Object.values(taxBreakdown).reduce((sum, breakdown) => sum + breakdown.taxAmount, 0);
  }

  const total = discountedSubtotal + totalTaxAmount;
  const totalDiscountAmount = itemDiscountAmount + globalDiscountAmount;

  return {
    subtotal,
    itemDiscountAmount,
    globalDiscountAmount,
    totalDiscountAmount,
    discountedSubtotal,
    taxAmount: totalTaxAmount,
    total
  };
}

/**
 * Aktualisiert ein InvoiceItem mit berechneten Rabattbeträgen
 */
export function updateItemWithDiscount(item: InvoiceItem): InvoiceItem {
  const discountAmount = calculateItemDiscount(
    item.quantity,
    item.unitPrice,
    item.discountType,
    item.discountValue
  );

  const itemTotal = item.quantity * item.unitPrice;
  
  return {
    ...item,
    discountAmount,
    total: itemTotal - discountAmount
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
