import { useEffect, useState } from 'react';
import { apiService } from '../services/api';
import type { AccountStatus } from '../types';

/**
 * Ob Tarif und Abrechnung in dieser Installation verfügbar sind (gehosteter
 * Betrieb mit Control Plane, nie in der Demo) und ob die angemeldete Rolle sie
 * verwalten darf. Einmal je Sitzung geladen und geteilt, analog
 * `useSupportAvailability`.
 */
const NOT_AVAILABLE: AccountStatus = { available: false, canManage: false };
// Die Rolle gilt je Workspace; deshalb wird je Workspace-ID gemerkt.
const cache = new Map<string, AccountStatus>();
const pending = new Map<string, Promise<AccountStatus>>();

function load(key: string): Promise<AccountStatus> {
  const known = cache.get(key);
  if (known) return Promise.resolve(known);
  let request = pending.get(key);
  if (!request) {
    request = apiService.getAccountStatus()
      .then(status => ({ available: Boolean(status.available), canManage: Boolean(status.available && status.canManage) }))
      .catch(() => NOT_AVAILABLE)
      .then(value => { cache.set(key, value); return value; })
      .finally(() => { pending.delete(key); });
    pending.set(key, request);
  }
  return request;
}

/** Nur für Tests und den Abmeldevorgang: Zwischenspeicher leeren. */
export function resetAccountBillingStatus(): void {
  cache.clear();
}

/** `null`, solange noch geladen wird. */
export function useAccountBillingStatus(workspaceId = ''): AccountStatus | null {
  const [status, setStatus] = useState<AccountStatus | null>(cache.get(workspaceId) ?? null);
  useEffect(() => {
    let active = true;
    setStatus(cache.get(workspaceId) ?? null);
    void load(workspaceId).then(value => { if (active) setStatus(value); });
    return () => { active = false; };
  }, [workspaceId]);
  return status;
}
