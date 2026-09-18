import { useEffect, useState } from 'react';
import { apiService } from '../services/api';

/**
 * Ob der Ticket-Support dieser Installation erreichbar ist (gehosteter
 * Betrieb mit Control Plane). Wird einmal je Sitzung geladen und für alle
 * Aufrufer geteilt, damit Seitenleiste und Seiten nicht mehrfach fragen.
 */
let cached: boolean | null = null;
let pending: Promise<boolean> | null = null;

function load(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  if (!pending) {
    pending = apiService.getSupportStatus()
      .then(status => { cached = Boolean(status.available); return cached; })
      .catch(() => { cached = false; return false; })
      .finally(() => { pending = null; });
  }
  return pending;
}

/** Nur für Tests und den Abmeldevorgang: Zwischenspeicher leeren. */
export function resetSupportAvailability(): void {
  cached = null;
}

export function useSupportAvailability(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(cached);
  useEffect(() => {
    let active = true;
    void load().then(value => { if (active) setAvailable(value); });
    return () => { active = false; };
  }, []);
  return available;
}
