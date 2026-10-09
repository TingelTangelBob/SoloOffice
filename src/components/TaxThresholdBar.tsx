import type { ThresholdResult } from '../types/finance';
import { thresholdDistance } from '../utils/taxDashboardDisplay';

/** Schwellenanzeige mit lesbarer Einordnung auch außerhalb des letzten Bands. */
export function TaxThresholdBar({ threshold, valueLabel, modeLabel, projectionValue, marginalRate, combinedMarginalRate }: {
  threshold: ThresholdResult;
  valueLabel?: string;
  modeLabel?: string;
  projectionValue?: number;
  marginalRate?: number;
  combinedMarginalRate?: number;
}) {
  const bands = [...threshold.bands].sort((a, b) => a.from - b.from);
  const first = bands[0]?.from ?? 0;
  const last = bands.at(-1);
  const openBandWidth = Math.max(1, ((last?.from ?? first) - first) * 0.2);
  const upper = last?.to ?? Math.max(Math.max(threshold.value, projectionValue ?? threshold.value) * 1.08, (last?.from ?? first) + openBandWidth);
  const span = Math.max(1, upper - first);
  const marker = Math.min(100, Math.max(0, ((threshold.value - first) / span) * 100));
  const valueText = valueLabel ?? new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(threshold.value);
  const zone = thresholdDistance(threshold);
  const marginal = threshold.marginalRate ?? marginalRate;
  const money = (value: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-gray-800">{threshold.label}{modeLabel ? ` · ${modeLabel}` : ''}</span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">{valueText}</span>
      </div>
      <div className="relative pt-1" role="img" aria-label={`${threshold.label}: ${valueText}. ${threshold.message}`}>
        <div className="flex h-2 overflow-hidden rounded-full bg-gray-100">
          {bands.map(band => {
            const end = band.to ?? upper;
            const width = Math.max(0, Math.min(100, ((end - Math.max(first, band.from)) / span) * 100));
            const tone = band.tone === 'danger' ? 'bg-rose-400' : band.tone === 'warning' ? 'bg-amber-400' : band.tone === 'success' ? 'bg-emerald-400' : 'bg-gray-300';
            return <span key={band.id} className={`${tone} border-r border-white/70 ${band.to === null ? 'rounded-r-full' : ''}`} style={{ width: `${width}%` }} title={`${band.label}${band.to === null ? ' · offen nach oben' : ` · bis ${money(band.to)}`}`} />;
          })}
        </div>
        <span className="absolute top-0 h-4 w-0.5 rounded bg-gray-950" style={{ left: `${marker}%` }} aria-hidden="true" />
        {projectionValue !== undefined && <span className="absolute -top-0.5 h-5 w-1 rounded border border-white bg-amber-600" style={{ left: `${Math.min(100, Math.max(0, ((projectionValue - first) / span) * 100))}%` }} title={`Jahresprognose: ${money(projectionValue)}`} aria-hidden="true" />}
      </div>
      {projectionValue !== undefined && <p className="text-xs text-gray-600">Ist: {valueText} · Jahresprognose: {money(projectionValue)}</p>}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-4 text-gray-500" aria-label="Grenzbereiche">
        {bands.map(band => <span key={band.id}>{band.label}: {money(band.from)}{band.to === null ? ' und mehr' : `–${money(band.to)}`}</span>)}
      </div>
      {zone && <p className="text-xs text-gray-700">Aktuelle Zone: <strong>{zone.activeBand.label}</strong>{zone.aboveLastBoundary ? ' · oberhalb der letzten Grenze' : zone.nextBoundary !== null && <> · nächste Grenze {money(zone.nextBoundary)}, Abstand {money(zone.distance ?? 0)}</>}</p>}
      <p className="text-xs leading-5 text-gray-600">{threshold.message}</p>
      {marginal !== undefined && <p className="text-xs text-gray-500">Grenzbelastung als Richtwert: {new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1 }).format(marginal)}</p>}
      {threshold.id === 'est' && combinedMarginalRate !== undefined && <p className="text-xs text-gray-500">Kombinierte Grenzbelastung aus Steuern und Sozialbeiträgen als Richtwert: {new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1 }).format(combinedMarginalRate)}</p>}
    </div>
  );
}
