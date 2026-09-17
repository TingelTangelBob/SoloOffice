import logger from '../utils/logger.js';

export const TELEMETRY_EVENTS = Object.freeze([
  'workspace_created',
  'customer_created',
  'template_created',
  'appointment_used',
  'calendar_exported',
  'calendar_connected',
  'calendar_synced',
  'extension_used',
  'terminology_used',
  'ocr_used',
  'invoice_sent_count',
  'heartbeat',
]);

const allowedEventNames = new Set(TELEMETRY_EVENTS);
const installationIdPattern = /^sh_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_EVENTS_PER_REQUEST = 50;
const MAX_COUNT = 10_000;

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function looksLikeInstallationId(value) {
  return installationIdPattern.test(stringValue(value));
}

function isValidIsoDate(value) {
  return typeof value === 'string' && datePattern.test(value) && Number.isFinite(Date.parse(value));
}

export function telemetryConfiguration(env = process.env) {
  const enabled = stringValue(env.TELEMETRY_ENABLED).toLowerCase() === 'true';
  const source = stringValue(env.TELEMETRY_SOURCE).toLowerCase() === 'hosted' ? 'hosted' : 'selfhost';
  const url = stringValue(env.TELEMETRY_URL);
  const secret = stringValue(env.TELEMETRY_SECRET);
  const installationId = stringValue(env.TELEMETRY_INSTALLATION_ID);
  const installedAt = stringValue(env.TELEMETRY_INSTALLED_AT);

  if (!enabled) return { enabled: false, reason: 'disabled', source };
  if (!/^https?:\/\//i.test(url)) return { enabled: false, reason: 'url_missing', source };
  if (secret.length < 32) return { enabled: false, reason: 'secret_missing', source };
  if (source === 'selfhost' && !looksLikeInstallationId(installationId)) {
    return { enabled: false, reason: 'installation_id_invalid', source };
  }
  if (source === 'selfhost' && !isValidIsoDate(installedAt)) {
    return { enabled: false, reason: 'installed_at_invalid', source };
  }

  const configuredTimeout = Number(env.TELEMETRY_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.min(10_000, Math.max(1_000, Math.round(configuredTimeout)))
    : 5_000;

  return {
    enabled: true,
    source,
    url,
    secret,
    ...(source === 'selfhost' ? { installationId, installedAt } : {}),
    timeoutMs,
  };
}

/**
 * SoloOffice sends only a bounded counter. This is intentionally stricter
 * than the Control Plane's generic primitive-value sanitizer: a future event
 * cannot accidentally turn an arbitrary label into telemetry data.
 */
export function sanitizeTelemetryProps(props) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {};
  const count = Number(props.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return {};
  return { count };
}

export function sanitizeTelemetryEvents(events, source = 'selfhost', now = new Date()) {
  if (!Array.isArray(events)) return [];
  return events.slice(0, MAX_EVENTS_PER_REQUEST).flatMap(event => {
    const name = stringValue(event?.name);
    if (!allowedEventNames.has(name)) return [];
    if (name === 'invoice_sent_count' && source !== 'hosted') return [];
    const occurredAt = isValidIsoDate(event?.occurredAt) ? event.occurredAt : now.toISOString();
    return [{
      name,
      occurredAt,
      props: sanitizeTelemetryProps(event?.props),
    }];
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildTelemetryPayload(events, configuration, env = process.env, now = new Date(), context = {}) {
  const sanitizedEvents = sanitizeTelemetryEvents(events, configuration.source, now);
  const appVersion = stringValue(env.SOLOOFFICE_VERSION || env.APP_VERSION).slice(0, 40) || 'dev';
  // Hosted: the Control Plane resolves the workspace UUID to its own account
  // server-side (workspace_bindings.solooffice_workspace_id). Without it every
  // hosted event arrives without an account and DAU/MAU stay at zero. The UUID
  // is an opaque key, not a name; selfhost installations never send it.
  const workspaceId = configuration.source === 'hosted' && UUID_PATTERN.test(stringValue(context.workspaceId))
    ? stringValue(context.workspaceId)
    : null;
  return {
    source: configuration.source,
    ...(configuration.installationId ? { installationId: configuration.installationId } : {}),
    ...(configuration.installedAt ? { installedAt: configuration.installedAt } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    appVersion,
    events: sanitizedEvents,
  };
}

export async function relayTelemetry(events, env = process.env, fetchImpl = globalThis.fetch, context = {}) {
  const configuration = telemetryConfiguration(env);
  if (!configuration.enabled) return { sent: false, reason: configuration.reason, accepted: 0 };
  if (typeof fetchImpl !== 'function') return { sent: false, reason: 'fetch_unavailable', accepted: 0 };

  const payload = buildTelemetryPayload(events, configuration, env, new Date(), context);
  if (!payload.events.length) return { sent: false, reason: 'no_allowed_events', accepted: 0 };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), configuration.timeoutMs);
  try {
    const response = await fetchImpl(configuration.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telemetry-Secret': configuration.secret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn('Telemetrie-Relay abgewiesen', { statusCode: response.status });
      return { sent: false, reason: `http_${response.status}`, accepted: 0 };
    }
    const result = await response.json().catch(() => ({}));
    return { sent: true, reason: 'accepted', accepted: Number(result.accepted || payload.events.length) };
  } catch (error) {
    logger.warn('Telemetrie-Relay nicht erreichbar', { error: error instanceof Error ? error.message : String(error) });
    return { sent: false, reason: 'request_failed', accepted: 0 };
  } finally {
    clearTimeout(timeout);
  }
}
