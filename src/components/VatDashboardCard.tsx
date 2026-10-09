import type { ReactNode } from 'react';
import type { VatOverview } from '../types/vat';
import { relevantVatPeriod, vatBasisText, vatDisplayedAmount, vatPaymentBadge } from '../utils/vatCardDisplay';
import { DashboardEmptyState } from './DashboardEmptyState';
import { FloatingInfoTooltip } from './InfoTooltip';
import { MetricBadge, MetricCard, MetricCardContent, MetricCardDescription, MetricCardHeader, MetricCardTitle, MetricValue } from './DashboardMetrics';

interface VatDashboardCardProps {
  overview: VatOverview | null;
  loading: boolean;
  error: string | null;
  year: number;
  onOpen: () => void;
  onSetup: () => void;
}

type CardBodyProps = VatDashboardCardProps;

const TITLE = 'Umsatzsteuer-Voranmeldung';
const SETUP_LABEL = 'Steuern & Abgaben einrichten';

const money = (amount: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
const dateLabel = (date: string) => new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));

/** Plain function statt Komponente, damit Aktionen im Elementbaum direkt auffindbar bleiben. */
function renderBody({ overview, loading, error, year, onOpen, onSetup }: CardBodyProps): ReactNode {
  if (loading) return <p role="status" className="px-4 py-6 text-sm text-gray-500">Umsatzsteuer wird geladen …</p>;
  if (error) return <div className="px-4 py-5"><p role="alert" className="text-sm text-red-700">{error}</p><p className="mt-1 text-xs text-gray-500">Es werden keine älteren Werte dieses Workspaces angezeigt.</p></div>;
  if (!overview) return <DashboardEmptyState variant="metric" title="Umsatzsteuer noch nicht eingerichtet" description="Umsatzsteuerstatus und Voranmeldungszeitraum stehen im Steuerprofil." action={{ label: SETUP_LABEL, onClick: onSetup }} />;

  if (!overview.applicable) {
    if (overview.vatStatus === null) {
      return <DashboardEmptyState variant="metric" title="Umsatzsteuerstatus im Steuerprofil festlegen" action={{ label: SETUP_LABEL, onClick: onSetup }} />;
    }
    const text = overview.vatStatus === 'small_business'
      ? 'Kleinunternehmerregelung: keine Umsatzsteuer-Voranmeldung.'
      : 'Für dieses Steuerprofil ist keine Umsatzsteuer-Voranmeldung vorgesehen.';
    return <p className="px-4 pb-4 text-sm text-gray-600">{text}</p>;
  }

  const period = relevantVatPeriod(overview);
  if (!period) {
    return <p className="px-4 pb-4 text-sm text-gray-600">Für {year} liegt noch kein Zeitraum mit Umsatzsteuerdaten vor.</p>;
  }

  const amount = vatDisplayedAmount(period);
  const badge = vatPaymentBadge(period);

  return <div className="space-y-3 px-4 pb-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-medium text-gray-700">{period.label}</p>
      <MetricBadge tone={badge.tone}>{badge.label}</MetricBadge>
    </div>
    <div>
      <MetricValue>{money(Math.abs(amount))}</MetricValue>
      <MetricCardDescription>{amount < 0 ? 'Überschuss' : 'Zahllast'}</MetricCardDescription>
    </div>
    <p className="text-xs text-gray-600">Fälligkeit: {period.dueDate ? dateLabel(period.dueDate) : 'keine Vorauszahlungsfälligkeit'}</p>
    <p className="text-xs text-gray-600">{vatBasisText(period)}</p>
    <p className="text-xs text-gray-600">Jahr {year}: Zahllast {money(overview.annual.liability)} · gezahlt {money(overview.annual.paid)}</p>
    <button type="button" className="action-button" onClick={onOpen}>Umsatzsteuer öffnen</button>
  </div>;
}

export function VatDashboardCard({ overview, loading, error, year, onOpen, onSetup }: VatDashboardCardProps) {
  return <MetricCard>
    <MetricCardHeader bordered>
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0"><MetricCardTitle>{TITLE}</MetricCardTitle></div>
        <FloatingInfoTooltip
          text={`Orientierung aus deinen erfassten Rechnungen und Belegen (Steuerjahr ${year}). Keine Steuerberatung, keine Voranmeldung und keine ELSTER-Übermittlung.`}
          label={`Hinweise zu ${TITLE}`}
        />
      </div>
      <MetricBadge tone="warning" className="max-w-[9rem] whitespace-normal text-center">Orientierung</MetricBadge>
    </MetricCardHeader>
    <MetricCardContent className="flex flex-1 flex-col">
      {renderBody({ overview, loading, error, year, onOpen, onSetup })}
    </MetricCardContent>
  </MetricCard>;
}
