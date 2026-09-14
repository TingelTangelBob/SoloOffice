import { useCallback, useReducer, useRef } from 'react';

/**
 * Merkt sich Zeilen, die während der Bearbeitung hinzugefügt wurden. Nur sie
 * bekommen die Einblend-Klasse – beim Öffnen eines bestehenden Beleges sollen
 * nicht alle Positionen gleichzeitig einfahren. Nach dem Ende der Animation
 * wird die Markierung wieder entfernt: Beim Sortieren per Drag-and-drop setzt
 * React die Zeile neu in den DOM ein, und eine noch gesetzte Klasse würde
 * die Animation dabei ein zweites Mal abspielen.
 */
export function useEnteringRows() {
  const enteringIds = useRef(new Set<string>());
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const markEntering = useCallback((id: string) => {
    enteringIds.current.add(id);
  }, []);

  const settleEntering = useCallback((id: string) => {
    if (!enteringIds.current.delete(id)) return;
    rerender();
  }, []);

  const isEntering = useCallback((id: string) => enteringIds.current.has(id), []);

  return { markEntering, settleEntering, isEntering };
}
