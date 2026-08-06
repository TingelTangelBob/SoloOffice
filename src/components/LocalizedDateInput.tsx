import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import type { DateFormat } from '../types';

interface LocalizedDateInputProps {
  value: string;
  onChange: (value: string) => void;
  locale?: string;
  dateFormat?: DateFormat;
  min?: string;
  required?: boolean;
  id?: string;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
}

const defaultDateFormat: DateFormat = 'DD.MM.YYYY';

function getDateParts(value: string): [number, number, number] | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function toLocalDate(value: string): Date | null {
  const parts = getDateParts(value);
  if (!parts) return null;
  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return null;
  return date;
}

function toCanonicalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateValue(value: string, dateFormat: DateFormat): string {
  const parts = getDateParts(value);
  if (!parts) return '';
  const [year, month, day] = parts;
  const dayText = String(day).padStart(2, '0');
  const monthText = String(month).padStart(2, '0');
  const yearText = String(year);

  switch (dateFormat) {
    case 'DD/MM/YYYY':
      return `${dayText}/${monthText}/${yearText}`;
    case 'MM/DD/YYYY':
      return `${monthText}/${dayText}/${yearText}`;
    case 'YYYY-MM-DD':
      return `${yearText}-${monthText}-${dayText}`;
    case 'DD.MM.YYYY':
    default:
      return `${dayText}.${monthText}.${yearText}`;
  }
}

function parseDateValue(input: string, dateFormat: DateFormat): string | null {
  const trimmed = input.trim();
  if (!trimmed) return '';

  const parts = trimmed.match(/\d+/g);
  if (!parts || parts.length !== 3) return null;

  let year: number;
  let month: number;
  let day: number;
  if (dateFormat === 'YYYY-MM-DD') {
    [year, month, day] = parts.map(Number);
  } else if (dateFormat === 'MM/DD/YYYY') {
    [month, day, year] = parts.map(Number);
  } else {
    [day, month, year] = parts.map(Number);
  }

  if (year < 100) year += year < 50 ? 2000 : 1900;
  const date = new Date(year, month - 1, day);
  if (
    !Number.isInteger(year)
    || !Number.isInteger(month)
    || !Number.isInteger(day)
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return null;

  return toCanonicalDate(date);
}

function formatDatePlaceholder(dateFormat: DateFormat): string {
  switch (dateFormat) {
    case 'DD/MM/YYYY': return 'TT/MM/JJJJ';
    case 'MM/DD/YYYY': return 'MM/TT/JJJJ';
    case 'YYYY-MM-DD': return 'JJJJ-MM-TT';
    case 'DD.MM.YYYY':
    default: return 'TT.MM.JJJJ';
  }
}

function formatWeekday(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', { weekday: 'short' }).format(date).replace(/\.$/, '');
}

export function LocalizedDateInput({
  value,
  onChange,
  locale = 'de-DE',
  dateFormat = defaultDateFormat,
  min,
  required,
  id,
  className = '',
  placeholder,
  'aria-label': ariaLabel,
}: LocalizedDateInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const effectiveFormat = dateFormat || defaultDateFormat;
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(() => formatDateValue(value, effectiveFormat));
  const [viewDate, setViewDate] = useState(() => toLocalDate(value) || new Date());

  useEffect(() => {
    setInputValue(formatDateValue(value, effectiveFormat));
    const selectedDate = toLocalDate(value);
    if (selectedDate) setViewDate(selectedDate);
  }, [effectiveFormat, value]);

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

  const calendarDays = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const offset = (firstDay + 6) % 7;
    return Array.from({ length: 42 }, (_, index) => new Date(year, month, 1 - offset + index));
  }, [locale, viewDate]);

  const weekdayDates = useMemo(() => {
    const monday = new Date(2023, 0, 2);
    return Array.from({ length: 7 }, (_, index) => (
      new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index)
    ));
  }, []);

  const selectedDate = toLocalDate(value);
  const minimumDate = min ? toLocalDate(min) : null;
  const today = toCanonicalDate(new Date());
  const monthLabel = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(viewDate);
  const labels = { previous: 'Vorheriger Monat', next: 'Nächster Monat', clear: 'Löschen', today: 'Heute' };

  const isSelectable = (date: Date) => {
    const canonical = toCanonicalDate(date);
    return !minimumDate || canonical >= toCanonicalDate(minimumDate);
  };

  const selectDate = (date: Date) => {
    if (!isSelectable(date)) return;
    const canonical = toCanonicalDate(date);
    onChange(canonical);
    setInputValue(formatDateValue(canonical, effectiveFormat));
    setViewDate(date);
    setIsOpen(false);
  };

  const handleInputChange = (nextValue: string) => {
    setInputValue(nextValue);
    const parsed = parseDateValue(nextValue, effectiveFormat);
    if (parsed && (!min || parsed >= min)) {
      onChange(parsed);
      const parsedDate = toLocalDate(parsed);
      if (parsedDate) setViewDate(parsedDate);
    } else if (parsed === '') {
      onChange('');
    }
  };

  const handleBlur = () => {
    const parsed = parseDateValue(inputValue, effectiveFormat);
    if (parsed && (!min || parsed >= min)) {
      setInputValue(formatDateValue(parsed, effectiveFormat));
      if (parsed !== value) onChange(parsed);
    } else if (value) {
      setInputValue(formatDateValue(value, effectiveFormat));
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={inputValue}
        onFocus={() => {
          const selected = toLocalDate(value);
          if (selected) setViewDate(selected);
        }}
        onChange={event => handleInputChange(event.target.value)}
        onBlur={handleBlur}
        required={required}
        placeholder={placeholder || formatDatePlaceholder(effectiveFormat)}
        aria-label={ariaLabel}
        aria-invalid={Boolean(inputValue && !parseDateValue(inputValue, effectiveFormat))}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary-custom"
      />
      <button
        type="button"
        onMouseDown={event => event.preventDefault()}
        onClick={() => {
          const selected = toLocalDate(value);
          if (selected) setViewDate(selected);
          setIsOpen(previous => !previous);
        }}
        className="absolute right-0 top-0 inline-flex h-full min-h-0 w-10 items-center justify-center rounded-r-lg text-gray-500 hover:bg-gray-50 hover:text-primary-custom"
        aria-label="Kalender öffnen"
        aria-expanded={isOpen}
      >
        <Calendar className="h-4 w-4" />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-30 mt-2 w-[19rem] rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}
              className="inline-flex h-7 w-7 min-h-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
              aria-label={labels.previous}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="capitalize text-sm font-semibold text-gray-900">{monthLabel}</span>
            <button
              type="button"
              onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}
              className="inline-flex h-7 w-7 min-h-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
              aria-label={labels.next}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-medium text-gray-500">
            {weekdayDates.map(date => <span key={date.toISOString()}>{formatWeekday(date)}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-0.5">
            {calendarDays.map(date => {
              const canonical = toCanonicalDate(date);
              const isCurrentMonth = date.getMonth() === viewDate.getMonth();
              const isSelected = selectedDate?.getTime() === date.getTime();
              const isToday = canonical === today;
              const selectable = isSelectable(date);
              return (
                <button
                  type="button"
                  key={canonical}
                  disabled={!selectable}
                  onClick={() => selectDate(date)}
                  className={`mx-auto h-7 min-h-0 w-7 rounded-md text-xs transition-colors ${
                    isSelected
                      ? 'bg-primary-custom font-semibold text-white'
                      : isToday
                        ? 'border border-primary-custom text-primary-custom'
                        : isCurrentMonth
                          ? 'text-gray-700 hover:bg-primary-custom/10'
                          : 'text-gray-300 hover:bg-gray-50'
                  } ${!selectable ? 'cursor-not-allowed text-gray-200' : ''}`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-xs">
            <button type="button" onClick={() => { onChange(''); setInputValue(''); setIsOpen(false); }} className="min-h-0 text-gray-500 hover:text-primary-custom">{labels.clear}</button>
            <button type="button" onClick={() => selectDate(toLocalDate(today) || new Date())} className="min-h-0 font-medium text-primary-custom hover:underline">{labels.today}</button>
          </div>
        </div>
      )}
    </div>
  );
}
