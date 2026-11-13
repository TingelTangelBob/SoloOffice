import type { AccountSubscription } from '../types';

/** Darstellungszustand des Abos in „Tarif & Abrechnung“. */
export type SubscriptionKind = 'none' | 'active' | 'trial' | 'cancelling' | 'overdue' | 'suspended' | 'ended';

export function subscriptionKind(subscription: AccountSubscription | null | undefined): SubscriptionKind {
  if (!subscription) return 'none';
  const status = subscription.status;
  if (subscription.access === 'suspended' || status === 'unpaid' || status === 'paused') return 'suspended';
  if (status === 'past_due' || subscription.access === 'grace') return 'overdue';
  if (status === 'canceled' || status === 'incomplete_expired') return 'ended';
  if (status === 'active' || status === 'trialing') {
    if (subscription.cancelAtPeriodEnd) return 'cancelling';
    return status === 'trialing' ? 'trial' : 'active';
  }
  return 'none';
}

/** Läuft ein Abo, das der Checkout nicht noch einmal anlegen darf (das Control Plane lehnt es mit 409 ab). */
export function hasRunningSubscription(kind: SubscriptionKind): boolean {
  return kind === 'active' || kind === 'trial' || kind === 'cancelling' || kind === 'overdue';
}

/** „bis zu 1 Mitglied“ / „bis zu 3 Mitglieder“; `null` bedeutet unbegrenzt und ergibt keinen Text. */
export function limitPhrase(max: number | null, singular: string, plural: string): string {
  if (max === null) return '';
  return `bis zu ${max} ${max === 1 ? singular : plural}`;
}

/**
 * Laufzeitzeile eines aktiven Abos. „Verlängert sich“ gilt nur bei einem
 * laufenden Stripe-Abo (Zahlungskunde vorhanden); ein manuell vergebener Zugang
 * endet einfach an dem Datum.
 */
export function activePeriodText(subscription: Pick<AccountSubscription, 'hasStripeCustomer'>, formattedDay: string): string {
  return subscription.hasStripeCustomer ? `Verlängert sich am ${formattedDay}.` : `Zugang bis ${formattedDay}.`;
}

/** Abo ist bezahlt und nutzbar; Ziel der Nachfrage nach dem Checkout. */
export function isSubscriptionConfirmed(subscription: AccountSubscription | null | undefined): boolean {
  const kind = subscriptionKind(subscription);
  return kind === 'active' || kind === 'trial' || kind === 'cancelling';
}

export type CheckoutReturn = 'success' | 'cancelled';

/** Liest `#settings/billing?checkout=success|cancelled` aus dem Hash. */
export function readCheckoutReturn(hash: string): CheckoutReturn | null {
  const query = hash.split('?')[1];
  if (!query) return null;
  const value = new URLSearchParams(query).get('checkout');
  return value === 'success' || value === 'cancelled' ? value : null;
}

/** Hash ohne Query-Anteil, damit die Meldung beim Neuladen nicht wiederkehrt. */
export function stripHashQuery(hash: string): string {
  return hash.split('?')[0];
}

export const CHECKOUT_POLL_INTERVAL_MS = 3_000;
export const CHECKOUT_POLL_MAX_MS = 30_000;

export function formatInterval(interval: string): string {
  if (interval === 'month') return 'Monat';
  if (interval === 'year') return 'Jahr';
  return interval;
}

export function paymentStatusLabel(status: string): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  switch (status) {
    case 'paid': case 'succeeded': return { label: 'Bezahlt', tone: 'success' };
    case 'open': case 'pending': case 'processing': return { label: 'Offen', tone: 'warning' };
    case 'failed': case 'uncollectible': return { label: 'Fehlgeschlagen', tone: 'warning' };
    case 'refunded': return { label: 'Erstattet', tone: 'neutral' };
    default: return { label: 'Unbekannt', tone: 'neutral' };
  }
}
