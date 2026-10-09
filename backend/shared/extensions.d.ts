export type ExtensionId = 'jobTracking' | 'quotes' | 'reporting' | 'taxes';

export interface ExtensionDefinition {
  id: ExtensionId;
  name: string;
  label: string;
  description: string;
  legacyCompanyField?: string;
  requiredPlan: 'free' | 'pro';
}

export interface WorkspaceExtension {
  id: ExtensionId;
  name: string;
  description: string;
  label: string;
  requiredPlan: 'free' | 'pro';
  available: boolean;
  legacyCompanyField?: string;
  enabled: boolean;
  acceptedAt: string | null;
  updatedAt: string | null;
}

export const EXTENSION_CATALOG: readonly ExtensionDefinition[];
export function getExtensionDefinition(id: string): ExtensionDefinition | null;
export function canUseExtension(definition: ExtensionDefinition | null | undefined, enabled: boolean, plan?: string): boolean;
export function workspaceExtension(definition: ExtensionDefinition, state?: Record<string, unknown>): WorkspaceExtension;
