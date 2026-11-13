import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Mail } from 'lucide-react';
import { ApiResponseError, apiService } from '../services/api';
import type { SignupConfig, SignupVerifyResult } from '../types';
import {
  NEUTRAL_START_TEXT,
  RESEND_COOLDOWN_SECONDS,
  clearStatusToken,
  fieldForErrorCode,
  initialWaitState,
  nextPollDelay,
  nextWaitState,
  readStatusToken,
  stripSignupParams,
  validateSignupForm,
  waitView,
  writeStatusToken,
  type SignupFormErrors,
  type SignupParams,
  type WaitState,
} from '../utils/signupFlow';

/**
 * Öffentliche Registrierung innerhalb der Anmeldeseite: Konto erstellen,
 * E-Mail bestätigen (`?verify=`), Zahlung und Warteseite (`?checkout=`).
 * Es gibt kein Passwortfeld; das einzige Passwort setzt der Kunde später über
 * die Einladung der Fachapp.
 */

type Step = 'form' | 'sent' | 'resend' | 'verifying' | 'verifyError' | 'checkout' | 'awaitingAccess' | 'wait' | 'cancelled' | 'thanks';

interface SignupFlowProps {
  params: SignupParams;
  legalLinks: { agb: string; datenschutz: string };
  onBackToLogin: () => void;
}

const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100';
const linkButtonClass = 'text-sm text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded';
const primaryButtonClass = 'flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60';

// Ein Bestätigungslink gilt nur einmal: In der Entwicklung läuft der Effekt doppelt, die Anfrage nicht.
const verifyInFlight = new Map<string, Promise<SignupVerifyResult>>();

function priceLabel(plan: SignupConfig['plans'][number]): string {
  if (plan.priceCents === null) return '';
  const amount = new Intl.NumberFormat('de-DE', { style: 'currency', currency: plan.currency || 'EUR' }).format(plan.priceCents / 100);
  return `${amount} pro ${plan.interval === 'year' ? 'Jahr' : 'Monat'}`;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <span id={id} className="mt-1 block text-xs text-red-700">{message}</span> : null;
}

export function SignupFlow({ params, legalLinks, onBackToLogin }: SignupFlowProps) {
  const initialStep = (): Step => {
    if (params.verify) return 'verifying';
    if (params.checkout === 'success') return readStatusToken() ? 'wait' : 'thanks';
    if (params.checkout === 'cancelled') return readStatusToken() ? 'cancelled' : 'thanks';
    return 'form';
  };
  const [step, setStep] = useState<Step>(initialStep);
  const [config, setConfig] = useState<SignupConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [inviteToken, setInviteToken] = useState(params.invite);
  const [planId, setPlanId] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [errors, setErrors] = useState<SignupFormErrors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [verifyError, setVerifyError] = useState('');
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [wait, setWait] = useState<WaitState>(initialWaitState);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef<Step>(step);
  const initialParams = useRef(params);

  // Tokens gehören nicht in Adressleiste, Verlauf oder Weitergabe.
  useEffect(() => {
    try {
      const { verify, checkout, invite, register } = initialParams.current;
      if (verify || checkout || invite || register) window.history.replaceState(window.history.state, '', stripSignupParams(window.location.href));
    } catch { /* Adresse bleibt, wie sie ist. */ }
  }, []);

  useEffect(() => {
    let active = true;
    apiService.getSignupConfig()
      .then(result => { if (active) { setConfig(result); setPlanId(current => current || result.plans[0]?.id || ''); } })
      .catch(error => { if (active) setConfigError(messageOf(error, 'Die Registrierung ist gerade nicht verfügbar.')); });
    return () => { active = false; };
  }, []);

  // Nach einem Schrittwechsel liest die Sprachausgabe die neue Überschrift.
  useEffect(() => {
    if (previousStep.current !== step) headingRef.current?.focus();
    previousStep.current = step;
  }, [step]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setTimeout(() => setCooldown(value => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  // E-Mail bestätigen
  useEffect(() => {
    const token = initialParams.current.verify;
    if (!token || step !== 'verifying') return undefined;
    let active = true;
    let request = verifyInFlight.get(token);
    if (!request) {
      request = apiService.verifySignup(token);
      verifyInFlight.set(token, request);
    }
    request.then(result => {
      if (!active) return;
      if (result.statusToken) writeStatusToken(result.statusToken);
      if (result.next === 'checkout') { setCheckoutUrl(result.url || ''); setStep('checkout'); }
      else if (result.next === 'workspace') setStep('wait');
      else setStep('awaitingAccess');
    }).catch(error => {
      if (!active) return;
      setVerifyError(messageOf(error, 'Die E-Mail-Adresse konnte nicht bestätigt werden.'));
      setStep('verifyError');
    });
    return () => { active = false; };
  }, [step]);

  // Warteseite: alle 3 Sekunden, höchstens 2 Minuten
  useEffect(() => {
    if (step !== 'wait') return undefined;
    const token = readStatusToken();
    if (!token) { setStep('thanks'); return undefined; }
    let cancelled = false;
    let timer: number | undefined;
    let state = initialWaitState;
    const startedAt = Date.now();
    setWait(state);
    const poll = async () => {
      try {
        const result = await apiService.getSignupStatus(token);
        state = nextWaitState(state, { type: 'response', state: result.state });
      } catch (error) {
        state = nextWaitState(state, { type: 'error', status: error instanceof ApiResponseError ? error.status : undefined });
      }
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      state = nextWaitState(state, { type: 'tick', elapsedMs: elapsed });
      setWait(state);
      if (state.phase === 'done' || state.phase === 'expired') clearStatusToken();
      const delay = nextPollDelay(state, elapsed);
      if (delay !== null) timer = window.setTimeout(() => { void poll(); }, delay);
    };
    void poll();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [step]);

  const continueToPayment = useCallback(async () => {
    setFormError('');
    if (checkoutUrl) { window.location.assign(checkoutUrl); return; }
    const token = readStatusToken();
    if (!token) { setFormError('Die Zahlung kann von hier nicht fortgesetzt werden. Bitte fordern Sie über „Konto erstellen“ einen neuen Link an.'); return; }
    setBusy(true);
    try {
      const result = await apiService.resumeSignupCheckout(token);
      if (result.url) { window.location.assign(result.url); return; }
      if (result.state === 'awaiting_payment') setFormError('Die Zahlungsseite ist gerade nicht erreichbar. Bitte versuchen Sie es in einigen Minuten erneut.');
      else setStep('wait');
    } catch (error) {
      setFormError(messageOf(error, 'Die Zahlungsseite ist gerade nicht erreichbar.'));
    } finally {
      setBusy(false);
    }
  }, [checkoutUrl]);

  const submitStart = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    const inviteRequired = Boolean(config?.inviteRequired);
    const found = validateSignupForm({ name, email, inviteToken, inviteRequired, acceptTerms, acceptPrivacy });
    setErrors(found);
    const firstInvalid = (['name', 'email', 'inviteToken', 'acceptTerms', 'acceptPrivacy'] as const).find(key => found[key]);
    if (firstInvalid) { document.getElementById(`signup-${firstInvalid}`)?.focus(); return; }
    setBusy(true);
    try {
      await apiService.startSignup({
        email: email.trim(),
        name: name.replace(/\s+/g, ' ').trim(),
        acceptTerms: true,
        acceptPrivacy: true,
        ...(planId ? { planId } : {}),
        ...(inviteToken.trim() ? { inviteToken: inviteToken.trim() } : {}),
      });
      // Immer derselbe Text, damit nicht erkennbar wird, ob die Adresse schon bekannt ist.
      setNotice('');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setStep('sent');
    } catch (error) {
      const apiError = error instanceof ApiResponseError ? error : null;
      const field = fieldForErrorCode(apiError?.code, apiError?.field);
      if (field) { setErrors({ [field]: messageOf(error, 'Bitte prüfen Sie diese Angabe.') }); document.getElementById(`signup-${field}`)?.focus(); }
      else setFormError(messageOf(error, 'Die Registrierung ist gerade nicht möglich. Bitte versuchen Sie es später erneut.'));
    } finally {
      setBusy(false);
    }
  };

  const resend = async (event?: FormEvent) => {
    event?.preventDefault();
    setFormError('');
    setNotice('');
    const found = validateSignupForm({ name: 'xx', email, inviteToken: 'x', inviteRequired: false, acceptTerms: true, acceptPrivacy: true });
    if (found.email) { setErrors({ email: found.email }); document.getElementById('signup-email')?.focus(); return; }
    setErrors({});
    setBusy(true);
    try {
      await apiService.resendSignup(email.trim());
      setNotice('Wenn zu dieser Adresse eine Registrierung offen ist, haben wir die E-Mail erneut gesendet.');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      if (step === 'resend') setStep('sent');
    } catch (error) {
      setFormError(messageOf(error, 'Die E-Mail konnte gerade nicht gesendet werden.'));
    } finally {
      setBusy(false);
    }
  };

  const heading = (text: string) => <h2 ref={headingRef} tabIndex={-1} className="mb-3 text-lg font-semibold text-gray-900 outline-none">{text}</h2>;
  const status = (text: string, tone: 'ok' | 'error' = 'ok') => text ? (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-lg border px-3 py-2 text-sm ${tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{text}</div>
  ) : null;
  const back = (label = 'Zurück zur Anmeldung') => <button type="button" onClick={onBackToLogin} className={`mt-4 w-full ${linkButtonClass}`}>{label}</button>;

  const resendBlock = (
    <>
      <button type="button" onClick={() => { void resend(); }} disabled={busy || cooldown > 0} className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60">
        {cooldown > 0 ? `E-Mail erneut senden (in ${cooldown} s möglich)` : 'E-Mail erneut senden'}
      </button>
    </>
  );

  let body: ReactNode;
  if (step === 'form') {
    const plans = config?.plans ?? [];
    body = (
      <>
        {heading('Konto erstellen')}
        <p className="mb-4 text-sm text-gray-600">Wir schicken Ihnen einen Bestätigungslink. Ein Passwort legen Sie erst später fest, wenn Ihr Zugang eingerichtet ist.</p>
        {configError && status(configError, 'error')}
        <form onSubmit={submitStart} noValidate className="form-consistent-fields space-y-4" aria-busy={busy}>
          <div>
            <label htmlFor="signup-name" className="block text-sm text-gray-700">Name oder Firmenname</label>
            <input id="signup-name" name="name" required autoComplete="name" value={name} onChange={event => setName(event.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'signup-name-error' : undefined} className={inputClass} />
            <FieldError id="signup-name-error" message={errors.name} />
          </div>
          <div>
            <label htmlFor="signup-email" className="block text-sm text-gray-700">E-Mail-Adresse</label>
            <span className="relative mt-1 block">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <input id="signup-email" name="email" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'signup-email-error' : undefined} className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
            </span>
            <FieldError id="signup-email-error" message={errors.email} />
          </div>
          {config?.inviteRequired && (
            <div>
              <label htmlFor="signup-inviteToken" className="block text-sm text-gray-700">Einladungscode</label>
              <input id="signup-inviteToken" name="invite-code" required autoComplete="off" value={inviteToken} onChange={event => setInviteToken(event.target.value)} aria-invalid={Boolean(errors.inviteToken)} aria-describedby={errors.inviteToken ? 'signup-inviteToken-error' : 'signup-inviteToken-hint'} className={inputClass} />
              <span id="signup-inviteToken-hint" className="mt-1 block text-xs text-gray-500">Den Code haben Sie von uns erhalten.</span>
              <FieldError id="signup-inviteToken-error" message={errors.inviteToken} />
            </div>
          )}
          {plans.length > 1 && (
            <fieldset>
              <legend className="text-sm text-gray-700">Tarif</legend>
              <div className="mt-1 space-y-2">
                {plans.map(plan => (
                  <label key={plan.id} htmlFor={`signup-plan-${plan.id}`} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${planId === plan.id ? 'border-blue-600 bg-blue-50' : 'border-gray-300'}`}>
                    <input id={`signup-plan-${plan.id}`} type="radio" name="plan" value={plan.id} checked={planId === plan.id} onChange={() => setPlanId(plan.id)} className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500" />
                    <span><span className="font-medium text-gray-900">{plan.name}</span>{priceLabel(plan) && <span className="text-gray-600">, {priceLabel(plan)}</span>}{plan.description && <span className="block text-xs text-gray-500">{plan.description}</span>}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {plans.length === 1 && <p className="text-sm text-gray-600">Tarif: <span className="font-medium text-gray-900">{plans[0].name}</span>{priceLabel(plans[0]) && `, ${priceLabel(plans[0])}`}</p>}
          <div>
            <label htmlFor="signup-acceptTerms" className="flex items-start gap-2 text-sm text-gray-700">
              <input id="signup-acceptTerms" type="checkbox" checked={acceptTerms} onChange={event => setAcceptTerms(event.target.checked)} aria-invalid={Boolean(errors.acceptTerms)} aria-describedby={errors.acceptTerms ? 'signup-acceptTerms-error' : undefined} className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <span>Ich bin Unternehmer und stimme den <a href={legalLinks.agb} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">AGB</a> zu.</span>
            </label>
            <FieldError id="signup-acceptTerms-error" message={errors.acceptTerms} />
          </div>
          <div>
            <label htmlFor="signup-acceptPrivacy" className="flex items-start gap-2 text-sm text-gray-700">
              <input id="signup-acceptPrivacy" type="checkbox" checked={acceptPrivacy} onChange={event => setAcceptPrivacy(event.target.checked)} aria-invalid={Boolean(errors.acceptPrivacy)} aria-describedby={errors.acceptPrivacy ? 'signup-acceptPrivacy-error' : undefined} className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <span>Ich habe den <a href={legalLinks.datenschutz} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">Datenschutzhinweis</a> gelesen.</span>
            </label>
            <FieldError id="signup-acceptPrivacy-error" message={errors.acceptPrivacy} />
          </div>
          {status(formError, 'error')}
          <button type="submit" disabled={busy || (!config && !configError)} className={primaryButtonClass}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Konto erstellen
          </button>
        </form>
        {back('Schon ein Konto? Anmelden')}
      </>
    );
  } else if (step === 'sent') {
    body = (
      <>
        {heading('Bitte prüfen Sie Ihr Postfach')}
        <div role="status" aria-live="polite">
          <p className="mb-4 text-sm text-gray-700">{NEUTRAL_START_TEXT}</p>
          {status(notice)}
        </div>
        {status(formError, 'error')}
        {resendBlock}
        <p className="mt-3 text-xs text-gray-500">Der Link ist begrenzt gültig. Schauen Sie bei Bedarf auch im Spam-Ordner nach.</p>
        {back()}
      </>
    );
  } else if (step === 'resend' || step === 'verifyError') {
    body = (
      <>
        {heading(step === 'resend' ? 'Neuen Bestätigungslink anfordern' : 'Bestätigung nicht möglich')}
        {step === 'verifyError' && <p role="alert" className="mb-4 text-sm text-gray-700">{verifyError} Der Link ist abgelaufen oder wurde schon benutzt. Sie können einen neuen anfordern.</p>}
        {step === 'verifyError' ? <button type="button" onClick={() => setStep('resend')} className={primaryButtonClass}>Neuen Link anfordern</button> : (
          <form onSubmit={resend} noValidate className="space-y-4">
            <div>
              <label htmlFor="signup-email" className="block text-sm text-gray-700">E-Mail-Adresse</label>
              <input id="signup-email" name="email" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'signup-email-error' : undefined} className={inputClass} />
              <FieldError id="signup-email-error" message={errors.email} />
            </div>
            {status(formError, 'error')}
            <button type="submit" disabled={busy || cooldown > 0} className={primaryButtonClass}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Link senden</button>
          </form>
        )}
        {back()}
      </>
    );
  } else if (step === 'verifying') {
    body = (
      <>
        {heading('E-Mail-Adresse wird bestätigt')}
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-gray-700"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Einen Moment bitte.</p>
      </>
    );
  } else if (step === 'checkout' || step === 'cancelled') {
    body = (
      <>
        {heading(step === 'checkout' ? 'E-Mail-Adresse bestätigt' : 'Zahlung nicht abgeschlossen')}
        <p role="status" className="mb-4 text-sm text-gray-700">
          {step === 'checkout' ? 'Vielen Dank. Als Nächstes folgt die Zahlung. Danach richten wir Ihren Arbeitsbereich ein.' : 'Die Zahlung wurde abgebrochen. Es ist nichts abgebucht worden. Sie können sie jetzt fortsetzen.'}
        </p>
        {status(formError, 'error')}
        <button type="button" onClick={() => { void continueToPayment(); }} disabled={busy} className={primaryButtonClass}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Weiter zur Zahlung</button>
        {back()}
      </>
    );
  } else if (step === 'awaitingAccess') {
    body = (
      <>
        {heading('E-Mail-Adresse bestätigt')}
        <p role="status" className="text-sm text-gray-700">Ihre E-Mail-Adresse ist bestätigt. Wir schalten Ihren Zugang frei und melden uns per E-Mail.</p>
        {back()}
      </>
    );
  } else if (step === 'thanks') {
    body = (
      <>
        {heading('Vielen Dank')}
        <p role="status" className="text-sm text-gray-700">Sobald Ihr Arbeitsbereich bereit ist, schicken wir Ihnen eine E-Mail mit einem Link zum Einrichten Ihres Zugangs.</p>
        {back()}
      </>
    );
  } else {
    const view = waitView(wait);
    body = (
      <>
        {heading(view.heading)}
        <div role="status" aria-live="polite" className={`rounded-lg border px-3 py-3 text-sm ${view.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : view.tone === 'calm' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
          <p className="flex items-start gap-2">
            {view.busy && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
            {view.tone === 'success' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
            <span>{view.message}</span>
          </p>
        </div>
        {!view.busy && back()}
      </>
    );
  }

  return <div>{body}</div>;
}
