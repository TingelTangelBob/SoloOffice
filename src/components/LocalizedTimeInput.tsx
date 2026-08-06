import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import type { TimeFormat } from '../types';

interface LocalizedTimeInputProps {
  value: string;
  onChange: (value: string) => void;
  timeFormat?: TimeFormat;
  required?: boolean;
  id?: string;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
}

function isCanonicalTime(value: string): boolean {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function formatTimeValue(value: string, timeFormat: TimeFormat): string {
  if (!isCanonicalTime(value)) return '';
  if (timeFormat !== '12h') return value;
  const [hoursText, minutes] = value.split(':');
  const hours = Number(hoursText);
  return `${String(hours % 12 || 12).padStart(2, '0')}:${minutes} ${hours >= 12 ? 'PM' : 'AM'}`;
}

function parseTimeValue(input: string, timeFormat: TimeFormat): string | null {
  const trimmed = input.trim().toUpperCase();
  if (!trimmed) return '';

  const match = trimmed.match(/^(\d{1,2})\s*:\s*(\d{2})(?:\s*(AM|PM))?$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const suffix = match[3];

  if (suffix) {
    if (hours < 1 || hours > 12) return null;
    if (suffix === 'PM' && hours !== 12) hours += 12;
    if (suffix === 'AM' && hours === 12) hours = 0;
  } else if (timeFormat === '12h' && (hours < 1 || hours > 12)) {
    return null;
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function LocalizedTimeInput({
  value,
  onChange,
  timeFormat = '24h',
  required,
  id,
  className = '',
  placeholder,
  'aria-label': ariaLabel,
}: LocalizedTimeInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(() => formatTimeValue(value, timeFormat));

  const timeOptions = useMemo(() => Array.from({ length: 96 }, (_, index) => {
    const totalMinutes = index * 15;
    return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
  }), []);

  useEffect(() => {
    setInputValue(formatTimeValue(value, timeFormat));
  }, [timeFormat, value]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  const handleChange = (nextValue: string) => {
    setInputValue(nextValue);
    const parsed = parseTimeValue(nextValue, timeFormat);
    if (parsed) onChange(parsed);
    else if (parsed === '') onChange('');
  };

  const handleBlur = () => {
    const parsed = parseTimeValue(inputValue, timeFormat);
    if (parsed) {
      setInputValue(formatTimeValue(parsed, timeFormat));
      if (parsed !== value) onChange(parsed);
    } else if (value) {
      setInputValue(formatTimeValue(value, timeFormat));
    }
  };

  const selectTime = (nextValue: string) => {
    onChange(nextValue);
    setInputValue(formatTimeValue(nextValue, timeFormat));
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={inputValue}
        onFocus={() => setIsOpen(true)}
        onChange={event => handleChange(event.target.value)}
        onBlur={handleBlur}
        required={required}
        placeholder={placeholder || (timeFormat === '12h' ? 'HH:MM AM' : 'HH:MM')}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-invalid={Boolean(inputValue && !parseTimeValue(inputValue, timeFormat))}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary-custom"
      />
      <button
        type="button"
        onMouseDown={event => event.preventDefault()}
        onClick={() => setIsOpen(previous => !previous)}
        className="absolute right-0 top-0 inline-flex h-full min-h-0 w-10 items-center justify-center rounded-r-lg text-gray-500 hover:bg-gray-50 hover:text-primary-custom"
        aria-label="Uhrzeit auswählen"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <Clock className="h-4 w-4" />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full z-30 mt-2 grid max-h-64 w-48 grid-cols-3 gap-1 overflow-y-auto rounded-xl border border-gray-200 bg-white p-2 shadow-xl"
          role="listbox"
          aria-label="Uhrzeit auswählen"
        >
          {timeOptions.map(option => {
            const selected = option === value;
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseDown={event => event.preventDefault()}
                onClick={() => selectTime(option)}
                className={`h-9 min-h-0 rounded-md px-1 text-xs transition-colors ${selected
                  ? 'bg-primary-custom font-semibold text-white'
                  : 'text-gray-700 hover:bg-gray-50'}`}
              >
                {formatTimeValue(option, timeFormat)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
