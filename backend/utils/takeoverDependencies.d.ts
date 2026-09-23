import type { PlannerContext, PlannerResource } from './importPlanner.js';

export interface TakeoverDependencyCategory {
  resource: PlannerResource;
  label?: string;
  rows: Array<Record<string, unknown>>;
}

export interface TakeoverDependencyNode {
  id: string;
  resource: PlannerResource;
  label: string;
  dependencies: string[];
  blockedReason: string | null;
  skipped: boolean;
  synthetic?: boolean;
}

export function planTakeoverDependencies(
  categories: TakeoverDependencyCategory[],
  context?: PlannerContext,
  skipped?: PlannerResource[],
): {
  nodes: TakeoverDependencyNode[];
  proposedCustomers: Array<{ key: string; name: string; customerNumber?: string; email?: string; rowNumbers: number[]; sources: string[] }>;
  plans: Record<string, unknown>;
};

export function isValidTakeoverOrder(nodes: TakeoverDependencyNode[], order: string[]): boolean;
