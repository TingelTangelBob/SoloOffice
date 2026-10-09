import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarClock, Check, SkipForward } from 'lucide-react';
import type { RecurringExpenseRun } from '../types/finance';
import { financeApi } from '../services/financeApi';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import { formatCurrency, formatDate } from '../utils/formatters';

interface Props { onBooked: () => void }
const today = () => new Date().toISOString().slice(0, 10);

export function DueRecurringExpensesNotice({ onBooked }: Props) {
  const { workspace, can } = useAuth();
  const { company } = useCompany();
  const workspaceId = workspace?.id ?? null;
  const canWrite = can('data.write');
  const [dueRuns, setDueRuns] = useState<RecurringExpenseRun[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [paidDates, setPaidDates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [generationError, setGenerationError] = useState('');
  const version = useRef(0);
  const generatedWorkspaces = useRef(new Set<string>());
  const activeWorkspace = useRef(workspaceId);
  const onBookedRef = useRef(onBooked);
  activeWorkspace.current = workspaceId;
  onBookedRef.current = onBooked;
  const locale = company?.locale || 'de-DE';

  const load = useCallback(async () => {
    const current = ++version.current;
    if (!workspaceId) { setDueRuns([]); setNames(new Map()); return; }
    try {
      const [runs, expenses] = await Promise.all([financeApi.getRuns(undefined, true), financeApi.getExpenses()]);
      if (version.current !== current || activeWorkspace.current !== workspaceId) return;
      const businessIds = new Set(expenses.filter(item => item.scope === 'business').map(item => item.id));
      setNames(new Map(expenses.filter(item => item.scope === 'business').map(item => [item.id, item.name])));
      setDueRuns(runs.filter(run => run.status === 'planned' && run.dueDate <= today() && (run.scope === 'business' || (!run.scope && businessIds.has(run.expenseId)))));
      setError('');
    } catch (e) { if (version.current === current && activeWorkspace.current === workspaceId) setError(e instanceof Error ? e.message : 'Fällige Fixkosten konnten nicht geladen werden.'); }
  }, [workspaceId]);

  useLayoutEffect(() => {
    setDueRuns([]); setNames(new Map()); setPaidDates({}); setError(''); setGenerationError(''); setBusy('');
    if (!workspaceId) return;
    let cancelled = false;
    const ensureRuns = async () => {
      if (canWrite && !generatedWorkspaces.current.has(workspaceId)) {
        generatedWorkspaces.current.add(workspaceId);
        try {
          const generated = await financeApi.generateRuns(today());
          if (cancelled || activeWorkspace.current !== workspaceId) return;
          if (generated.some(run => run.status === 'confirmed' && run.scope === 'business')) onBookedRef.current();
        } catch (e) {
          generatedWorkspaces.current.delete(workspaceId);
          if (!cancelled && activeWorkspace.current === workspaceId) setGenerationError(e instanceof Error ? e.message : 'Fälligkeiten konnten nicht aktualisiert werden.');
        }
      }
      if (!cancelled && activeWorkspace.current === workspaceId) await load();
    };
    void ensureRuns();
    return () => { cancelled = true; version.current += 1; };
  }, [workspaceId, canWrite, load]);

  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener('solooffice-finance-changed', refresh);
    return () => window.removeEventListener('solooffice-finance-changed', refresh);
  }, [load]);

  const setPaid = async (run: RecurringExpenseRun) => {
    const paidOn = paidDates[run.id] || today();
    if (paidOn > today()) { setError('Das Zahlungsdatum darf nicht in der Zukunft liegen.'); return; }
    const targetWorkspace = workspaceId;
    setBusy(run.id); setError('');
    try {
      await financeApi.confirmRun(run.id, paidOn);
      if (activeWorkspace.current !== targetWorkspace) return;
      await load(); onBookedRef.current();
    } catch (e) { if (activeWorkspace.current === targetWorkspace) setError(e instanceof Error ? e.message : 'Die Fixkostenbuchung konnte nicht bestätigt werden.'); }
    finally { if (activeWorkspace.current === targetWorkspace) setBusy(''); }
  };
  const skip = async (run: RecurringExpenseRun) => {
    const targetWorkspace = workspaceId;
    setBusy(run.id); setError('');
    try { await financeApi.skipRun(run.id); if (activeWorkspace.current === targetWorkspace) await load(); }
    catch (e) { if (activeWorkspace.current === targetWorkspace) setError(e instanceof Error ? e.message : 'Die Fälligkeit konnte nicht übersprungen werden.'); }
    finally { if (activeWorkspace.current === targetWorkspace) setBusy(''); }
  };
  const retryGeneration = async () => {
    if (!workspaceId || !canWrite || busy) return;
    const targetWorkspace = workspaceId; setBusy('generate'); setGenerationError('');
    try { const generated = await financeApi.generateRuns(today()); if (activeWorkspace.current === targetWorkspace) { await load(); if (generated.some(run => run.status === 'confirmed' && run.scope === 'business')) onBookedRef.current(); } }
    catch (e) { if (activeWorkspace.current === targetWorkspace) setGenerationError(e instanceof Error ? e.message : 'Fälligkeiten konnten nicht aktualisiert werden.'); }
    finally { if (activeWorkspace.current === targetWorkspace) setBusy(''); }
  };
  if (!dueRuns.length && !error && !generationError) return null;
  return <section className="rounded-xl border border-amber-200 bg-amber-50 p-4" aria-labelledby="due-recurring-expenses-title">
    <div className="flex items-start gap-3"><CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div className="min-w-0 flex-1"><h2 id="due-recurring-expenses-title" className="font-semibold text-amber-950">Fällige Fixkosten ({dueRuns.length})</h2><p className="mt-1 text-sm text-amber-900">Geplante betriebliche Zahlungen. Erst „Bezahlt am …“ übernimmt den Betrag als EÜR-Ausgabe.</p>
      {generationError && <div className="mt-2 flex flex-wrap items-center gap-2"><p role="alert" className="text-sm text-red-800">{generationError}</p><button type="button" disabled={Boolean(busy)} onClick={() => void retryGeneration()} className="min-h-8 rounded-lg border border-amber-300 bg-white px-3 text-xs font-medium text-amber-950">Fälligkeiten aktualisieren</button></div>}
      {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
      <ul className="mt-3 divide-y divide-amber-200">{dueRuns.map(run => <li key={run.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"><div className="min-w-0"><p className="truncate text-sm font-medium text-amber-950">{run.name || names.get(run.expenseId) || 'Fixkosten'}</p><p className="mt-1 text-xs text-amber-800">Fällig {formatDate(run.dueDate, locale)} · {formatCurrency(run.amountGross, locale, company?.numberFormat, company?.currency || 'EUR')}</p></div>{canWrite && <div className="flex flex-wrap items-center gap-2"><label className="text-xs text-amber-950">Bezahlt am<input type="date" max={today()} value={paidDates[run.id] || today()} onChange={event => setPaidDates(current => ({ ...current, [run.id]: event.target.value }))} className="form-input form-input-compact ml-2 min-h-9 text-xs" /></label><button type="button" disabled={Boolean(busy)} onClick={() => void setPaid(run)} className="min-h-9 rounded-lg bg-primary-custom px-3 text-xs font-semibold text-white"><Check className="mr-1 inline h-4 w-4" />Bezahlt am {formatDate(paidDates[run.id] || today(), locale)}</button><button type="button" disabled={Boolean(busy)} onClick={() => void skip(run)} className="min-h-9 rounded-lg border border-amber-300 bg-white px-3 text-xs font-medium text-amber-900"><SkipForward className="mr-1 inline h-4 w-4" />Überspringen</button></div>}</li>)}</ul>
    </div></div>
  </section>;
}
