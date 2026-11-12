import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { Pencil, Plus, Trash2, TrendingUp } from 'lucide-react';
import type { EuerForecastPlan } from '../services/financeApi';
import { DialogShell } from './DialogShell';

type ForecastDraft = Omit<EuerForecastPlan, 'id'>;

interface EuerForecastDialogProps {
  year: number;
  plans: EuerForecastPlan[];
  draft: ForecastDraft;
  setDraft: Dispatch<SetStateAction<ForecastDraft>>;
  formOpen: boolean;
  editingId: string | null;
  canWrite: boolean;
  busy: boolean;
  ready: boolean;
  /** Ist-Werte des Jahres ohne Planwerte. */
  actual: { income: number; expenses: number; profit: number };
  /** Summen der Planwerte. */
  planned: { income: number; expense: number };
  categoryLabels: Record<string, string>;
  formatAmount: (amount: number) => string;
  formatPlanDate: (isoDate: string) => string;
  onAdd: () => void;
  onEdit: (plan: EuerForecastPlan) => void;
  onRemove: (plan: EuerForecastPlan) => void;
  onCancelForm: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}

const ENTRY_TYPES = [
  { value: 'income', label: 'Einnahme' },
  { value: 'expense', label: 'Ausgabe' },
] as const;

export function EuerForecastDialog({
  year, plans, draft, setDraft, formOpen, editingId, canWrite, busy, ready, actual, planned,
  categoryLabels, formatAmount, formatPlanDate, onAdd, onEdit, onRemove, onCancelForm, onSubmit, onClose,
}: EuerForecastDialogProps) {
  const sortedPlans = [...plans].sort((a, b) => a.date.localeCompare(b.date));
  const plannedProfit = planned.income - planned.expense;
  const rows = [
    { label: 'Einnahmen', actual: actual.income, planned: planned.income, total: actual.income + planned.income },
    { label: 'Ausgaben', actual: actual.expenses, planned: planned.expense, total: actual.expenses + planned.expense },
    { label: 'Überschuss', actual: actual.profit, planned: plannedProfit, total: actual.profit + plannedProfit, emphasis: true },
  ];
  const categoryOptions = Object.entries(categoryLabels).filter(([key]) =>
    key !== 'vat_payment' && key !== 'vat_refund' && (draft.entryType === 'expense' || key === 'other_income' || key === 'operating_income'));

  return (
    <DialogShell unsavedChangesGuard
      titleId="euer-forecast-dialog-title"
      title={`Prognose ${year}`}
      description="Planwerte für erwartete Einnahmen und Ausgaben. Sie ändern keine Ist-Zahlen, Exporte oder Steuerberechnungen."
      icon={TrendingUp}
      size="lg"
      fitContent
      onClose={onClose}
    >
      <div className="space-y-6 pb-4 pt-2">
        <table className="w-full text-sm">
          <caption className="sr-only">Ist-Werte, Planwerte und Gesamt für {year}</caption>
          <thead>
            <tr className="border-b border-gray-200 table-head text-gray-500">
              <th scope="col" className="py-2 pr-3 text-left font-medium"><span className="sr-only">Kennzahl</span></th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Ist</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Prognose</th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">Gesamt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(row => (
              <tr key={row.label} className={row.emphasis ? 'font-semibold text-gray-900' : 'text-gray-700'}>
                <th scope="row" className="py-2.5 pr-3 text-left font-medium">{row.label}</th>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatAmount(row.actual)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{formatAmount(row.planned)}</td>
                <td className="py-2.5 pl-3 text-right tabular-nums">{formatAmount(row.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section aria-labelledby="euer-forecast-plans-title">
          <div className="flex items-center justify-between gap-3">
            <h3 id="euer-forecast-plans-title" className="text-base font-semibold text-gray-900">
              Planwerte{sortedPlans.length > 0 && <span className="ml-2 text-sm font-normal text-gray-500">{sortedPlans.length}</span>}
            </h3>
            {canWrite && !formOpen && (
              <button
                type="button"
                disabled={!ready || busy}
                onClick={onAdd}
                className="btn-primary inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium text-white disabled:opacity-50"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />Planwert hinzufügen
              </button>
            )}
          </div>

          {formOpen && (
            <form onSubmit={onSubmit} className="mt-3 space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <fieldset>
                <legend className="text-sm font-medium text-gray-700">Art</legend>
                <div className="mt-1.5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Art des Planwerts">
                  {ENTRY_TYPES.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={draft.entryType === option.value}
                      onClick={() => setDraft(value => ({
                        ...value,
                        entryType: option.value,
                        category: option.value === 'income' ? 'other_income' : null,
                      }))}
                      className={`min-h-10 rounded-lg border px-3 text-sm font-medium ${draft.entryType === option.value
                        ? 'border-primary-custom bg-primary-light-custom text-gray-900'
                        : 'border-gray-300 bg-white text-gray-700'}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="block text-sm font-medium text-gray-700">
                Bezeichnung
                <input
                  required
                  maxLength={255}
                  autoFocus
                  placeholder="z. B. Softwareprojekt Herbst"
                  className="form-input form-input-compact mt-1.5 w-full"
                  value={draft.description}
                  onChange={event => setDraft(value => ({ ...value, description: event.target.value }))}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-gray-700">
                  Betrag in €
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    required
                    className="form-input form-input-compact mt-1.5 w-full text-right tabular-nums"
                    value={draft.amount || ''}
                    onChange={event => setDraft(value => ({ ...value, amount: Number(event.target.value) }))}
                  />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  Datum
                  <input
                    type="date"
                    required
                    min={`${year}-01-01`}
                    max={`${year}-12-31`}
                    className="form-input form-input-compact mt-1.5 w-full"
                    value={draft.date}
                    onChange={event => setDraft(value => ({ ...value, date: event.target.value }))}
                  />
                </label>
              </div>

              <label className="block text-sm font-medium text-gray-700">
                Kategorie <span className="font-normal text-gray-500">(optional)</span>
                <select
                  className="form-input form-input-compact mt-1.5 w-full"
                  value={draft.category || ''}
                  onChange={event => setDraft(value => ({ ...value, category: event.target.value || null }))}
                >
                  <option value="">Keine</option>
                  {categoryOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>

              <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4">
                <button type="button" onClick={onCancelForm} className="min-h-10 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700">
                  Abbrechen
                </button>
                <button type="submit" disabled={busy} className="btn-primary min-h-10 rounded-lg px-4 text-sm font-medium text-white disabled:opacity-50">
                  {editingId ? 'Änderungen speichern' : 'Planwert speichern'}
                </button>
              </div>
            </form>
          )}

          {sortedPlans.length === 0 ? (
            !formOpen && (
              <p className="mt-3 rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
                Für {year} sind noch keine Planwerte erfasst.
              </p>
            )
          ) : (
            <ul className="mt-3 divide-y divide-gray-100 border-y border-gray-100">
              {sortedPlans.map(plan => (
                <li key={plan.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{plan.description}</p>
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      {formatPlanDate(plan.date)} · {plan.category ? categoryLabels[plan.category] || plan.category : 'Keine Kategorie'}
                    </p>
                  </div>
                  <span className={`shrink-0 text-sm font-medium tabular-nums ${plan.entryType === 'income' ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {plan.entryType === 'income' ? '+' : '−'}{formatAmount(plan.amount)}
                  </span>
                  {canWrite && (
                    <div className="flex shrink-0 items-center">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onEdit(plan)}
                        aria-label={`Planwert „${plan.description}“ bearbeiten`}
                        title="Bearbeiten"
                        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRemove(plan)}
                        aria-label={`Planwert „${plan.description}“ löschen`}
                        title="Löschen"
                        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-rose-700 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </DialogShell>
  );
}
