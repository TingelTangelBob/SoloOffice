/**
 * Tax calculation utilities for PDF generation
 */

import { Invoice, JobEntry } from '../../types';
import { calculateDocumentMoney } from '../../../backend/utils/documentMoney.js';

export interface TaxBreakdown {
  [taxRate: number]: {
    taxableAmount: number;
    taxAmount: number;
  };
}

/**
 * Calculate tax breakdown by rate for invoice items
 * @param items - Invoice items
 * @param invoice - Optional invoice object for global discount
 * @returns Tax breakdown by rate
 */
export function calculateTaxBreakdown(items: Invoice['items'], invoice?: Partial<Invoice>): TaxBreakdown {
  const result = calculateDocumentMoney({
    items,
    globalDiscountType: invoice?.globalDiscountType,
    globalDiscountValue: invoice?.globalDiscountValue,
    globalDiscountAmount: invoice?.globalDiscountAmount,
  }, {
    documentType: invoice?.documentType === 'credit_note' ? 'credit_note' : 'invoice',
  });
  if (invoice?.id && ((Number.isFinite(invoice.taxAmount) && Math.abs(result.taxAmount - Number(invoice.taxAmount)) > 0.005)
      || (Number.isFinite(invoice.total) && Math.abs(result.total - Number(invoice.total)) > 0.005))) {
    throw new Error('Die gespeicherten Dokumentbeträge stimmen nicht mit Positionen und Rabatten überein. Bitte prüfen Sie die Rechnung bzw. das Angebot. Ein Entwurf kann durch erneutes Speichern neu berechnet werden.');
  }
  return result.taxBreakdown;
}

/**
 * Calculate tax breakdown for job entries
 * @param job - Job entry
 * @param isSmallBusiness - Whether small business rules apply
 * @returns Tax breakdown by rate
 */
export function calculateJobTaxBreakdown(job: JobEntry, isSmallBusiness?: boolean): TaxBreakdown {
  const taxBreakdown: TaxBreakdown = {};
  
  // Process time entries (use job's legacy fields if no time entries exist)
  if (job.timeEntries && job.timeEntries.length > 0) {
    job.timeEntries.forEach(timeEntry => {
      const entryTotal = timeEntry.hoursWorked * timeEntry.hourlyRate;
      // Bei Kleinunternehmerregelung immer 0% MwSt.
      const taxRate = isSmallBusiness ? 0 : (timeEntry.taxRate != null ? timeEntry.taxRate : 19);
      const taxAmount = entryTotal * (taxRate / 100);
      
      if (taxBreakdown[taxRate]) {
        taxBreakdown[taxRate].taxableAmount += entryTotal;
        taxBreakdown[taxRate].taxAmount += taxAmount;
      } else {
        taxBreakdown[taxRate] = {
          taxableAmount: entryTotal,
          taxAmount: taxAmount
        };
      }
    });
  } else {
    // Legacy support: use hoursWorked and hourlyRate
    const laborTotal = job.hoursWorked * job.hourlyRate;
    // Bei Kleinunternehmerregelung immer 0% MwSt., sonst 19% als Fallback (Legacy-Jobs haben kein taxRate Feld)
    const taxRate = isSmallBusiness ? 0 : 19;
    const taxAmount = laborTotal * (taxRate / 100);
    
    taxBreakdown[taxRate] = {
      taxableAmount: laborTotal,
      taxAmount: taxAmount
    };
  }
  
  // Process materials
  if (job.materials) {
    job.materials.forEach(material => {
      const materialTotal = material.quantity * material.unitPrice;
      // Bei Kleinunternehmerregelung immer 0% MwSt.
      const taxRate = isSmallBusiness ? 0 : (material.taxRate != null ? material.taxRate : 19);
      const taxAmount = materialTotal * (taxRate / 100);
      
      if (taxBreakdown[taxRate]) {
        taxBreakdown[taxRate].taxableAmount += materialTotal;
        taxBreakdown[taxRate].taxAmount += taxAmount;
      } else {
        taxBreakdown[taxRate] = {
          taxableAmount: materialTotal,
          taxAmount: taxAmount
        };
      }
    });
  }
  
  return taxBreakdown;
}

/**
 * Check if any discounts exist in invoice items
 * @param items - Invoice items
 * @returns Whether discounts exist
 */
export function checkHasDiscounts(items: Invoice['items']): boolean {
  return items.some(item => 
    (item.discountAmount && item.discountAmount > 0) || 
    (item.discountValue && item.discountValue > 0)
  );
}

/**
 * Check if invoice has only 0% tax rate
 * @param items - Invoice items
 * @returns Whether only 0% tax rate is used
 */
export function hasOnlyZeroTaxRate(items: Invoice['items']): boolean {
  return items.length > 0 && items.every(item => item.taxRate === 0);
}
