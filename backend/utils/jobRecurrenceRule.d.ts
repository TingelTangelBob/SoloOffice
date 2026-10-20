import type { JobRecurrenceRule } from '../../src/types';
export function normalizeRecurrence(value: unknown): JobRecurrenceRule | null;
export function sameRecurrenceRule(left: unknown, right: unknown): boolean;
export function expandRecurrence(rule: JobRecurrenceRule): string[];
