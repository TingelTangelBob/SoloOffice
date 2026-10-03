import { useEffect, useId, useState } from 'react';
import { Check } from 'lucide-react';

interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
  defaultColor?: string;
  /** Optional short helper under the label */
  hint?: string;
}

const SWATCHES = [
  '#15803d',
  '#2563eb',
  '#0f766e',
  '#7c3aed',
  '#db2777',
  '#c2410c',
  '#b45309',
  '#334155',
  '#111827',
];

function normalizeHex(raw: string): string | null {
  const value = raw.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(value)) return value.toLowerCase();
  if (/^[0-9A-Fa-f]{6}$/.test(value)) return `#${value.toLowerCase()}`;
  if (/^#?[0-9A-Fa-f]{3}$/.test(value)) {
    const [a, b, c] = value.replace(/^#/, '');
    return `#${a}${a}${b}${b}${c}${c}`.toLowerCase();
  }
  return null;
}

export function ColorPicker({ label, value, onChange, defaultColor, hint }: ColorPickerProps) {
  const pickerId = useId();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hexDraft, setHexDraft] = useState(value);
  const [hexError, setHexError] = useState(false);
  const safeDefaultColor = normalizeHex(defaultColor ?? '') || '#2563eb';
  const safeValue = normalizeHex(value) || safeDefaultColor;

  useEffect(() => {
    setHexDraft(value);
    setHexError(false);
  }, [value]);

  const commitHex = () => {
    const normalized = normalizeHex(hexDraft);
    if (!normalized) {
      setHexError(true);
      return;
    }
    setHexError(false);
    setHexDraft(normalized);
    onChange(normalized);
  };

  const applyHex = (raw: string) => {
    setHexError(false);
    setHexDraft(raw);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={pickerId} className="block text-sm font-medium text-gray-700">
          {label}
        </label>
        {defaultColor && normalizeHex(defaultColor) && (
          <button
            type="button"
            onClick={() => {
              onChange(safeDefaultColor);
              setHexDraft(safeDefaultColor);
              setHexError(false);
            }}
            className="text-xs font-medium text-gray-500 hover:text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-color)]"
            aria-label={`${label} auf Standard zurücksetzen`}
          >
            Standard
          </button>
        )}
      </div>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-gray-300 shadow-sm transition focus-within:ring-2 focus-within:ring-[var(--primary-color)] focus-within:ring-offset-2"
          style={{ backgroundColor: safeValue }}
        >
          <input
            id={pickerId}
            type="color"
            value={safeValue}
            onChange={(event) => {
              onChange(event.target.value);
              setHexDraft(event.target.value);
              setHexError(false);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={`${label} mit Farbwähler auswählen`}
          />
        </div>
        {SWATCHES.map((swatch) => {
          const selected = safeValue.toLowerCase() === swatch.toLowerCase();
          return (
            <button
              key={swatch}
              type="button"
              onClick={() => {
                onChange(swatch);
                setHexDraft(swatch);
                setHexError(false);
              }}
              className={`inline-flex h-11 w-11 min-h-0 items-center justify-center rounded-full border-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-color)] ${selected ? 'border-gray-900 ring-2 ring-gray-900/20' : 'border-white shadow ring-1 ring-gray-200 hover:scale-105'}`}
              style={{ backgroundColor: swatch }}
              aria-label={`Farbe ${swatch} wählen`}
              aria-pressed={selected}
              title={swatch}
            >
              {selected && <Check className="h-5 w-5 text-white" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-expanded={showAdvanced}
        aria-controls={`${pickerId}-hex`}
        onClick={() => {
          setShowAdvanced((open) => !open);
          setHexDraft(safeValue);
          setHexError(false);
        }}
        className="text-xs font-medium text-gray-600 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-color)]"
      >
        {showAdvanced ? 'Hex-Code ausblenden' : 'Hex-Code eingeben (optional)'}
      </button>

      {showAdvanced && (
        <div id={`${pickerId}-hex`} className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={hexDraft}
            onChange={(event) => applyHex(event.target.value)}
            onBlur={commitHex}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitHex();
              }
            }}
            placeholder="#15803d"
            spellCheck={false}
            className="form-input form-input-compact w-36 font-mono text-sm"
            pattern="^#?[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$"
            aria-label={`${label} als Hex-Code`}
            aria-invalid={hexError}
            aria-describedby={hexError ? `${pickerId}-hex-error` : undefined}
          />
          {hexError
            ? <span id={`${pickerId}-hex-error`} className="text-xs text-red-700">Bitte einen gültigen Hex-Code eingeben.</span>
            : <span className="text-xs text-gray-500">Nur nötig, wenn Sie einen festen Code haben.</span>}
        </div>
      )}
    </div>
  );
}
