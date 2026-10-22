/** Sperrt verzögerte Speicherungen schon vor einem Sitzungswechsel. */
export function createSessionWriteBoundary() {
  let revision = 0;
  let changing = false;
  return {
    capture: () => revision,
    matches: (scope: number) => scope === revision,
    isCurrent: (scope: number) => !changing && scope === revision,
    invalidate: () => { revision += 1; return revision; },
    async transition<T>(change: () => T | Promise<T>): Promise<T> {
      if (changing) throw new Error('Ein Sitzungswechsel läuft bereits. Bitte warten Sie kurz.');
      changing = true;
      try {
        const result = await change();
        revision += 1;
        return result;
      } finally {
        // Bei einem Fehler bleibt der bisherige Scope nutzbar. Bereits während
        // des Wechsels abgewiesene Speicherungen werden nicht erneut ausgeführt.
        changing = false;
      }
    },
  };
}

export const sessionWriteBoundary = createSessionWriteBoundary();
