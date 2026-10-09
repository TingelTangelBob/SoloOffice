export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year';
export type RecurrencePause = { from: string; until: string | null };
export declare function assertDateOnly(value: string, label?: string): string;
export declare function occurrenceAt(startDate: string, occurrenceIndex: number, intervalValue?: number, intervalUnit?: RecurrenceUnit): string;
export declare function nextOccurrence(startDate: string, currentDate: string, intervalValue?: number, intervalUnit?: RecurrenceUnit): string;
export declare function addDays(dateValue: string, days: number): string;
export declare function isPausedOn(dateValue: string, pauses?: RecurrencePause[]): boolean;
