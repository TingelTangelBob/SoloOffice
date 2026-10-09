import { useId, useState } from 'react';
import { TAX_TEXTS } from '../../backend/shared/taxTexts.js';
import { useElementWidth } from '../hooks/useElementWidth';

export interface RevenuePoint {
  key: string;
  /** Vollständige Beschriftung für Kurzinfo und Vorlesehilfe, etwa „September 2026“. */
  label: string;
  /** Kurzform für die Achse, etwa „Sep“. */
  shortLabel: string;
  value: number;
  forecast?: boolean;
}

/**
 * Zusätzliche Linie über dem Umsatzverlauf, etwa der Vorzeitraum. Die Punkte
 * liegen auf derselben x-Achse wie `points` (gleiche Länge, gleiche
 * Reihenfolge); weitere Reihen kommen über die Registry in
 * `dashboardChartSeries.ts` hinzu.
 */
export interface RevenueChartOverlay {
  key: string;
  label: string;
  points: RevenuePoint[];
  /** CSS-Farbe; Standard ist die neutrale Achsenfarbe. */
  color?: string;
  dashed?: boolean;
  kind?: 'bar' | 'line';
  stackGroup?: 'deductions';
  estimated?: boolean;
  tooltip?: string;
  toggleable?: boolean;
}

interface RevenueAreaChartProps {
  points: RevenuePoint[];
  overlays?: RevenueChartOverlay[];
  currentLabel?: string;
  formatValue: (value: number) => string;
  ariaLabel: string;
  onToggle?: (key: string) => void;
}

const CHART_HEIGHT = 240;
const PADDING = { top: 12, right: 14, bottom: 26, left: 54 };
const GRID_LINES = 4;
const TOOLTIP_GAP = 10;
/** Geschätzte Höhe der Kurzinfo; sie entscheidet nur über oben oder unten. */
const TOOLTIP_BASE_HEIGHT = 52;

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
export function RevenueAreaChart({ points, overlays = [], currentLabel, formatValue, ariaLabel, onToggle }: RevenueAreaChartProps) {
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
  const visibleOverlays = overlays.filter(overlay => overlay.points.length === points.length);
  const stackGroups = new Map<string, number[]>();
  const negativeStackGroups = new Map<string, number[]>();
  visibleOverlays.filter(overlay => overlay.kind === 'bar' && overlay.stackGroup).forEach(overlay => {
    const values = stackGroups.get(overlay.stackGroup!) ?? Array(points.length).fill(0);
    const negativeValues = negativeStackGroups.get(overlay.stackGroup!) ?? Array(points.length).fill(0);
    overlay.points.forEach((point, index) => {
      if (point.value >= 0) values[index] += point.value;
      else negativeValues[index] += point.value;
    });
    stackGroups.set(overlay.stackGroup!, values);
    negativeStackGroups.set(overlay.stackGroup!, negativeValues);
  });
  const stackedMax = [...stackGroups.values()].flat().reduce((max, value) => Math.max(max, value), 0);
  const stackedMin = [...negativeStackGroups.values()].flat().reduce((min, value) => Math.min(min, value), 0);
  const allValues = [...points, ...visibleOverlays.flatMap(overlay => overlay.points)].map(point => point.value);
  const minValue = Math.min(0, ...allValues, stackedMin);
  const maxValue = Math.max(0, ...allValues, stackedMax);
  const roughStep = Math.max(maxValue - minValue, 1) / GRID_LINES;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalizedStep = roughStep / magnitude;
  const tickStep = (normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 2.5 ? 2.5 : normalizedStep <= 5 ? 5 : 10) * magnitude;
  const scaleMax = Math.max(tickStep * GRID_LINES, tickStep);
  const scaleMin = minValue < 0 ? -scaleMax : 0;

  const pointX = (index: number) => (points.length > 1
    ? PADDING.left + (index / (points.length - 1)) * plotWidth
    : PADDING.left + plotWidth / 2);
  const pointY = (value: number) => PADDING.top + ((scaleMax - value) / (scaleMax - scaleMin)) * plotHeight;
  const baseline = pointY(0);

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${pointX(index).toFixed(2)} ${pointY(point.value).toFixed(2)}`)
    .join(' ');
  const firstForecastIndex = points.findIndex(point => point.forecast === true);
  const actualPath = points.slice(0, Math.max(firstForecastIndex, 0) + (firstForecastIndex < 0 ? points.length : 0))
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${pointX(index).toFixed(2)} ${pointY(point.value).toFixed(2)}`).join(' ');
  const forecastPath = firstForecastIndex > 0
    ? points.slice(firstForecastIndex - 1).map((point, index) => `${index === 0 ? 'M' : 'L'}${pointX(firstForecastIndex - 1 + index).toFixed(2)} ${pointY(point.value).toFixed(2)}`).join(' ')
    : firstForecastIndex === 0 ? linePath : '';
  const areaPath = `${linePath} L${pointX(points.length - 1).toFixed(2)} ${baseline} L${pointX(0).toFixed(2)} ${baseline} Z`;

  const gridLines = Array.from({ length: GRID_LINES + 1 }, (_, index) => {
    const value = scaleMax - ((scaleMax - scaleMin) / GRID_LINES) * index;
    return { y: PADDING.top + (plotHeight / GRID_LINES) * index, value };
  });

  // Beschriftungen von rechts ausdünnen: Der jüngste Monat ist der wichtigste
  // und bleibt dadurch bei jeder Breite beschriftet.
  const labelStep = Math.max(1, Math.ceil((points.length * 36) / plotWidth));
  const bandWidth = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth;

  const activePoint = activeIndex === null ? null : points[activeIndex] ?? null;
  const activePointY = activePoint ? pointY(activePoint.value) : 0;
  const tooltipWidth = Math.min(288, Math.max(1, width - 16));
  const tooltipLeft = activeIndex === null ? 0
    : Math.min(Math.max(pointX(activeIndex), tooltipWidth / 2 + 8), width - tooltipWidth / 2 - 8);
  // Über dem Punkt ist der übliche Platz. An der Kurvenspitze reicht er nicht,
  // und die Karte schneidet mit `overflow-hidden` ab – dort klappt die Kurzinfo
  // unter den Punkt.
  const tooltipHeight = Math.min(CHART_HEIGHT - 16, TOOLTIP_BASE_HEIGHT + visibleOverlays.length * 30 + (activePoint?.forecast ? 20 : 0));
  const tooltipTop = Math.max(8, Math.min(activePointY + TOOLTIP_GAP, CHART_HEIGHT - tooltipHeight - 8));

  // Neue Werte zeichnen die Kurve erneut; eine Breitenänderung (Seitenleiste,
  // Fenster) soll das nicht auslösen, deshalb hängt der Schlüssel nur an den
  // Daten. `pathLength={1}` normiert die Linie, damit das Einzeichnen in CSS
  // ohne gemessene Pfadlänge auskommt.
  const dataKey = [points, ...visibleOverlays.map(overlay => overlay.points)]
    .map(series => series.map(point => `${point.key}:${point.value}`).join('|')).join('#');
  const overlayPath = (series: RevenuePoint[]) => series
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${pointX(index).toFixed(2)} ${pointY(point.value).toFixed(2)}`).join(' ');
  const barOverlays = visibleOverlays.filter(overlay => overlay.kind === 'bar');
  const lineOverlays = visibleOverlays.filter(overlay => overlay.kind !== 'bar');
  const barWidth = Math.max(3, Math.min(22, bandWidth * 0.56));
  const barStacks = new Map<string, number[]>(Array.from(stackGroups, ([key]) => [key, Array(points.length).fill(0)]));
  const negativeBarStacks = new Map<string, number[]>(Array.from(negativeStackGroups, ([key]) => [key, Array(points.length).fill(0)]));
  const barCoordinates = (overlay: RevenueChartOverlay, index: number) => {
    const point = overlay.points[index];
    const stack = overlay.stackGroup
      ? (point.value < 0 ? negativeBarStacks.get(overlay.stackGroup)! : barStacks.get(overlay.stackGroup)!)
      : Array(points.length).fill(0);
    const lower = overlay.stackGroup ? stack[index] : 0;
    const upper = lower + point.value;
    if (overlay.stackGroup) stack[index] = upper;
    return { x: pointX(index) - barWidth / 2, y: pointY(Math.max(lower, upper)), height: Math.max(0, pointY(Math.min(lower, upper)) - pointY(Math.max(lower, upper))), width: barWidth };
  };
  const compactMoney = (value: number) => {
    if (value === 0) return '0 €';
    if (Math.abs(value) >= 1000) return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value / 1000)} T€`;
    return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value)} €`;
  };

  return (
    <div ref={ref} className="relative w-full">
      <svg
        key={dataKey}
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
          <pattern id={`${gradientId}-hatch`} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="2" />
          </pattern>
        </defs>

        {gridLines.map(({ y, value }) => (
          <g key={y}>
          <line
            x1={PADDING.left}
            x2={width - PADDING.right}
            y1={y}
            y2={y}
            stroke={Math.abs(value) < 0.000001 ? 'var(--dashboard-chart-axis)' : 'var(--dashboard-chart-grid)'}
            strokeWidth={Math.abs(value) < 0.000001 ? 1.5 : 1}
          />
          <text x={PADDING.left - 7} y={y + 3} textAnchor="end" fontSize={10} fill="var(--dashboard-chart-axis)">{compactMoney(value)}</text>
          </g>
        ))}

        <path d={areaPath} fill={`url(#${gradientId})`} className="chart-area-reveal" />
        <path
          d={actualPath}
          pathLength={1}
          className="chart-line-draw"
          fill="none"
          stroke="var(--dashboard-chart-line)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {forecastPath && <path d={forecastPath} fill="none" stroke="var(--dashboard-chart-line)" strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" strokeLinecap="round" />}
        {barOverlays.map(overlay => (
          <g key={`bars-${overlay.key}`} style={{ color: overlay.color ?? 'var(--dashboard-chart-axis)' }}>
            {overlay.points.map((point, index) => {
              const rect = barCoordinates(overlay, index);
              return <rect key={point.key} {...rect} fill={point.forecast ? `url(#${gradientId}-hatch)` : overlay.color ?? 'var(--dashboard-chart-axis)'}
                fillOpacity={point.forecast ? 0.82 : 0.68} stroke={overlay.color ?? 'var(--dashboard-chart-axis)'} strokeWidth={point.forecast ? 1 : 0} strokeDasharray={point.forecast ? '3 2' : undefined} />;
            })}
          </g>
        ))}
        {lineOverlays.map(overlay => {
          if (overlay.points.length === 1) return <circle key={`overlay-${overlay.key}`} cx={pointX(0)} cy={pointY(overlay.points[0].value)} r={4} fill={overlay.color ?? 'var(--dashboard-chart-axis)'} stroke="var(--dashboard-chart-surface)" strokeWidth={1.5} />;
          if (overlay.dashed === true) return <path key={`overlay-${overlay.key}`} d={overlayPath(overlay.points)} fill="none"
            stroke={overlay.color ?? 'var(--dashboard-chart-axis)'} strokeWidth={1.75} strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />;
          const forecastStart = overlay.points.findIndex(point => point.forecast);
          const splitPath = (from: number, until: number) => overlay.points.slice(from, until)
            .map((point, index) => `${index === 0 ? 'M' : 'L'}${pointX(from + index).toFixed(2)} ${pointY(point.value).toFixed(2)}`).join(' ');
          return <g key={`overlay-${overlay.key}`} fill="none" stroke={overlay.color ?? 'var(--dashboard-chart-axis)'} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round">
            <path d={splitPath(0, forecastStart < 0 ? overlay.points.length : forecastStart)} />
            {forecastStart >= 0 && <path d={splitPath(Math.max(0, forecastStart - 1), overlay.points.length)} strokeDasharray="5 4" />}
          </g>;
        })}

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
            className="chart-point-reveal"
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
          className="absolute z-10 -translate-x-1/2 overflow-y-auto rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-900"
          style={{ left: tooltipLeft, top: tooltipTop, width: tooltipWidth, maxHeight: CHART_HEIGHT - 16 }}
        >
          <p className="whitespace-normal break-words text-[11px] text-gray-500">{activePoint.label}</p>
          <p className="whitespace-normal break-words font-sans text-xs font-semibold text-gray-900 tabular-nums dark:text-gray-100">
            {formatValue(activePoint.value)}
          </p>
          {visibleOverlays.map(overlay => overlay.points[activeIndex!] && (
            <p key={overlay.key} className="max-w-[min(18rem,70vw)] whitespace-normal break-words text-[11px] text-gray-600 dark:text-gray-300" title={overlay.tooltip}>
              {overlay.label}: {formatValue(overlay.points[activeIndex!].value)}{(overlay.points[activeIndex!].forecast || overlay.estimated) ? ` · ${TAX_TEXTS.badge}` : ''}
            </p>
          ))}
          {activePoint.forecast && <p className="max-w-[min(18rem,70vw)] whitespace-normal text-[11px] text-amber-700 dark:text-amber-300">Prognose · {TAX_TEXTS.badge}</p>}
        </div>
      )}
      {visibleOverlays.length > 0 && <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 pb-1 text-[11px] text-gray-600 dark:text-gray-300">
        {currentLabel && <span className="inline-flex items-center gap-1.5" title="Umsatz-Ist"><i className="h-0.5 w-4 bg-primary-custom" />{currentLabel} · Ist</span>}
        {currentLabel && points.some(point => point.forecast) && <span className="inline-flex items-center gap-1.5" title="Umsatzprognose · Unverbindliche Schätzung"><i className="w-4 border-t-2 border-dashed border-primary-custom" />Prognose · Schätzung</span>}
        {visibleOverlays.map(overlay => (
          <button key={overlay.key} type="button" onClick={() => onToggle?.(overlay.key)} disabled={!onToggle || overlay.toggleable === false}
            title={overlay.tooltip ?? overlay.label} className={`inline-flex min-h-8 items-center gap-1.5 rounded px-1 text-left ${onToggle && overlay.toggleable !== false ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800' : 'cursor-default'}`}>
            <i className={`w-4 ${overlay.kind === 'bar' ? 'h-2 border border-solid' : `border-t-2 ${overlay.dashed === false ? 'border-solid' : 'border-dashed'}`}`}
              style={{ borderColor: overlay.color ?? 'var(--dashboard-chart-axis)', backgroundColor: overlay.kind === 'bar' ? overlay.color : undefined }} />
            <span>{overlay.label}{overlay.estimated ? ' · Schätzung' : ''}</span>
          </button>
        ))}
      </div>}

      {/* Dieselben Werte als Liste: Das Diagramm selbst ist für Vorlesehilfen
          nur ein Bild. */}
      <ul className="sr-only">
        {points.map((point) => (
          <li key={`value-${point.key}`}>{`${point.label}: ${formatValue(point.value)}`}</li>
        ))}
        {visibleOverlays.flatMap(overlay => overlay.points.map((point) => (
          <li key={`${overlay.key}-value-${point.key}`}>{`${overlay.label} ${point.label}: ${formatValue(point.value)}`}</li>
        )))}
      </ul>
    </div>
  );
}
