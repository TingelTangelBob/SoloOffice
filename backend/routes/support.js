import express from 'express';
import { ControlPlaneClientError, callControlPlane, controlPlaneClientConfiguration } from '../services/controlPlaneClient.js';
import { persistentRateLimit } from '../middleware/rateLimit.js';

/**
 * Support-Tickets aus der Fachapp (E1).
 *
 * Die Fachapp hält keine Tickets. Jede Anfrage geht signiert an das Control
 * Plane, das den Workspace zum Kundenkonto auflöst und die Tickets führt; die
 * Betreiber bearbeiten sie in der Adminkonsole. Ohne konfiguriertes Control
 * Plane (Self-Hosting) meldet `/status` `available: false` und die Oberfläche
 * blendet den Bereich aus.
 *
 * Berechtigung: Jedes Mitglied darf Anfragen stellen. Eigentümer und
 * Administratoren sehen alle Tickets des Kontos; andere Mitglieder nur ihre
 * eigenen – das entscheidet das Control Plane anhand der mitgeschickten Rolle.
 */

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.use(persistentRateLimit({
  name: 'support-user',
  windowMs: 60 * 1000,
  max: Number(process.env.SUPPORT_RATE_LIMIT_MAX || 30),
  keyGenerator: req => req.auth?.userId || req.ip,
}));

function appBaseUrl(req) {
  return (process.env.APP_BASE_URL || process.env.CORS_ORIGIN?.split(',')[0] || `${req.protocol}://${req.get('host') || ''}`).trim().replace(/\/$/, '');
}

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

router.get('/status', (req, res) => {
  const configuration = controlPlaneClientConfiguration();
  return res.json({
    available: configuration.enabled,
    ...(configuration.enabled ? {} : { reason: configuration.reason }),
  });
});

router.get('/tickets', async (req, res, next) => {
  try {
    const result = await callControlPlane('/internal/fachapp/tickets/list', relayContext(req));
    return res.json({ tickets: result.tickets || [] });
  } catch (error) {
    return handleError(res, error, next);
  }
});

router.post('/tickets', async (req, res, next) => {
  const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim().slice(0, 200) : '';
  const body = typeof req.body?.body === 'string' ? req.body.body.trim().slice(0, 10_000) : '';
  if (!subject) return res.status(400).json({ error: 'Bitte einen Betreff angeben.', code: 'TICKET_SUBJECT_REQUIRED' });
  if (!body) return res.status(400).json({ error: 'Bitte eine Nachricht eingeben.', code: 'TICKET_BODY_REQUIRED' });
  try {
    const result = await callControlPlane('/internal/fachapp/tickets', {
      ...relayContext(req),
      subject,
      body,
      category: typeof req.body?.category === 'string' ? req.body.category : undefined,
      priority: typeof req.body?.priority === 'string' ? req.body.priority : undefined,
      appVersion: (process.env.SOLOOFFICE_VERSION || process.env.APP_VERSION || 'dev').slice(0, 40),
      appUrl: appBaseUrl(req),
      context: {
        page: typeof req.body?.page === 'string' ? req.body.page.slice(0, 120) : undefined,
        userAgent: req.get('user-agent')?.slice(0, 200) || undefined,
      },
    });
    return res.status(201).json(result);
  } catch (error) {
    return handleError(res, error, next);
  }
});

router.get('/tickets/:ticketId', async (req, res, next) => {
  if (!UUID_PATTERN.test(req.params.ticketId)) return res.status(400).json({ error: 'Ungültige Ticket-Kennung.', code: 'INVALID_UUID' });
  try {
    const result = await callControlPlane('/internal/fachapp/tickets/get', { ...relayContext(req), ticketId: req.params.ticketId });
    return res.json(result);
  } catch (error) {
    return handleError(res, error, next);
  }
});

router.post('/tickets/:ticketId/messages', async (req, res, next) => {
  if (!UUID_PATTERN.test(req.params.ticketId)) return res.status(400).json({ error: 'Ungültige Ticket-Kennung.', code: 'INVALID_UUID' });
  const body = typeof req.body?.body === 'string' ? req.body.body.trim().slice(0, 10_000) : '';
  if (!body) return res.status(400).json({ error: 'Bitte eine Nachricht eingeben.', code: 'TICKET_BODY_REQUIRED' });
  try {
    const result = await callControlPlane('/internal/fachapp/tickets/reply', { ...relayContext(req), ticketId: req.params.ticketId, body });
    return res.status(201).json(result);
  } catch (error) {
    return handleError(res, error, next);
  }
});

export default router;
