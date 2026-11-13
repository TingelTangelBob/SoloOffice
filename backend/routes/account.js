import express from 'express';
import { ControlPlaneClientError, callAccountAction, controlPlaneClientConfiguration } from '../services/controlPlaneClient.js';
import {
  mapAccountResponse,
  mapBillingHistoryResponse,
  mapBillingProfile,
  mapPlansResponse,
  mapRedirectResponse,
  validateBillingProfileInput,
} from '../services/accountMapping.js';
import { persistentRateLimit } from '../middleware/rateLimit.js';

/**
 * Tarif und Abrechnung aus der Fachapp.
 *
 * Konto, Abo und Stripe liegen im Control Plane. Die Fachapp ruft es über den
 * signierten Kanal für den Workspace der Sitzung auf. Nur die Workspace-Rolle
 * `owner` darf Konto-Aktionen auslösen (das Control Plane prüft die
 * mitgeschickte Rolle zusätzlich). `GET /status` darf jede angemeldete Rolle
 * rufen; ohne Control Plane (Self-Hosting) meldet es `available: false`.
 */

const OWNER_ONLY_MESSAGE = 'Tarif und Abrechnung kann nur der Eigentümer des Workspace verwalten.';
const BAD_REDIRECT_MESSAGE = 'Die Weiterleitung zum Zahlungsanbieter ist gerade nicht möglich. Bitte versuchen Sie es später erneut.';
const PLAN_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

function relayContext(req) {
  return {
    workspaceId: req.auth.workspaceId,
    workspaceName: req.auth.workspace?.name || null,
    requester: {
      email: req.auth.user?.email || null,
      name: req.auth.user?.displayName && req.auth.user.displayName !== req.auth.user.email ? req.auth.user.displayName : null,
      role: req.auth.role,
    },
  };
}

function handleError(res, error, next) {
  if (error instanceof ControlPlaneClientError) return res.status(error.status).json({ error: error.message, code: error.code });
  return next(error);
}

function requireOwner(req, res, next) {
  if (req.auth?.role !== 'owner') return res.status(403).json({ error: OWNER_ONLY_MESSAGE, code: 'OWNER_REQUIRED' });
  return next();
}

export function createAccountRouter({
  limiter = persistentRateLimit({
    name: 'account-user',
    windowMs: 60 * 1000,
    max: Number(process.env.ACCOUNT_RATE_LIMIT_MAX || 30),
    keyGenerator: req => req.auth?.userId || req.ip,
  }),
  env = process.env,
} = {}) {
  const router = express.Router();
  router.use(limiter);

  router.get('/status', (req, res) => {
    const configuration = controlPlaneClientConfiguration(env);
    return res.json({
      available: configuration.enabled,
      canManage: configuration.enabled && req.auth?.role === 'owner',
      ...(configuration.enabled ? {} : { reason: configuration.reason }),
    });
  });

  router.use(requireOwner);

  const call = (action, req, extra) => callAccountAction(action, relayContext(req), extra, { env });

  router.get('/', async (req, res, next) => {
    try {
      return res.json(mapAccountResponse(await call('account/get', req)));
    } catch (error) {
      return handleError(res, error, next);
    }
  });

  router.put('/billing-profile', async (req, res, next) => {
    const checked = validateBillingProfileInput(req.body);
    if (checked.error) return res.status(400).json({ error: checked.error, code: 'BILLING_PROFILE_INVALID' });
    try {
      const result = await call('account/billing-profile', req, { billingProfile: checked.value });
      return res.json({ billingProfile: mapBillingProfile(result?.billingProfile) ?? checked.value });
    } catch (error) {
      return handleError(res, error, next);
    }
  });

  router.get('/plans', async (req, res, next) => {
    try {
      return res.json(mapPlansResponse(await call('plans/list', req)));
    } catch (error) {
      return handleError(res, error, next);
    }
  });

  router.post('/checkout', async (req, res, next) => {
    const planId = typeof req.body?.planId === 'string' ? req.body.planId.trim() : '';
    if (!PLAN_ID_PATTERN.test(planId)) return res.status(400).json({ error: 'Bitte einen Tarif auswählen.', code: 'PLAN_INVALID' });
    try {
      const redirect = mapRedirectResponse(await call('billing/checkout', req, { planId }), env);
      if (!redirect) return res.status(502).json({ error: BAD_REDIRECT_MESSAGE, code: 'REDIRECT_URL_REJECTED' });
      return res.json(redirect);
    } catch (error) {
      return handleError(res, error, next);
    }
  });

  router.post('/portal', async (req, res, next) => {
    try {
      const redirect = mapRedirectResponse(await call('billing/portal', req), env);
      if (!redirect) return res.status(502).json({ error: BAD_REDIRECT_MESSAGE, code: 'REDIRECT_URL_REJECTED' });
      return res.json(redirect);
    } catch (error) {
      return handleError(res, error, next);
    }
  });

  router.get('/billing-history', async (req, res, next) => {
    try {
      return res.json(mapBillingHistoryResponse(await call('billing/history', req), env));
    } catch (error) {
      return handleError(res, error, next);
    }
  });

  return router;
}

export default createAccountRouter();
