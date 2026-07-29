import { JobEntry, JobTimeEntry } from '../types';

/**
 * Calculate total hours from all time entries in a job
 */
export function calculateTotalHours(job: JobEntry): number {
  if (job.timeEntries && job.timeEntries.length > 0) {
    return job.timeEntries.reduce((total, entry) => total + entry.hoursWorked, 0);
  }
  // Fallback to legacy hoursWorked field for backwards compatibility
  return job.hoursWorked || 0;
}

/**
 * Create a default time entry
 */
export function createDefaultTimeEntry(hourlyRate?: number, hourlyRateId?: string, taxRate?: number): JobTimeEntry {
  return {
    id: Date.now().toString(),
    description: '',
    startTime: '',
    endTime: '',
    hoursWorked: 0,
    hourlyRate: hourlyRate || 0,
    hourlyRateId: hourlyRateId || '',
    taxRate: taxRate != null ? taxRate : 19, // Default tax rate
    total: 0
  };
}
