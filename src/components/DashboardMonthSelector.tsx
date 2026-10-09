interface DashboardMonthSelectorProps {
  monthKeys: string[];
  selectedMonth: string;
  comparisonMonth: string;
  locale: string;
  currentMonth: string;
  onMonthChange: (month: string) => void;
  onComparisonChange: (month: string) => void;
}

export function DashboardMonthSelector({ monthKeys, selectedMonth, comparisonMonth, locale, currentMonth, onMonthChange, onComparisonChange }: DashboardMonthSelectorProps) {
  const monthLabel = (month: string) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T00:00:00`));
  const selectedIndex = monthKeys.indexOf(selectedMonth);
  const ongoing = selectedMonth === currentMonth;
  return <section className="dashboard-month-selector rounded-xl border border-gray-200 bg-white p-4 shadow-sm" aria-label="Monatsansicht auswählen">
    <style>{`
      .dashboard-month-selector .dashboard-month-range { appearance: none; -webkit-appearance: none; display: block; width: 100%; height: 44px; margin: 0; background: transparent; cursor: pointer; touch-action: pan-y; }
      .dashboard-month-selector .dashboard-month-range::-webkit-slider-runnable-track { height: 6px; border-radius: 999px; background: var(--line-soft, #d1d5db); }
      .dashboard-month-selector .dashboard-month-range::-moz-range-track { height: 6px; border-radius: 999px; background: var(--line-soft, #d1d5db); }
      .dashboard-month-selector .dashboard-month-range::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 24px; height: 24px; margin-top: -9px; border: 3px solid var(--surface-raised, #fff); border-radius: 50%; background: var(--primary-on-surface, #2563eb); box-shadow: 0 0 0 1px var(--primary-on-surface, #2563eb); }
      .dashboard-month-selector .dashboard-month-range::-moz-range-thumb { width: 18px; height: 18px; border: 3px solid var(--surface-raised, #fff); border-radius: 50%; background: var(--primary-on-surface, #2563eb); box-shadow: 0 0 0 1px var(--primary-on-surface, #2563eb); }
      .dashboard-month-selector .dashboard-month-range:focus-visible { outline: 2px solid var(--primary-on-surface, #2563eb); outline-offset: 2px; border-radius: 6px; }
    `}</style>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 sm:items-center">
      <div className="min-w-0"><label htmlFor="dashboard-month-slider" className="block text-sm font-semibold capitalize text-gray-900">{monthLabel(selectedMonth)}</label>
        <p className="mt-0.5 text-xs text-gray-500">{ongoing ? 'Laufender Monat · bisher' : 'Abgeschlossener Monat'}</p>
      </div>
      <label className="block min-w-0 text-xs text-gray-600" htmlFor="dashboard-compare-month">Vergleichsmonat
        <select id="dashboard-compare-month" className="form-input mt-1 min-h-11 w-full px-3 py-2 text-sm capitalize" value={comparisonMonth} onChange={event => onComparisonChange(event.target.value)}>
          {monthKeys.map(month => <option key={month} value={month} disabled={month === selectedMonth}>{monthLabel(month)}{month === currentMonth ? ' · bisher' : ''}</option>)}
        </select>
      </label>
    </div>
    <input id="dashboard-month-slider" className="dashboard-month-range mt-2" type="range" min={0} max={monthKeys.length - 1} step={1} value={selectedIndex}
      aria-valuetext={`${monthLabel(selectedMonth)}${ongoing ? ', bisher' : ''}`} aria-label="Monat auswählen" onChange={event => onMonthChange(monthKeys[Number(event.target.value)])} />
    <div className="flex justify-between px-2 text-[10px] text-gray-500" aria-hidden="true">{monthKeys.map(month => <span key={month} className="flex min-w-0 flex-col items-center gap-1"><span className="h-1.5 w-px bg-gray-300" /><span className={month === selectedMonth ? 'font-semibold text-gray-900' : ''}>{new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(`${month}-01T00:00:00`)).replace('.', '').slice(0, 3)}</span></span>)}</div>
  </section>;
}
