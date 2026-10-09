import { useState } from 'react';
import { useElementWidth } from '../hooks/useElementWidth';
import type { IncomeExpensePoint } from '../utils/dashboardMetrics';

const CHART_HEIGHT = 180;
const PADDING = { top: 10, right: 8, bottom: 24, left: 48 };
const GRID_LINES = 3;

const compactMoney = (value: number) => {
  if (value === 0) return '0 €';
  if (value >= 1000) return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value / 1000)} T€`;
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value)} €`;
};

/**
 * Einnahmen und Ausgaben als Balkenpaare je Monat (bzw. je Jahr bei
 * „Gesamt“). Eigenes SVG wie `RevenueAreaChart`, ohne Diagrammbibliothek.
 */
export function IncomeExpenseChart({ points, formatValue, ariaLabel }: {
  points: IncomeExpensePoint[];
  formatValue: (value: number) => string;
  ariaLabel: string;
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (points.length === 0 || width === 0) return <div ref={ref} className="h-[180px] w-full" aria-hidden="true" />;

  const plotWidth = Math.max(width - PADDING.left - PADDING.right, 1);
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const baseline = PADDING.top + plotHeight;
  const maxValue = points.reduce((max, point) => Math.max(max, point.income, point.expenses), 0) || 1;
  const roughStep = maxValue / GRID_LINES;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  const scaleMax = step * GRID_LINES;
  const band = plotWidth / points.length;
  const barWidth = Math.max(2, Math.min(14, (band - 6) / 2));
  const y = (value: number) => baseline - (Math.max(0, value) / scaleMax) * plotHeight;
  const labelStep = Math.max(1, Math.ceil((points.length * 34) / plotWidth));
  const active = activeIndex === null ? null : points[activeIndex];

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={CHART_HEIGHT} viewBox={`0 0 ${width} ${CHART_HEIGHT}`} className="block" role="img" aria-label={ariaLabel}
        onMouseLeave={() => setActiveIndex(null)}>
        {Array.from({ length: GRID_LINES + 1 }, (_, index) => {
          const value = scaleMax - step * index;
          const lineY = PADDING.top + (plotHeight / GRID_LINES) * index;
          return (
            <g key={index}>
              <line x1={PADDING.left} x2={width - PADDING.right} y1={lineY} y2={lineY} stroke="var(--dashboard-chart-grid)" strokeWidth={1} />
              <text x={PADDING.left - 7} y={lineY + 3} textAnchor="end" fontSize={10} fill="var(--dashboard-chart-axis)">{compactMoney(value)}</text>
            </g>
          );
        })}
        {points.map((point, index) => {
          const center = PADDING.left + band * index + band / 2;
          const showLabel = (points.length - 1 - index) % labelStep === 0;
          return (
            <g key={point.key}>
              {activeIndex === index && <rect x={center - band / 2} y={PADDING.top} width={band} height={plotHeight} fill="var(--dashboard-chart-grid)" opacity={0.5} />}
              <rect className="chart-area-reveal" x={center - barWidth - 1} y={y(point.income)} width={barWidth} height={baseline - y(point.income)} rx={2} fill="var(--dashboard-chart-line)" />
              <rect className="chart-area-reveal" x={center + 1} y={y(point.expenses)} width={barWidth} height={baseline - y(point.expenses)} rx={2} fill="var(--dashboard-chart-axis)" opacity={0.55} />
              {showLabel && <text x={center} y={CHART_HEIGHT - 8} textAnchor="middle" fontSize={11} fill="var(--dashboard-chart-axis)">{point.shortLabel}</text>}
              <rect x={center - band / 2} y={0} width={band} height={CHART_HEIGHT} fill="transparent"
                onMouseEnter={() => setActiveIndex(index)} onClick={() => setActiveIndex(index)} />
            </g>
          );
        })}
      </svg>
      {active && activeIndex !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 shadow-lg"
          style={{ left: Math.min(Math.max(PADDING.left + band * activeIndex + band / 2, 80), Math.max(width - 80, 80)) }}
        >
          <p className="whitespace-nowrap text-[11px] text-gray-500">{active.label}</p>
          <p className="whitespace-nowrap text-xs font-semibold text-gray-900 tabular-nums">Einnahmen {formatValue(active.income)}</p>
          <p className="whitespace-nowrap text-xs text-gray-600 tabular-nums">Ausgaben {formatValue(active.expenses)}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pb-1 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1.5"><i className="h-2 w-3 rounded-sm" style={{ backgroundColor: 'var(--dashboard-chart-line)' }} />Einnahmen</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2 w-3 rounded-sm opacity-60" style={{ backgroundColor: 'var(--dashboard-chart-axis)' }} />Ausgaben</span>
      </div>
      <ul className="sr-only">
        {points.map(point => <li key={point.key}>{`${point.label}: Einnahmen ${formatValue(point.income)}, Ausgaben ${formatValue(point.expenses)}`}</li>)}
      </ul>
    </div>
  );
}
