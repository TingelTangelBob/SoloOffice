import { useId, useState } from 'react';
import { useElementWidth } from '../hooks/useElementWidth';

export interface RevenuePoint {
  key: string;
  /** Vollständige Beschriftung für Kurzinfo und Vorlesehilfe, etwa „September 2026“. */
  label: string;
  /** Kurzform für die Achse, etwa „Sep“. */
  shortLabel: string;
  value: number;
}

interface RevenueAreaChartProps {
  points: RevenuePoint[];
  formatValue: (value: number) => string;
  ariaLabel: string;
}

const CHART_HEIGHT = 240;
const PADDING = { top: 12, right: 14, bottom: 26, left: 14 };
const GRID_LINES = 4;
const TOOLTIP_GAP = 10;
/** Geschätzte Höhe der Kurzinfo; sie entscheidet nur über oben oder unten. */
const TOOLTIP_HEIGHT = 52;

/**
 * Flächendiagramm für den Umsatzverlauf.
 *
 * Bewusst als eigenes SVG statt über eine Diagrammbibliothek: Die Übersicht
 * braucht genau eine Kurve, und eine zusätzliche Abhängigkeit müsste über den
 * Docker-Build eingezogen und dauerhaft gepflegt werden.
 *
 * Die Breite kommt aus `useElementWidth`, nicht aus festen Haltepunkten. Die
 * Seitenleiste skaliert frei zwischen 72 und 360 Pixeln; dieselbe Fensterbreite
 * lässt der Karte dadurch sehr unterschiedlich viel Platz.
 */
export function RevenueAreaChart({ points, formatValue, ariaLabel }: RevenueAreaChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const gradientId = `revenue-area-${useId().replace(/:/g, '')}`;

  // Erste Darstellung: Die Höhe steht bereits, damit der ResizeObserver eine
  // belastbare Breite meldet und die Karte beim Nachrendern nicht springt.
  if (points.length === 0 || width === 0) {
    return <div ref={ref} className="h-60 w-full" aria-hidden="true" />;
  }

  const plotWidth = Math.max(width - PADDING.left - PADDING.right, 1);
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const baseline = PADDING.top + plotHeight;
  const maxValue = points.reduce((max, point) => Math.max(max, point.value), 0);
  // Kopfraum über der Spitze, damit Kurve und Punkt nicht an der Oberkante kleben.
  const scaleMax = maxValue > 0 ? maxValue * 1.15 : 1;

  const pointX = (index: number) => (points.length > 1
    ? PADDING.left + (index / (points.length - 1)) * plotWidth
    : PADDING.left + plotWidth / 2);
  const pointY = (value: number) => baseline - (value / scaleMax) * plotHeight;

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${pointX(index).toFixed(2)} ${pointY(point.value).toFixed(2)}`)
    .join(' ');
  const areaPath = `${linePath} L${pointX(points.length - 1).toFixed(2)} ${baseline} L${pointX(0).toFixed(2)} ${baseline} Z`;

  const gridLines = Array.from({ length: GRID_LINES + 1 }, (_, index) => PADDING.top + (plotHeight / GRID_LINES) * index);

  // Beschriftungen von rechts ausdünnen: Der jüngste Monat ist der wichtigste
  // und bleibt dadurch bei jeder Breite beschriftet.
  const labelStep = Math.max(1, Math.ceil((points.length * 36) / plotWidth));
  const bandWidth = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth;

  const activePoint = activeIndex === null ? null : points[activeIndex] ?? null;
  const activePointY = activePoint ? pointY(activePoint.value) : 0;
  const tooltipLeft = activeIndex === null
    ? 0
    : Math.min(Math.max(pointX(activeIndex), 68), Math.max(width - 68, 68));
  // Über dem Punkt ist der übliche Platz. An der Kurvenspitze reicht er nicht,
  // und die Karte schneidet mit `overflow-hidden` ab – dort klappt die Kurzinfo
  // unter den Punkt.
  const tooltipAbove = activePointY > TOOLTIP_HEIGHT + TOOLTIP_GAP;
  const tooltipTop = tooltipAbove ? activePointY - TOOLTIP_GAP : activePointY + TOOLTIP_GAP;

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={CHART_HEIGHT}
        viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
        className="block"
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setActiveIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--dashboard-chart-line)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--dashboard-chart-line)" stopOpacity={0} />
          </linearGradient>
        </defs>

        {gridLines.map((y) => (
          <line
            key={y}
            x1={PADDING.left}
            x2={width - PADDING.right}
            y1={y}
            y2={y}
            stroke="var(--dashboard-chart-grid)"
            strokeWidth={1}
          />
        ))}

        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path
          d={linePath}
          fill="none"
          stroke="var(--dashboard-chart-line)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {activeIndex !== null && (
          <line
            x1={pointX(activeIndex)}
            x2={pointX(activeIndex)}
            y1={PADDING.top}
            y2={baseline}
            stroke="var(--dashboard-chart-line)"
            strokeWidth={1}
            strokeDasharray="3 3"
            strokeLinecap="round"
          />
        )}

        {points.map((point, index) => (
          <circle
            key={point.key}
            cx={pointX(index)}
            cy={pointY(point.value)}
            r={activeIndex === index ? 4 : 2.5}
            fill="var(--dashboard-chart-line)"
            stroke="var(--dashboard-chart-surface)"
            strokeWidth={activeIndex === index ? 2 : 0}
          />
        ))}

        {points.map((point, index) => {
          const showLabel = (points.length - 1 - index) % labelStep === 0;
          if (!showLabel) return null;
          const isFirst = index === 0;
          const isLast = index === points.length - 1;

          return (
            <text
              key={`label-${point.key}`}
              x={pointX(index)}
              y={CHART_HEIGHT - 8}
              textAnchor={isFirst ? 'start' : isLast ? 'end' : 'middle'}
              fontSize={11}
              fill="var(--dashboard-chart-axis)"
            >
              {point.shortLabel}
            </text>
          );
        })}

        {/* Unsichtbare Trefferflächen: Sie machen die Kurzinfo auch dort
            erreichbar, wo die Kurve flach verläuft und der Punkt klein ist. */}
        {points.map((point, index) => (
          <rect
            key={`band-${point.key}`}
            x={Math.max(0, pointX(index) - bandWidth / 2)}
            y={0}
            width={Math.min(bandWidth, width)}
            height={CHART_HEIGHT}
            fill="transparent"
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => setActiveIndex(index)}
          />
        ))}
      </svg>

      {activePoint && (
        <div
          className={`pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 shadow-lg ${
            tooltipAbove ? '-translate-y-full' : ''
          }`}
          style={{ left: tooltipLeft, top: tooltipTop }}
        >
          <p className="whitespace-nowrap text-[11px] text-gray-500">{activePoint.label}</p>
          <p className="whitespace-nowrap font-mono text-xs font-semibold text-gray-900 tabular-nums">
            {formatValue(activePoint.value)}
          </p>
        </div>
      )}

      {/* Dieselben Werte als Liste: Das Diagramm selbst ist für Vorlesehilfen
          nur ein Bild. */}
      <ul className="sr-only">
        {points.map((point) => (
          <li key={`value-${point.key}`}>{`${point.label}: ${formatValue(point.value)}`}</li>
        ))}
      </ul>
    </div>
  );
}
