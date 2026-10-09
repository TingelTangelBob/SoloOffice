import { useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useFloatingTooltip } from '../hooks/useFloatingTooltip';
import { createPortal } from 'react-dom';
import { HelpCircle, Info } from 'lucide-react';

interface InfoTooltipProps {
  text: string;
  label?: string;
  align?: 'start' | 'end';
}

/** Kleine, tastaturbedienbare Hilfe direkt am jeweiligen Feldtitel. */
export function InfoTooltip({ text, label = 'Weitere Informationen', align }: InfoTooltipProps) {
  const tooltipId = useId();
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [mobileTop, setMobileTop] = useState<number | null>(null);

  const positionMobileTooltip = () => {
    const tooltip = tooltipRef.current;
    const trigger = tooltip?.querySelector('.info-tooltip-trigger');
    if (!tooltip || !trigger || window.matchMedia('(min-width: 768px)').matches
      || tooltip.closest('#topbar-page-title')) return;

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipHeight = tooltip.querySelector('.info-tooltip-bubble')?.getBoundingClientRect().height ?? 0;
    const gap = 10;
    const above = triggerRect.top - gap - tooltipHeight;
    const below = triggerRect.bottom + gap;
    const top = above >= 8 ? above : below + tooltipHeight <= window.innerHeight - 8 ? below : Math.max(8, above);
    setMobileTop(top);
  };

  return (
    <span
      ref={tooltipRef}
      className={`info-tooltip${align ? ` info-tooltip-align-${align}` : ''}`}
      onPointerEnter={positionMobileTooltip}
      onFocus={positionMobileTooltip}
    >
      <button
        type="button"
        className="info-tooltip-trigger inline-flex h-6 w-6 min-h-0 min-w-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-color)]"
        aria-label={label}
        aria-describedby={tooltipId}
      >
        <HelpCircle className="h-4 w-4" aria-hidden="true" />
      </button>
      <span
        style={{ '--mobile-tooltip-top': mobileTop === null ? undefined : `${mobileTop}px` } as CSSProperties}
        id={tooltipId}
        role="tooltip"
        className="info-tooltip-bubble"
      >
        {text}
      </span>
    </span>
  );
}

const FLOATING_GAP = 8;
const VIEWPORT_PADDING = 8;

/**
 * Kurzinfo in einem Portal, am Fensterrand ausgerichtet; der Zustand kommt
 * aus `useFloatingTooltip`. Oberhalb des Auslösers, unten nur dann, wenn oben
 * kein Platz ist.
 */
export function FloatingTooltipBubble({ id, anchorRef, open, children }: {
  id: string;
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  children: ReactNode;
}) {
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const portalTarget = typeof document !== 'undefined' ? document.getElementById('app-shell') || document.body : null;

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;
    const rect = anchor.getBoundingClientRect();
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;
    const left = Math.min(
      Math.max(VIEWPORT_PADDING, rect.left + rect.width / 2 - width / 2),
      Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING),
    );
    const above = rect.top - FLOATING_GAP - height;
    const below = rect.bottom + FLOATING_GAP;
    const top = above >= VIEWPORT_PADDING || below + height > window.innerHeight - VIEWPORT_PADDING
      ? Math.max(VIEWPORT_PADDING, above)
      : below;
    setPosition({ left, top });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return undefined; }
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  if (!portalTarget) return null;
  // Die Kurzinfo bleibt im DOM, damit `aria-describedby` auch geschlossen
  // auf einen Text zeigt.
  return createPortal(
    <span
      ref={bubbleRef}
      id={id}
      role="tooltip"
      className="floating-tooltip"
      data-open={open && position ? 'true' : 'false'}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0 }}
    >
      {children}
    </span>,
    portalTarget,
  );
}

/** Info-Symbol mit Kurzinfo, etwa für Berechnungshinweise in Menüs. */
export function FloatingInfoTooltip({ text, label = 'Weitere Informationen' }: { text: string; label?: string }) {
  const tooltip = useFloatingTooltip<HTMLButtonElement>();
  return (
    <>
      <button
        type="button"
        {...tooltip.anchorProps}
        onClick={event => { event.preventDefault(); tooltip.togglePinned(); }}
        className="info-tooltip-trigger inline-flex h-6 w-6 min-h-0 min-w-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-color)]"
        aria-label={label}
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>
      <FloatingTooltipBubble id={tooltip.id} anchorRef={tooltip.anchorRef} open={tooltip.open}>{text}</FloatingTooltipBubble>
    </>
  );
}
