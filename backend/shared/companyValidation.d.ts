export type CompanyFormatField = 'email' | 'postalCode' | 'taxId' | 'bankAccount' | 'paymentInformation.bankAccount';
export type CompanyFormatErrors = Partial<Record<CompanyFormatField, string>>;
export type CompanyRequiredField = 'name' | 'address' | 'postalCode' | 'city' | 'country' | 'phone' | 'email' | 'taxBusinessType' | 'legalForm';
export type CompanyRequiredErrors = Partial<Record<CompanyRequiredField, string>>;
interface CompanyFormatInput {
  name?: unknown;
  address?: unknown;
  city?: unknown;
  phone?: unknown;
  taxBusinessType?: unknown;
  legalForm?: unknown;
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
export function validateCompanyRequiredFields(data: CompanyFormatInput): CompanyRequiredErrors;
