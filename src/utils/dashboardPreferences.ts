import {
  DASHBOARD_ITEM_DEFINITIONS,
  DASHBOARD_PREFERENCES_VERSION,
  DASHBOARD_SIZE_SPANS,
  DEFAULT_DASHBOARD_PREFERENCES as SHARED_DEFAULTS,
  getDashboardItemDefinition,
  normalizeDashboardPreferences as normalizeShared,
  validDashboardSize,
} from '../../backend/utils/dashboardPreferences.js';
import type {
  DashboardCardItemId,
  DashboardItemId,
  DashboardItemPreference,
  DashboardPreferences,
  DashboardQuickItemId,
  DashboardSize,
} from '../../backend/utils/dashboardPreferences.js';

/*
 * Die Liste der Kacheln, ihre Größen und die Normalisierung kommen aus dem
 * Backend-Modul, das auch der Server und die Demo-API verwenden. Hier liegen
 * nur die reinen Layout-Operationen des Bearbeiten-Modus.
 */
export type {
  DashboardCardItemId,
  DashboardItemId,
  DashboardItemPreference,
  DashboardPreferences,
  DashboardQuickItemId,
  DashboardSize,
};
export { DASHBOARD_ITEM_DEFINITIONS, DASHBOARD_PREFERENCES_VERSION, DASHBOARD_SIZE_SPANS, getDashboardItemDefinition };

export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = normalizeShared(SHARED_DEFAULTS);

export function normalizeDashboardPreferences(value: unknown): DashboardPreferences {
  return normalizeShared(value);
}

type Items = DashboardItemPreference[];

export function dashboardItemGroup(id: DashboardItemId): 'quick' | 'card' {
  return getDashboardItemDefinition(id)?.group ?? 'card';
}

export function isQuickItem(id: DashboardItemId): id is DashboardQuickItemId {
  return dashboardItemGroup(id) === 'quick';
}

export function isCardItem(id: DashboardItemId): id is DashboardCardItemId {
  return dashboardItemGroup(id) === 'card';
}

/** Verschiebt `activeId` an die Stelle von `overId` (nur innerhalb einer Gruppe). */
export function moveDashboardItem(items: Items, activeId: DashboardItemId, overId: DashboardItemId): Items {
  const from = items.findIndex(item => item.id === activeId);
  const to = items.findIndex(item => item.id === overId);
  if (from < 0 || to < 0 || from === to || dashboardItemGroup(activeId) !== dashboardItemGroup(overId)) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Nächster sichtbarer Nachbar derselben Gruppe in Richtung `direction`. */
function neighbourOf(items: Items, id: DashboardItemId, direction: -1 | 1): DashboardItemId | null {
  const index = items.findIndex(item => item.id === id);
  if (index < 0) return null;
  const group = dashboardItemGroup(id);
  for (let cursor = index + direction; cursor >= 0 && cursor < items.length; cursor += direction) {
    const candidate = items[cursor];
    if (candidate.visible && dashboardItemGroup(candidate.id) === group) return candidate.id;
  }
  return null;
}

export function canStepDashboardItem(items: Items, id: DashboardItemId, direction: -1 | 1): boolean {
  return neighbourOf(items, id, direction) !== null;
}

/** Tastatur- und Pfeilalternative zum Ziehen: eine sichtbare Position weiter. */
export function stepDashboardItem(items: Items, id: DashboardItemId, direction: -1 | 1): Items {
  const neighbour = neighbourOf(items, id, direction);
  return neighbour ? moveDashboardItem(items, id, neighbour) : items;
}

/**
 * Ausblenden lässt die Position stehen. Einblenden („hinzufügen“) setzt die
 * Kachel hinter die letzte sichtbare ihrer Gruppe, damit sie dort erscheint,
 * wo man sie erwartet: am Ende.
 */
export function setDashboardItemVisible(items: Items, id: DashboardItemId, visible: boolean): Items {
  const index = items.findIndex(item => item.id === id);
  if (index < 0 || items[index].visible === visible) return items;
  if (!visible) return items.map(item => item.id === id ? { ...item, visible: false } : item);
  const group = dashboardItemGroup(id);
  const rest = items.filter(item => item.id !== id);
  let insertAt = -1;
  rest.forEach((item, position) => {
    if (item.visible && dashboardItemGroup(item.id) === group) insertAt = position;
  });
  const shown = { ...items[index], visible: true };
  if (insertAt < 0) {
    const firstOfGroup = rest.findIndex(item => dashboardItemGroup(item.id) === group);
    insertAt = firstOfGroup < 0 ? rest.length - 1 : firstOfGroup - 1;
  }
  return [...rest.slice(0, insertAt + 1), shown, ...rest.slice(insertAt + 1)];
}

export function dashboardItemSize(item: DashboardItemPreference): DashboardSize {
  return validDashboardSize(item.id, item.size) ?? getDashboardItemDefinition(item.id)?.defaultSize ?? 'full';
}

export function dashboardSizeOptions(id: DashboardItemId): readonly DashboardSize[] {
  return getDashboardItemDefinition(id)?.sizes ?? [];
}

/** Die Standardgröße wird nicht gespeichert, damit spätere Anpassungen greifen. */
export function resizeDashboardItem(items: Items, id: DashboardItemId, size: DashboardSize): Items {
  if (!validDashboardSize(id, size)) return items;
  const fallback = getDashboardItemDefinition(id)?.defaultSize;
  return items.map(item => {
    if (item.id !== id) return item;
    const next: DashboardItemPreference = { id: item.id, visible: item.visible };
    if (size !== fallback) next.size = size;
    return next;
  });
}

export function nextDashboardSize(item: DashboardItemPreference): DashboardSize | null {
  const options = dashboardSizeOptions(item.id);
  if (options.length < 2) return null;
  const index = options.indexOf(dashboardItemSize(item));
  return options[(index + 1) % options.length];
}

/** Setzt Auswahl, Reihenfolge und Größen zurück; Zeitraum und Schalter bleiben. */
export function resetDashboardLayout(preferences: DashboardPreferences): DashboardPreferences {
  return { ...preferences, items: DEFAULT_DASHBOARD_PREFERENCES.items.map(item => ({ ...item })) };
}

export function dashboardLayoutChanged(a: DashboardPreferences, b: DashboardPreferences): boolean {
  return JSON.stringify(a.items) !== JSON.stringify(b.items);
}

/**
 * Verteilt Kacheln zeilenweise auf `columns` Spalten. Bleibt am Zeilenende
 * Platz, weil die nächste Kachel nicht mehr passt, wachsen die Kacheln der
 * Zeile anteilig – das Raster bekommt keine Löcher. So wird z. B. der
 * Umsatzverlauf voll breit, wenn „Top-Kunden“ ausgeblendet ist.
 */
export function packDashboardRows<T extends string>(entries: { id: T; span: number }[], columns: number): Map<T, number> {
  const result = new Map<T, number>();
  let row: { id: T; span: number }[] = [];
  let used = 0;
  const flush = () => {
    if (row.length === 0) return;
    const free = columns - used;
    let assigned = 0;
    row.forEach((entry, index) => {
      const span = index === row.length - 1
        ? Math.max(1, columns - assigned)
        : Math.max(1, Math.round(entry.span + (free * entry.span) / used));
      result.set(entry.id, span);
      assigned += span;
    });
    row = [];
    used = 0;
  };
  entries.forEach(entry => {
    const span = Math.min(columns, Math.max(1, entry.span));
    if (used + span > columns) flush();
    row.push({ id: entry.id, span });
    used += span;
  });
  flush();
  return result;
}

/** Gleichmäßig gefüllte Reihen: 5 → 3 + 2, 7 → 4 + 3, 8 → 4 + 4. */
export function balancedColumns(count: number, max: number): number {
  if (count <= 0) return 1;
  return Math.ceil(count / Math.ceil(count / max));
}
