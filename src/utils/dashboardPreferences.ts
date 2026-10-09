export const DASHBOARD_ITEMS = [
  'quick-invoice', 'quick-receipt', 'quick-customer', 'quick-course',
  'revenue', 'top-customers', 'week-calendar', 'recent-jobs', 'recent-invoices', 'course-series',
] as const;

export type DashboardItemId = typeof DASHBOARD_ITEMS[number];
export type DashboardPreferences = {
  items: { id: DashboardItemId; visible: boolean }[];
  includeUnpaidInvoices: boolean;
  comparePrevious: boolean;
  year: number | 'all' | null;
};

export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = {
  items: DASHBOARD_ITEMS.map(id => ({ id, visible: true })),
  includeUnpaidInvoices: false,
  comparePrevious: false,
  year: null,
};

export function normalizeDashboardPreferences(value: unknown): DashboardPreferences {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  try {
    if (new TextEncoder().encode(JSON.stringify(source)).length > 4096) return structuredClone(DEFAULT_DASHBOARD_PREFERENCES);
  } catch {
    return structuredClone(DEFAULT_DASHBOARD_PREFERENCES);
  }
  const itemValues = Array.isArray(source.items) ? source.items : [];
  const provided = new Map<string, boolean>();
  itemValues.slice(0, DASHBOARD_ITEMS.length * 2).forEach(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const record = item as Record<string, unknown>;
    if (typeof record.id === 'string' && DASHBOARD_ITEMS.includes(record.id as DashboardItemId)
      && typeof record.visible === 'boolean' && !provided.has(record.id)) {
      provided.set(record.id, record.visible);
    }
  });
  const year = source.year === 'all' || source.year === null || source.year === undefined
    ? (source.year === 'all' ? 'all' : null)
    : Number.isInteger(source.year) && Number(source.year) >= 2000 && Number(source.year) <= 2200
      ? Number(source.year)
      : null;
  const orderedIds = itemValues.slice(0, DASHBOARD_ITEMS.length * 2).flatMap(item => item && typeof item === 'object' && !Array.isArray(item)
    && typeof (item as Record<string, unknown>).id === 'string'
    && DASHBOARD_ITEMS.includes((item as Record<string, unknown>).id as DashboardItemId)
    && provided.has((item as Record<string, unknown>).id as string)
    ? [(item as Record<string, unknown>).id as DashboardItemId] : []);
  const uniqueOrderedIds = [...new Set(orderedIds)];
  return {
    items: [
      ...uniqueOrderedIds.map(id => ({ id, visible: provided.get(id)! })),
      ...DASHBOARD_ITEMS.filter(id => !provided.has(id)).map(id => ({ id, visible: true })),
    ],
    includeUnpaidInvoices: source.includeUnpaidInvoices === true,
    comparePrevious: source.comparePrevious === true && year !== 'all',
    year,
  };
}
