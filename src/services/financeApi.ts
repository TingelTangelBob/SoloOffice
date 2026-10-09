import { apiService } from './api';
import type { ForecastResult, LevyPayment, LevyPaymentPayload, RecurringExpense, RecurringExpensePayload, RecurringExpenseRun, TaxProfile, TaxProfilePayload } from '../types/finance';

const json = (method: string, data: unknown) => ({ method, body: JSON.stringify(data) });
async function mutate<T>(path: string, options: RequestInit): Promise<T> {
  const result = await apiService.financeRequest<T>(path, options);
  window.dispatchEvent(new Event('solooffice-finance-changed'));
  return result;
}
/** Ein Auth-, CSRF-, Fehler- und Demo-Pfad für alle Finanz-Endpunkte. */
export const financeApi = {
  getProfile: (year: number) => apiService.financeRequest<TaxProfile>(`/tax-profile/${year}`),
  saveProfile: (year: number, payload: TaxProfilePayload) => mutate<TaxProfile>(`/tax-profile/${year}`, json('PUT', payload)),
  copyProfile: (year: number, targetYear: number) => mutate<TaxProfile>(`/tax-profile/${year}/copy`, json('POST', { targetYear })),
  acceptDisclaimer: (year: number) => mutate<TaxProfile>(`/tax-profile/${year}/disclaimer`, json('POST', { accepted: true })),
  churchConsent: (year: number, consented: boolean, liable?: boolean) => mutate<TaxProfile>(`/tax-profile/${year}/church-consent`, json('POST', { consented, ...(liable === undefined ? {} : { liable }) })),
  getExpenses: () => apiService.financeRequest<RecurringExpense[]>('/recurring-expenses'),
  saveExpense: (payload: RecurringExpensePayload, id?: string) => mutate<RecurringExpense>(id ? `/recurring-expenses/${id}` : '/recurring-expenses', json(id ? 'PUT' : 'POST', payload)),
  deleteExpense: (id: string) => mutate<void>(`/recurring-expenses/${id}`, { method: 'DELETE' }),
  getRuns: (year: number, dueOnly = false) => apiService.financeRequest<RecurringExpenseRun[]>(`/recurring-expenses/runs?year=${year}&dueOnly=${dueOnly}`),
  generateRuns: (throughDate: string) => mutate<RecurringExpenseRun[]>('/recurring-expenses/generate', json('POST', { throughDate })),
  confirmRun: (id: string, paidOn: string) => mutate<RecurringExpenseRun>(`/recurring-expenses/runs/${id}/confirm`, json('POST', { paidOn })),
  skipRun: (id: string) => mutate<RecurringExpenseRun>(`/recurring-expenses/runs/${id}/skip`, json('POST', {})),
  getLevies: (year: number) => apiService.financeRequest<LevyPayment[]>(`/levy-payments?year=${year}`),
  saveLevy: (payload: LevyPaymentPayload, id?: string) => mutate<LevyPayment>(id ? `/levy-payments/${id}` : '/levy-payments', json(id ? 'PUT' : 'POST', payload)),
  deleteLevy: (id: string) => mutate<void>(`/levy-payments/${id}`, { method: 'DELETE' }),
  getForecast: (year: number) => apiService.financeRequest<ForecastResult>(`/forecast/${year}`),
};
