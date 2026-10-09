/**
 * Der Regler sitzt mit demselben Innenabstand oben, links und rechts:
 * klein 36 × 20 mit 16er-Regler (2 px), groß 48 × 28 mit 20er-Regler (4 px).
 * Der Weg beim Umschalten ist daher Bahnbreite − Regler − 2 × Abstand
 * (klein 16 px, groß 20 px). Vorher lag der Regler links bei 2 px, rechts
 * aber bei 4 px, weil der Weg von 0 statt vom Innenabstand aus gerechnet war.
 */
export function SwitchTrack({ checked, showLabel = true }: { checked: boolean; showLabel?: boolean }) {
  return <span data-checked={checked ? 'true' : 'false'} className={`so-switch relative inline-block shrink-0 rounded-full transition-colors ${showLabel ? 'h-5 w-9' : 'h-7 w-12'} ${checked ? 'bg-primary-custom' : 'bg-gray-300'}`} aria-hidden="true">
    <span className={`so-switch-knob absolute inline-block shrink-0 rounded-full bg-white shadow transition-transform ${showLabel ? 'left-0.5 top-0.5 h-4 w-4' : 'left-1 top-1 h-5 w-5'} ${checked ? (showLabel ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0'}`} />
  </span>;
}

export function ToggleSwitch({ checked, onChange, label, showLabel = true, className = '' }: {
  checked: boolean;
  onChange: () => void;
  label: string;
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange}
      className={`inline-flex min-h-10 min-w-0 items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-left text-sm font-medium text-gray-700 transition hover:border-primary-custom hover:text-primary-custom ${className}`}>
      <SwitchTrack checked={checked} showLabel={showLabel} />
      {showLabel && <span className="min-w-0">{label}</span>}
    </button>
  );
}
