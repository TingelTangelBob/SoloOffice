import { isIP } from 'node:net';
import { mapPlansResponse, safeReturnUrl } from './accountMapping.js';

/**
 * Abbildung der Control-Plane-Antworten der Registrierung (Kanal
 * `/internal/fachapp/signup/*`) auf die öffentliche Antwort der Fachapp.
 *
 * Grundsätze: Antworten verraten nie, ob eine Adresse schon existiert
 * (`start` und `resend` liefern immer denselben Text); interne Kennungen gehen nie an den Browser (Ausnahme: die
 * Testfelder `verificationToken` und `ownerInvitation`, die nur die Gegenseite
 * mit ihren Staging-Schaltern ausgibt und die die Oberfläche nie anzeigt); Weiterleitungen werden mit derselben Prüfung wie bei der
 * Abrechnung auf Stripe-Hosts beschränkt.
 */

export const NEUTRAL_START_MESSAGE = 'Wenn die Angaben stimmen, haben wir Ihnen eine E-Mail mit einem Bestätigungslink geschickt.';
export const NEUTRAL_RESEND_MESSAGE = 'Wenn zu dieser Adresse eine Registrierung offen ist, haben wir die E-Mail erneut gesendet.';

export const SIGNUP_STATES = ['awaiting_payment', 'creating_workspace', 'invitation_sent', 'failed'];
export const VERIFY_NEXT = ['checkout', 'workspace', 'awaiting_access'];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLAN_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const INVITE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{16,500}$/;

function text(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Client-IP für die Gegenseite: nur gültige Adressen, IPv4-in-IPv6 ohne Präfix. */
export function normalizeClientIp(value) {
  if (typeof value !== 'string') return null;
  const ip = value.trim().replace(/^::ffff:/i, '');
  return isIP(ip) ? ip : null;
}

/** Name: Steuerzeichen raus, Leerraum zusammengezogen, 2 bis 120 Zeichen. */
function cleanName(value) {
  return text(value, 400).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function validateStartInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Bitte füllen Sie das Formular vollständig aus.', field: null };
  const email = text(body.email, 320).toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return { error: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.', field: 'email' };
  const name = cleanName(body.name);
  if (name.length < 2 || name.length > 120) return { error: 'Bitte geben Sie einen Namen mit 2 bis 120 Zeichen ein.', field: 'name' };
  if (body.acceptTerms !== true) return { error: 'Bitte stimmen Sie den AGB zu.', field: 'acceptTerms' };
  if (body.acceptPrivacy !== true) return { error: 'Bitte bestätigen Sie den Datenschutzhinweis.', field: 'acceptPrivacy' };
  const value = { email, name, acceptTerms: true, acceptPrivacy: true };
  if (body.planId !== undefined && body.planId !== null && body.planId !== '') {
    const planId = text(body.planId, 80);
    if (!PLAN_ID_PATTERN.test(planId)) return { error: 'Bitte wählen Sie einen gültigen Tarif.', field: 'planId' };
    value.planId = planId;
  }
  if (body.inviteToken !== undefined && body.inviteToken !== null && body.inviteToken !== '') {
    const inviteToken = text(body.inviteToken, 200);
    if (!INVITE_PATTERN.test(inviteToken)) return { error: 'Der Einladungscode ist ungültig.', field: 'inviteToken' };
    value.inviteToken = inviteToken;
  }
  return { value };
}

export function validateResendInput(body) {
  const email = text(body?.email, 320).toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return { error: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.', field: 'email' };
  return { value: { email } };
}

/** Bestätigungs- und Fortsetzungs-Token: nur Form prüfen, nie ausgeben. */
export function validateToken(value) {
  const token = text(value, 600);
  return TOKEN_PATTERN.test(token) ? token : null;
}

/**
 * Antwort von `signup/config`. Buchbar sind aktive Tarife; ist Stripe
 * eingerichtet, nur die mit Zahlungsmöglichkeit.
 */
export function mapSignupConfig(raw) {
  const stripeConfigured = raw?.stripeConfigured === true;
  const registrationMode = text(raw?.registrationMode, 40) || 'open';
  const inviteRequired = raw?.inviteRequired === true || registrationMode === 'invite_only';
  const plans = mapPlansResponse(raw).plans
    .filter(plan => !stripeConfigured || plan.checkoutAvailable)
    .map(({ id, name, description, priceCents, currency, interval }) => ({ id, name, description, priceCents, currency, interval }));
  return { registrationMode, inviteRequired, stripeConfigured, plans };
}

/** `start`: immer dieselbe Antwort, egal was die Gegenseite meldet. */
export function mapStartResponse(raw) {
  const result = { ok: true, message: NEUTRAL_START_MESSAGE };
  // Testbetrieb: Gibt die Gegenseite (nur mit ihren Staging-Schaltern) das Token
  // aus, wird es unverändert durchgereicht. Die Oberfläche zeigt es nie an.
  if (testTokensExposed() && typeof raw?.verificationToken === 'string' && raw.verificationToken) result.verificationToken = raw.verificationToken.slice(0, 600);
  return result;
}

export function mapResendResponse(raw) {
  const result = { ok: true, message: NEUTRAL_RESEND_MESSAGE };
  if (testTokensExposed() && typeof raw?.verificationToken === 'string' && raw.verificationToken) result.verificationToken = raw.verificationToken.slice(0, 600);
  return result;
}

/**
 * `verify`: `next` (checkout | workspace | awaiting_access), bei `checkout`
 * die geprüfte Zahlungsadresse, dazu das Fortsetzungs-Token der Warteseite.
 * Ist die Adresse nicht zulässig, bleibt `url` weg (`checkout` ohne Adresse:
 * die Oberfläche holt sie über `status` mit `resumeCheckout` nach).
 */
export function mapVerifyResponse(raw, env = process.env) {
  const next = VERIFY_NEXT.includes(raw?.next) ? raw.next : 'awaiting_access';
  const statusToken = validateToken(raw?.statusToken);
  const result = { verified: true, next };
  if (statusToken) {
    result.statusToken = statusToken;
    const seconds = Number(raw?.statusTokenExpiresInSeconds);
    if (Number.isFinite(seconds) && seconds > 0) result.statusTokenExpiresInSeconds = Math.min(86_400, Math.round(seconds));
  }
  if (next === 'checkout') {
    const url = safeReturnUrl(raw?.url, env);
    if (url) result.url = url;
  }
  return result;
}

/** `status`: Zustand der Warteseite, optional neue Zahlungsadresse. */
export function mapStatusResponse(raw, env = process.env) {
  const state = SIGNUP_STATES.includes(raw?.state) ? raw.state : 'failed';
  const result = { state };
  // Testbetrieb: Einladungslink der Gegenseite unverändert durchreichen (nie in der Oberfläche anzeigen).
  if (testTokensExposed() && typeof raw?.ownerInvitation?.link === 'string' && raw.ownerInvitation.link) result.ownerInvitation = { link: raw.ownerInvitation.link.slice(0, 2000) };
  if (state === 'awaiting_payment') {
    const url = safeReturnUrl(raw?.url, env);
    if (url) result.url = url;
    else if (raw?.checkoutError) result.checkoutError = true;
  }
  return result;
}

/**
 * Testfelder der Gegenseite nur durchreichen, wenn diese Instanz selbst im
 * Testbetrieb läuft. Fehlt die Variable oder ist sie falsch geschrieben, bleibt es aus.
 */
function testTokensExposed() {
  return process.env.EXPOSE_INVITATION_TOKENS === 'true';
}
