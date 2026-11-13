import type { SignupServerState } from '../types';

/**
 * Reine Logik der öffentlichen Registrierung: Adressparameter, Fortsetzungs-
 * Token im sessionStorage und der Zustandsautomat der Warteseite.
 */

export const POLL_INTERVAL_MS = 3_000;
export const POLL_MAX_MS = 120_000;
export const RESEND_COOLDOWN_SECONDS = 60;
const MAX_CONSECUTIVE_ERRORS = 5;
const STORAGE_KEY = 'solooffice-signup-status-token';

export const NEUTRAL_START_TEXT = 'Wenn die Angaben stimmen, haben wir Ihnen eine E-Mail mit einem Bestätigungslink geschickt.';

export interface SignupParams {
  verify: string;
  checkout: 'success' | 'cancelled' | null;
  invite: string;
  register: boolean;
}

const SIGNUP_QUERY_KEYS = ['verify', 'checkout', 'einladung', 'register'];

/** Parameter der Anmeldeseite, die ein einmaliges Token tragen. */
export const AUTH_LINK_QUERY_KEYS = ['invite', 'verifyEmail', 'resetPassword'] as const;

export function readSignupParams(search: string): SignupParams {
  const params = new URLSearchParams(search);
  const checkout = params.get('checkout');
  return {
    verify: (params.get('verify') || '').trim(),
    checkout: checkout === 'success' || checkout === 'cancelled' ? checkout : null,
    invite: (params.get('einladung') || '').trim(),
    register: params.has('register'),
  };
}

export function hasSignupParams(params: SignupParams): boolean {
  return Boolean(params.verify || params.checkout || params.invite || params.register);
}

/** Adresse ohne die Registrierungs-Parameter (Tokens gehören nicht in Adressleiste und Verlauf). */
export function stripSignupParams(href: string): string {
  return stripLinkParams(href, SIGNUP_QUERY_KEYS);
}

/**
 * Entfernt Link-Parameter (Einladung, Bestätigung, Zurücksetzen) aus Suchteil
 * und aus einer Abfrage im Hash (`#settings/billing?invite=…`), damit ein
 * verbrauchtes Token nach Abmelden oder Neuladen nicht wieder auftaucht.
 */
export function stripLinkParams(href: string, keys: readonly string[]): string {
  const url = new URL(href);
  for (const key of keys) url.searchParams.delete(key);
  let hash = url.hash;
  const queryStart = hash.indexOf('?');
  if (queryStart >= 0) {
    const hashParams = new URLSearchParams(hash.slice(queryStart + 1));
    for (const key of keys) hashParams.delete(key);
    const rest = hashParams.toString();
    hash = `${hash.slice(0, queryStart)}${rest ? `?${rest}` : ''}`;
  }
  return `${url.pathname}${url.search}${hash}`;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

export function readStatusToken(storage: StorageLike | null = defaultStorage()): string {
  try { return storage?.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}

export function writeStatusToken(token: string, storage: StorageLike | null = defaultStorage()): void {
  try { storage?.setItem(STORAGE_KEY, token); } catch { /* Speicher gesperrt: die Warteseite funktioniert dann ohne Wiederaufnahme. */ }
}

export function clearStatusToken(storage: StorageLike | null = defaultStorage()): void {
  try { storage?.removeItem(STORAGE_KEY); } catch { /* siehe oben */ }
}

// ---------------------------------------------------------------- Warteseite

export type WaitPhase = 'polling' | 'done' | 'failed' | 'timeout' | 'expired' | 'unreachable';

export interface WaitState {
  phase: WaitPhase;
  serverState: SignupServerState | null;
  errors: number;
}

export type WaitEvent =
  | { type: 'response'; state: SignupServerState }
  | { type: 'error'; status?: number }
  | { type: 'tick'; elapsedMs: number };

export const initialWaitState: WaitState = { phase: 'polling', serverState: null, errors: 0 };

export function isWaitFinished(state: WaitState): boolean {
  return state.phase !== 'polling';
}

/** Übergänge der Warteseite; ein beendeter Zustand bleibt unverändert. */
export function nextWaitState(state: WaitState, event: WaitEvent): WaitState {
  if (isWaitFinished(state)) return state;
  if (event.type === 'response') {
    if (event.state === 'invitation_sent') return { phase: 'done', serverState: event.state, errors: 0 };
    if (event.state === 'failed') return { phase: 'failed', serverState: event.state, errors: 0 };
    return { phase: 'polling', serverState: event.state, errors: 0 };
  }
  if (event.type === 'error') {
    // 404: Das Fortsetzungs-Token ist abgelaufen oder unbekannt.
    if (event.status === 404) return { ...state, phase: 'expired' };
    const errors = state.errors + 1;
    return errors >= MAX_CONSECUTIVE_ERRORS ? { ...state, phase: 'unreachable', errors } : { ...state, errors };
  }
  return event.elapsedMs >= POLL_MAX_MS ? { ...state, phase: 'timeout' } : state;
}

export interface WaitView {
  heading: string;
  message: string;
  busy: boolean;
  tone: 'progress' | 'success' | 'calm';
}

const SUPPORT_HINT = 'Sie müssen nichts weiter tun: Unser Support meldet sich bei Ihnen. Sie können uns auch jederzeit selbst über den Support erreichen.';

export function waitView(state: WaitState): WaitView {
  switch (state.phase) {
    case 'done':
      return { heading: 'Fast geschafft', message: 'Wir haben Ihnen eine E-Mail mit einem Link zum Einrichten Ihres Zugangs geschickt.', busy: false, tone: 'success' };
    case 'failed':
      return { heading: 'Das dauert länger als erwartet', message: `Die Einrichtung Ihres Arbeitsbereichs ist nicht sofort gelungen. ${SUPPORT_HINT}`, busy: false, tone: 'calm' };
    case 'timeout':
      return { heading: 'Das dauert länger als erwartet', message: `Ihr Arbeitsbereich ist noch nicht bereit. Sobald er fertig ist, schicken wir Ihnen eine E-Mail mit dem Link zum Einrichten Ihres Zugangs. ${SUPPORT_HINT}`, busy: false, tone: 'calm' };
    case 'unreachable':
      return { heading: 'Status gerade nicht abrufbar', message: `Wir erreichen den Dienst im Moment nicht. Ihre Anmeldung geht dadurch nicht verloren. ${SUPPORT_HINT}`, busy: false, tone: 'calm' };
    case 'expired':
      return { heading: 'Statusanzeige abgelaufen', message: 'Diese Statusanzeige ist nicht mehr gültig. Sobald Ihr Arbeitsbereich bereit ist, erhalten Sie eine E-Mail mit dem Link zum Einrichten Ihres Zugangs. Sie können sich auch an den Support wenden.', busy: false, tone: 'calm' };
    default:
      return state.serverState === 'awaiting_payment'
        ? { heading: 'Zahlung wird bestätigt', message: 'Wir warten auf die Bestätigung Ihrer Zahlung. Das dauert meist nur wenige Sekunden.', busy: true, tone: 'progress' }
        : { heading: 'Ihr Arbeitsbereich wird eingerichtet', message: 'Bitte lassen Sie diese Seite geöffnet. Das dauert meist nur wenige Sekunden.', busy: true, tone: 'progress' };
  }
}

/** Wartezeit bis zur nächsten Anfrage; `null`, wenn nichts mehr gefragt wird. */
export function nextPollDelay(state: WaitState, elapsedMs: number): number | null {
  if (isWaitFinished(state) || elapsedMs >= POLL_MAX_MS) return null;
  return POLL_INTERVAL_MS;
}

// ------------------------------------------------------- Formularprüfung

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SignupFormValues { name: string; email: string; inviteToken: string; inviteRequired: boolean; acceptTerms: boolean; acceptPrivacy: boolean }
export type SignupFormErrors = Partial<Record<'name' | 'email' | 'inviteToken' | 'acceptTerms' | 'acceptPrivacy', string>>;

export function validateSignupForm(values: SignupFormValues): SignupFormErrors {
  const errors: SignupFormErrors = {};
  const name = values.name.replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 120) errors.name = 'Bitte geben Sie Ihren Namen oder Firmennamen mit 2 bis 120 Zeichen ein.';
  if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = 'Bitte geben Sie eine gültige E-Mail-Adresse ein.';
  if (values.inviteRequired && !values.inviteToken.trim()) errors.inviteToken = 'Bitte geben Sie Ihren Einladungscode ein.';
  if (!values.acceptTerms) errors.acceptTerms = 'Bitte stimmen Sie den AGB zu.';
  if (!values.acceptPrivacy) errors.acceptPrivacy = 'Bitte bestätigen Sie den Datenschutzhinweis.';
  return errors;
}

export const INVITE_CODE_INVALID_TEXT = 'Der Einladungscode ist ungültig oder abgelaufen.';
const NEW_LINK_HINT = 'Sie können einen neuen Link anfordern.';

/** Meldung am Feld „Einladungscode“: der Server spricht von einem Link, das Feld heißt aber Code. */
export function fieldErrorText(field: keyof SignupFormErrors, code: string | undefined, serverMessage: string | undefined, fallback: string): string {
  if (field === 'inviteToken' && (code === 'INVITE_INVALID' || /Einladungslink/i.test(serverMessage || ''))) return INVITE_CODE_INVALID_TEXT;
  return serverMessage || fallback;
}

/** Text bei fehlgeschlagener Bestätigung, ohne den Satz „ungültig oder abgelaufen“ doppelt zu sagen. */
export function verifyFailureText(code: string | undefined, serverMessage: string | undefined): string {
  if (code === 'VERIFICATION_INVALID' || !serverMessage) {
    return `Der Bestätigungslink ist ungültig, abgelaufen oder wurde schon benutzt. ${NEW_LINK_HINT}`;
  }
  return `${serverMessage} ${NEW_LINK_HINT}`;
}

/** Feld zu einem Fehlercode der Fachapp bzw. des Control Plane. */
export function fieldForErrorCode(code: string | undefined, field: string | undefined): keyof SignupFormErrors | null {
  const known = ['name', 'email', 'inviteToken', 'acceptTerms', 'acceptPrivacy'] as const;
  if (field && (known as readonly string[]).includes(field)) return field as keyof SignupFormErrors;
  if (code === 'EMAIL_INVALID') return 'email';
  if (code === 'NAME_REQUIRED') return 'name';
  if (code === 'INVITE_REQUIRED' || code === 'INVITE_INVALID') return 'inviteToken';
  if (code === 'CONSENT_REQUIRED') return 'acceptTerms';
  return null;
}
