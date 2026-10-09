import { useCallback, useEffect, useId, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * Zustand einer Kurzinfo, die in einem Portal liegt (`FloatingTooltipBubble`).
 *
 * Für Auslöser in Containern mit `overflow` (Aktionsmenüs, Karten), in denen
 * die reine CSS-Variante abgeschnitten würde. Öffnet bei Zeigen, Fokus und
 * Tippen; Esc und ein Tipp daneben schließen sie.
 */
export function useFloatingTooltip<T extends HTMLElement>() {
  const id = useId();
  const anchorRef = useRef<T>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);

  const close = useCallback(() => { setOpen(false); setPinned(false); }, []);

  useEffect(() => {
    if (!pinned) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [pinned, close]);

  const anchorProps = {
    ref: anchorRef,
    'aria-describedby': id,
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => { if (!pinned) setOpen(false); },
    // Nur bei Tastaturfokus: Nach einem Mausklick oder einer programmatischen
    // Fokusrückgabe soll die Kurzinfo nicht ungefragt aufgehen.
    onFocus: (event: ReactFocusEvent<HTMLElement>) => { if (event.currentTarget.matches(':focus-visible')) setOpen(true); },
    onBlur: close,
    onKeyDown: (event: ReactKeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        // Nur die Kurzinfo schließen, nicht zugleich ein umgebendes Menü.
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    },
  };

  /** Tippen auf Touch-Geräten hält die Kurzinfo offen, erneutes Tippen schließt. */
  const togglePinned = () => {
    if (pinned) close();
    else { setPinned(true); setOpen(true); }
  };

  return { id, anchorRef, open, anchorProps, togglePinned, close };
}
