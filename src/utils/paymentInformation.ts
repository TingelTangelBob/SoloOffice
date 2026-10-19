import { Company, PaymentInformation } from '../types';

/**
 * Resolve the payment details used in documents. In company mode the account
 * holder follows the current company name; bank details remain editable.
 */
export function getEffectivePaymentInformation(company: Company): PaymentInformation {
  const configured = company.paymentInformation || {};
  const isCompanyMode = company.paymentInformationMode === 'company';

  return {
    ...configured,
    accountHolder: isCompanyMode
      ? company.name
      : (configured.accountHolder || company.name),
    bankAccount: isCompanyMode
      ? (company.bankAccount || configured.bankAccount)
      : (configured.bankAccount || company.bankAccount),
    bic: isCompanyMode
      ? (company.bic || configured.bic)
      : (configured.bic || company.bic),
  };
}

/** Zerlegt den Eingabetext der Zahlungsarten an Kommas. Leere Einträge entfallen. */
export function parsePaymentMethods(text: string): string[] {
  return text.split(',').map(method => method.trim()).filter(Boolean);
}
