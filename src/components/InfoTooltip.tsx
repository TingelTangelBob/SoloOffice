import { useId } from 'react';
import { HelpCircle } from 'lucide-react';

interface InfoTooltipProps {
  text: string;
  label?: string;
}

/** Kleine, tastaturbedienbare Hilfe direkt am jeweiligen Feldtitel. */
export function InfoTooltip({ text, label = 'Weitere Informationen' }: InfoTooltipProps) {
  const tooltipId = useId();

  return (
    <span className="info-tooltip">
      <button
        type="button"
        className="info-tooltip-trigger inline-flex h-6 w-6 min-h-0 min-w-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-custom/30"
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
