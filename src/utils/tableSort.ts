export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  direction: SortDirection;
}

/** Vergleich für Tabellenwerte mit deutscher, numerischer Sortierung. */
export function compareTableValues(left: unknown, right: unknown, locale = 'de-DE'): number {
  if (left === right) return 0;
  if (left === null || left === undefined || left === '') return 1;
  if (right === null || right === undefined || right === '') return -1;

  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  const leftDate = left instanceof Date ? left.getTime() : Date.parse(String(left));
  const rightDate = right instanceof Date ? right.getTime() : Date.parse(String(right));
  if (!Number.isNaN(leftDate) && !Number.isNaN(rightDate) && /[-/.]/.test(String(left)) && /[-/.]/.test(String(right))) {
    return leftDate - rightDate;
  }

  return new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }).compare(String(left), String(right));
}

export function sortByTableState<T>(items: T[], state: SortState, getValue: (item: T, key: string) => unknown, locale = 'de-DE'): T[] {
  const multiplier = state.direction === 'asc' ? 1 : -1;
  return [...items].sort((left, right) => multiplier * compareTableValues(getValue(left, state.key), getValue(right, state.key), locale));
}
