import { Customer } from '../types';

export function findDuplicateCustomer(
  customers: Customer[], 
  newCustomer: { name: string; email: string; address: string; postalCode: string; city: string }, 
  excludeId?: string
): Customer | null {
  return customers.find(existing => {
    // Exclude the current customer being edited
    if (existing.id === excludeId) return false;
    
    // 1. Name muss gleich sein
    const nameMatches = existing.name.toLowerCase() === newCustomer.name.toLowerCase();
    if (!nameMatches) return false;
    
    // 2. Adresse muss gleich sein (address + PLZ + Stadt)
    const addressMatches = 
      existing.address.toLowerCase() === newCustomer.address.toLowerCase() &&
      existing.postalCode.toLowerCase() === newCustomer.postalCode.toLowerCase() &&
      existing.city.toLowerCase() === newCustomer.city.toLowerCase();
    if (!addressMatches) return false;
    
    // 3. E-Mail muss gleich sein (leere E-Mails gelten als gleich)
    const existingEmail = (existing.email || '').toLowerCase();
    const newEmail = (newCustomer.email || '').toLowerCase();
    const emailMatches = existingEmail === newEmail;
    
    return emailMatches;
  }) || null;
}

/**
 * Beschreibt den gefundenen Doppeleintrag. Die Funktion baut nur den Text; ob
 * er als Rückfrage oder als Hinweis erscheint, entscheidet die aufrufende
 * Ansicht.
 */
export function buildDuplicateCustomerMessage(
  duplicateCustomer: Customer,
  entityLabel: string,
  numberLabel: string
): string {
  return [
    `Ein ${entityLabel} mit identischen Daten existiert bereits:`,
    '',
    `Name: ${duplicateCustomer.name}`,
    `Adresse: ${duplicateCustomer.address}, ${duplicateCustomer.postalCode} ${duplicateCustomer.city}`,
    `E-Mail: ${duplicateCustomer.email || 'Nicht angegeben'}`,
    `${numberLabel}: ${formatCustomerNumber(duplicateCustomer.customerNumber)}`,
  ].join('\n');
}

/**
 * Formats customer number to always display as 4 digits with leading zeros
 * @param customerNumber - The customer number to format
 * @returns Formatted customer number (e.g., "0001", "0042", "1234")
 */
export function formatCustomerNumber(customerNumber: string | number): string {
  if (!customerNumber) return '0000';
  
  const numericValue = typeof customerNumber === 'string' ? parseInt(customerNumber) : customerNumber;
  
  if (isNaN(numericValue)) return customerNumber.toString();
  
  return String(numericValue).padStart(4, '0');
}
