export type DashboardSize = 'quarter' | 'third' | 'half' | 'two-thirds' | 'three-quarters' | 'full';

export type DashboardQuickItemId =
  | 'quick-invoice' | 'quick-receipt' | 'quick-customer' | 'quick-course'
  | 'quick-quote' | 'quick-calendar' | 'quick-credit-note' | 'quick-euer' | 'quick-import';

export type DashboardCardItemId =
  | 'revenue' | 'top-customers' | 'week-calendar' | 'recent-jobs' | 'recent-invoices' | 'course-series'
  | 'open-invoices' | 'income-expense' | 'upcoming-jobs' | 'open-quotes' | 'unbilled-jobs'
  | 'average-invoice' | 'active-customers' | 'recent-receipts'
  | 'taxes' | 'tax-reserve' | 'tax-position' | 'small-business' | 'fixed-costs' | 'tax-advances' | 'health-backpayment';

export type DashboardItemId = DashboardQuickItemId | DashboardCardItemId;

export interface DashboardItemDefinition {
  id: DashboardItemId;
  group: 'quick' | 'card';
  defaultVisible: boolean;
  defaultSize?: DashboardSize;
  sizes?: readonly DashboardSize[];
  requiredExtension?: 'taxes';
}

export interface DashboardItemPreference {
  id: DashboardItemId;
  visible: boolean;
  size?: DashboardSize;
}

export interface DashboardPreferences {
  version: number;
  items: DashboardItemPreference[];
  includeUnpaidInvoices: boolean;
  comparePrevious: boolean;
  year: number | 'all' | null;
  showPrivateLevies: boolean;
  showFixedCosts: boolean;
  showSocialContributions: boolean;
  showTaxReserve: boolean;
  showVatReserve: boolean;
  showAvailable: boolean;
  monthView: boolean;
  month: string | null;
  compareMonth: string | null;
}

export const DASHBOARD_PREFERENCES_VERSION: number;
export const DASHBOARD_PREFERENCES_MAX_BYTES: number;
export const DASHBOARD_SIZE_SPANS: Readonly<Record<DashboardSize, number>>;
export const DASHBOARD_SIZES: readonly DashboardSize[];
export const DASHBOARD_ITEM_DEFINITIONS: readonly DashboardItemDefinition[];
export const DASHBOARD_PREFERENCE_IDS: readonly DashboardItemId[];
export const DEFAULT_DASHBOARD_PREFERENCES: Readonly<DashboardPreferences>;
export function getDashboardItemDefinition(id: string): DashboardItemDefinition | null;
export function validDashboardSize(id: string, size: unknown): DashboardSize | null;
export function normalizeDashboardPreferences(value: unknown): DashboardPreferences;
