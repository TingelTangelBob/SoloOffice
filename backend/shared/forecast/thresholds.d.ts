import type { TaxParameters } from '../taxParams/index.js';
import type { ThresholdResult, TaxProfile } from '../../../src/types/finance.js';
export function calculateThresholds(input?: { profit?: number; taxableIncome?: number; revenue?: number; currentRevenue?: number; previousRevenue?: number | null; profile?: Partial<TaxProfile>; params?: TaxParameters }): { thresholds: ThresholdResult[]; smallBusiness: { previous: 'green' | 'yellow' | 'red'; current: 'green' | 'yellow' | 'red'; previousValue: number; currentValue: number; currentLimit: number; forecastValue: number } };
