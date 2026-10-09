export type DashboardPeriodPreferences = {
  year?: number | 'all' | null;
  monthView?: boolean;
  month?: string | null;
  compareMonth?: string | null;
};

export interface DashboardPeriod {
  monthKeys: string[];
  selectedMonth: string;
  comparisonMonth: string;
  selectedYear: number;
  allYears: boolean;
}

export function toDashboardMonthKey(value: Date | string | number): string | null {
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    date = new Date(`${value.slice(0, 10)}T00:00:00`);
  } else date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function createDashboardMonthKeys(anchor: Date = new Date()): string[] {
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(anchor.getFullYear(), anchor.getMonth() - 11 + index, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });
}

export function getDefaultDashboardComparisonMonth(monthKeys: string[], selectedMonth: string): string {
  const selectedIndex = monthKeys.indexOf(selectedMonth);
  if (selectedIndex < 0) return monthKeys[monthKeys.length - 1] ?? selectedMonth;
  if (selectedIndex > 0) return monthKeys[selectedIndex - 1];
  return monthKeys[1] ?? selectedMonth;
}

export function moveDashboardMonthSelection(
  monthKeys: string[],
  selectedMonth: string,
  comparisonMonth: string,
  nextMonth: string,
): { selectedMonth: string; comparisonMonth: string } {
  if (!monthKeys.includes(nextMonth)) return { selectedMonth, comparisonMonth };
  return {
    selectedMonth: nextMonth,
    comparisonMonth: comparisonMonth === nextMonth
      ? getDefaultDashboardComparisonMonth(monthKeys, nextMonth)
      : comparisonMonth,
  };
}

export function resolveDashboardPeriod(
  preferences: DashboardPeriodPreferences,
  anchor: Date = new Date(),
): DashboardPeriod {
  const monthKeys = createDashboardMonthKeys(anchor);
  // Monatsvergleich startet mit einem abgeschlossenen Monat; laufende Monate bleiben wählbar.
  const latestMonth = monthKeys[monthKeys.length - 2] ?? monthKeys[monthKeys.length - 1];
  const selectedMonth = preferences.monthView && monthKeys.includes(preferences.month ?? '')
    ? preferences.month!
    : latestMonth;
  const comparisonMonth = preferences.compareMonth !== selectedMonth && monthKeys.includes(preferences.compareMonth ?? '')
    ? preferences.compareMonth!
    : getDefaultDashboardComparisonMonth(monthKeys, selectedMonth);
  const selectedYear = preferences.monthView
    ? Number(selectedMonth.slice(0, 4))
    : typeof preferences.year === 'number' ? preferences.year : anchor.getFullYear();
  return {
    monthKeys,
    selectedMonth,
    comparisonMonth,
    selectedYear,
    allYears: preferences.year === 'all' && !preferences.monthView,
  };
}

export function filterDashboardRecordsByMonth<T>(
  records: T[],
  month: string,
  getDate: (record: T) => Date | string | number,
): T[] {
  return records.filter(record => toDashboardMonthKey(getDate(record)) === month);
}

export function sumDashboardRecordsByMonth<T>(
  records: T[],
  month: string,
  getDate: (record: T) => Date | string | number,
  getAmount: (record: T) => number,
): number {
  return filterDashboardRecordsByMonth(records, month, getDate)
    .reduce((sum, record) => sum + getAmount(record), 0);
}

/** Serialisiert Schreibvorgänge, damit eine spätere Präferenzwahl zuletzt gespeichert wird. */
export function enqueueDashboardPreferenceSave(
  previousSave: Promise<unknown>,
  save: () => Promise<unknown>,
): Promise<void> {
  return previousSave.catch(() => undefined).then(() => save()).then(() => undefined);
}

export function filterDashboardPointsByMonth<T extends { key: string }>(points: T[], month: string): T[] {
  return points.filter(point => point.key === month);
}

const PRIVATE_DASHBOARD_CARD_IDS = new Set([
  'taxes', 'tax-reserve', 'tax-position', 'tax-advances', 'health-backpayment',
]);

/** §19-Umsatzgrenzen und betriebliche Fixkosten bleiben ohne private Sicht verfügbar. */
export function isDashboardCardVisibleForPrivateView(id: string, showPrivateLevies: boolean): boolean {
  return showPrivateLevies || !PRIVATE_DASHBOARD_CARD_IDS.has(id);
}
