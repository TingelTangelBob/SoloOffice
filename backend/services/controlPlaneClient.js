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
 */

const DEFAULT_TIMEOUT_MS = 8_000;

export class ControlPlaneClientError extends Error {
  constructor(message, { status = 502, code = 'CONTROL_PLANE_UNAVAILABLE' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

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
export async function callControlPlane(path, payload, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const configuration = controlPlaneClientConfiguration(env);
  if (!configuration.enabled) throw new ControlPlaneClientError('Der Support ist für diese Installation nicht eingerichtet.', { status: 503, code: 'CONTROL_PLANE_NOT_CONFIGURED' });
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
    throw new ControlPlaneClientError('Der Support-Dienst ist gerade nicht erreichbar. Bitte später erneut versuchen.');
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
    throw new ControlPlaneClientError('Der Support-Dienst hat die Anfrage nicht verarbeiten können.', { status: 502, code: data.code || 'CONTROL_PLANE_ERROR' });
  }
  return data;
}
