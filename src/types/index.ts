// ============================================================================
// Base Types
// ============================================================================

export type UUID = string;
export type ISODateString = string;
export type TerminologyProfile = 'customers' | 'mandants' | 'patients' | 'students' | 'clients';
export type TerminologyColorSource = 'appearance' | 'profile';

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
  leitwegId?: string;
  phone?: string;
  isActive?: boolean;
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

export interface InvoiceJobSource {
  id: UUID;
  jobId: UUID;
  jobNumber: string;
  externalJobNumber?: string;
  title: string;
  jobDate: Date;
  recurrenceIndex?: number;
}

export type InvoiceItemPayload = Omit<InvoiceItem, 'id' | 'total'> & Partial<Pick<InvoiceItem, 'id' | 'total'>>;

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
  sourceJobs?: InvoiceJobSource[];
  // Reminder fields
  lastReminderDate?: Date;
  lastReminderSentAt?: Date;
  maxReminderStage?: number;
  /** Shared document metadata used by credit notes and recurring invoices. */
  documentType?: 'invoice' | 'credit_note';
  referenceInvoiceId?: UUID | null;
  referenceInvoiceNumber?: string;
  sourceQuoteId?: UUID | null;
  sourceQuoteNumber?: string;
  creditNoteReason?: string;
  recurringInvoiceId?: UUID;
}

export type CreditNote = Invoice & { documentType: 'credit_note' };

// ============================================================================
// Recurring Invoice Types
// ============================================================================

export type RecurringInvoiceFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'custom';
export type RecurringInvoiceIntervalUnit = 'day' | 'week' | 'month' | 'year';
export type RecurringInvoiceStatus = 'active' | 'paused' | 'ended';
export type RecurringInvoiceRunStatus = 'success' | 'failed';

export interface RecurringInvoice extends Timestamps, GlobalDiscount {
  id: UUID;
  name: string;
  customerId: UUID;
  customerName: string;
  items: InvoiceItem[];
  frequency: RecurringInvoiceFrequency;
  intervalValue: number;
  intervalUnit: RecurringInvoiceIntervalUnit;
  startDate: Date;
  endDate?: Date;
  nextRunDate: Date;
  lastRunDate?: Date;
  dueDays: number;
  notes?: string;
  status: RecurringInvoiceStatus;
}

export interface RecurringInvoiceRun {
  id: UUID;
  recurringInvoiceId: UUID;
  invoiceId?: UUID;
  invoiceNumber?: string;
  scheduledDate: Date;
  status: RecurringInvoiceRunStatus;
  errorMessage?: string;
  createdAt: Date;
}

export interface RecurringInvoicePayload {
  name: string;
  customerId: UUID;
  items: InvoiceItemPayload[];
  frequency: RecurringInvoiceFrequency;
  intervalValue?: number;
  intervalUnit?: RecurringInvoiceIntervalUnit;
  startDate: Date | string;
  endDate?: Date | string | null;
  nextRunDate?: Date | string;
  dueDays?: number;
  notes?: string;
  status?: RecurringInvoiceStatus;
  globalDiscountType?: DiscountType;
  globalDiscountValue?: number;
  globalDiscountAmount?: number;
}

export interface CreditNotePayload {
  customerId: UUID;
  referenceInvoiceId?: UUID | null;
  creditNoteReason: string;
  issueDate: Date | string;
  dueDate?: Date | string;
  items: InvoiceItemPayload[];
  notes?: string;
  status?: InvoiceStatus;
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

/**
 * A schedule for a series of concrete job/course units.
 * Weekdays use ISO values: Monday = 1 ... Sunday = 7.
 */
export interface JobRecurrenceRule {
  intervalUnit: 'week' | 'month' | 'year';
  interval: number;
  weekdays?: number[];
  startDate: string;
  duration?: number;
  /** Legacy field used by already stored weekly rules. */
  durationWeeks?: number;
}

export interface JobRecurrence extends JobRecurrenceRule {
  id?: UUID;
  occurrenceIndex?: number;
  totalOccurrences?: number;
}

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
  alternateLocation?: string;
  timeZone?: string;
  recurrence?: JobRecurrence | null;
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
export type NumberFormat = 'european' | 'american';
export type DateFormat = 'DD.MM.YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
export type TimeFormat = '24h' | '12h';
export type ThemeMode = 'system' | 'light' | 'dark';
export type PaymentInformationMode = 'separate' | 'company';
export type TaxBusinessType = 'freelance' | 'commercial' | 'agriculture' | 'nonprofit' | 'other';
export type LegalForm = 'sole_proprietorship' | 'partnership' | 'gbr' | 'ug' | 'gmbh' | 'ag' | 'eg' | 'nonprofit' | 'other';

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
  taxBusinessType?: TaxBusinessType;
  legalForm?: LegalForm;
  logo?: string | null;
  icon?: string | null;
  terminologyProfile?: TerminologyProfile;
  terminologyColorSource?: TerminologyColorSource;
  /** Custom label for the receipt/document area in navigation and copy. */
  receiptLabel?: string;
  locale?: Locale;
  numberFormat?: NumberFormat;
  currency?: string;
  dateFormat?: DateFormat;
  timeFormat?: TimeFormat;
  timeZone?: string;
  primaryColor?: string;
  secondaryColor?: string;
  themeMode?: ThemeMode;
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
  paymentInformationMode?: PaymentInformationMode;
  // Invoice position templates
  invoiceTemplates?: InvoiceTemplate[];
  // Document templates for invoices, quotes and reminders
  documentTemplates?: DocumentTemplate[];
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

export type DocumentTemplateType = 'invoice' | 'quote' | 'reminder' | 'orderConfirmation';
export type DocumentLayout =
  | 'classic'
  | 'minimal'
  | 'editorial'
  | 'modern'
  | 'compact'
  | 'split'
  | 'bold'
  | 'air'
  | 'frame';
export type DocumentLogoMode = 'company' | 'none';
export type DocumentHeaderAlignment = 'left' | 'center' | 'split';
export type DocumentTableStyle = 'light' | 'dark' | 'accent';

export interface ReminderTemplateTexts {
  stage1?: string;
  stage2?: string;
  stage3?: string;
}

export interface DocumentTemplate {
  id: UUID;
  documentType: DocumentTemplateType;
  name: string;
  description?: string;
  subject?: string;
  introText?: string;
  closingText?: string;
  paymentTerms?: string;
  /** Visual PDF layout profile. Older templates without these fields use a safe default. */
  layout?: DocumentLayout;
  accentColor?: string;
  logoMode?: DocumentLogoMode;
  headerAlignment?: DocumentHeaderAlignment;
  tableStyle?: DocumentTableStyle;
  showPaymentInformation?: boolean;
  showFooter?: boolean;
  reminderTexts?: ReminderTemplateTexts;
  reminderStage?: 1 | 2 | 3;
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
// Import Types
// ============================================================================

export type ImportResource = 'customers' | 'jobs' | 'quotes' | 'positions' | 'hourlyRates' | 'materials' | 'euerEntries';
export type ImportDuplicateMode = 'skip' | 'update';
export type ImportRowStatus = 'valid' | 'update' | 'duplicate' | 'warning' | 'error' | 'imported';

export interface ImportRowResult {
  rowNumber: number;
  status: ImportRowStatus;
  message: string;
}

export interface ImportSummary {
  total: number;
  valid: number;
  updated: number;
  duplicates: number;
  warnings: number;
  errors: number;
  imported: number;
  skipped: number;
}

export interface ImportResponse {
  resource: ImportResource;
  dryRun: boolean;
  summary: ImportSummary;
  rows: ImportRowResult[];
  truncated?: boolean;
}

// ============================================================================
// Identity and workspace types
// ============================================================================

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface AuthUser {
  id: UUID;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  createdAt?: string;
}

export interface WorkspaceSummary {
  id: UUID;
  name: string;
  slug: string;
  role: WorkspaceRole;
  permissions?: Record<string, boolean>;
  createdAt?: string;
}

export interface AuthResponse {
  user: AuthUser;
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
}

export interface RegistrationResponse {
  user?: AuthUser;
  workspace?: WorkspaceSummary;
  workspaces?: WorkspaceSummary[];
  verificationRequired?: boolean;
  message?: string;
}

export interface WorkspaceMember {
  id: UUID;
  email: string;
  firstName: string;
  lastName: string;
  role: WorkspaceRole;
  permissions?: Record<string, boolean>;
  joinedAt?: string;
}

export interface WorkspaceInvitation {
  id: UUID;
  email: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  expiresAt: string;
  acceptedAt?: string;
  createdAt?: string;
  inviteToken?: string;
  inviteLink?: string;
}

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
// EÜR Types
// ============================================================================

export type EuerEntryType = 'income' | 'expense';

export type EuerEntryCategory =
  | 'other_income'
  | 'materials'
  | 'office'
  | 'software'
  | 'telecommunications'
  | 'travel'
  | 'vehicle'
  | 'marketing'
  | 'professional_services'
  | 'insurance'
  | 'bank_fees'
  | 'other_expense';

export interface EuerEntry extends Timestamps {
  id: UUID;
  entryType: EuerEntryType;
  entryDate: Date;
  description: string;
  category: EuerEntryCategory;
  amount: number;
  taxRate: number;
  notes?: string;
  sourceType?: EuerEntrySourceType;
  sourceId?: UUID;
  status?: 'active' | 'voided';
  correctionReason?: string;
}

export type EuerEntrySourceType = 'manual' | 'invoice_payment' | 'receipt' | 'correction';

export interface EuerEntryHistory {
  id: UUID;
  euerEntryId?: UUID;
  action: 'created' | 'updated' | 'voided';
  reason?: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  changedAt: Date;
}

export interface EuerEntryPayload {
  entryType: EuerEntryType;
  entryDate: Date | string;
  description: string;
  category: EuerEntryCategory;
  amount: number;
  taxRate?: number;
  notes?: string;
  sourceType?: EuerEntrySourceType;
  sourceId?: UUID;
  correctionReason?: string;
}

// ============================================================================
// Fixed asset register types
// ============================================================================

export type FixedAssetStatus = 'active' | 'disposed';

export interface FixedAsset extends Timestamps {
  id: UUID;
  name: string;
  category: string;
  acquisitionDate: string;
  acquisitionCost: number;
  usefulLifeYears: number;
  status: FixedAssetStatus;
  disposalDate?: string;
  notes?: string;
}

export interface FixedAssetPayload {
  name: string;
  category: string;
  acquisitionDate: string;
  acquisitionCost: number;
  usefulLifeYears: number;
  status?: FixedAssetStatus;
  disposalDate?: string;
  notes?: string;
}

// ============================================================================
// Receipt and local OCR Types
// ============================================================================

export type ReceiptOcrStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ReceiptExtractedData {
  vendorName?: string;
  documentDate?: string;
  documentNumber?: string;
  netAmount?: number;
  taxAmount?: number;
  grossAmount?: number;
  taxRate?: number;
  currency?: string;
  suggestedCategory?: EuerEntryCategory;
}

export interface Receipt extends Timestamps {
  id: UUID;
  name: string;
  contentType: string;
  size: number;
  ocrStatus: ReceiptOcrStatus;
  ocrText?: string;
  ocrConfidence?: number;
  ocrError?: string;
  extractedData: ReceiptExtractedData;
  /** Original values produced by the latest OCR run, before manual corrections. */
  ocrExtractedData?: ReceiptExtractedData;
  linkedEuerEntryId?: UUID | null;
  /** Only present when a receipt detail is requested. */
  content?: string;
}

export interface ReceiptPayload {
  name: string;
  content: string;
  contentType: string;
  size: number;
}

export interface ReceiptUpdatePayload {
  extractedData?: ReceiptExtractedData;
  ocrText?: string;
  linkedEuerEntryId?: UUID | null;
}

export type IncomingEInvoiceFormat = 'XRechnung' | 'ZUGFeRD';
export type IncomingEInvoiceValidationStatus = 'validated' | 'rejected';

export interface IncomingEInvoice {
  id: UUID;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  format: IncomingEInvoiceFormat;
  validationStatus: IncomingEInvoiceValidationStatus;
  validationError?: string;
  invoiceNumber?: string;
  issueDate?: string;
  currency?: string;
  supplierName?: string;
  supplierTaxId?: string;
  buyerReference?: string;
  grossAmount?: number;
  extractedData: Record<string, unknown>;
  linkedCustomerId?: UUID;
  receivedAt: string;
  updatedAt: string;
  content?: string;
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
