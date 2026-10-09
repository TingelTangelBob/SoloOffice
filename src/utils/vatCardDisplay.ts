import type { VatOverview, VatPaymentStatus, VatPeriodResult } from '../types/vat';

export type VatCardTone = 'positive' | 'negative' | 'warning' | 'info' | 'neutral';

const PAYMENT_BADGE: Record<VatPaymentStatus, { label: string; tone: VatCardTone }> = {
  open: { label: 'offen', tone: 'warning' },
  partial: { label: 'teilweise bezahlt', tone: 'warning' },
  paid: { label: 'bezahlt', tone: 'positive' },
  overpaid: { label: 'überzahlt', tone: 'info' },
  settled: { label: 'erstattet', tone: 'positive' },
  refund_open: { label: 'Erstattung erwartet', tone: 'info' },
  not_due: { label: 'läuft noch', tone: 'neutral' },
  none: { label: 'keine Zahllast', tone: 'neutral' },
};

/** Zeitraum der Kachel: nächste Fälligkeit, sonst letzter abgeschlossener, sonst laufender Zeitraum. */
export function relevantVatPeriod(overview: Pick<VatOverview, 'periods' | 'nextDue'>): VatPeriodResult | null {
  const { periods, nextDue } = overview;
  if (nextDue) {
    const due = periods.find(item => item.key === nextDue.periodKey);
    if (due) return due;
  }
  const closed = periods.filter(item => item.state === 'closed');
  if (closed.length) return closed[closed.length - 1];
  return periods.find(item => item.state === 'running') ?? null;
}

export function vatPaymentBadge(period: Pick<VatPeriodResult, 'paymentStatus' | 'overdue'>): { label: string; tone: VatCardTone } {
  if (period.paymentStatus === 'open' && period.overdue) return { label: 'überfällig', tone: 'negative' };
  return PAYMENT_BADGE[period.paymentStatus];
}

/** Angezeigter Betrag: berechnet bei vollständigen Daten, sonst Schätzung inklusive Vorschlägen. */
export function vatDisplayedAmount(period: Pick<VatPeriodResult, 'complete' | 'liability' | 'estimatedLiability'>): number {
  return period.complete ? period.liability : period.estimatedLiability;
}

export function vatBasisText(period: Pick<VatPeriodResult, 'complete' | 'incompleteEntryIds'>): string {
  if (period.complete) return 'Aus deinen erfassten Belegen berechnet.';
  const count = period.incompleteEntryIds.length;
  if (count === 0) return 'Schätzung · Zeitraum enthält noch unvollständige Angaben.';
  return `Schätzung · ${count} ${count === 1 ? 'Buchung' : 'Buchungen'} ohne USt-Angaben.`;
}
