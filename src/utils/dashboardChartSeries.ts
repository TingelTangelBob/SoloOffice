import type { RevenueChartOverlay } from '../components/RevenueAreaChart';
import { aggregateRevenue, type DashboardRevenueRecord } from './dashboardMetrics';
import type { DashboardPreferences } from './dashboardPreferences';

/**
 * Zuschaltbare Zusatzlinien im Umsatzverlauf.
 *
 * Jede Reihe bringt ihren Menüeintrag (Schalter im 3-Punkte-Menü), ihren
 * gespeicherten Zustand und die Berechnung ihrer Punkte mit. Das Menü und das
 * Diagramm iterieren nur über diese Liste. Eine neue Reihe (z. B. Fixkosten,
 * Sozialbeiträge, voraussichtliche Steuern) braucht:
 * 1. ein boolesches Feld in `backend/utils/dashboardPreferences.js`
 *    (Normalisierung: `value.feld === true`, keine Migration nötig),
 * 2. einen Eintrag hier mit `isActive`/`toggle`/`build`,
 * 3. Punkte auf derselben Monats- bzw. Jahresachse wie der Umsatz.
 */
export interface RevenueSeriesContext {
  preferences: DashboardPreferences;
  allYears: boolean;
  year: number | 'all';
  records: DashboardRevenueRecord[];
  locale: string;
}

export interface RevenueSeriesDefinition {
  id: string;
  menuLabel: string;
  /** Kurzer Grund, wenn die Reihe im aktuellen Zeitraum nicht verfügbar ist. */
  unavailableReason: (context: RevenueSeriesContext) => string | null;
  isActive: (preferences: DashboardPreferences) => boolean;
  toggle: (preferences: DashboardPreferences) => DashboardPreferences;
  build: (context: RevenueSeriesContext) => RevenueChartOverlay | null;
}

export const REVENUE_CHART_SERIES: RevenueSeriesDefinition[] = [
  {
    id: 'previous-period',
    menuLabel: 'Mit Vorzeitraum vergleichen',
    unavailableReason: ({ allYears }) => allYears ? 'Für den gesamten Zeitraum gibt es keinen einzelnen Vorzeitraum.' : null,
    isActive: preferences => preferences.comparePrevious && preferences.year !== 'all',
    toggle: preferences => ({ ...preferences, comparePrevious: !preferences.comparePrevious }),
    build: ({ allYears, year, records, locale, preferences }) => {
      if (allYears || year === 'all' || !preferences.comparePrevious) return null;
      return {
        key: 'previous-period',
        label: String(year - 1),
        points: aggregateRevenue(records, year - 1, locale),
        dashed: true,
      };
    },
  },
];
