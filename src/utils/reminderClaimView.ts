import type { Company, Customer, Invoice } from '../types';
import { calculateReminderClaim, type ReminderClaim } from '../../backend/shared/reminderClaim.js';
import { formatDateInputValue } from './invoicePeriod';

/**
 * Forderungsaufstellung einer Mahnung für Mahndialog, Mahnliste, PDF und E-Mail.
 * Zahlungsdaten einzelner Teilzahlungen liegen im Frontend nicht vor; die Zinsen
 * werden daher aus dem aktuellen offenen Betrag über den gesamten Verzug berechnet.
 */
export function reminderClaimFor(
  company: Pick<Company, 'reminderFeeStage1' | 'reminderFeeStage2' | 'reminderFeeStage3' | 'reminderInterestEnabled' | 'reminderBaseInterestRate'>,
  invoice: Pick<Invoice, 'total' | 'paidAmount' | 'outstandingAmount' | 'dueDate'> & Partial<Pick<Invoice, 'status'>>,
  customer: Pick<Customer, 'customerType'> | undefined,
  stage: number,
  asOf: Date = new Date(),
): ReminderClaim {
  return calculateReminderClaim({
    invoice: { ...invoice, dueDate: invoice.dueDate as Date | string },
    stage,
    settings: company,
    customerType: customer?.customerType,
    asOfDate: formatDateInputValue(asOf),
  });
}
