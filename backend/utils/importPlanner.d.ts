export type PlannerResource =
  | 'customers' | 'jobs' | 'quotes' | 'positions' | 'hourlyRates' | 'materials'
  | 'euerEntries' | 'invoicePayments' | 'invoices';

export type PlannerStatus = 'valid' | 'update' | 'duplicate' | 'warning' | 'error';

export interface PlannerEntry {
  rowNumbers: number[];
  status: PlannerStatus;
  message: string;
  // Die Nutzdaten unterscheiden sich je Importziel und werden in der
  // Anwendungsschicht (Server oder Demo) ausgewertet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  existingId?: string;
}

export interface PlannerNewCustomer {
  key: string;
  name: string;
  customerNumber?: string;
  email?: string;
  rowNumbers: number[];
}

export interface PlannerMonthTotal {
  month: string;
  income: number;
  expense: number;
  invoicePayments: number;
  invoiced: number;
  count: number;
}

export interface PlannerTotals {
  income: number;
  expense: number;
  invoicePayments: number;
  invoiced: number;
  openAmount: number;
  byMonth: PlannerMonthTotal[];
}

export interface PlannerOptions {
  duplicateMode?: 'skip' | 'update';
  createMissingCustomers?: boolean;
  matchOpenInvoices?: boolean;
  createInvoiceCourses?: boolean;
}

export interface InvoiceCourseAction {
  action: 'create' | 'assign';
  jobId: string | null;
  customerKey?: string | null;
  date: string;
  title: string;
  description: string;
  hoursWorked: number;
  hourlyRate: number;
  itemOrder: number;
}

export interface PlannerContext {
  entityLabel?: string;
  workLabel?: string;
  today?: string;
  cutoverDate?: string | null;
  defaultPaymentDays?: number;
  customers?: Array<Record<string, unknown>>;
  jobs?: Array<Record<string, unknown>>;
  quotes?: Array<Record<string, unknown>>;
  hourlyRates?: Array<Record<string, unknown>>;
  materials?: Array<Record<string, unknown>>;
  positionTemplates?: Array<Record<string, unknown>>;
  euerEntries?: Array<Record<string, unknown>>;
  invoices?: Array<Record<string, unknown>>;
  reservedInvoiceNumbers?: string[];
}

export interface ImportPlan {
  resource: PlannerResource;
  options: Required<PlannerOptions>;
  entries: PlannerEntry[];
  newCustomers: PlannerNewCustomer[];
  totals: PlannerTotals | null;
  courseSummary?: { created: number; assigned: number } | null;
}

export interface PlannerSummary {
  total: number;
  valid: number;
  updated: number;
  duplicates: number;
  warnings: number;
  errors: number;
  imported: number;
  skipped: number;
  records: number;
  newCustomers: number;
}

export const IMPORT_RESOURCES: PlannerResource[];
export const UPDATEABLE_IMPORT_RESOURCES: PlannerResource[];
export const SETTINGS_IMPORT_RESOURCES: PlannerResource[];
export const CUSTOMER_CREATING_RESOURCES: PlannerResource[];
export const MAX_IMPORT_ROWS: number;
export const MAX_IMPORT_CELL_LENGTH: number;
export function createCustomerDirectory(customers?: Array<Record<string, unknown>>, options?: { createMissing?: boolean }): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolve: (ref: Record<string, string>, rowNumber: number) => any;
  newCustomers: () => PlannerNewCustomer[];
};
export function planImport(resource: PlannerResource, rows: Array<Record<string, unknown>>, context: PlannerContext, options?: PlannerOptions): ImportPlan;
export function planInvoiceCourses(invoice: { customerId?: string | null; customerKey?: string | null; date: string; items: Array<{ description?: string; quantity: number; unitPrice: number; order: number; unit?: string | null }> }, jobs: Array<Record<string, unknown>>): InvoiceCourseAction[];
export function isApplicable(entry: PlannerEntry): boolean;
export function summariseImport(plan: ImportPlan, total: number): PlannerSummary;
export function reportRows(plan: ImportPlan, imported?: boolean): Array<{ rowNumber: number; status: PlannerStatus | 'imported'; message: string }>;
