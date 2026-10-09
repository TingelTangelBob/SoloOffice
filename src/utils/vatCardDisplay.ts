import type { VatOverview, VatPaymentStatus, VatPeriodResult } from '../types/vat';

export type VatCardTone = 'positive' | 'negative' | 'warning' | 'info' | 'neutral';

function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Standardzeitraum für Kachel und USt-Seite: der als Nächstes fällige Zeitraum
 * (Fälligkeit heute oder später), sonst der laufende. Überfällige Altzeiträume
 * werden nicht vorausgewählt, sondern bleiben über ihre Warnung sichtbar.
 */
export function defaultVatPeriod(
  periods: VatOverview['periods'],
  nextDue: Pick<NonNullable<VatOverview['nextDue']>, 'periodKey'> & Partial<Pick<NonNullable<VatOverview['nextDue']>, 'dueDate'>> | null,
  today: string = localIsoDate(new Date()),
): VatPeriodResult | null {
  const upcoming = periods
    .filter(item => item.state === 'closed' && item.dueDate && item.dueDate >= today)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];
  if (upcoming) return upcoming;
  if (nextDue && (!nextDue.dueDate || nextDue.dueDate >= today)) {
    const due = periods.find(item => item.key === nextDue.periodKey);
    if (due) return due;
  }
  return periods.find(item => item.state === 'running')
    ?? periods.find(item => item.state === 'future')
    ?? periods.filter(item => item.state === 'closed').at(-1)
    ?? null;
}

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
  return defaultVatPeriod(overview.periods, overview.nextDue);
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
