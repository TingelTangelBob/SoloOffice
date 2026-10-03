import { useId } from 'react';
import { HelpCircle } from 'lucide-react';

interface InfoTooltipProps {
  text: string;
  label?: string;
  align?: 'start' | 'end';
}

/** Kleine, tastaturbedienbare Hilfe direkt am jeweiligen Feldtitel. */
export function InfoTooltip({ text, label = 'Weitere Informationen', align }: InfoTooltipProps) {
  const tooltipId = useId();

  return (
    <span className={`info-tooltip${align ? ` info-tooltip-align-${align}` : ''}`}>
      <button
        type="button"
        className="info-tooltip-trigger inline-flex h-6 w-6 min-h-0 min-w-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-color)]"
        aria-label={label}
        aria-describedby={tooltipId}
      >
        <HelpCircle className="h-4 w-4" aria-hidden="true" />
      </button>
      <span id={tooltipId} role="tooltip" className="info-tooltip-bubble">
        {text}
      </span>
    </span>
  );
}
