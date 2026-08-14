import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Misst die Innenbreite eines Elements und hält sie aktuell.
 *
 * Listenansichten entscheiden damit anhand des tatsächlich verfügbaren Platzes
 * über ihre Verdichtungsstufe. Feste Viewport-Breakpoints sind dafür ungeeignet,
 * weil die Seitenleiste in SoloOffice frei zwischen 72 und 360 Pixeln skaliert
 * und dieselbe Fensterbreite je nach Seitenleiste sehr unterschiedlich viel
 * Platz für die Tabelle übrig lässt.
 *
 * Die Referenz ist bewusst eine Callback-Ref: Viele Listen zeigen zuerst einen
 * Ladezustand und hängen die Tabelle erst später ein. Ein Effekt mit leerer
 * Abhängigkeitsliste würde diesen späteren Knoten nie beobachten.
 */
export function useElementWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!node) return;

    setWidth(node.clientWidth);

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const nextWidth = entry.contentRect.width;
      setWidth(previous => (Math.abs(previous - nextWidth) < 1 ? previous : nextWidth));
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { ref, width };
}
