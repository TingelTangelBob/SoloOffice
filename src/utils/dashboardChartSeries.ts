import type { ForecastResult } from '../types/finance';
import type { RevenueChartOverlay, RevenuePoint } from '../components/RevenueAreaChart';
import { aggregateRevenue, type DashboardRevenueRecord } from './dashboardMetrics';
import type { DashboardPreferences } from './dashboardPreferences';
import { TAX_TEXTS } from '../../backend/shared/taxTexts.js';

export interface RevenueSeriesContext {
  preferences: DashboardPreferences;
  allYears: boolean;
  year: number | 'all';
  records: DashboardRevenueRecord[];
  locale: string;
  forecast?: ForecastResult | null;
  taxesEnabled?: boolean;
}

export interface RevenueSeriesDefinition {
  id: string;
  menuLabel: string;
  group?: 'comparison' | 'levies';
  private?: boolean;
  unavailableReason: (context: RevenueSeriesContext) => string | null;
  isActive: (preferences: DashboardPreferences) => boolean;
  toggle: (preferences: DashboardPreferences) => DashboardPreferences;
  build: (context: RevenueSeriesContext) => RevenueChartOverlay | null;
}

const FORECAST_DISABLED = 'Für dieses Jahr liegt keine vollständige Schätzgrundlage vor. Bitte Angaben unter „Steuern & Abgaben“ ergänzen.';
const yearlyForecast = (context: RevenueSeriesContext) => {
  if (context.allYears || context.year === 'all' || !Number.isInteger(context.year)) return null;
  const forecast = context.forecast;
  if (!context.taxesEnabled || !forecast || forecast.year !== context.year || !forecast.profileComplete) return null;
  return forecast;
};

const seriesSpecs = [
  { id: 'fixed-costs', preference: 'showFixedCosts', label: 'Fixkosten (betrieblich)', field: 'fixedCosts', private: false,
    tooltip: 'Betriebliche Fixkosten aus der Schätzung. Vergangene und geplante Werte können enthalten sein.' },
  { id: 'social-contributions', preference: 'showSocialContributions', label: 'Sozialbeiträge', field: 'social', private: true,
    tooltip: 'Unverbindliche Jahresschätzung, gleichmäßig auf Monate verteilt – auch vergangene Monate sind keine bestätigten Zahlungen.' },
  { id: 'tax-reserve', preference: 'showTaxReserve', label: 'Steuerrücklage', field: 'taxReserve', private: true,
    tooltip: 'Unverbindliche Steuerprognose, gleichmäßig auf Monate verteilt – keine Aussage über tatsächlich gezahlte Beträge.' },
  { id: 'vat-reserve', preference: 'showVatReserve', label: 'USt-Rücklage (grob)', field: 'vatReserve', private: false,
    tooltip: 'Grobe Umsatzsteuer-Schätzung aus erfassten Bruttowerten und Steuersätzen. Vorsteuer und Sonderfälle können fehlen.' },
] as const;

function makeOverlay(context: RevenueSeriesContext, spec: typeof seriesSpecs[number]): RevenueChartOverlay | null {
  const forecast = yearlyForecast(context);
  if (!forecast) return null;
  const points = forecast.monthly.map(month => ({
    key: month.month,
    label: new Intl.DateTimeFormat(context.locale, { month: 'long', year: 'numeric' }).format(new Date(`${month.month}-01T00:00:00`)),
    shortLabel: new Intl.DateTimeFormat(context.locale, { month: 'short' }).format(new Date(`${month.month}-01T00:00:00`)).replace('.', ''),
    value: month[spec.field],
    forecast: month.forecast,
  }));
  const estimatedHistory = spec.id === 'social-contributions' || spec.id === 'tax-reserve';
  return {
    key: spec.id,
    label: spec.label,
    points,
    kind: 'bar',
    stackGroup: 'deductions',
    estimated: true,
    tooltip: `${spec.tooltip} ${TAX_TEXTS.badge}. ${TAX_TEXTS.tooltip(forecast.year)}${estimatedHistory ? ' Vergangene Monatswerte sind ebenfalls verteilte Schätzungen und keine Ist-Zahlungen.' : ''}`,
    color: ({ 'fixed-costs': '#64748b', 'social-contributions': '#8b5cf6', 'tax-reserve': '#f97316', 'vat-reserve': '#fb923c' } as const)[spec.id],
  };
}

const forecastReason = (context: RevenueSeriesContext) => {
  if (context.allYears || context.year === 'all' || !Number.isInteger(context.year)) return 'Wähle ein einzelnes Jahr für die Monatsprognose.';
  if (!context.taxesEnabled) return 'Die Erweiterung „Steuern & Abgaben“ ist nicht aktiv.';
  if (!context.forecast || context.forecast.year !== context.year) return FORECAST_DISABLED;
  if (!context.forecast.profileComplete) return `Für eine vollständigere Prognose fehlen Angaben: ${context.forecast.missingFields.join(', ')}.`;
  return null;
};

function activeSeries(id: string, preference: keyof DashboardPreferences, isPrivate = false): RevenueSeriesDefinition {
  const spec = seriesSpecs.find(item => item.id === id);
  return {
    id, menuLabel: spec?.label ?? 'Verfügbar', group: 'levies', private: isPrivate,
    unavailableReason: context => forecastReason(context) ?? (id === 'vat-reserve' && context.forecast?.vatStatus !== 'regular' ? 'Die grobe USt-Rücklage ist nur bei Regelbesteuerung verfügbar.' : null),
    isActive: preferences => Boolean(preferences[preference]) && (!isPrivate || preferences.showPrivateLevies),
    toggle: preferences => ({ ...preferences, [preference]: !preferences[preference] }),
    build: context => {
      if (!context.preferences[preference] || (id === 'vat-reserve' && context.forecast?.vatStatus !== 'regular')) return null;
      if (isPrivate && !context.preferences.showPrivateLevies) return null;
      if (spec) return makeOverlay(context, spec);
      const forecast = yearlyForecast(context);
      if (!forecast) return null;
      const selected = seriesSpecs.filter(item => context.preferences[item.preference]
        && (!item.private || context.preferences.showPrivateLevies)
        && (item.id !== 'vat-reserve' || forecast.vatStatus === 'regular'));
      const points = forecast.monthly.map(month => {
        const deductions = selected.reduce((sum, item) => sum + month[item.field], 0);
        return {
          key: month.month,
          label: new Intl.DateTimeFormat(context.locale, { month: 'long', year: 'numeric' }).format(new Date(`${month.month}-01T00:00:00`)),
          shortLabel: new Intl.DateTimeFormat(context.locale, { month: 'short' }).format(new Date(`${month.month}-01T00:00:00`)).replace('.', ''),
          value: month.revenue - deductions,
          forecast: month.forecast,
        };
      });
      return { key: id, label: 'Verfügbar', points, kind: 'line', color: '#0f766e', estimated: true,
        tooltip: `Prognostizierter Umsatz abzüglich ausschließlich der eingeblendeten Fixkosten und Abgaben. Variable Ausgaben werden nicht abgezogen. ${TAX_TEXTS.badge}. ${TAX_TEXTS.tooltip(forecast.year)}` };
    },
  };
}

export const REVENUE_CHART_SERIES: RevenueSeriesDefinition[] = [
  {
    id: 'previous-period', group: 'comparison', menuLabel: 'Mit Vorzeitraum vergleichen',
    unavailableReason: ({ allYears }) => allYears ? 'Für den gesamten Zeitraum gibt es keinen einzelnen Vorzeitraum.' : null,
    isActive: preferences => preferences.comparePrevious && preferences.year !== 'all',
    toggle: preferences => ({ ...preferences, comparePrevious: !preferences.comparePrevious }),
    build: ({ allYears, year, records, locale, preferences }) => {
      if (allYears || year === 'all' || !preferences.comparePrevious) return null;
      return { key: 'previous-period', label: String(year - 1), points: aggregateRevenue(records, year - 1, locale), dashed: true, kind: 'line' };
    },
  },
  ...seriesSpecs.map(spec => activeSeries(spec.id, spec.preference, spec.private)),
  activeSeries('available', 'showAvailable'),
];

/** Prognosemonate ersetzen den Ist-Umsatzwert; Ist-Monate bleiben unverändert. */
export function getForecastRevenuePoints(
  forecast: ForecastResult | null | undefined,
  actualPoints: RevenuePoint[],
  locale = 'de-DE',
): RevenuePoint[] {
  if (!forecast) return actualPoints;
  const actualByKey = new Map(actualPoints.map(point => [point.key, point]));
  return forecast.monthly.map(month => {
    const actual = actualByKey.get(month.month);
    const labelDate = new Date(`${month.month}-01T00:00:00`);
    return {
      key: month.month,
      label: actual?.label ?? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(labelDate),
      shortLabel: actual?.shortLabel ?? new Intl.DateTimeFormat(locale, { month: 'short' }).format(labelDate).replace('.', ''),
      value: month.forecast ? month.revenue : actual?.value ?? month.revenue,
      forecast: month.forecast,
    };
  });
}
