import { isDemoMode } from './demoApi';
import { apiService } from './api';

export const TELEMETRY_EVENT_NAMES = [
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
] as const;

export type TelemetryEventName = typeof TELEMETRY_EVENT_NAMES[number];
type TelemetryEvent = { name: TelemetryEventName; occurredAt: string; props?: { count?: number } };

const allowedEventNames = new Set<string>(TELEMETRY_EVENT_NAMES);
const MAX_QUEUE_SIZE = 50;
const FLUSH_DELAY_MS = 1_000;

let queue: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushInProgress = false;

export function isTelemetryEnabled(): boolean {
  return !isDemoMode && import.meta.env.VITE_TELEMETRY_ENABLED === 'true';
}

function normaliseProps(props?: { count?: number }): { count?: number } {
  const count = Number(props?.count);
  return Number.isInteger(count) && count >= 1 && count <= 10_000 ? { count } : {};
}

export function trackTelemetry(name: TelemetryEventName, props?: { count?: number }): void {
  if (!isTelemetryEnabled() || !allowedEventNames.has(name)) return;
  queue.push({ name, occurredAt: new Date().toISOString(), props: normaliseProps(props) });
  if (queue.length >= MAX_QUEUE_SIZE) {
    void flushTelemetry();
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void flushTelemetry();
    }, FLUSH_DELAY_MS);
  }
}

export async function flushTelemetry(): Promise<void> {
  if (flushInProgress || !queue.length || !isTelemetryEnabled()) return;
  flushInProgress = true;
  const events = queue.splice(0, MAX_QUEUE_SIZE);
  try {
    await apiService.sendTelemetry(events);
  } catch {
    // Optional telemetry is best-effort and must not affect user actions.
  } finally {
    flushInProgress = false;
    if (queue.length && isTelemetryEnabled()) void flushTelemetry();
  }
}

export function resetTelemetryQueue(): void {
  queue = [];
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
}
