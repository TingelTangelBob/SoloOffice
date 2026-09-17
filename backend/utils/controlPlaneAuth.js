import crypto from 'node:crypto';

/**
 * Signatur- und Konfigurationsregeln der internen Control-Plane-Schnittstelle.
 *
 * Diese Datei enthält bewusst keine Datenbank- oder Express-Abhängigkeit,
 * damit die Prüfregeln ohne laufenden Stack getestet werden können.
 * Der Vertrag entspricht `control-plane/src/soloOfficeAdapter.js`:
 * HMAC-SHA256 über `timestamp.method.path.body`.
 */

export const TIMESTAMP_HEADER = 'x-control-plane-timestamp';
export const SIGNATURE_HEADER = 'x-control-plane-signature';
export const IDEMPOTENCY_HEADER = 'idempotency-key';

// Ein kurzer Wert würde die Signatur nur vortäuschen. 32 Hex-Zeichen sind das
// Minimum; empfohlen ist `openssl rand -hex 32`.
export const MIN_SECRET_LENGTH = 32;
export const DEFAULT_TIMESTAMP_TOLERANCE_SECONDS = 300;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

export function controlPlaneSecret(env = process.env) {
  return String(env.CONTROL_PLANE_INTERNAL_SECRET || '').trim();
}

export function timestampToleranceSeconds(env = process.env) {
  const configured = Number(env.CONTROL_PLANE_INTERNAL_TIMESTAMP_TOLERANCE_SECONDS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_TIMESTAMP_TOLERANCE_SECONDS;
  return Math.min(3600, Math.floor(configured));
}

/**
 * @returns {{configured: boolean, reason?: 'missing'|'too-short'}}
 */
export function controlPlaneConfiguration(env = process.env) {
  const secret = controlPlaneSecret(env);
  if (!secret) return { configured: false, reason: 'missing' };
  if (secret.length < MIN_SECRET_LENGTH) return { configured: false, reason: 'too-short' };
  return { configured: true };
}

export function signaturePayload({ timestamp, method, path, body }) {
  return `${timestamp}.${method}.${path}.${body}`;
}

export function computeSignature(secret, parts) {
  return crypto.createHmac('sha256', secret).update(signaturePayload(parts)).digest('hex');
}

function signaturesMatch(expected, received) {
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(String(received || ''), 'utf8');
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Prüft Konfiguration, Zeitfenster, Idempotency-Key und Signatur einer
 * eingehenden internen Anfrage.
 *
 * @returns {{ok: true, idempotencyKey: string} | {ok: false, status: number, code: string, error: string}}
 */
export function verifyControlPlaneRequest({
  secret,
  timestamp,
  signature,
  idempotencyKey,
  method,
  path,
  body,
  toleranceSeconds = DEFAULT_TIMESTAMP_TOLERANCE_SECONDS,
  now = Date.now(),
}) {
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return {
      ok: false,
      status: 503,
      code: 'CONTROL_PLANE_API_NOT_CONFIGURED',
      error: 'Die interne Control-Plane-Schnittstelle ist nicht konfiguriert.',
    };
  }

  if (!/^\d{1,15}$/.test(String(timestamp || ''))) {
    return {
      ok: false,
      status: 401,
      code: 'CONTROL_PLANE_TIMESTAMP_INVALID',
      error: 'Zeitstempel der Anfrage fehlt oder ist ungültig.',
    };
  }

  const ageSeconds = Math.abs(Math.floor(now / 1000) - Number(timestamp));
  if (ageSeconds > toleranceSeconds) {
    return {
      ok: false,
      status: 401,
      code: 'CONTROL_PLANE_TIMESTAMP_EXPIRED',
      error: 'Der Zeitstempel der Anfrage liegt außerhalb des erlaubten Fensters.',
    };
  }

  const key = String(idempotencyKey || '').trim();
  if (!key || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return {
      ok: false,
      status: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      error: `Ein Idempotency-Key mit höchstens ${MAX_IDEMPOTENCY_KEY_LENGTH} Zeichen ist erforderlich.`,
    };
  }

  const expected = computeSignature(secret, { timestamp, method, path, body });
  if (!signaturesMatch(expected, signature)) {
    return {
      ok: false,
      status: 401,
      code: 'CONTROL_PLANE_SIGNATURE_INVALID',
      error: 'Die Signatur der Anfrage ist ungültig.',
    };
  }

  return { ok: true, idempotencyKey: key };
}

export function requestHash(body) {
  return crypto.createHash('sha256').update(String(body ?? '')).digest('hex');
}
