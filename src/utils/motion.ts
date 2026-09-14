/**
 * Bewegungshelfer, die CSS allein nicht leisten kann.
 *
 * Dauern und Kurve entsprechen den `--motion-*`-Werten in index.css, damit
 * JS-gesteuerte Übergänge dieselbe Handschrift haben wie die CSS-Keyframes.
 */

const COLLAPSE_DURATION_MS = 160;
const MOTION_EASE = 'cubic-bezier(0.2, 0, 0, 1)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Klappt eine Listenzeile zusammen und ruft danach `onDone` auf; erst dort
 * wird die Zeile aus dem Zustand entfernt. Höhe, Innenabstände, Rahmen und
 * der Abstand zur Vorzeile gehen gemeinsam auf null, damit die folgenden
 * Zeilen nachrücken statt zu springen. Ohne Element, ohne Web-Animations-API
 * oder bei reduzierter Bewegung wird sofort entfernt.
 */
export function collapseRow(element: HTMLElement | null | undefined, onDone: () => void): void {
  if (!element || prefersReducedMotion() || typeof element.animate !== 'function') {
    onDone();
    return;
  }
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  element.style.overflow = 'hidden';
  element.style.pointerEvents = 'none';
  const animation = element.animate(
    [
      {
        height: `${rect.height}px`,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        marginTop: style.marginTop,
        borderTopWidth: style.borderTopWidth,
        borderBottomWidth: style.borderBottomWidth,
        opacity: 1,
      },
      {
        height: '0px',
        paddingTop: '0px',
        paddingBottom: '0px',
        marginTop: '0px',
        borderTopWidth: '0px',
        borderBottomWidth: '0px',
        opacity: 0,
      },
    ],
    { duration: COLLAPSE_DURATION_MS, easing: MOTION_EASE, fill: 'forwards' },
  );
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    onDone();
  };
  animation.onfinish = finish;
  animation.oncancel = finish;
}
