export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year';
export type RecurrencePause = { from: string; until: string | null };
export declare function assertDateOnly(value: string, label?: string): string;
export declare function occurrenceAt(startDate: string, occurrenceIndex: number, intervalValue?: number, intervalUnit?: RecurrenceUnit): string;
export declare function nextOccurrence(startDate: string, currentDate: string, intervalValue?: number, intervalUnit?: RecurrenceUnit): string;
export declare function occurrenceOnOrAfter(startDate: string, dateValue: string, intervalValue?: number, intervalUnit?: RecurrenceUnit): string;
export declare function addDays(dateValue: string, days: number): string;
export declare function isPausedOn(dateValue: string, pauses?: RecurrencePause[]): boolean;
export declare function isRecurringExpenseDue(expense: {
  startDate?: string; start_date?: string; endDate?: string | null; end_date?: string | null;
  cancelledOn?: string | null; cancelled_on?: string | null; noticePeriodDays?: number; cancellationNoticeDays?: number; cancellation_notice_days?: number;
  status?: 'active' | 'paused' | 'ended'; pauses?: RecurrencePause[]; intervalCount?: number; intervalValue?: number; interval_value?: number;
  intervalUnit?: string; interval_unit?: string;
}, dueDate: string): boolean;
