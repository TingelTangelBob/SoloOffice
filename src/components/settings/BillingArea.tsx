import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CreditCard, ExternalLink, FileText, Loader2, Receipt, RefreshCw, Wallet } from 'lucide-react';
import { SettingsCard, SettingsField } from './SettingsUi';
import { settingsInputClass } from './settingsStyles';
import { Notice } from '../Notice';
import { SkeletonBlock } from '../TableSkeleton';
import { apiService } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { useAccountBillingStatus } from '../../hooks/useAccountBilling';
import { formatCurrency, formatDate } from '../../utils/formatters';
import {
  activePeriodText,
  CHECKOUT_POLL_INTERVAL_MS,
  CHECKOUT_POLL_MAX_MS,
  formatInterval,
  hasRunningSubscription,
  isSubscriptionConfirmed,
  limitPhrase,
  paymentStatusLabel,
  readCheckoutReturn,
  stripHashQuery,
  subscriptionKind,
  type CheckoutReturn,
  type SubscriptionKind,
} from '../../utils/accountBillingDisplay';
import type { AccountBillingProfile, AccountOverview, AccountPayment, AccountPlan } from '../../types';

const EMPTY_PROFILE: AccountBillingProfile = {
  legalName: '', contactName: '', billingEmail: '', vatId: '', addressLine1: '', addressLine2: '',
  postalCode: '', city: '', countryCode: 'DE', purchaseOrderRef: '',
};

const KIND_BADGE: Record<SubscriptionKind, { label: string; className: string }> = {
  none: { label: 'Kein Tarif', className: 'bg-gray-100 text-gray-700' },
  active: { label: 'Aktiv', className: 'bg-green-100 text-green-800' },
  trial: { label: 'Testzeitraum', className: 'bg-primary-light-custom text-primary-custom' },
  cancelling: { label: 'Gekündigt', className: 'bg-amber-100 text-amber-800' },
  overdue: { label: 'Zahlung überfällig', className: 'bg-red-100 text-red-800' },
  suspended: { label: 'Gesperrt', className: 'bg-red-100 text-red-800' },
  ended: { label: 'Beendet', className: 'bg-gray-100 text-gray-700' },
};

const PAYMENT_TONE = {
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-800',
  neutral: 'bg-gray-100 text-gray-700',
} as const;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Bereich „Tarif & Abrechnung“: Abo, Stripe-Checkout und -Portal, Zahlungsverlauf, Rechnungsanschrift. */
export function BillingArea() {
  const { workspace } = useAuth();
  const { company } = useCompany();
  const status = useAccountBillingStatus(workspace?.id);
  const locale = company.locale || 'de-DE';
  const money = (cents: number | null, currency: string) => (cents === null ? '' : formatCurrency(cents / 100, locale, company.numberFormat, currency));
  const day = (value: string | null) => formatDate(value, locale, company.dateFormat);

  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const [plans, setPlans] = useState<AccountPlan[] | null>(null);
  const [payments, setPayments] = useState<AccountPayment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [plansError, setPlansError] = useState('');
  const [historyError, setHistoryError] = useState('');

  const [checkoutReturn, setCheckoutReturn] = useState<CheckoutReturn | null>(null);
  const [polling, setPolling] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);

  const [redirecting, setRedirecting] = useState(false);
  const [actionError, setActionError] = useState('');

  const [profile, setProfile] = useState<AccountBillingProfile>(EMPTY_PROFILE);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const profileDirty = useRef(false);

  const canManage = Boolean(status?.available && status.canManage);

  const loadOverview = useCallback(async (): Promise<AccountOverview> => {
    const data = await apiService.getAccountOverview();
    setOverview(data);
    if (!profileDirty.current) setProfile({ ...EMPTY_PROFILE, ...(data.billingProfile ?? {}) });
    return data;
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      await loadOverview();
    } catch (error) {
      setLoadError(errorText(error, 'Die Kontodaten konnten nicht geladen werden.'));
      setLoading(false);
      return;
    }
    setLoading(false);
    const [plansResult, historyResult] = await Promise.allSettled([apiService.getAccountPlans(), apiService.getAccountBillingHistory()]);
    if (plansResult.status === 'fulfilled') { setPlans(plansResult.value); setPlansError(''); } else setPlansError(errorText(plansResult.reason, 'Die Tarife konnten nicht geladen werden.'));
    if (historyResult.status === 'fulfilled') { setPayments(historyResult.value); setHistoryError(''); } else setHistoryError(errorText(historyResult.reason, 'Der Zahlungsverlauf konnte nicht geladen werden.'));
  }, [loadOverview]);

  // Rückkehr von Stripe: Meldung merken und den Query-Anteil aus der Adresse entfernen.
  useEffect(() => {
    const returned = readCheckoutReturn(window.location.hash);
    if (!returned) return;
    setCheckoutReturn(returned);
    const url = new URL(window.location.href);
    url.hash = stripHashQuery(url.hash);
    window.history.replaceState(window.history.state, '', url);
  }, []);

  useEffect(() => {
    if (canManage) void loadAll();
  }, [canManage, loadAll]);

  // Nach erfolgreicher Zahlung kommt die Bestätigung per Webhook; bis zu 30 Sekunden alle 3 Sekunden nachfragen.
  const overviewRef = useRef<AccountOverview | null>(null);
  overviewRef.current = overview;
  const overviewReady = overview !== null;
  useEffect(() => {
    if (checkoutReturn !== 'success' || !overviewReady) return;
    if (isSubscriptionConfirmed(overviewRef.current?.subscription)) return;
    setPolling(true);
    const startedAt = Date.now();
    let stopped = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const data = await loadOverview();
          if (stopped) return;
          if (isSubscriptionConfirmed(data.subscription)) {
            window.clearInterval(timer);
            setPolling(false);
            void apiService.getAccountBillingHistory().then(list => { if (!stopped) setPayments(list); }).catch(() => undefined);
            return;
          }
        } catch { /* nächste Runde */ }
        if (!stopped && Date.now() - startedAt >= CHECKOUT_POLL_MAX_MS) {
          window.clearInterval(timer);
          setPolling(false);
          setPollTimedOut(true);
        }
      })();
    }, CHECKOUT_POLL_INTERVAL_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [checkoutReturn, overviewReady, loadOverview]);

  const goToStripe = async (start: () => Promise<{ url: string }>) => {
    if (redirecting) return;
    setActionError('');
    setRedirecting(true);
    try {
      const { url } = await start();
      window.location.assign(url);
    } catch (error) {
      setRedirecting(false);
      setActionError(errorText(error, 'Die Weiterleitung zum Zahlungsanbieter ist gerade nicht möglich.'));
    }
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (profileSaving) return;
    const errors: Record<string, string> = {};
    if (!profile.legalName.trim()) errors.legalName = 'Bitte Name oder Firma angeben.';
    if (!profile.addressLine1.trim()) errors.addressLine1 = 'Bitte Straße und Hausnummer angeben.';
    if (!profile.postalCode.trim()) errors.postalCode = 'Bitte Postleitzahl angeben.';
    if (!profile.city.trim()) errors.city = 'Bitte Ort angeben.';
    if (!/^[A-Za-z]{2}$/.test(profile.countryCode.trim())) errors.countryCode = 'Bitte zweistelligen Ländercode angeben, z. B. DE.';
    if (profile.billingEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.billingEmail.trim())) errors.billingEmail = 'Bitte eine gültige E-Mail-Adresse angeben.';
    setProfileErrors(errors);
    if (Object.keys(errors).length) {
      setProfileMessage({ type: 'error', text: 'Bitte prüfen Sie die markierten Felder.' });
      document.getElementById(`billing-${Object.keys(errors)[0]}`)?.focus();
      return;
    }
    setProfileSaving(true);
    setProfileMessage(null);
    try {
      const saved = await apiService.saveAccountBillingProfile({ ...profile, countryCode: profile.countryCode.trim().toUpperCase() });
      profileDirty.current = false;
      setProfile({ ...EMPTY_PROFILE, ...saved });
      setProfileMessage({ type: 'success', text: 'Rechnungsanschrift gespeichert.' });
    } catch (error) {
      setProfileMessage({ type: 'error', text: errorText(error, 'Die Rechnungsanschrift konnte nicht gespeichert werden.') });
    } finally {
      setProfileSaving(false);
    }
  };

  const updateProfile = (field: keyof AccountBillingProfile, value: string) => {
    profileDirty.current = true;
    setProfile(previous => ({ ...previous, [field]: value }));
    setProfileMessage(null);
  };

  // --- Zustände vor den Inhalten ---
  if (status === null) {
    return (
      <SettingsCard icon={CreditCard} title="Tarif & Abrechnung">
        <div role="status" aria-label="Lädt" className="space-y-3"><SkeletonBlock className="h-6 w-1/3" /><SkeletonBlock className="h-16 w-full" /></div>
      </SettingsCard>
    );
  }
  if (!status.available) {
    return (
      <SettingsCard icon={CreditCard} title="Tarif & Abrechnung">
        <p className="text-sm text-gray-600">Tarif und Abrechnung sind für diese Installation nicht verfügbar.</p>
      </SettingsCard>
    );
  }
  if (!status.canManage) {
    return (
      <SettingsCard icon={CreditCard} title="Tarif & Abrechnung">
        <p className="text-sm text-gray-600">Tarif und Abrechnung kann nur der Eigentümer des Workspace verwalten.</p>
      </SettingsCard>
    );
  }
  if (loading && !overview) {
    return (
      <div className="space-y-4" role="status" aria-label="Tarif und Abrechnung werden geladen">
        <SkeletonBlock className="h-40 w-full" />
        <SkeletonBlock className="h-32 w-full" />
      </div>
    );
  }
  if (loadError || !overview) {
    return (
      <Notice
        variant="error"
        title="Tarif und Abrechnung konnten nicht geladen werden"
        action={<button type="button" onClick={() => void loadAll()} className="btn-secondary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"><RefreshCw className="h-4 w-4" aria-hidden="true" />Erneut versuchen</button>}
      >
        {loadError || 'Bitte versuchen Sie es erneut.'}
      </Notice>
    );
  }

  const subscription = overview.subscription;
  const kind = subscriptionKind(subscription);
  const badge = KIND_BADGE[kind];
  const stripeReady = overview.stripeConfigured;
  const running = hasRunningSubscription(kind);
  const canCheckout = stripeReady && !running && kind !== 'suspended';
  const showPortal = stripeReady && Boolean(subscription?.hasStripeCustomer);
  const bookablePlans = (plans ?? []).filter(plan => plan.checkoutAvailable);

  const portalButton = (label: string, primary = false) => (
    <button
      type="button"
      onClick={() => void goToStripe(() => apiService.openAccountPortal())}
      disabled={redirecting}
      className={`${primary ? 'btn-primary' : 'btn-secondary'} inline-flex min-h-10 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <Wallet className="h-4 w-4" aria-hidden="true" />{label}
    </button>
  );

  return (
    <>
      {checkoutReturn === 'cancelled' && (
        <Notice variant="info" icon={AlertTriangle} onDismiss={() => setCheckoutReturn(null)}>Der Bezahlvorgang wurde abgebrochen. Es wurde nichts berechnet.</Notice>
      )}
      {checkoutReturn === 'success' && polling && (
        <Notice variant="info" icon={Loader2} title="Vielen Dank für Ihre Zahlung">Wir bestätigen die Zahlung gerade und aktivieren Ihr Abo. Das dauert meist nur wenige Sekunden.</Notice>
      )}
      {checkoutReturn === 'success' && !polling && !pollTimedOut && isSubscriptionConfirmed(subscription) && (
        <Notice variant="success" icon={CheckCircle2} title="Ihr Abo ist aktiv" onDismiss={() => setCheckoutReturn(null)}>Vielen Dank. Die Zahlung ist eingegangen und Ihr Tarif ist freigeschaltet.</Notice>
      )}
      {checkoutReturn === 'success' && pollTimedOut && (
        <Notice
          variant="warning"
          title="Die Bestätigung dauert länger als üblich"
          action={<button type="button" onClick={() => { setPollTimedOut(false); void loadAll(); }} className="btn-secondary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"><RefreshCw className="h-4 w-4" aria-hidden="true" />Aktualisieren</button>}
        >
          Ihr Abo erscheint hier, sobald die Zahlung bei uns eingegangen ist. Sie müssen nichts erneut bezahlen.
        </Notice>
      )}
      {redirecting && (
        <Notice variant="info" icon={Loader2}>Sie werden zu unserem Zahlungsanbieter Stripe weitergeleitet.</Notice>
      )}
      {actionError && <Notice variant="error" onDismiss={() => setActionError('')}>{actionError}</Notice>}

      <SettingsCard
        sectionId="tarif"
        icon={CreditCard}
        title="Aktueller Tarif"
        description={overview.account.email ? `Vertragskonto: ${overview.account.email}` : undefined}
        actions={showPortal ? portalButton('Zahlungsart und Rechnungen verwalten') : undefined}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-lg font-semibold text-gray-900">{subscription?.planName || 'Kein Tarif gebucht'}</p>
          <span className={`status-badge inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
        </div>

        {kind === 'active' && subscription?.currentPeriodEnd && <p className="mt-2 text-sm text-gray-600">{activePeriodText(subscription, day(subscription.currentPeriodEnd))}</p>}
        {kind === 'trial' && subscription?.currentPeriodEnd && <p className="mt-2 text-sm text-gray-600">Der Testzeitraum läuft bis {day(subscription.currentPeriodEnd)}.</p>}
        {kind === 'cancelling' && (
          <p className="mt-2 text-sm text-amber-800">
            Gekündigt zum {day(subscription?.currentPeriodEnd ?? null)}. Bis dahin können Sie SoloOffice wie bisher nutzen.
            {showPortal && ' Im Kundenportal lässt sich die Kündigung zurücknehmen.'}
          </p>
        )}
        {kind === 'overdue' && (
          <div className="mt-3"><Notice variant="warning" icon={AlertTriangle} title="Die letzte Zahlung ist nicht eingegangen">
            Bitte prüfen Sie Ihre Zahlungsart{subscription?.graceUntil ? `. Bis ${day(subscription.graceUntil)} können Sie SoloOffice weiter nutzen, danach wird der Zugang eingeschränkt` : ''}.
          </Notice></div>
        )}
        {kind === 'suspended' && (
          <div className="mt-3"><Notice variant="error" icon={AlertTriangle} title="Ihr Zugang ist eingeschränkt">
            Ihre Daten bleiben sichtbar und exportierbar. Sobald die offene Zahlung beglichen ist, wird der Zugang wieder freigegeben.
          </Notice></div>
        )}
        {kind === 'ended' && <p className="mt-2 text-sm text-gray-600">Ihr Abo ist beendet. Wählen Sie unten einen Tarif, um es neu zu starten.</p>}
        {kind === 'none' && <p className="mt-2 text-sm text-gray-600">Es besteht noch kein Abo.</p>}

        {overview.limits && (overview.limits.maxWorkspaces !== null || overview.limits.maxMembers !== null) && (
          <p className="mt-2 text-sm text-gray-600">
            Enthalten:{' '}
            {[
              limitPhrase(overview.limits.maxWorkspaces, 'Workspace', 'Workspaces'),
              limitPhrase(overview.limits.maxMembers, 'Mitglied', 'Mitglieder'),
            ].filter(Boolean).join(', ')}.
          </p>
        )}

        {!stripeReady && <p className="mt-3 text-sm text-gray-600">Die Abrechnung wird vom Anbieter verwaltet. Bei Fragen wenden Sie sich bitte an den Support.</p>}
        {stripeReady && kind === 'suspended' && showPortal && <div className="mt-3">{portalButton('Zahlungsart prüfen', true)}</div>}
        {stripeReady && kind === 'overdue' && showPortal && <div className="mt-3">{portalButton('Zahlungsart aktualisieren', true)}</div>}
      </SettingsCard>

      {stripeReady && (
        <SettingsCard
          sectionId="zahlungsart"
          icon={Wallet}
          title={canCheckout ? 'Tarif wählen' : 'Zahlungsart & Rechnungen'}
          description={canCheckout
            ? 'Die Bezahlung läuft über unseren Zahlungsanbieter Stripe.'
            : 'Zahlungsart ändern, Rechnungen laden, Tarif wechseln oder kündigen: Das erledigen Sie im Kundenportal von Stripe.'}
        >
          {canCheckout ? (
            plansError ? (
              <p className="text-sm text-red-700">{plansError} <button type="button" onClick={() => void loadAll()} className="font-medium underline">Erneut versuchen</button></p>
            ) : plans === null ? (
              <SkeletonBlock className="h-20 w-full" />
            ) : bookablePlans.length === 0 ? (
              <p className="text-sm text-gray-600">Aktuell ist kein Tarif buchbar. Bitte wenden Sie sich an den Support.</p>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2" aria-label="Verfügbare Tarife">
                {bookablePlans.map(plan => (
                  <li key={plan.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-gray-200 p-4">
                    <p className="font-semibold text-gray-900">{plan.name}</p>
                    {plan.description && <p className="text-sm text-gray-600">{plan.description}</p>}
                    {plan.priceCents !== null && <p className="text-sm text-gray-800">{money(plan.priceCents, plan.currency)} pro {formatInterval(plan.interval)}</p>}
                    <button
                      type="button"
                      onClick={() => void goToStripe(() => apiService.startAccountCheckout(plan.id))}
                      disabled={redirecting}
                      aria-label={`${plan.name} buchen`}
                      className="btn-primary mt-auto inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Jetzt buchen
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : showPortal ? (
            portalButton('Zahlungsart und Rechnungen verwalten', true)
          ) : (
            <p className="text-sm text-gray-600">Für Ihr Konto gibt es noch kein Kundenportal. Es wird mit der ersten Zahlung angelegt.</p>
          )}
        </SettingsCard>
      )}

      <SettingsCard sectionId="zahlungsverlauf" icon={Receipt} title="Zahlungsverlauf">
        {historyError ? (
          <p className="text-sm text-red-700">{historyError} <button type="button" onClick={() => void loadAll()} className="font-medium underline">Erneut versuchen</button></p>
        ) : payments === null ? (
          <SkeletonBlock className="h-16 w-full" />
        ) : payments.length === 0 ? (
          <p className="text-sm text-gray-600">Es gibt noch keine Zahlungen.</p>
        ) : (
          <ul className="divide-y divide-gray-100" aria-label="Zahlungen">
            {payments.map(payment => {
              const state = paymentStatusLabel(payment.status);
              return (
                <li key={payment.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{payment.planName || 'Abo'}</p>
                    <p className="text-xs text-gray-500">{payment.paidAt ? day(payment.paidAt) : 'Noch nicht bezahlt'}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="tabular-nums text-gray-900">{money(payment.amountCents, payment.currency)}</span>
                    <span className={`status-badge inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${PAYMENT_TONE[state.tone]}`}>{state.label}</span>
                    {(payment.invoiceUrl || payment.invoicePdfUrl) && (
                      <a href={(payment.invoicePdfUrl || payment.invoiceUrl) as string} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 font-medium text-primary-custom hover:underline">
                        <FileText className="h-4 w-4" aria-hidden="true" />Rechnung<span className="sr-only"> vom {day(payment.paidAt)} öffnen</span><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard sectionId="rechnungsanschrift" icon={FileText} title="Rechnungsanschrift" description="Diese Angaben stehen auf den Rechnungen für Ihr Abo.">
        <form onSubmit={event => void saveProfile(event)} noValidate className="grid gap-4 sm:grid-cols-2" aria-label="Rechnungsanschrift">
          <SettingsField id="billing-legalName" label="Name oder Firma" required error={profileErrors.legalName} className="sm:col-span-2">
            <input id="billing-legalName" className={settingsInputClass} value={profile.legalName} maxLength={200} autoComplete="organization" aria-invalid={Boolean(profileErrors.legalName)} aria-describedby={profileErrors.legalName ? 'billing-legalName-message' : undefined} onChange={event => updateProfile('legalName', event.target.value)} />
          </SettingsField>
          <SettingsField id="billing-contactName" label="Ansprechpartner">
            <input id="billing-contactName" className={settingsInputClass} value={profile.contactName} maxLength={200} autoComplete="name" onChange={event => updateProfile('contactName', event.target.value)} />
          </SettingsField>
          <SettingsField id="billing-billingEmail" label="E-Mail für Rechnungen" error={profileErrors.billingEmail}>
            <input id="billing-billingEmail" type="email" className={settingsInputClass} value={profile.billingEmail} maxLength={255} autoComplete="email" aria-invalid={Boolean(profileErrors.billingEmail)} aria-describedby={profileErrors.billingEmail ? 'billing-billingEmail-message' : undefined} onChange={event => updateProfile('billingEmail', event.target.value)} />
          </SettingsField>
          <SettingsField id="billing-addressLine1" label="Straße und Hausnummer" required error={profileErrors.addressLine1}>
            <input id="billing-addressLine1" className={settingsInputClass} value={profile.addressLine1} maxLength={200} autoComplete="address-line1" aria-invalid={Boolean(profileErrors.addressLine1)} aria-describedby={profileErrors.addressLine1 ? 'billing-addressLine1-message' : undefined} onChange={event => updateProfile('addressLine1', event.target.value)} />
          </SettingsField>
          <SettingsField id="billing-addressLine2" label="Adresszusatz">
            <input id="billing-addressLine2" className={settingsInputClass} value={profile.addressLine2} maxLength={200} autoComplete="address-line2" onChange={event => updateProfile('addressLine2', event.target.value)} />
          </SettingsField>
          <SettingsField id="billing-postalCode" label="Postleitzahl" required error={profileErrors.postalCode}>
            <input id="billing-postalCode" className={settingsInputClass} value={profile.postalCode} maxLength={20} autoComplete="postal-code" aria-invalid={Boolean(profileErrors.postalCode)} aria-describedby={profileErrors.postalCode ? 'billing-postalCode-message' : undefined} onChange={event => updateProfile('postalCode', event.target.value)} />
          </SettingsField>
          <SettingsField id="billing-city" label="Ort" required error={profileErrors.city}>
            <input id="billing-city" className={settingsInputClass} value={profile.city} maxLength={120} autoComplete="address-level2" aria-invalid={Boolean(profileErrors.city)} aria-describedby={profileErrors.city ? 'billing-city-message' : undefined} onChange={event => updateProfile('city', event.target.value)} />
          </SettingsField>
          <SettingsField id="billing-countryCode" label="Land (Ländercode)" required hint="Zwei Buchstaben, z. B. DE, AT oder CH." error={profileErrors.countryCode}>
            <input id="billing-countryCode" className={`${settingsInputClass} uppercase`} value={profile.countryCode} maxLength={2} autoComplete="country" aria-invalid={Boolean(profileErrors.countryCode)} aria-describedby="billing-countryCode-message" onChange={event => updateProfile('countryCode', event.target.value)} />
          </SettingsField>
          <SettingsField id="billing-vatId" label="Umsatzsteuer-ID">
            <input id="billing-vatId" className={settingsInputClass} value={profile.vatId} maxLength={40} autoComplete="off" onChange={event => updateProfile('vatId', event.target.value)} />
          </SettingsField>
          <SettingsField id="billing-purchaseOrderRef" label="Bestellnummer" className="sm:col-span-2">
            <input id="billing-purchaseOrderRef" className={settingsInputClass} value={profile.purchaseOrderRef} maxLength={100} autoComplete="off" onChange={event => updateProfile('purchaseOrderRef', event.target.value)} />
          </SettingsField>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="submit" disabled={profileSaving} className="btn-primary inline-flex min-h-10 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50">
              {profileSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Rechnungsanschrift speichern
            </button>
            {profileMessage && <p role={profileMessage.type === 'error' ? 'alert' : 'status'} className={`text-sm ${profileMessage.type === 'error' ? 'text-red-700' : 'text-green-700'}`}>{profileMessage.text}</p>}
          </div>
        </form>
      </SettingsCard>
    </>
  );
}
