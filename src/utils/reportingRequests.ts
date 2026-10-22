export interface ReportingFilters {
  selectedYear: number;
  startDate: string;
  endDate: string;
  selectedCustomer: string;
}

export const yearStart = (year: number) => `${year}-01-01`;
export const yearEnd = (year: number) => `${year}-12-31`;

/** Jahreskennzahlen und der unveränderte Jahreszeitraum wechseln gemeinsam. */
export function changeReportingYear(filters: ReportingFilters, selectedYear: number): ReportingFilters {
  const followsYear = filters.startDate === yearStart(filters.selectedYear)
    && filters.endDate === yearEnd(filters.selectedYear);
  return {
    ...filters,
    selectedYear,
    ...(followsYear ? { startDate: yearStart(selectedYear), endDate: yearEnd(selectedYear) } : {}),
  };
}

/** Jede Abfrage besitzt ihren eigenen Gültigkeitsbereich, auch bei Fehlern. */
export function createRequestScope() {
  let active = true;
  return {
    isActive: () => active,
    invalidate: () => { active = false; },
  };
}

export async function runScopedRequest<T>(
  scope: ReturnType<typeof createRequestScope>,
  request: () => Promise<T>,
  onSuccess: (value: T) => void,
  onError: (error: unknown) => void,
  onSettled: () => void,
): Promise<void> {
  try {
    const value = await request();
    if (scope.isActive()) onSuccess(value);
  } catch (error) {
    if (scope.isActive()) onError(error);
  } finally {
    if (scope.isActive()) onSettled();
  }
}
