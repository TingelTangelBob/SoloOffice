import express from 'express';
import { ControlPlaneClientError, callSignupAction, controlPlaneClientConfiguration } from '../services/controlPlaneClient.js';
import {
  mapResendResponse,
  mapSignupConfig,
  mapStartResponse,
  mapStatusResponse,
  mapVerifyResponse,
  normalizeClientIp,
  validateResendInput,
  validateStartInput,
  validateToken,
} from '../services/signupMapping.js';
import { persistentRateLimit } from '../middleware/rateLimit.js';

/**
 * Öffentliche Registrierung (ohne Sitzung). Konto, Bestätigung, Zahlung und
 * Workspace-Anlage liegen im Control Plane; die Fachapp reicht die Aufrufe über
 * den signierten Kanal durch und meldet die Besucher-IP als `clientIp` mit.
 * Ohne angebundenes Control Plane (Self-Hosting, Demo) antwortet jede Route
 * mit 404.
 *
 * Schutz: eigenes Rate-Limit je IP, Eingabeprüfung vor dem Weiterreichen,
 * Antworten ohne Auskunft über bestehende Adressen. Das Fortsetzungs-Token
 * nimmt `status` bevorzugt aus dem Header `X-Signup-Token`, laut Festlegung auch
 * als `?token=`; Tokens kommen nie ins Log der Fachapp.
 * CSRF: wie `/auth/login` ohne Doppel-Cookie, weil es vor der Anmeldung keinen
 * gibt (Ausnahmeliste in `middleware/auth.js`).
 */

export const SIGNUP_TOKEN_HEADER = 'x-signup-token';

function handleError(res, error, next) {
  if (error instanceof ControlPlaneClientError) {
    if (error.status === 429) res.set('Retry-After', '60');
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  return next(error);
}

export function createSignupRouter({
  writeLimiter = persistentRateLimit({
    name: 'signup-ip',
    windowMs: 10 * 60 * 1000,
    max: Number(process.env.SIGNUP_RATE_LIMIT_MAX || 20),
    keyGenerator: req => req.ip,
    failClosed: true,
  }),
  readLimiter = persistentRateLimit({
    name: 'signup-status-ip',
    windowMs: 10 * 60 * 1000,
    max: Number(process.env.SIGNUP_STATUS_RATE_LIMIT_MAX || 200),
    keyGenerator: req => req.ip,
  }),
  env = process.env,
} = {}) {
  const router = express.Router();

  // Ohne Control Plane gibt es die Registrierung nicht (404 vor allem anderen).
  router.use((req, res, next) => {
    if (!controlPlaneClientConfiguration(env).enabled) return res.status(404).json({ error: 'Nicht gefunden.', code: 'NOT_FOUND' });
    return next();
  });

  const call = (action, req, input) => callSignupAction(action, input, { clientIp: normalizeClientIp(req.ip), env });

  router.get('/config', readLimiter, async (req, res, next) => {
    try {
      return res.json(mapSignupConfig(await call('config', req, {})));
    } catch (error) {
      return handleError(res, error, next);
    }
  });

  router.post('/start', writeLimiter, async (req, res, next) => {
    const checked = validateStartInput(req.body);
    if (checked.error) return res.status(400).json({ error: checked.error, code: 'SIGNUP_INVALID', field: checked.field });
    try {
      return res.json(mapStartResponse(await call('start', req, checked.value)));
    } catch (error) {
      return handleError(res, error, next);
    }
  });

  router.post('/resend', writeLimiter, async (req, res, next) => {
    const checked = validateResendInput(req.body);
    if (checked.error) return res.status(400).json({ error: checked.error, code: 'SIGNUP_INVALID', field: checked.field });
    try {
      return res.json(mapResendResponse(await call('resend', req, checked.value)));
    } catch (error) {
      // Auch Fehler der Gegenseite nicht an die Adresse koppeln: nur Limit und Ausfall werden gemeldet.
      if (error instanceof ControlPlaneClientError && [400, 403, 404, 409, 422].includes(error.status)) return res.json(mapResendResponse());
      return handleError(res, error, next);
    }
  });

  router.post('/verify', writeLimiter, async (req, res, next) => {
    const token = validateToken(req.body?.token);
    if (!token) return res.status(400).json({ error: 'Der Bestätigungslink ist ungültig oder abgelaufen.', code: 'VERIFICATION_INVALID' });
    try {
      return res.json(mapVerifyResponse(await call('verify', req, { token }), env));
    } catch (error) {
      return handleError(res, error, next);
    }
  });

  router.get('/status', readLimiter, async (req, res, next) => {
    const token = validateToken(req.get(SIGNUP_TOKEN_HEADER) || req.query.token);
    if (!token) return res.status(404).json({ error: 'Der Link zur Statusanzeige ist abgelaufen. Bitte wenden Sie sich an den Support.', code: 'STATUS_TOKEN_INVALID' });
    try {
      return res.json(mapStatusResponse(await call('status', req, { token }), env));
    } catch (error) {
      return handleError(res, error, next);
    }
  });

  // Zahlung fortsetzen (nach Abbruch): löst eine Checkout-Sitzung aus, deshalb POST mit Token im Body.
  router.post('/resume-checkout', writeLimiter, async (req, res, next) => {
    const token = validateToken(req.body?.token);
    if (!token) return res.status(404).json({ error: 'Der Link zur Statusanzeige ist abgelaufen. Bitte wenden Sie sich an den Support.', code: 'STATUS_TOKEN_INVALID' });
    try {
      const result = mapStatusResponse(await call('status', req, { token, resumeCheckout: true }), env);
      return res.json({ state: result.state, ...(result.url ? { url: result.url } : {}), ...(result.checkoutError ? { checkoutError: true } : {}) });
    } catch (error) {
      return handleError(res, error, next);
    }
  });

  return router;
}

export default createSignupRouter();
