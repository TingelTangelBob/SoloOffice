import express from 'express';

import { persistentRateLimit } from '../middleware/rateLimit.js';
import { sendSystemEmail } from '../services/emailService.js';
import { systemMails } from '../services/emailTemplates.js';
import {
  ControlPlaneOperationError,
  isUuid,
  provisionWorkspace,
  setWorkspaceSuspension,
} from '../services/controlPlaneWorkspaces.js';
import { isValidEmail, normaliseEmail } from '../utils/auth.js';
import {
  IDEMPOTENCY_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  controlPlaneConfiguration,
  controlPlaneSecret,
  requestHash,
  timestampToleranceSeconds,
  verifyControlPlaneRequest,
} from '../utils/controlPlaneAuth.js';
import logger from '../utils/logger.js';

/**
 * Interne Schnittstelle für den Control Plane (AP-4.4).
 *
 * Sie hängt bewusst nicht unter `/api`: keine Nutzersitzung, kein CSRF-Cookie,
 * keine CORS-Freigabe. Der Reverse-Proxy reicht ausschließlich `/api/` nach
 * außen durch; dieser Pfad ist nur im internen Netz erreichbar und zusätzlich
 * über HMAC-Signatur, Zeitfenster und Idempotency-Key abgesichert.
 */

const router = express.Router();

function fail(res, status, code, error) {
  return res.status(status).json({ error, code });
}

function appBaseUrl() {
  const configured = process.env.APP_BASE_URL || process.env.CORS_ORIGIN?.split(',')[0] || '';
  return configured.trim().replace(/\/$/, '');
}

router.use((req, res, next) => {
  const configuration = controlPlaneConfiguration();
  if (configuration.configured) return next();

  logger.warn('Interne Control-Plane-Schnittstelle ist nicht konfiguriert', {
    reason: configuration.reason,
    path: req.originalUrl.split('?')[0],
  });
  return fail(
    res,
    503,
    'CONTROL_PLANE_API_NOT_CONFIGURED',
    configuration.reason === 'too-short'
      ? 'CONTROL_PLANE_INTERNAL_SECRET ist zu kurz. Erforderlich sind mindestens 32 Zeichen.'
      : 'Die interne Control-Plane-Schnittstelle ist nicht konfiguriert.',
  );
});

router.use(persistentRateLimit({
  name: 'control-plane-internal',
  windowMs: 60 * 1000,
  max: Number(process.env.CONTROL_PLANE_INTERNAL_RATE_LIMIT_MAX || 60),
  keyGenerator: req => req.ip,
  failClosed: true,
}));

// Die Signatur wird über den unveränderten Anfrageinhalt gebildet. Deshalb
// muss der Rohtext vor dem Parsen gesichert werden.
router.use(express.json({
  limit: '32kb',
  verify: (req, res, buffer) => {
    req.rawBody = buffer.toString('utf8');
  },
}));

router.use((req, res, next) => {
  const verification = verifyControlPlaneRequest({
    secret: controlPlaneSecret(),
    timestamp: req.get(TIMESTAMP_HEADER),
    signature: req.get(SIGNATURE_HEADER),
    idempotencyKey: req.get(IDEMPOTENCY_HEADER),
    method: req.method,
    path: req.originalUrl.split('?')[0],
    body: req.rawBody ?? '',
    toleranceSeconds: timestampToleranceSeconds(),
  });

  if (!verification.ok) {
    logger.warn('Interner Control-Plane-Aufruf abgewiesen', {
      code: verification.code,
      path: req.originalUrl.split('?')[0],
      requestId: req.requestId,
    });
    return fail(res, verification.status, verification.code, verification.error);
  }

  req.controlPlane = {
    idempotencyKey: verification.idempotencyKey,
    requestHash: requestHash(req.rawBody ?? ''),
    operationId: typeof req.body?.operationId === 'string' ? req.body.operationId.slice(0, 100) : null,
  };
  return next();
});

function handleOperationError(res, req, error, operation) {
  if (error instanceof ControlPlaneOperationError) {
    logger.warn('Control-Plane-Vorgang abgelehnt', { operation, code: error.code, requestId: req.requestId });
    return fail(res, error.status, error.code, error.message);
  }
  logger.error('Control-Plane-Vorgang fehlgeschlagen', {
    operation,
    error: error.message,
    stack: error.stack,
    requestId: req.requestId,
  });
  return fail(res, 500, 'CONTROL_PLANE_OPERATION_FAILED', 'Der Vorgang konnte nicht ausgeführt werden.');
}

async function sendOwnerInvitation({ workspaceId, email, token, workspaceName }) {
  const baseUrl = appBaseUrl();
  if (!baseUrl) {
    logger.warn('Eigentümer-Einladung ohne öffentliche Adresse: APP_BASE_URL oder CORS_ORIGIN fehlt', { workspaceId });
    return { sent: false, link: null };
  }

  const link = `${baseUrl}?invite=${encodeURIComponent(token)}`;
  try {
    await sendSystemEmail({
      workspaceId,
      to: email,
      ...systemMails.workspaceReady({ email, link, workspaceName: workspaceName || 'SoloOffice' }),
    });
    return { sent: true, link };
  } catch (error) {
    logger.warn('Eigentümer-Einladung konnte nicht per E-Mail versendet werden', {
      workspaceId,
      error: error.message,
    });
    return { sent: false, link };
  }
}

router.post('/workspaces', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 255) : '';
  const ownerEmail = normaliseEmail(req.body?.ownerEmail);
  if (!name) return fail(res, 400, 'WORKSPACE_NAME_REQUIRED', 'Ein Workspace-Name ist erforderlich.');
  if (!isValidEmail(ownerEmail)) return fail(res, 400, 'OWNER_EMAIL_INVALID', 'Eine gültige Eigentümer-E-Mail-Adresse ist erforderlich.');

  try {
    const result = await provisionWorkspace({
      name,
      ownerEmail,
      idempotencyKey: req.controlPlane.idempotencyKey,
      operationId: req.controlPlane.operationId,
      requestHash: req.controlPlane.requestHash,
    });

    if (!result.ownerInvitationToken) {
      return res.status(result.replayed ? 200 : result.status).json(result.body);
    }

    const invitation = await sendOwnerInvitation({
      workspaceId: result.body.workspaceId,
      email: ownerEmail,
      token: result.ownerInvitationToken,
      workspaceName: name,
    });
    return res.status(result.status).json({
      ...result.body,
      owner: {
        ...result.body.owner,
        invitationEmailSent: invitation.sent,
        // Der Token verlässt die Anwendung nur, wenn der Betreiber das bewusst
        // freischaltet — dieselbe Regel wie bei Workspace-Einladungen.
        ...(process.env.EXPOSE_INVITATION_TOKENS === 'true' && invitation.link
          ? { invitationLink: invitation.link }
          : {}),
      },
    });
  } catch (error) {
    return handleOperationError(res, req, error, 'provision');
  }
});

function suspensionHandler(suspended) {
  return async (req, res) => {
    const workspaceId = req.params.workspaceId;
    if (!isUuid(workspaceId)) return fail(res, 400, 'WORKSPACE_ID_INVALID', 'Die Workspace-Kennung ist ungültig.');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';

    try {
      const result = await setWorkspaceSuspension({
        workspaceId,
        suspended,
        reason: reason || null,
        idempotencyKey: req.controlPlane.idempotencyKey,
        operationId: req.controlPlane.operationId,
        requestHash: req.controlPlane.requestHash,
      });
      return res.status(result.status).json(result.body);
    } catch (error) {
      return handleOperationError(res, req, error, suspended ? 'suspend' : 'unsuspend');
    }
  };
}

router.post('/workspaces/:workspaceId/suspend', suspensionHandler(true));
router.post('/workspaces/:workspaceId/unsuspend', suspensionHandler(false));

router.use((req, res) => fail(res, 404, 'CONTROL_PLANE_ENDPOINT_NOT_FOUND', 'Endpunkt nicht gefunden.'));

// Fehler des JSON-Parsers dürfen nicht als allgemeiner Serverfehler enden.
router.use((error, req, res, next) => {
  const status = Number.isInteger(error.status) ? error.status : 400;
  if (error.type === 'entity.too.large') {
    return fail(res, 413, 'REQUEST_PAYLOAD_TOO_LARGE', 'Der Anfrageinhalt ist zu groß.');
  }
  if (error.type === 'entity.parse.failed') {
    return fail(res, 400, 'REQUEST_JSON_INVALID', 'Der Anfrageinhalt enthält kein gültiges JSON.');
  }
  logger.error('Interner Control-Plane-Aufruf fehlgeschlagen', {
    error: error.message,
    stack: error.stack,
    requestId: req.requestId,
  });
  return fail(res, status >= 400 && status < 500 ? status : 500, 'CONTROL_PLANE_REQUEST_FAILED', 'Die Anfrage konnte nicht verarbeitet werden.');
});

export default router;
