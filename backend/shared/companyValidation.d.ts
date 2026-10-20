export type CompanyFormatField = 'email' | 'postalCode' | 'taxId' | 'bankAccount' | 'paymentInformation.bankAccount';
export type CompanyFormatErrors = Partial<Record<CompanyFormatField, string>>;
interface CompanyFormatInput {
  email?: unknown;
  postalCode?: unknown;
  country?: unknown;
  taxId?: unknown;
  bankAccount?: unknown;
  paymentInformation?: { bankAccount?: unknown } | null;
}
export function emailFormatError(value: unknown): string | null;
export function isGermanCountry(country: unknown): boolean;
export function postalCodeFormatError(value: unknown, country?: unknown): string | null;
export function vatIdFormatError(value: unknown): string | null;
export function ibanFormatError(value: unknown): string | null;
export function validateCompanyFormats(data: CompanyFormatInput, context?: Pick<CompanyFormatInput, 'country' | 'postalCode'>): CompanyFormatErrors;
