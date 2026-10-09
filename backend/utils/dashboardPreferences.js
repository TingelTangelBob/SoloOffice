export const DASHBOARD_PREFERENCE_IDS = Object.freeze([
  'quick-invoice', 'quick-receipt', 'quick-customer', 'quick-course',
  'revenue', 'top-customers', 'week-calendar', 'recent-jobs', 'recent-invoices', 'course-series',
]);

export const DEFAULT_DASHBOARD_PREFERENCES = Object.freeze({
  items: DASHBOARD_PREFERENCE_IDS.map(id => ({ id, visible: true })),
  includeUnpaidInvoices: false,
  comparePrevious: false,
  year: null,
});

export function normalizeDashboardPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return structuredClone(DEFAULT_DASHBOARD_PREFERENCES);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 4096) return structuredClone(DEFAULT_DASHBOARD_PREFERENCES);
  const entries = Array.isArray(value.items) ? value.items.slice(0, DASHBOARD_PREFERENCE_IDS.length * 2) : [];
  const provided = new Map();
  for (const item of entries) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (DASHBOARD_PREFERENCE_IDS.includes(item.id) && typeof item.visible === 'boolean' && !provided.has(item.id)) {
      provided.set(item.id, item.visible);
    }
  }
  const year = value.year === 'all' ? 'all'
    : Number.isInteger(value.year) && value.year >= 2000 && value.year <= 2200 ? value.year : null;
  const normalized = {
    items: [
      ...[...new Set(entries.map(item => item?.id).filter(id => DASHBOARD_PREFERENCE_IDS.includes(id) && provided.has(id)))].map(id => ({ id, visible: provided.get(id) })),
      ...DASHBOARD_PREFERENCE_IDS.filter(id => !provided.has(id)).map(id => ({ id, visible: true })),
    ],
    includeUnpaidInvoices: value.includeUnpaidInvoices === true,
    comparePrevious: value.comparePrevious === true && year !== 'all',
    year,
  };
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > 4096) return structuredClone(DEFAULT_DASHBOARD_PREFERENCES);
  return normalized;
}
