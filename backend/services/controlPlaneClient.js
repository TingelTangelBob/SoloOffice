import { computeSignature, controlPlaneSecret, MIN_SECRET_LENGTH } from '../utils/controlPlaneAuth.js';
import logger from '../utils/logger.js';

/**
 * Signierte Aufrufe Fachapp → Control Plane (Rückkanal zu
 * routes/controlPlaneWorkspaces.js). Genutzt für Support-Tickets: Die Fachapp
 * speichert keine Tickets, das Control Plane ist die Quelle.
 *
 * Konfiguration:
 * - CONTROL_PLANE_URL             Basisadresse, z. B. http://control-plane:4100.
 *                                 Fehlt sie, wird im gehosteten Betrieb der
 *                                 Ursprung von TELEMETRY_URL genommen.
 * - CONTROL_PLANE_INTERNAL_SECRET Gemeinsames Geheimnis (wie für die interne
 *                                 Admin-Schnittstelle), mindestens 32 Zeichen.
 *
 * Signatur wie in der Gegenrichtung: HMAC-SHA256 über
 * `timestamp.method.path.body`.
 *
 * Zwei Arten von Aufrufen: Tickets (`callControlPlane` mit vollem Pfad) und
 * Konto-Aktionen (`callAccountAction`, nur die Aktion, z. B. `account/get`).
 */

const DEFAULT_TIMEOUT_MS = 8_000;

export class ControlPlaneClientError extends Error {
  constructor(message, { status = 502, code = 'CONTROL_PLANE_UNAVAILABLE' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_MESSAGES = {
  notConfigured: 'Der Support ist für diese Installation nicht eingerichtet.',
  unreachable: 'Der Support-Dienst ist gerade nicht erreichbar. Bitte später erneut versuchen.',
  failed: 'Der Support-Dienst hat die Anfrage nicht verarbeiten können.',
};

const ACCOUNT_MESSAGES = {
  notConfigured: 'Tarif und Abrechnung sind für diese Installation nicht verfügbar.',
  unreachable: 'Die Kontoverwaltung ist gerade nicht erreichbar. Bitte versuchen Sie es später erneut.',
  failed: 'Die Kontoverwaltung konnte die Anfrage nicht verarbeiten. Bitte versuchen Sie es später erneut.',
};

/** Konto-Aktionen des signierten Kanals (Pfad unter `/internal/fachapp/`). */
export const ACCOUNT_ACTIONS = Object.freeze([
  'account/get',
  'account/billing-profile',
  'plans/list',
  'billing/checkout',
  'billing/portal',
  'billing/history',
]);

/** Aktionen der Registrierung (ohne Workspace-Bezug, Pfad unter `/internal/fachapp/signup/`). */
export const SIGNUP_ACTIONS = Object.freeze(['config', 'start', 'resend', 'verify', 'status']);

const SIGNUP_MESSAGES = {
  notConfigured: 'Die Registrierung ist für diese Installation nicht verfügbar.',
  unreachable: 'Die Registrierung ist gerade nicht erreichbar. Bitte versuchen Sie es später erneut.',
  failed: 'Die Registrierung konnte nicht verarbeitet werden. Bitte versuchen Sie es später erneut.',
};

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function controlPlaneClientConfiguration(env = process.env) {
  const secret = controlPlaneSecret(env);
  let url = stringValue(env.CONTROL_PLANE_URL).replace(/\/$/, '');
  if (!url && stringValue(env.TELEMETRY_SOURCE).toLowerCase() === 'hosted') {
    try { url = new URL(stringValue(env.TELEMETRY_URL)).origin; } catch { url = ''; }
  }
  if (!/^https?:\/\//i.test(url)) return { enabled: false, reason: 'url_missing' };
  if (secret.length < MIN_SECRET_LENGTH) return { enabled: false, reason: 'secret_missing' };
  const configuredTimeout = Number(env.CONTROL_PLANE_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) ? Math.min(30_000, Math.max(1_000, Math.round(configuredTimeout))) : DEFAULT_TIMEOUT_MS;
  return { enabled: true, url, secret, timeoutMs };
}

export function signedHeaders(secret, { method, path, body, now = Date.now() }) {
  const timestamp = String(Math.floor(now / 1000));
  return {
    'Content-Type': 'application/json',
    'X-Control-Plane-Timestamp': timestamp,
    'X-Control-Plane-Signature': computeSignature(secret, { timestamp, method, path, body }),
  };
}

/**
 * @param {string} path z. B. `/internal/fachapp/tickets`
 * @param {object} payload JSON-Body
 * @returns {Promise<object>} JSON-Antwort des Control Plane
 * @throws {ControlPlaneClientError} bei Konfigurations-, Netz- oder API-Fehlern
 */
export async function callControlPlane(path, payload, { env = process.env, fetchImpl = globalThis.fetch, messages = {} } = {}) {
  const texts = { ...DEFAULT_MESSAGES, ...messages };
  const configuration = controlPlaneClientConfiguration(env);
  if (!configuration.enabled) throw new ControlPlaneClientError(texts.notConfigured, { status: 503, code: 'CONTROL_PLANE_NOT_CONFIGURED' });
  if (typeof fetchImpl !== 'function') throw new ControlPlaneClientError('fetch ist nicht verfügbar.', { status: 503, code: 'CONTROL_PLANE_NOT_CONFIGURED' });

  const body = JSON.stringify(payload ?? {});
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), configuration.timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${configuration.url}${path}`, {
      method: 'POST',
      headers: signedHeaders(configuration.secret, { method: 'POST', path, body }),
      body,
      signal: controller.signal,
    });
  } catch (error) {
    logger.warn('Control Plane nicht erreichbar', { path, error: error instanceof Error ? error.message : String(error) });
    throw new ControlPlaneClientError(texts.unreachable);
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
  if (!response.ok) {
    // Fachliche Ablehnungen (Validierung, Limit, unbekanntes Ticket) reicht die
    // Fachapp unverändert weiter; technische Fehler werden allgemein gemeldet.
    const passThrough = [400, 403, 404, 409, 422, 429].includes(response.status);
    logger.warn('Control Plane hat den Aufruf abgelehnt', { path, statusCode: response.status, code: data.code || null });
    if (passThrough) throw new ControlPlaneClientError(data.error || 'Die Anfrage wurde abgelehnt.', { status: response.status, code: data.code || 'CONTROL_PLANE_REJECTED' });
    throw new ControlPlaneClientError(texts.failed, { status: 502, code: data.code || 'CONTROL_PLANE_ERROR' });
  }
  return data;
}

/**
 * Konto-Aktion für den Workspace der Anfrage. `context` trägt `workspaceId`,
 * `workspaceName` und `requester` ({ email, name, role }) wie bei Tickets,
 * `extra` die Eingabe der Aktion (z. B. `planId` oder das Rechnungsprofil).
 */
export async function callAccountAction(action, context, extra = {}, options = {}) {
  if (!ACCOUNT_ACTIONS.includes(action)) throw new Error(`Unbekannte Konto-Aktion: ${action}`);
  return callControlPlane(`/internal/fachapp/${action}`, { ...extra, ...context }, { ...options, messages: ACCOUNT_MESSAGES });
}

/**
 * Registrierungs-Aktion ohne Workspace-Bezug (`signup/config|start|resend|
 * verify|status`). Dieselbe Signatur wie bei den Konto-Aktionen. `clientIp`
 * wird als Feld mitgegeben, damit das Control Plane seine Limits je Besucher
 * rechnet; es überschreibt eine gleichnamige Eingabe.
 */
export async function callSignupAction(action, input = {}, { clientIp = null, ...options } = {}) {
  if (!SIGNUP_ACTIONS.includes(action)) throw new Error(`Unbekannte Registrierungs-Aktion: ${action}`);
  const payload = { ...input };
  delete payload.clientIp;
  if (clientIp) payload.clientIp = clientIp;
  return callControlPlane(`/internal/fachapp/signup/${action}`, payload, { ...options, messages: SIGNUP_MESSAGES });
}
