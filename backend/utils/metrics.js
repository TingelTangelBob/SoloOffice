import { timingSafeEqual } from 'node:crypto';

const requestCounters = new Map();
const startedAt = new Date().toISOString();

function metricPath(req) {
  return `${req.method} ${req.baseUrl || ''}${req.route?.path || req.path}`
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .slice(0, 180);
}

export function metricsMiddleware(req, res, next) {
  const started = Date.now();
  res.on('finish', () => {
    const key = metricPath(req);
    const current = requestCounters.get(key) || { requests: 0, errors: 0, durationMs: 0 };
    current.requests += 1;
    current.errors += res.statusCode >= 500 ? 1 : 0;
    current.durationMs += Date.now() - started;
    requestCounters.set(key, current);
  });
  next();
}

export function getMetricsSnapshot() {
  return {
    startedAt,
    process: { uptimeSeconds: Math.round(process.uptime()), memory: process.memoryUsage() },
    requests: Object.fromEntries([...requestCounters.entries()].map(([path, value]) => [path, {
      ...value,
      averageDurationMs: value.requests ? Math.round(value.durationMs / value.requests) : 0,
    }])),
  };
}

export function metricsAccessStatus(configuredToken, authorizationHeader) {
  if (typeof configuredToken !== 'string' || !configuredToken) return 'unconfigured';
  const expected = Buffer.from(`Bearer ${configuredToken}`);
  const supplied = Buffer.from(typeof authorizationHeader === 'string' ? authorizationHeader : '');
  if (expected.length !== supplied.length) return 'unauthorized';
  return timingSafeEqual(expected, supplied) ? 'authorized' : 'unauthorized';
}
