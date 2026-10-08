import { useId, useRef, useState, type CSSProperties } from 'react';
import { HelpCircle } from 'lucide-react';

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
