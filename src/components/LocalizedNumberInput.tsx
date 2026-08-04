import { useEffect, useState, type FocusEvent, type InputHTMLAttributes } from 'react';
import type { NumberFormat } from '../types';
import { formatDecimalInput, parseLocalizedNumber, type DecimalInputValue } from '../utils/formatters';

interface LocalizedNumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: DecimalInputValue;
  locale?: string;
  numberFormat?: NumberFormat;
  onValueChange: (value: number | '') => void;
}

export function LocalizedNumberInput({
  value,
  locale = 'de-DE',
  numberFormat,
  onValueChange,
  onBlur,
  onFocus,
  inputMode = 'decimal',
  ...inputProps
}: LocalizedNumberInputProps) {
  const [draftValue, setDraftValue] = useState(() => formatDecimalInput(value, locale, numberFormat));
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setDraftValue(formatDecimalInput(value, locale, numberFormat));
    }
  }, [isEditing, locale, numberFormat, value]);

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    const parsedValue = parseLocalizedNumber(draftValue, locale, numberFormat);
    const nextValue = draftValue.trim() === '' ? '' : Number.isFinite(parsedValue) ? parsedValue : undefined;

    if (nextValue !== undefined) {
      onValueChange(nextValue);
      setDraftValue(formatDecimalInput(nextValue, locale, numberFormat));
    } else {
      setDraftValue(formatDecimalInput(value, locale, numberFormat));
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
        if (Number.isFinite(parsedValue)) {
          onValueChange(parsedValue);
        }
      }}
      onBlur={handleBlur}
    />
  );
}
