import type { JobEntry } from '../types';

/**
 * Returns a useful calendar title even for imported or manually edited jobs
 * whose title was accidentally set to the invoice number.
 */
export function getCalendarJobTitle(job: Pick<JobEntry, 'title'>, customerName?: string | null): string {
  const title = job.title.trim();
  const isInvoiceTitle = /^rechnung\s+(?:nr\.?\s*)?[a-z0-9]+(?:[-/][a-z0-9]+)*\s*$/i.test(title);

  if (title && !isInvoiceTitle) return title;
  return customerName?.trim() ? `Termin mit ${customerName.trim()}` : 'Termin';
}

export function hasCalendarJobTitle(job: Pick<JobEntry, 'title'>): boolean {
  const title = job.title.trim();
  return Boolean(title) && !/^rechnung\s+(?:nr\.?\s*)?[a-z0-9]+(?:[-/][a-z0-9]+)*\s*$/i.test(title);
}
