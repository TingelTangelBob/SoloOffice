// ============================================================================
// Base Types
// ============================================================================

export type UUID = string;
export type ISODateString = string;

export interface Timestamps {
  createdAt: Date;
  updatedAt?: Date;
}

// ============================================================================
// Customer Types
// ============================================================================

export interface CustomerEmail {
  id: UUID;
  email: string;
  label?: string;
  isActive: boolean;
}

export interface Customer extends Timestamps {
  id: UUID;
  customerNumber: string;
  name: string;
  email: string;
  address: string;
  addressSupplement?: string;
  city: string;
  postalCode: string;
  country: string;
  taxId?: string;
  phone?: string;
  additionalEmails?: CustomerEmail[];
  hourlyRates?: HourlyRate[];
  materials?: MaterialTemplate[];
}

// ============================================================================
// Invoice Types
// ============================================================================

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'reminded_1x' | 'reminded_2x' | 'reminded_3x';

export type DiscountType = 'percentage' | 'fixed';

export interface Discount {
  discountType?: DiscountType;
  discountValue?: number;
  discountAmount?: number;
}

export interface InvoiceItem extends Discount {
  id: UUID;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number;
  jobNumber?: string;
  externalJobNumber?: string;
  order: number;
}

export interface InvoiceAttachment {
  id: UUID;
  name: string;
  content: string; // Base64 encoded
  contentType: string;
  size: number;
  uploadedAt: Date;
}

export interface GlobalDiscount {
  globalDiscountType?: DiscountType;
  globalDiscountValue?: number;
  globalDiscountAmount?: number;
}

export interface Invoice extends Timestamps, GlobalDiscount {
  id: UUID;
  invoiceNumber: string;
  customerId: UUID;
  customerName: string;
  issueDate: Date;
  dueDate: Date;
  items: InvoiceItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  status: InvoiceStatus;
  notes?: string;
  attachments?: InvoiceAttachment[];
  // Reminder fields
  lastReminderDate?: Date;
  lastReminderSentAt?: Date;
  maxReminderStage?: number;
}

// ============================================================================
// Quote Types
// ============================================================================

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'billed';

export interface QuoteItem extends Discount {
  id: UUID;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number;
  order: number;
}

export interface QuoteAttachment {
  id: UUID;
  name: string;
  content: string; // Base64 encoded
  contentType: string;
  size: number;
  uploadedAt: Date;
}

export interface Quote extends Timestamps, GlobalDiscount {
  id: UUID;
  quoteNumber: string;
  customerId: UUID;
  customerName: string;
  issueDate: Date;
  validUntil: Date;
  items: QuoteItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  status: QuoteStatus;
  notes?: string;
  attachments?: QuoteAttachment[];
  convertedToInvoiceId?: UUID;
}

// ============================================================================
// Job Types
// ============================================================================

export type JobStatus = 'draft' | 'in-progress' | 'completed' | 'invoiced';
export type JobPriority = 'low' | 'medium' | 'high';

export interface JobAttachment {
  id: UUID;
  name: string;
  content: string; // Base64 encoded
  contentType: string;
  size: number;
  uploadedAt: Date;
}

export interface JobSignature {
  id: UUID;
  customerName: string;
  signatureData: string; // Base64 encoded signature image
  signedAt: Date;
  ipAddress?: string;
}

export interface JobMaterial extends Discount {
  id: UUID;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number;
  unit?: string;
  templateId?: UUID;
}

export interface JobTimeEntry extends Discount {
  id: UUID;
  description: string;
  startTime?: string;
  endTime?: string;
  hoursWorked: number;
  hourlyRate: number;
  hourlyRateId?: UUID;
  taxRate: number;
  total: number;
}

export interface JobEntry extends Timestamps {
  id: UUID;
  jobNumber: string;
  externalJobNumber?: string;
  customerId: UUID;
  customerName: string;
  customerAddress?: string;
  title: string;
  description: string;
  date: Date;
  startTime?: string;
  endTime?: string;
  hoursWorked: number;
  hourlyRate: number;
  hourlyRateId?: UUID;
  timeEntries?: JobTimeEntry[];
  materials?: JobMaterial[];
  status: JobStatus;
  notes?: string;
  attachments?: JobAttachment[];
  signature?: JobSignature;
  tags?: string[];
  priority?: JobPriority;
  estimatedHours?: number;
  actualHours?: number;
  location?: string;
}

export type CalendarEventType = 'vacation';

export interface CalendarEvent extends Timestamps {
  id: UUID;
  eventType: CalendarEventType;
  title: string;
  startDate: string;
  endDate: string;
  notes?: string;
  allDay?: boolean;
}

export interface JobInvoiceGeneration {
  type: 'single' | 'daily' | 'weekly' | 'monthly';
  jobIds: UUID[];
  date?: Date;
  customerId: UUID;
}

// ============================================================================
// Company Types
// ============================================================================

export type Locale = 'de-DE' | 'en-US' | 'fr-FR' | 'es-ES';

export interface PaymentInformation {
  accountHolder?: string;
  bankAccount?: string; // IBAN
  bic?: string;
  bankName?: string;
  paymentTerms?: string;
  paymentMethods?: string[];
}

export interface ReminderSettings {
  remindersEnabled?: boolean;
  reminderDaysAfterDue?: number;
  reminderDaysBetween?: number;
  reminderFeeStage1?: number;
  reminderFeeStage2?: number;
  reminderFeeStage3?: number;
  reminderTextStage1?: string;
  reminderTextStage2?: string;
  reminderTextStage3?: string;
}

export interface CompanyHeader {
  companyHeaderTwoLine?: boolean;
  companyHeaderLine1?: string;
  companyHeaderLine2?: string;
}

export interface Company extends ReminderSettings, CompanyHeader {
  name: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string;
  website?: string;
  taxId: string; // USt-IdNr.
  taxIdentificationNumber?: string; // Steuernummer
  logo?: string | null;
  icon?: string | null;
  locale?: Locale;
  primaryColor?: string;
  secondaryColor?: string;
  // Feature flags
  jobTrackingEnabled?: boolean;
  reportingEnabled?: boolean;
  quotesEnabled?: boolean;
  discountsEnabled?: boolean;
  showCombinedDropdowns?: boolean;
  isSmallBusiness?: boolean;
  // Payment settings
  defaultPaymentDays?: number;
  immediatePaymentClause?: string;
  invoiceStartNumber?: number;
  paymentInformation?: PaymentInformation;
  // Templates
  hourlyRates?: HourlyRate[];
  materialTemplates?: MaterialTemplate[];
  invoiceTemplates?: InvoiceTemplate[];
  // Legacy fields (deprecated)
  bankAccount?: string;
  bic?: string;
}

// ============================================================================
// Template Types
// ============================================================================

export interface HourlyRate {
  id: UUID;
  name: string;
  description?: string;
  rate: number;
  taxRate?: number;
  isDefault?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MaterialTemplate {
  id: UUID;
  name: string;
  description?: string;
  unitPrice: number;
  unit: string;
  taxRate?: number;
  isDefault?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface InvoiceTemplate {
  id: UUID;
  name: string;
  description?: string;
  unitPrice: number;
  unit: string;
  taxRate: number;
  isDefault?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface YearlyInvoiceStartNumber {
  id: number;
  year: number;
  start_number: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Export Types
// ============================================================================

export type ExportFormat = 'zugferd' | 'xrechnung';

// ============================================================================
// Reporting Types
// ============================================================================

export interface InvoiceJournalEntry {
  id: UUID;
  invoiceNumber: string;
  customerName: string;
  customerNumber?: string;
  issueDate: Date;
  dueDate: Date;
  subtotal: number;
  taxAmount: number;
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue';
  paidAmount: number;
  overdueAmount: number;
  outstandingAmount: number;
  createdAt: Date;
}

export interface InvoiceJournalSummary {
  totalInvoices: number;
  totalAmount: number;
  paidAmount: number;
  overdueAmount: number;
  outstandingAmount: number;
  subtotalSum: number;
  taxSum: number;
}

export interface InvoiceJournalResponse {
  invoices: InvoiceJournalEntry[];
  summary: InvoiceJournalSummary;
  dateRange: {
    startDate: string | null;
    endDate: string | null;
  };
}

export interface MonthlyRevenueStats {
  month: number;
  invoiceCount: number;
  subtotalSum: number;
  taxSum: number;
  totalSum: number;
  paidSum: number;
  overdueSum: number;
}

export interface CustomerStats {
  customerId: UUID;
  customerName: string;
  invoiceCount: number;
  totalRevenue: number;
  avgInvoiceAmount: number;
}

export interface StatusDistribution {
  status: 'draft' | 'sent' | 'paid' | 'overdue';
  count: number;
  totalAmount: number;
}

export interface YearOverview {
  totalInvoices: number;
  totalSubtotal: number;
  totalTax: number;
  totalAmount: number;
  paidAmount: number;
  overdueAmount: number;
  avgInvoiceAmount: number;
}

export interface ReportingStatistics {
  year: number;
  monthlyRevenue: MonthlyRevenueStats[];
  topCustomers: CustomerStats[];
  statusDistribution: StatusDistribution[];
  yearOverview: YearOverview | null;
}

// ============================================================================
// Reminder Types
// ============================================================================

export type ReminderStage = 1 | 2 | 3;

export interface ReminderEligibility {
  invoiceId: UUID;
  invoiceNumber: string;
  customerId: UUID;
  customerName: string;
  dueDate: Date;
  total: number;
  currentStatus: InvoiceStatus;
  nextStage: ReminderStage;
  daysSinceDue: number;
  daysSinceLastReminder?: number;
  isEligible: boolean;
  nextEligibleDate?: Date;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Make some properties optional
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Make some properties required
 */
export type RequiredBy<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

/**
 * Create input type for new entities (without id and timestamps)
 */
export type CreateInput<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Create update input type (all fields optional except id)
 */
export type UpdateInput<T> = Partial<Omit<T, 'id'>> & { id: UUID };
