import { createContext, useContext, useEffect } from 'react';

/**
 * Seitenlokale Suche über das Suchfeld der Kopfleiste.
 *
 * Es gibt nur noch ein Suchfeld. Listenansichten wie Rechnungen, Angebote und
 * Aufträge melden sich beim Einhängen an; ab dann filtert die Eingabe in der
 * Kopfleiste live ihre Liste, und die seitenübergreifende Trefferliste bleibt
 * geschlossen. Ohne angemeldete Seite sucht das Feld wie bisher über alle
 * Bereiche.
 */
export interface PageSearchRegistration {
  placeholder: string;
  /** Vorbelegung, etwa aus einem Deep-Link auf eine bestimmte Rechnung. */
  initialQuery?: string;
}

export interface PageSearchContextValue {
  query: string;
  setQuery: (query: string) => void;
  registration: PageSearchRegistration | null;
  register: (registration: PageSearchRegistration) => void;
  unregister: () => void;
}

export const PageSearchContext = createContext<PageSearchContextValue | null>(null);

/**
 * Hängt die aufrufende Ansicht an das Suchfeld der Kopfleiste und liefert die
 * aktuelle Eingabe. Ändert sich `initialQuery` – zum Beispiel durch einen
 * neuen Deep-Link –, wird das Feld entsprechend neu belegt.
 */
export function usePageSearch({ placeholder, initialQuery }: PageSearchRegistration): { query: string; setQuery: (query: string) => void } {
  const context = useContext(PageSearchContext);

  useEffect(() => {
    if (!context) return undefined;
    context.register({ placeholder, initialQuery });
    return () => context.unregister();
    // `context` wechselt nur zusammen mit dem Layout; die Anmeldung soll beim
    // Wechsel von Platzhalter oder Vorbelegung erneuert werden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeholder, initialQuery]);

  return { query: context?.query ?? '', setQuery: context?.setQuery ?? (() => undefined) };
}
