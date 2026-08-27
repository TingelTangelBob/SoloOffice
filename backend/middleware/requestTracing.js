import { randomUUID } from 'node:crypto';
import logger from '../utils/logger.js';
import { runWithRequestContext } from '../utils/requestContext.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function normalizeRequestId(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return REQUEST_ID_PATTERN.test(normalized) ? normalized : null;
}

export function requestTracing(req, res, next) {
  const requestId = normalizeRequestId(req.get('x-request-id')) || randomUUID();
  const started = Date.now();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  return runWithRequestContext({ requestId }, () => {
    res.on('finish', () => {
      const path = String(req.originalUrl || req.url || '').split('?')[0];
      logger.request(req.method, path, res.statusCode, Date.now() - started);
    });
    return next();
  });
}
