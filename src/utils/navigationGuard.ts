/**
 * Schutz vor dem Verlassen von Formularen mit ungespeicherten Änderungen.
 *
 * Formulare melden sich mit einer ID an; die App fragt vor einem Seiten- oder
 * Bereichswechsel nach. Bewusst ohne React, damit die Regeln testbar bleiben.
 */
export interface NavigationGuard {
  id: string;
  isBlocking: () => boolean;
  /** Fragt nach, ob Änderungen verworfen werden dürfen. */
  confirm: () => Promise<boolean>;
}

/** Steuerprofil: eigener Speicherstand, geht beim Bereichswechsel verloren. */
export const TAX_PROFILE_GUARD_ID = 'settings-tax-profile';
/** Firmeneinstellungen: bleiben beim Bereichswechsel erhalten, nicht beim Seitenwechsel. */
export const COMPANY_SETTINGS_GUARD_ID = 'settings-company';
/** Mail-Einrichtung: eigener Speicherstand im Systembereich. */
export const SMTP_SETTINGS_GUARD_ID = 'settings-smtp';

const guards = new Map<string, NavigationGuard>();

export function registerNavigationGuard(guard: NavigationGuard): () => void {
  guards.set(guard.id, guard);
  return () => {
    if (guards.get(guard.id) === guard) guards.delete(guard.id);
  };
}

/** `'all'` prüft jeden angemeldeten Schutz, sonst nur die genannten IDs. */
export type GuardScope = 'all' | string[];

function guardsInScope(scope: GuardScope): NavigationGuard[] {
  const all = [...guards.values()];
  return scope === 'all' ? all : all.filter(guard => scope.includes(guard.id));
}

export function isNavigationBlocked(scope: GuardScope = 'all'): boolean {
  return guardsInScope(scope).some(guard => guard.isBlocking());
}

/** `true`, wenn die Navigation stattfinden darf. */
export async function confirmNavigation(scope: GuardScope = 'all'): Promise<boolean> {
  for (const guard of guardsInScope(scope)) {
    if (!guard.isBlocking()) continue;
    if (!(await guard.confirm())) return false;
  }
  return true;
}

interface PageTarget {
  page: string;
  filter?: string;
}

/**
 * Welche Formulare ein Wechsel betrifft. Innerhalb der Einstellungen bleibt
 * das gemeinsame Firmenformular erhalten; nur das Steuerprofil verliert beim
 * Verlassen seines Bereichs den Bearbeitungsstand.
 */
export function guardScopeForNavigation(from: PageTarget, to: PageTarget): GuardScope | null {
  if (from.page !== 'settings') return null;
  if (to.page !== 'settings') return 'all';
  const fromArea = from.filter || '';
  const toArea = to.filter || '';
  if (fromArea === 'taxes' && toArea !== 'taxes') return [TAX_PROFILE_GUARD_ID];
  if (fromArea === 'system' && toArea !== 'system') return [SMTP_SETTINGS_GUARD_ID];
  return null;
}

/** Nur für Tests: alle Anmeldungen entfernen. */
export function resetNavigationGuardsForTests(): void {
  guards.clear();
}
