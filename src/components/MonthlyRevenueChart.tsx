import { TAX_TEXTS } from '../../backend/shared/taxTexts.js';

export interface MonthlyRevenueComparisonRow {
  key: string;
  label: string;
  color: string;
  current: number | null;
  comparison: number | null;
  currentEstimate?: boolean;
  comparisonEstimate?: boolean;
  tooltip?: string;
}

interface MonthlyRevenueChartProps {
  rows: MonthlyRevenueComparisonRow[];
  currentLabel: string;
  comparisonLabel: string;
  formatValue: (value: number) => string;
  ariaLabel: string;
}

/** Monatsvergleich mit einer gemeinsamen Nullachse für positive und negative Werte. */
export function MonthlyRevenueChart({ rows, currentLabel, comparisonLabel, formatValue, ariaLabel }: MonthlyRevenueChartProps) {
  const maxMagnitude = Math.max(0, ...rows.flatMap(row => [row.current, row.comparison].filter((value): value is number => value !== null).map(Math.abs)));
  const scale = maxMagnitude || 1;

  const barStyle = (value: number | null, color: string, estimated: boolean, outlined: boolean) => {
    const width = value === null ? 0 : Math.abs(value) / scale * 50;
    return {
      left: value !== null && value < 0 ? `${50 - width}%` : '50%',
      width: `${width}%`,
      background: estimated
        ? `repeating-linear-gradient(135deg, ${color} 0 2px, transparent 2px 5px)`
        : outlined ? 'transparent' : color,
      border: estimated || outlined ? `1px ${estimated ? 'dashed' : 'solid'} ${color}` : 'none',
      opacity: outlined ? 0.8 : 1,
    };
  };

  const renderValue = (value: number | null, estimated: boolean | undefined, label: string, tooltip?: string) => (
    <span className="monthly-revenue-value" title={tooltip}>
      <span>{value === null ? 'Nicht verfügbar' : formatValue(value)}</span>
      {estimated && <span className="monthly-revenue-estimate" title={TAX_TEXTS.badge}>{TAX_TEXTS.badge}</span>}
      <span className="sr-only">{label}</span>
    </span>
  );

  return (
    <figure className="monthly-revenue-chart" aria-label={ariaLabel}>
      <figcaption className="monthly-revenue-caption">
        <span>Monatsvergleich</span>
        <span className="monthly-revenue-legend" aria-hidden="true">
          <span><i className="monthly-revenue-legend-current" />{currentLabel}</span>
          <span><i className="monthly-revenue-legend-comparison" />{comparisonLabel}</span>
        </span>
      </figcaption>

      <div className="monthly-revenue-rows" aria-hidden="true">
        {rows.map(row => (
          <div className="monthly-revenue-row" key={row.key}>
            <div className="monthly-revenue-label" title={row.tooltip}>{row.label}</div>
            <div className="monthly-revenue-pair">
              <div className="monthly-revenue-period">
                <span className="monthly-revenue-period-label">{currentLabel}</span>
                <div className="monthly-revenue-track">
                  <span className="monthly-revenue-zero" />
                  {row.current !== null && row.current !== 0 && <span className="monthly-revenue-bar" style={barStyle(row.current, row.color, !!row.currentEstimate, false)} />}
                </div>
                {renderValue(row.current, row.currentEstimate, currentLabel, row.tooltip)}
              </div>
              <div className="monthly-revenue-period">
                <span className="monthly-revenue-period-label">{comparisonLabel}</span>
                <div className="monthly-revenue-track">
                  <span className="monthly-revenue-zero" />
                  {row.comparison !== null && row.comparison !== 0 && <span className="monthly-revenue-bar" style={barStyle(row.comparison, row.color, !!row.comparisonEstimate, true)} />}
                </div>
                {renderValue(row.comparison, row.comparisonEstimate, comparisonLabel, row.tooltip)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* sr-only auf einem Wrapper: Tabellen ignorieren width:1px und erzeugten mobil horizontale Überbreite. */}
      <div className="sr-only">
      <table>
        <caption>{ariaLabel}</caption>
        <thead><tr><th scope="col">Reihe</th><th scope="col">{currentLabel}</th><th scope="col">{comparisonLabel}</th></tr></thead>
        <tbody>{rows.map(row => (
          <tr key={row.key}>
            <th scope="row">{row.label}</th>
            <td>{row.current === null ? 'Nicht verfügbar' : `${formatValue(row.current)}${row.currentEstimate ? `, ${TAX_TEXTS.badge}` : ''}`}</td>
            <td>{row.comparison === null ? 'Nicht verfügbar' : `${formatValue(row.comparison)}${row.comparisonEstimate ? `, ${TAX_TEXTS.badge}` : ''}`}</td>
          </tr>
        ))}</tbody>
      </table>
      </div>

      <style>{`
        .monthly-revenue-chart { min-width: 0; color: var(--dashboard-chart-axis); }
        .monthly-revenue-caption { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem .75rem; margin-bottom: .75rem; color: var(--dashboard-chart-axis); font-size: .8125rem; font-weight: 600; }
        .monthly-revenue-legend { display: flex; flex-wrap: wrap; gap: .5rem .875rem; font-size: .6875rem; font-weight: 400; }
        .monthly-revenue-legend > span { display: inline-flex; min-width: 0; align-items: center; gap: .35rem; overflow-wrap: anywhere; }
        .monthly-revenue-legend i { display: inline-block; width: .8rem; height: .65rem; flex: 0 0 auto; border-radius: 2px; }
        .monthly-revenue-legend-current { background: var(--dashboard-chart-line); }
        .monthly-revenue-legend-comparison { border: 1px solid var(--dashboard-chart-line); background: color-mix(in srgb, var(--dashboard-chart-line) 22%, transparent); }
        .monthly-revenue-rows { display: grid; gap: .9rem; }
        .monthly-revenue-row { min-width: 0; border-top: 1px solid var(--dashboard-chart-grid); padding-top: .6rem; }
        .monthly-revenue-label { min-width: 0; margin-bottom: .4rem; color: var(--dashboard-chart-axis); font-size: .8125rem; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
        .monthly-revenue-pair { display: grid; gap: .45rem; }
        .monthly-revenue-period { display: grid; min-width: 0; grid-template-columns: minmax(4.5rem, 1fr) minmax(4.5rem, 2fr) minmax(5rem, 1fr); align-items: center; gap: .5rem; }
        .monthly-revenue-period-label { min-width: 0; color: var(--dashboard-chart-axis); font-size: .6875rem; line-height: 1.25; overflow-wrap: anywhere; }
        .monthly-revenue-track { position: relative; height: .8rem; min-width: 0; border-radius: 2px; background: var(--dashboard-chart-grid); }
        .monthly-revenue-zero { position: absolute; z-index: 1; top: -2px; bottom: -2px; left: 50%; width: 1px; background: var(--dashboard-chart-axis); opacity: .75; }
        .monthly-revenue-bar { position: absolute; top: 1px; bottom: 1px; border-radius: 2px; }
        .monthly-revenue-value { display: flex; min-width: 0; flex-wrap: wrap; align-items: baseline; gap: .2rem .35rem; color: var(--dashboard-chart-axis); font-size: .75rem; font-variant-numeric: tabular-nums; line-height: 1.3; overflow-wrap: anywhere; }
        .monthly-revenue-estimate { color: #92400e; font-size: .625rem; }
        #app-shell[data-theme="dark"] .monthly-revenue-estimate { color: #fcd34d; }
        @media (max-width: 420px) {
          .monthly-revenue-period { grid-template-columns: minmax(4rem, .9fr) minmax(3rem, 1.3fr) minmax(4.5rem, 1fr); gap: .35rem; }
          .monthly-revenue-period-label { font-size: .625rem; }
          .monthly-revenue-value { font-size: .6875rem; }
          .monthly-revenue-legend { gap: .35rem .6rem; }
        }
      `}</style>
    </figure>
  );
}
