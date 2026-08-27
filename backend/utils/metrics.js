import { timingSafeEqual } from 'node:crypto';

const requestCounters = new Map();
const startedAt = new Date().toISOString();
const DEFAULT_MAX_METRIC_PATHS = 250;
const OVERFLOW_KEY = 'OTHER';

function configuredMetricPathLimit() {
  const configured = Number(process.env.METRICS_MAX_PATHS || DEFAULT_MAX_METRIC_PATHS);
  return Number.isSafeInteger(configured) && configured >= 10
    ? configured
    : DEFAULT_MAX_METRIC_PATHS;
}

export function metricPath(req) {
  if (!req.route?.path) return `${req.method} UNMATCHED`;
  const routePath = Array.isArray(req.route.path) ? req.route.path.join('|') : req.route.path;
  return `${req.method} ${req.baseUrl || ''}${routePath}`
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .slice(0, 180);
}

function metricCounterFor(key) {
  if (requestCounters.has(key)) return { key, counter: requestCounters.get(key) };
  const maximumPaths = configuredMetricPathLimit();
  // Einen Platz für den Sammelschlüssel reservieren, damit die konfigurierte
  // Obergrenze einschließlich Überlauf nie überschritten wird.
  const targetKey = requestCounters.size < maximumPaths - 1 ? key : OVERFLOW_KEY;
  return {
    key: targetKey,
    counter: requestCounters.get(targetKey) || {
      requests: 0,
      clientErrors: 0,
      errors: 0,
      durationMs: 0,
    },
  };
}

export function metricsMiddleware(req, res, next) {
  const started = Date.now();
  res.on('finish', () => {
    const resolved = metricCounterFor(metricPath(req));
    const current = resolved.counter;
    current.requests += 1;
    current.clientErrors += res.statusCode >= 400 && res.statusCode < 500 ? 1 : 0;
    current.errors += res.statusCode >= 500 ? 1 : 0;
    current.durationMs += Date.now() - started;
    requestCounters.set(resolved.key, current);
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

export function resetMetricsForTests() {
  requestCounters.clear();
}
