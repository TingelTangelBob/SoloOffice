import { defaultTaxProfile } from '../../backend/shared/financeDefaults.js';
import { EXTENSION_CATALOG, workspaceExtension } from '../../backend/shared/extensions.js';
import type { ExtensionId } from '../../backend/shared/extensions.js';
import type { TaxProfile, TaxProfilePayload, WorkspaceExtension as FinanceWorkspaceExtension } from '../types/finance';

export function demoDefaultTaxProfile(year: number): TaxProfile {
  return defaultTaxProfile(year) as TaxProfile;
}

export function demoSeedTaxProfile(year: number, currentYear: number): TaxProfile {
  if (year !== currentYear) return demoDefaultTaxProfile(year);
  const defaults = demoDefaultTaxProfile(year);
  return {
    ...defaults, businessKind: 'teacher', startedOn: `${year - 5}-01-01`, vatStatus: 'regular',
    healthInsurance: 'gkv_voluntary', birthYear: 1980, children: 0, childrenUnder25: 0,
    pensionStatus: 'teacher', pensionMode: 'income', healthNoticeMonthly: 262.5, careNoticeMonthly: 63,
    healthNoticeIncomeMonthly: 1500, churchTaxLiable: null,
  };
}

export function demoProfilePayload(profile: TaxProfile): TaxProfilePayload {
  const serverFields = new Set(['id', 'disclaimerAcceptedAt', 'churchTaxConsentAt', 'updatedAt', 'paramsVersion']);
  return Object.fromEntries(Object.entries(profile).filter(([key]) => !serverFields.has(key))) as TaxProfilePayload;
}

export function demoExtensionList(state: {
  taxesAcceptedAt?: string | null;
  jobTrackingEnabled?: unknown;
  quotesEnabled?: unknown;
  reportingEnabled?: unknown;
}, now = new Date().toISOString()): FinanceWorkspaceExtension[] {
  const legacy: Record<string, boolean> = {
    job_tracking_enabled: state.jobTrackingEnabled !== false,
    quotes_enabled: state.quotesEnabled !== false,
    reporting_enabled: state.reportingEnabled !== false,
  };
  return EXTENSION_CATALOG.map(definition => workspaceExtension(definition, {
    enabled: definition.id === 'taxes' ? Boolean(state.taxesAcceptedAt) : legacy[definition.legacyCompanyField || ''],
    accepted_at: definition.id === 'taxes' ? state.taxesAcceptedAt || null : null,
    plan: 'free',
  })).map(extension => ({ ...extension, updatedAt: now }));
}

export function demoExtensionId(value: string): ExtensionId | null {
  return EXTENSION_CATALOG.some(item => item.id === value) ? value as ExtensionId : null;
}

export function demoTaxesEnabled(extensions: FinanceWorkspaceExtension[]): boolean {
  return extensions.some(extension => extension.id === 'taxes' && extension.enabled && extension.available);
}
