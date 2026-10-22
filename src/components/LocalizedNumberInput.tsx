import { useEffect, useState, type FocusEvent, type InputHTMLAttributes } from 'react';
import type { NumberFormat } from '../types';
import { formatDecimalInput, getNumberLocale, parseLocalizedNumber, type DecimalInputValue } from '../utils/formatters';

interface LocalizedNumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: DecimalInputValue;
  locale?: string;
  numberFormat?: NumberFormat;
  allowNegative?: boolean;
  /** Mindestanzahl Nachkommastellen in der Anzeige, z. B. 2 für Geldbeträge („510,00“). */
  minimumFractionDigits?: number;
  onValueChange: (value: number | '') => void;
}

export function LocalizedNumberInput({
  value,
  locale = 'de-DE',
  numberFormat,
  allowNegative = true,
  minimumFractionDigits,
  onValueChange,
  onBlur,
  onFocus,
  inputMode = 'decimal',
  className = '',
  ...inputProps
}: LocalizedNumberInputProps) {
  const display = (input: DecimalInputValue) => {
    const formatted = formatDecimalInput(input, locale, numberFormat);
    if (!minimumFractionDigits || formatted === '') return formatted;
    const parsed = parseLocalizedNumber(input, locale, numberFormat);
    return new Intl.NumberFormat(getNumberLocale(locale, numberFormat), {
      useGrouping: false,
      minimumFractionDigits,
      maximumFractionDigits: Math.max(minimumFractionDigits, 6),
    }).format(parsed);
  };
  const [draftValue, setDraftValue] = useState(() => display(value));
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setDraftValue(display(value));
    }
  // `display` hängt nur an locale, numberFormat und minimumFractionDigits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, locale, numberFormat, value, minimumFractionDigits]);

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    const parsedValue = parseLocalizedNumber(draftValue, locale, numberFormat);
    const validValue = Number.isFinite(parsedValue) && (allowNegative || parsedValue >= 0);
    const nextValue = draftValue.trim() === '' ? '' : validValue ? parsedValue : undefined;

    if (nextValue !== undefined) {
      onValueChange(nextValue);
      setDraftValue(display(nextValue));
    } else {
      setDraftValue(display(value));
    }

    setIsEditing(false);
    onBlur?.(event);
  };

  return (
    <input
      {...inputProps}
      type="text"
      inputMode={inputMode}
      value={draftValue}
      onFocus={(event) => {
        setIsEditing(true);
        onFocus?.(event);
      }}
      onChange={(event) => {
        const nextDraftValue = event.target.value;
        setDraftValue(nextDraftValue);

        if (nextDraftValue.trim() === '') {
          onValueChange('');
          return;
        }

        const parsedValue = parseLocalizedNumber(nextDraftValue, locale, numberFormat);
        if (Number.isFinite(parsedValue) && (allowNegative || parsedValue >= 0)) {
          onValueChange(parsedValue);
        }
      }}
      onBlur={handleBlur}
      className={`form-input form-input-compact ${className}`.trim()}
    />
  );
}
