import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasRunningSubscription,
  isSubscriptionConfirmed,
  paymentStatusLabel,
  readCheckoutReturn,
  stripHashQuery,
  subscriptionKind,
} from '../../.test-dist/utils/accountBillingDisplay.js';
import { searchSettings } from '../../.test-dist/utils/settingsSearch.js';

const sub = overrides => ({ planId: 'pro', planName: 'Pro', status: 'active', access: 'active', currentPeriodEnd: '2026-12-01T00:00:00.000Z', cancelAtPeriodEnd: false, graceUntil: null, hasStripeCustomer: true, ...overrides });

test('subscriptionKind bildet Abo-Zustände auf Darstellungszustände ab', () => {
  assert.equal(subscriptionKind(null), 'none');
  assert.equal(subscriptionKind(sub({})), 'active');
  assert.equal(subscriptionKind(sub({ status: 'trialing' })), 'trial');
  assert.equal(subscriptionKind(sub({ cancelAtPeriodEnd: true })), 'cancelling');
  assert.equal(subscriptionKind(sub({ status: 'past_due', access: 'grace' })), 'overdue');
  assert.equal(subscriptionKind(sub({ status: 'unpaid', access: 'suspended' })), 'suspended');
  assert.equal(subscriptionKind(sub({ status: 'canceled', access: 'suspended' })), 'suspended');
  assert.equal(subscriptionKind(sub({ status: 'canceled', access: null })), 'ended');
  assert.equal(subscriptionKind(sub({ status: 'incomplete', access: null })), 'none');
});

test('Checkout ist nur ohne laufendes Abo sinnvoll, Bestätigung nur bei bezahltem Abo', () => {
  assert.equal(hasRunningSubscription('active'), true);
  assert.equal(hasRunningSubscription('overdue'), true);
  assert.equal(hasRunningSubscription('none'), false);
  assert.equal(hasRunningSubscription('ended'), false);
  assert.equal(isSubscriptionConfirmed(sub({})), true);
  assert.equal(isSubscriptionConfirmed(sub({ status: 'past_due' })), false);
  assert.equal(isSubscriptionConfirmed(null), false);
});

test('Rückkehr aus dem Checkout wird aus dem Hash gelesen und entfernt', () => {
  assert.equal(readCheckoutReturn('#settings/billing?checkout=success'), 'success');
  assert.equal(readCheckoutReturn('#settings/billing?checkout=cancelled'), 'cancelled');
  assert.equal(readCheckoutReturn('#settings/billing?checkout=boese'), null);
  assert.equal(readCheckoutReturn('#settings/billing'), null);
  assert.equal(stripHashQuery('#settings/billing?checkout=success'), '#settings/billing');
  assert.equal(stripHashQuery('#settings/billing'), '#settings/billing');
});

test('Zahlungsstatus hat deutsche Beschriftungen', () => {
  assert.equal(paymentStatusLabel('paid').label, 'Bezahlt');
  assert.equal(paymentStatusLabel('failed').tone, 'warning');
  assert.equal(paymentStatusLabel('xyz').label, 'Unbekannt');
});

test('Einstellungssuche findet Tarif & Abrechnung, außer der Bereich ist ausgeblendet', () => {
  for (const term of ['Tarif', 'Abo', 'Rechnung', 'Zahlungsart', 'kündigen']) {
    assert.ok(searchSettings(term).some(result => result.area === 'billing'), `${term} findet billing nicht`);
  }
  const hidden = new Set(['billing']);
  for (const term of ['Tarif', 'Abo', 'Zahlungsart', 'kündigen']) {
    assert.ok(!searchSettings(term, 8, hidden).some(result => result.area === 'billing'));
  }
});

test('Grenzen in Einzahl und Mehrzahl, Laufzeitzeile nur bei Stripe-Abo mit „Verlängert“', async () => {
  const { limitPhrase, activePeriodText } = await import('../../.test-dist/utils/accountBillingDisplay.js');
  assert.equal(limitPhrase(1, 'Mitglied', 'Mitglieder'), 'bis zu 1 Mitglied');
  assert.equal(limitPhrase(5, 'Mitglied', 'Mitglieder'), 'bis zu 5 Mitglieder');
  assert.equal(limitPhrase(1, 'Workspace', 'Workspaces'), 'bis zu 1 Workspace');
  assert.equal(limitPhrase(null, 'Mitglied', 'Mitglieder'), '');
  assert.equal(activePeriodText({ hasStripeCustomer: true }, '20.11.2026'), 'Verlängert sich am 20.11.2026.');
  assert.equal(activePeriodText({ hasStripeCustomer: false }, '20.11.2026'), 'Zugang bis 20.11.2026.');
});
