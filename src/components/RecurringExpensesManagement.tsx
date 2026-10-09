import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Check, MoreHorizontal, Pause, Play, Plus, ReceiptText, SkipForward, Trash2, X } from 'lucide-react';
import type { LevyKind, LevyPayment, LevyPaymentPayload, RecurringExpense, RecurringExpensePayload, RecurringExpenseRun } from '../types/finance';
import { financeApi } from '../services/financeApi';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import { useExtensions } from '../hooks/useExtensions';
import { useFeedback } from '../context/FeedbackContext';
import { formatCurrency, formatDate } from '../utils/formatters';
import { monthlyEquivalent, annualEquivalent, currentExpenseAmount, currentExpenseStatus, isExpensePaused, nextDueLabel, nextRecurringExpenseDueDate, recurrenceLabels, runStatusLabel } from '../utils/recurringExpenseDisplay';
import { RecurringExpenseDialog } from './RecurringExpenseDialog';
import { PageHeader } from './PageHeader';
import { ThemeTabBar } from './ThemeTabBar';
import { DialogShell } from './DialogShell';
import { TableSkeleton } from './TableSkeleton';
import { parseLocalizedNumber } from '../utils/formatters';
import { resolveTaxParams } from '../../backend/shared/taxParams/index.js';
import { calculateSocial } from '../../backend/shared/forecast/social.js';
import { ActionMenu, ActionMenuItem } from './ActionMenu';

interface Props { onNavigate?: (page: string, filter?: string) => void }
type Tab = 'business' | 'private';
const today = () => new Date().toISOString().slice(0, 10);
const kinds: Array<[LevyKind, string]> = [['kv', 'Krankenversicherung'], ['pv', 'Pflegeversicherung'], ['rv', 'Rentenversicherung'], ['av', 'Arbeitslosenversicherung'], ['ksk', 'Künstlersozialkasse'], ['est_vz', 'Einkommensteuer-Vorauszahlung'], ['gewst_vz', 'Gewerbesteuer-Vorauszahlung'], ['ust', 'Umsatzsteuer']];
const input = 'form-input form-input-compact mt-1 w-full text-sm';

export function RecurringExpensesManagement(props: Props) {
  void props;
  const { workspace, can } = useAuth();
  const { company } = useCompany();
  const { isEnabled } = useExtensions();
  const { confirm } = useFeedback();
  const workspaceId = workspace?.id || null;
  const privateAllowed = isEnabled('taxes') && can('workspace.settings');
  const businessWritable = can('data.write');
  const [tab, setTab] = useState<Tab>('business');
  const [expenses, setExpenses] = useState<RecurringExpense[]>([]);
  const [runs, setRuns] = useState<RecurringExpenseRun[]>([]);
  const [payments, setPayments] = useState<LevyPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<{ scope: 'business' | 'private_levy'; expense?: RecurringExpense } | null>(null);
  const [levyDialog, setLevyDialog] = useState<LevyPayment | null | undefined>(undefined);
  const [runPaidDates, setRunPaidDates] = useState<Record<string, string>>({});
  const [paidLevyDialog, setPaidLevyDialog] = useState<LevyPayment | null>(null);
  const [paidLevyOn, setPaidLevyOn] = useState(today());
  const requestVersion = useRef(0);
  const activeWorkspace = useRef(workspaceId);
  activeWorkspace.current = workspaceId;
  const year = new Date().getFullYear();
  const locale = company?.locale || 'de-DE';
  const currency = company?.currency || 'EUR';
  const money = (value: number) => formatCurrency(value, locale, company?.numberFormat, currency);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!workspaceId) { setExpenses([]); setRuns([]); setPayments([]); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [nextExpenses, nextRuns, nextPayments] = await Promise.all([
        financeApi.getExpenses(), financeApi.getRuns(),
        privateAllowed ? financeApi.getLevies(year) : Promise.resolve([]),
      ]);
      if (requestVersion.current !== version || activeWorkspace.current !== workspaceId) return;
      setExpenses(nextExpenses);
      setRuns(nextRuns);
      setPayments(nextPayments);
    } catch (e) {
      if (requestVersion.current === version && activeWorkspace.current === workspaceId) setError(e instanceof Error ? e.message : 'Fixkosten konnten nicht geladen werden.');
    } finally { if (requestVersion.current === version && activeWorkspace.current === workspaceId) setLoading(false); }
  }, [workspaceId, year, privateAllowed]);

  useLayoutEffect(() => {
    setExpenses([]); setRuns([]); setPayments([]); setLoading(true); setBusy(''); setError(''); setNotice('');
    setDialog(null); setLevyDialog(undefined); setPaidLevyDialog(null); setRunPaidDates({}); setPaidLevyOn(today());
    setTab('business'); void load(); return () => { requestVersion.current += 1; };
  }, [load]);
  useEffect(() => { if (!privateAllowed && tab === 'private') setTab('business'); }, [privateAllowed, tab]);
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener('solooffice-finance-changed', refresh);
    return () => window.removeEventListener('solooffice-finance-changed', refresh);
  }, [load]);

  const tabExpenses = useMemo(() => expenses.filter(expense => tab === 'business' ? expense.scope === 'business' : expense.scope === 'private_levy'), [expenses, tab]);
  const privateExpenseIds = useMemo(() => new Set(expenses.filter(item => item.scope === 'private_levy').map(item => item.id)), [expenses]);
  const privateRuns = useMemo(() => runs.filter(run => run.scope === 'private_levy' || (!run.scope && privateExpenseIds.has(run.expenseId))), [runs, privateExpenseIds]);
  const activeBusinessExpenses = expenses.filter(expense => expense.scope === 'business' && currentExpenseStatus(expense) !== 'ended' && expense.startDate <= today() && !(currentExpenseStatus(expense) === 'paused' && !expense.pauses.length) && !(expense.endDate && expense.endDate <= today()) && !isExpensePaused(expense));
  const monthlyTotal = activeBusinessExpenses.reduce((sum, expense) => sum + monthlyEquivalent({ ...expense, amountGross: currentExpenseAmount(expense) }), 0);
  const annualTotal = activeBusinessExpenses.reduce((sum, expense) => sum + annualEquivalent({ ...expense, amountGross: currentExpenseAmount(expense) }), 0);
  const saveExpense = async (payload: RecurringExpensePayload, id?: string) => {
    if (payload.scope === 'business' && !businessWritable || payload.scope === 'private_levy' && !privateAllowed) throw new Error('Für diese Änderung fehlt die erforderliche Berechtigung.');
    const targetWorkspace = workspaceId;
    await financeApi.saveExpense(payload, id);
    if (activeWorkspace.current !== targetWorkspace) return;
    setNotice(id ? 'Fixkosten wurden aktualisiert.' : 'Fixkosten wurden gespeichert.'); await load();
  };
  const saveLevy = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (levyDialog === undefined || !privateAllowed) return;
    const form = new FormData(event.currentTarget);
    const amount = parseLocalizedNumber(String(form.get('amount') || ''), locale, company?.numberFormat);
    if (!Number.isFinite(amount) || amount < 0) { setError('Bitte einen gültigen Betrag eintragen.'); return; }
    const payload: LevyPaymentPayload = { kind: String(form.get('kind')) as LevyKind, year: Number(form.get('year')), period: String(form.get('period') || ''), dueDate: String(form.get('dueDate')), paidOn: String(form.get('paidOn') || '') || null, amount, source: String(form.get('source')) as LevyPayment['source'], notes: String(form.get('notes') || '') };
    const targetWorkspace = workspaceId; setBusy('levy'); setError('');
    try { await financeApi.saveLevy(payload, levyDialog?.id); if (activeWorkspace.current !== targetWorkspace) return; setLevyDialog(undefined); await load(); setNotice('Private Abgabe wurde gespeichert.'); }
    catch (e) { if (activeWorkspace.current === targetWorkspace) setError(e instanceof Error ? e.message : 'Private Abgabe konnte nicht gespeichert werden.'); }
    finally { if (activeWorkspace.current === targetWorkspace) setBusy(''); }
  };
  const generate = async () => {
    if (tab === 'business' && !businessWritable) return;
    const targetWorkspace = workspaceId; setBusy('generate'); setError('');
    try { const generated = await financeApi.generateRuns(today()); if (activeWorkspace.current !== targetWorkspace) return; await load(); const confirmed = generated.filter(run => run.status === 'confirmed').length; setNotice(confirmed ? `${confirmed} Fälligkeit(en) wurden gemäß dem gespeicherten Opt-in automatisch gebucht; weitere Fälligkeiten sind geplant.` : 'Fälligkeiten bis heute wurden aktualisiert. Es wurden nur Pläne erstellt.'); }
    catch (e) { if (activeWorkspace.current === targetWorkspace) setError(e instanceof Error ? e.message : 'Fälligkeiten konnten nicht erzeugt werden.'); }
    finally { if (activeWorkspace.current === targetWorkspace) setBusy(''); }
  };
  const confirmRunDirect = async (run: RecurringExpenseRun) => {
    if (run.scope !== 'private_levy' && !privateExpenseIds.has(run.expenseId) && !businessWritable) return;
    if ((run.scope === 'private_levy' || privateExpenseIds.has(run.expenseId)) && !privateAllowed) return;
    const paymentDate = runPaidDates[run.id] || today();
    if (paymentDate > today()) { setError('Das Zahlungsdatum darf nicht in der Zukunft liegen.'); return; }
    const targetWorkspace = workspaceId; setBusy(run.id); setError('');
    try {
      await financeApi.confirmRun(run.id, paymentDate);
      if (activeWorkspace.current !== targetWorkspace) return;
      await load(); setNotice(run.scope === 'private_levy' || privateExpenseIds.has(run.expenseId) ? 'Private Zahlung wurde erfasst.' : 'Fälligkeit wurde als bezahlt markiert.');
    } catch (e) { if (activeWorkspace.current === targetWorkspace) setError(e instanceof Error ? e.message : 'Fälligkeit konnte nicht bestätigt werden.'); }
    finally { if (activeWorkspace.current === targetWorkspace) setBusy(''); }
  };
  const skipRun = async (run: RecurringExpenseRun) => {
    if ((run.scope !== 'private_levy' && !privateExpenseIds.has(run.expenseId)) && !businessWritable) return;
    if ((run.scope === 'private_levy' || privateExpenseIds.has(run.expenseId)) && !privateAllowed) return;
    setBusy(run.id); setError('');
    const targetWorkspace = workspaceId;
    try { await financeApi.skipRun(run.id); if (activeWorkspace.current !== targetWorkspace) return; await load(); setNotice('Fälligkeit wurde übersprungen.'); }
    catch (e) { if (activeWorkspace.current === targetWorkspace) setError(e instanceof Error ? e.message : 'Fälligkeit konnte nicht übersprungen werden.'); }
    finally { if (activeWorkspace.current === targetWorkspace) setBusy(''); }
  };
  const updateLifecycle = async (expense: RecurringExpense, action: 'pause' | 'resume' | 'end') => {
    if (expense.scope === 'business' ? !businessWritable : !privateAllowed) return;
    const targetWorkspace = workspaceId;
    const accepted = await confirm({ title: action === 'end' ? 'Fixkosten beenden' : action === 'pause' ? 'Fixkosten pausieren' : 'Fixkosten fortsetzen', message: action === 'end' ? `„${expense.name}“ zum heutigen Tag beenden? Bereits erfasste Fälligkeiten bleiben erhalten.` : action === 'pause' ? `„${expense.name}“ auf unbestimmte Zeit pausieren?` : `„${expense.name}“ fortsetzen?`, confirmText: action === 'end' ? 'Beenden' : action === 'pause' ? 'Pausieren' : 'Fortsetzen', isDestructive: action === 'end' });
    if (!accepted || activeWorkspace.current !== targetWorkspace) return;
    const payload: RecurringExpensePayload = action === 'end'
      ? { ...expense, endDate: expense.startDate > today() ? expense.startDate : today(), cancelledOn: expense.cancelledOn || today(), status: 'ended' }
      : action === 'pause'
        ? { ...expense, status: 'paused', pauses: [...expense.pauses, { from: today(), until: null }] }
        : { ...expense, status: 'active', pauses: expense.pauses.map(pause => pause.until === null ? { ...pause, until: new Date(Date.parse(`${today()}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) } : pause).filter(pause => !pause.until || pause.until >= pause.from) };
    setBusy(expense.id); setError('');
    try { await financeApi.saveExpense(payload, expense.id); if (activeWorkspace.current !== targetWorkspace) return; await load(); setNotice(action === 'end' ? 'Fixkosten wurden beendet.' : action === 'pause' ? 'Fixkosten wurden pausiert.' : 'Fixkosten wurden fortgesetzt.'); }
    catch (e) { if (activeWorkspace.current === targetWorkspace) setError(e instanceof Error ? e.message : 'Änderung konnte nicht gespeichert werden.'); }
    finally { if (activeWorkspace.current === targetWorkspace) setBusy(''); }
  };
  const deleteExpense = async (expense: RecurringExpense) => {
    if (expense.scope === 'business' ? !businessWritable : !privateAllowed) return;
    const targetWorkspace = workspaceId;
    const accepted = await confirm({ title: 'Vorlage löschen', message: `„${expense.name}“ und noch nicht gebuchte Fälligkeiten wirklich löschen? Bereits erfasste Zahlungen und EÜR-Buchungen bleiben bestehen.`, confirmText: 'Löschen', isDestructive: true });
    if (!accepted || activeWorkspace.current !== targetWorkspace) return;
    setBusy(expense.id); setError('');
    try { await financeApi.deleteExpense(expense.id); if (activeWorkspace.current !== targetWorkspace) return; await load(); setNotice('Vorlage wurde gelöscht.'); }
    catch (e) { if (activeWorkspace.current === targetWorkspace) setError(e instanceof Error ? e.message : 'Vorlage konnte nicht gelöscht werden.'); }
    finally { if (activeWorkspace.current === targetWorkspace) setBusy(''); }
  };
  const deleteLevy = async (payment: LevyPayment) => {
    if (!privateAllowed || payment.source === 'recurring_expense') return;
    const targetWorkspace = workspaceId;
    const accepted = await confirm({ title: 'Private Abgabe löschen', message: `„${kinds.find(([kind]) => kind === payment.kind)?.[1] || payment.kind}“ wirklich löschen?`, confirmText: 'Löschen', isDestructive: true });
    if (!accepted || activeWorkspace.current !== targetWorkspace) return;
    try { await financeApi.deleteLevy(payment.id); if (activeWorkspace.current !== targetWorkspace) return; await load(); } catch (e) { if (activeWorkspace.current === targetWorkspace) setError(e instanceof Error ? e.message : 'Abgabe konnte nicht gelöscht werden.'); }
  };
  const setPaidLevy = async () => {
    if (!paidLevyDialog || !privateAllowed || paidLevyDialog.source === 'recurring_expense' || paidLevyOn > today()) return;
    const targetWorkspace = workspaceId;
    setBusy(paidLevyDialog.id);
    try { await financeApi.saveLevy({ ...paidLevyDialog, paidOn: paidLevyOn }, paidLevyDialog.id); if (activeWorkspace.current !== targetWorkspace) return; setPaidLevyDialog(null); await load(); setNotice('Zahlungsstatus wurde aktualisiert.'); }
    catch (e) { if (activeWorkspace.current === targetWorkspace) setError(e instanceof Error ? e.message : 'Zahlungsstatus konnte nicht gespeichert werden.'); }
    finally { if (activeWorkspace.current === targetWorkspace) setBusy(''); }
  };
  const prefillFromProfile = async () => {
    if (!privateAllowed) return;
    const targetWorkspace = workspaceId;
    setBusy('profile'); setError('');
    try {
      const profile = await financeApi.getProfile(year);
      if (activeWorkspace.current !== targetWorkspace) return;
      const { params } = resolveTaxParams(year);
      const dayAtOrAfter = (dates: number[][], from: string) => {
        for (let dateYear = Number(from.slice(0, 4)); dateYear <= Number(from.slice(0, 4)) + 1; dateYear += 1) {
          const next = dates.map(([month, day]) => `${dateYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`).find(value => value >= from);
          if (next) return next;
        }
        return from;
      };
      const makeTemplate = (name: string, kind: LevyKind, amount: number, startDate: string, interval: 'monthly' | 'quarterly' = 'monthly', note = 'Betrag laut Steuerprofil bzw. Bescheid.') => ({
        name, counterparty: '', category: kind, amountGross: amount, taxRate: null, interval, intervalCount: interval === 'quarterly' ? 3 : 1, intervalUnit: 'months' as const,
        startDate, endDate: null, noticePeriodDays: 0, cancelledOn: null, status: 'active' as const, pauses: [], priceChanges: [], automaticBooking: false,
        scope: 'private_levy' as const, levyKind: kind, linkedReceiptId: null, notes: note,
      });
      const proposed = [
        ...(Number(profile.incomeTaxAdvanceQuarterly) > 0 ? [makeTemplate('Einkommensteuer-Vorauszahlung', 'est_vz', Number(profile.incomeTaxAdvanceQuarterly), dayAtOrAfter(params.advancePayments.incomeTaxDates, today()), 'quarterly')] : []),
        ...(Number(profile.tradeTaxAdvanceQuarterly) > 0 ? [makeTemplate('Gewerbesteuer-Vorauszahlung', 'gewst_vz', Number(profile.tradeTaxAdvanceQuarterly), dayAtOrAfter(params.advancePayments.tradeTaxDates, today()), 'quarterly')] : []),
      ];
      const noticeValues: Array<[LevyKind, string, number]> = [
        ['kv', 'Krankenversicherung laut Bescheid', Number(profile.healthNoticeMonthly)], ['pv', 'Pflegeversicherung laut Bescheid', Number(profile.careNoticeMonthly)],
        ['rv', 'Rentenversicherung laut Bescheid', Number(profile.pensionNoticeMonthly)],
      ];
      for (const [kind, name, amount] of noticeValues) if (amount > 0) proposed.push(makeTemplate(name, kind, amount, today()));
      if (profile.healthInsurance === 'pkv') {
        if (Number(profile.privateHealthMonthly) > 0) proposed.push(makeTemplate('Private Krankenversicherung laut Profil', 'kv', Number(profile.privateHealthMonthly), today()));
        if (Number(profile.privateCareMonthly) > 0) proposed.push(makeTemplate('Private Pflegeversicherung laut Profil', 'pv', Number(profile.privateCareMonthly), today()));
      }
      if (!Number(profile.pensionNoticeMonthly) && profile.pensionStatus !== 'ksk' && ['standard', 'half'].includes(profile.pensionMode)) {
        const pensionAmount = profile.pensionMode === 'standard' ? params.social.pensionStandardMonthly : params.social.pensionHalfMonthly;
        if (pensionAmount > 0) proposed.push(makeTemplate(`Rentenversicherung – ${profile.pensionMode === 'standard' ? 'Regelbeitrag' : 'halber Regelbeitrag'} laut Profil`, 'rv', pensionAmount, today(), 'monthly', 'Profilangabe, Richtwert aus den zentralen Parametern; mit Bescheid abgleichen.'));
      }
      if (profile.unemploymentEnabled) {
        const monthly = profile.startedOn && year - Number(profile.startedOn.slice(0, 4)) < params.social.unemploymentFounderYears ? params.social.unemploymentFounderMonthly : params.social.unemploymentMonthly;
        proposed.push(makeTemplate('Arbeitslosenversicherung laut Profil', 'av', monthly, today(), 'monthly', 'Profilangabe; Beitrag laut Bewilligung prüfen.'));
      }
      if (profile.healthInsurance === 'gkv_ksk' || profile.pensionStatus === 'ksk') {
        const estimate = calculateSocial(0, profile, params);
        for (const [kind, name, amount] of [['kv', 'KSK – Krankenversicherung (Schätzung)', estimate.health], ['pv', 'KSK – Pflegeversicherung (Schätzung)', estimate.care], ['rv', 'KSK – Rentenversicherung (Schätzung)', estimate.pension]] as Array<[LevyKind, string, number]>) {
          if (amount > 0) proposed.push(makeTemplate(name, kind, amount / 12, today(), 'monthly', 'Schätzung anhand des gemeldeten KSK-Jahreseinkommens; Beitragsbescheid ist maßgeblich.'));
        }
      }
      const templates = proposed.filter(template => !expenses.some(expense => expense.scope === 'private_levy' && expense.name === template.name));
      if (!templates.length) { setError(proposed.length ? 'Die passenden Profilvorlagen sind bereits vorhanden.' : 'Im Steuerprofil fehlen geeignete Beitrags- oder Vorauszahlungsbeträge.'); return; }
      const summary = templates.map(template => `${template.name}: ${money(template.amountGross)} ${template.interval === 'quarterly' ? 'vierteljährlich' : 'monatlich'} ab ${formatDate(template.startDate, locale)}`).join('\n');
      const accepted = await confirm({ title: 'Vorlagen aus dem Steuerprofil prüfen', message: `${summary}\n\nDiese privaten Vorlagen werden erst nach Ihrer Bestätigung erstellt. Es entstehen keine Zahlungen oder EÜR-Buchungen.`, confirmText: 'Vorlagen erstellen' });
      if (!accepted) return;
      if (activeWorkspace.current !== targetWorkspace) return;
      for (const template of templates) { await financeApi.saveExpense(template); if (activeWorkspace.current !== targetWorkspace) return; }
      await load(); setNotice('Vorlagen wurden erstellt. Termine und Zahlungen können Sie anschließend prüfen.');
    } catch (e) { if (activeWorkspace.current === targetWorkspace) setError(e instanceof Error ? e.message : 'Steuerprofil konnte nicht verwendet werden.'); }
    finally { if (activeWorkspace.current === targetWorkspace) setBusy(''); }
  };

  return <div className="page-root space-y-5">
    <PageHeader icon={CalendarClock} title="Fixkosten" subtitle="Wiederkehrende betriebliche Ausgaben und private Abgaben planen.">{(tab === 'business' && businessWritable || tab === 'private' && privateAllowed) && <button type="button" onClick={() => setDialog({ scope: tab === 'business' ? 'business' : 'private_levy' })} className="btn-primary inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white"><Plus className="h-4 w-4" /><span>Neu</span></button>}</PageHeader>
    <ThemeTabBar ariaLabel="Fixkostenbereiche" activeTab={tab} onChange={setTab} tabs={[{ id: 'business', label: 'Betrieblich', count: expenses.filter(item => item.scope === 'business').length }, ...(privateAllowed ? [{ id: 'private' as const, label: 'Private Abgaben · Vorlagen', count: expenses.filter(item => item.scope === 'private_levy').length }] : [])]} />
    {error && <div role="alert" className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}<button type="button" onClick={() => setError('')} aria-label="Fehler schließen"><X className="h-4 w-4" /></button></div>}
    {notice && <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</div>}
    {tab === 'business' ? <>
      <section className="grid gap-3 sm:grid-cols-2"><article className="rounded-xl border border-gray-200 bg-white p-4"><p className="text-sm text-gray-500">Fixkosten pro Monat</p><p className="mt-1 text-xl font-semibold text-gray-900">{money(monthlyTotal)}</p></article><article className="rounded-xl border border-gray-200 bg-white p-4"><p className="text-sm text-gray-500">Fixkosten pro Jahr</p><p className="mt-1 text-xl font-semibold text-gray-900">{money(annualTotal)}</p><p className="mt-1 text-xs text-gray-500">Richtwert; Wochenintervalle werden mit 52 Wochen pro Jahr angenähert.</p></article></section>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4"><div><h2 className="font-semibold text-gray-900">Fälligkeiten</h2><p className="mt-1 text-sm text-gray-500">Fälligkeiten werden beim Öffnen der EÜR sowie auf Ihre Aktion hin aktualisiert. Eine EÜR-Buchung entsteht erst nach Bestätigung als bezahlt.</p></div>{businessWritable ? <button type="button" disabled={Boolean(busy)} onClick={() => void generate()} className="rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 min-h-10 px-4 text-sm">{busy === 'generate' ? 'Wird aktualisiert …' : 'Fälligkeiten aktualisieren'}</button> : <p className="text-sm text-gray-500">Zum Planen und Buchen ist Schreibrecht für Daten erforderlich.</p>}</section>
      {loading ? <TableSkeleton rows={4} columns={5} label="Fixkosten werden geladen …" /> : tabExpenses.length === 0 ? <section className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center"><p className="text-sm text-gray-600">Noch keine betrieblichen Fixkosten erfasst.</p><button type="button" disabled={!businessWritable} onClick={() => setDialog({ scope: 'business' })} className="btn-primary mt-4 min-h-10 rounded-lg px-4 text-sm text-white">Fixkosten erfassen</button></section> : <section className="overflow-hidden rounded-xl border border-gray-200 bg-white"><div className="hidden overflow-x-auto tablet:block"><table className="w-full min-w-[850px]"><thead className="bg-gray-50"><tr>{['Bezeichnung', 'Intervall', 'Monatswert', 'Jahreswert', 'Nächste Fälligkeit', 'Aktionen'].map(label => <th key={label} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{tabExpenses.map(expense => <tr key={expense.id}><td className="px-4 py-4"><p className="font-medium text-gray-900">{expense.name}</p><p className="mt-1 text-xs text-gray-500">{expense.counterparty || 'Kein Anbieter angegeben'} · {currentExpenseStatus(expense) === 'ended' ? 'Beendet' : currentExpenseStatus(expense) === 'paused' ? 'Pausiert' : 'Aktiv'}</p>{expense.noticePeriodDays > 0 && <p className="text-xs text-gray-500">Kündigungsfrist: {expense.noticePeriodDays} Tage</p>}{expense.cancelledOn && <p className="text-xs text-gray-500">Kündigung eingereicht am {formatDate(expense.cancelledOn, locale)}</p>}{expense.endDate && <p className="text-xs text-gray-500">Ende: {formatDate(expense.endDate, locale)} · Ab diesem Datum keine Fälligkeiten</p>}{expense.priceChanges.length > 0 && <p className="text-xs text-gray-500">Preisgeschichte: {expense.priceChanges.map(change => `${formatDate(change.validFrom, locale)} ${money(change.amountGross)}`).join(' · ')}</p>}</td><td className="px-4 py-4 text-sm text-gray-700">{recurrenceLabels[expense.interval]}{expense.interval === 'custom' ? ` · alle ${expense.intervalCount} ${expense.intervalUnit === 'weeks' ? 'Wochen' : 'Monate'}` : ''}</td><td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">{money(monthlyEquivalent({ ...expense, amountGross: currentExpenseAmount(expense) }))}</td><td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">{money(annualEquivalent({ ...expense, amountGross: currentExpenseAmount(expense) }))}</td><td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">{nextDueLabel(nextRecurringExpenseDueDate(expense, runs), locale)}</td><td className="px-4 py-4"><div className="flex items-center gap-2"><button type="button" className="rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 min-h-9 rounded-lg px-3 text-xs" disabled={!businessWritable || Boolean(busy)} onClick={() => setDialog({ scope: 'business', expense })}>Bearbeiten</button><ActionMenu ariaLabel={`Aktionen für ${expense.name}`} disabled={Boolean(busy) || !businessWritable} triggerClassName="action-menu-export-trigger h-9 w-9 p-0">{currentExpenseStatus(expense) !== 'ended' && <ActionMenuItem icon={currentExpenseStatus(expense) === 'paused' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />} onClick={() => void updateLifecycle(expense, currentExpenseStatus(expense) === 'paused' ? 'resume' : 'pause')}>{currentExpenseStatus(expense) === 'paused' ? 'Fortsetzen' : 'Pausieren'}</ActionMenuItem>}{currentExpenseStatus(expense) !== 'ended' && <ActionMenuItem icon={<MoreHorizontal className="h-4 w-4" />} onClick={() => void updateLifecycle(expense, 'end')}>Beenden</ActionMenuItem>}<ActionMenuItem icon={<Trash2 className="h-4 w-4" />} tone="red" onClick={() => void deleteExpense(expense)}>Löschen</ActionMenuItem></ActionMenu></div></td></tr>)}</tbody></table></div><div className="divide-y divide-gray-100 tablet:hidden">{tabExpenses.map(expense => <article key={expense.id} className="space-y-2 p-4"><div className="flex justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-medium text-gray-900">{expense.name}</h3><p className="text-xs text-gray-500">{recurrenceLabels[expense.interval]} · {currentExpenseStatus(expense) === 'active' ? 'Aktiv' : currentExpenseStatus(expense) === 'paused' ? 'Pausiert' : 'Beendet'}{expense.cancelledOn ? ` · Kündigung eingereicht ${formatDate(expense.cancelledOn, locale)}` : ''}{expense.endDate ? ` · Ende ${formatDate(expense.endDate, locale)}` : ''}</p>{expense.priceChanges.length > 0 && <p className="mt-1 text-xs text-gray-500">Preisgeschichte: {expense.priceChanges.map(change => `${formatDate(change.validFrom, locale)} ${money(change.amountGross)}`).join(' · ')}</p>}</div><div className="shrink-0 text-right text-sm font-semibold text-gray-900">{money(monthlyEquivalent({ ...expense, amountGross: currentExpenseAmount(expense) }))}<p className="text-xs font-normal text-gray-500">pro Monat</p></div></div><p className="text-xs text-gray-500">{money(annualEquivalent({ ...expense, amountGross: currentExpenseAmount(expense) }))} im Jahr · Nächste Fälligkeit: {nextDueLabel(nextRecurringExpenseDueDate(expense, runs), locale)}</p><div className="flex items-center gap-2"><button type="button" className="rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 min-h-9 rounded-lg px-3 text-xs" disabled={!businessWritable || Boolean(busy)} onClick={() => setDialog({ scope: 'business', expense })}>Bearbeiten</button><ActionMenu ariaLabel={`Aktionen für ${expense.name}`} disabled={Boolean(busy) || !businessWritable} triggerClassName="action-menu-export-trigger h-9 w-9 p-0">{currentExpenseStatus(expense) !== 'ended' && <ActionMenuItem icon={currentExpenseStatus(expense) === 'paused' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />} onClick={() => void updateLifecycle(expense, currentExpenseStatus(expense) === 'paused' ? 'resume' : 'pause')}>{currentExpenseStatus(expense) === 'paused' ? 'Fortsetzen' : 'Pausieren'}</ActionMenuItem>}{currentExpenseStatus(expense) !== 'ended' && <ActionMenuItem icon={<MoreHorizontal className="h-4 w-4" />} onClick={() => void updateLifecycle(expense, 'end')}>Beenden</ActionMenuItem>}<ActionMenuItem icon={<Trash2 className="h-4 w-4" />} tone="red" onClick={() => void deleteExpense(expense)}>Löschen</ActionMenuItem></ActionMenu></div></article>)}</div></section>}
      <section className="rounded-xl border border-gray-200 bg-white"><div className="border-b border-gray-100 p-4"><h2 className="font-semibold text-gray-900">Geplante und erledigte Fälligkeiten</h2><p className="mt-1 text-sm text-gray-500">Jeder Lauf behält den zum Fälligkeitstag gültigen Betrag.</p></div>{runs.filter(run => run.scope !== 'private_levy').length ? <div className="divide-y divide-gray-100">{runs.filter(run => run.scope !== 'private_levy').sort((a,b) => a.dueDate.localeCompare(b.dueDate)).map(run => <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium text-gray-900">{run.name || expenses.find(item => item.id === run.expenseId)?.name || 'Fixkosten'}</p><p className="mt-1 text-sm text-gray-500">Fällig {formatDate(run.dueDate, locale)} · {money(run.amountGross)} · {runStatusLabel(run)}{run.paidOn ? ` am ${formatDate(run.paidOn, locale)}` : ''}</p></div>{run.status === 'planned' && <div className="flex flex-wrap items-center gap-2"><label className="text-xs text-gray-600">Zahlungsdatum<input type="date" max={today()} value={runPaidDates[run.id] || today()} onChange={event => setRunPaidDates(current => ({ ...current, [run.id]: event.target.value }))} className="form-input form-input-compact ml-2 min-h-9 text-xs" /></label><button type="button" disabled={Boolean(busy)} onClick={() => void confirmRunDirect(run)} className="btn-primary min-h-10 px-3 text-sm text-white"><Check className="mr-1 inline h-4 w-4" />Bezahlt am {formatDate(runPaidDates[run.id] || today(), locale)}</button><button type="button" disabled={Boolean(busy)} onClick={() => void skipRun(run)} className="rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 min-h-10 px-3 text-sm"><SkipForward className="mr-1 inline h-4 w-4" />Überspringen</button></div>}</div>)}</div> : <p className="p-5 text-sm text-gray-500">Noch keine Fälligkeiten geplant. Planen Sie sie bis heute, um überfällige und aktuelle Termine zu erzeugen.</p>}</section>
    </> : privateAllowed && <>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4"><div><h2 className="font-semibold text-gray-900">Private Zahlungen und Vorauszahlungen</h2><p className="mt-1 text-sm text-gray-500">Diese Erfassung bleibt außerhalb der EÜR. Beträge sind Angaben aus Ihren Bescheiden oder manuelle Einträge.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void prefillFromProfile()} disabled={Boolean(busy)} className="rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 min-h-10 px-3 text-sm">{busy === 'profile' ? 'Wird geladen …' : 'Vorlagen aus Steuerprofil erstellen'}</button><button type="button" onClick={() => void generate()} disabled={Boolean(busy)} className="rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 min-h-10 px-3 text-sm">{busy === 'generate' ? 'Wird geplant …' : 'Fälligkeiten bis heute planen'}</button><button type="button" disabled={Boolean(busy)} onClick={() => setLevyDialog(null)} className="btn-primary min-h-10 px-3 text-sm text-white"><Plus className="mr-1 inline h-4 w-4" />Abgabe erfassen</button></div></section>
      {tabExpenses.map(expense => <article key={expense.id} className="rounded-xl border border-gray-200 bg-white p-4"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold text-gray-900">{expense.name}</h3><p className="mt-1 text-sm text-gray-500">{currentExpenseStatus(expense) === 'ended' ? 'Beendet' : currentExpenseStatus(expense) === 'paused' ? 'Pausiert' : 'Aktiv'} · {nextDueLabel(nextRecurringExpenseDueDate(expense, runs), locale)} · Kündigungsfrist {expense.noticePeriodDays} Tage</p></div><div className="text-sm font-medium text-gray-700">{money(monthlyEquivalent({ ...expense, amountGross: currentExpenseAmount(expense) }))} / Monat · {money(annualEquivalent({ ...expense, amountGross: currentExpenseAmount(expense) }))} / Jahr</div></div><div className="mt-3 flex items-center gap-2"><button type="button" className="rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 min-h-9 rounded-lg px-3 text-xs" disabled={!privateAllowed || Boolean(busy)} onClick={() => setDialog({ scope: 'private_levy', expense })}>Bearbeiten</button><ActionMenu ariaLabel={`Aktionen für ${expense.name}`} disabled={Boolean(busy) || !privateAllowed} triggerClassName="action-menu-export-trigger h-9 w-9 p-0">{currentExpenseStatus(expense) !== 'ended' && <ActionMenuItem icon={currentExpenseStatus(expense) === 'paused' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />} onClick={() => void updateLifecycle(expense, currentExpenseStatus(expense) === 'paused' ? 'resume' : 'pause')}>{currentExpenseStatus(expense) === 'paused' ? 'Fortsetzen' : 'Pausieren'}</ActionMenuItem>}{currentExpenseStatus(expense) !== 'ended' && <ActionMenuItem icon={<MoreHorizontal className="h-4 w-4" />} onClick={() => void updateLifecycle(expense, 'end')}>Beenden</ActionMenuItem>}<ActionMenuItem icon={<Trash2 className="h-4 w-4" />} tone="red" onClick={() => void deleteExpense(expense)}>Löschen</ActionMenuItem></ActionMenu></div></article>)}
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white"><div className="border-b border-gray-100 p-4"><h2 className="font-semibold text-gray-900">Private Fälligkeiten</h2><p className="mt-1 text-sm text-gray-500">Bestätigte Zahlungen werden als private Abgabe erfasst und bleiben außerhalb der EÜR.</p></div>{privateRuns.length ? <div className="divide-y divide-gray-100">{privateRuns.map(run => <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium text-gray-900">{run.name || tabExpenses.find(item => item.id === run.expenseId)?.name || 'Private Abgabe'}</p><p className="mt-1 text-sm text-gray-500">Fällig {formatDate(run.dueDate, locale)} · {money(run.amountGross)} · {runStatusLabel(run)}{run.paidOn ? ` am ${formatDate(run.paidOn, locale)}` : ''}</p></div>{run.status === 'planned' && <div className="flex flex-wrap items-center gap-2"><label className="text-xs text-gray-600">Zahlungsdatum<input type="date" max={today()} value={runPaidDates[run.id] || today()} onChange={event => setRunPaidDates(current => ({ ...current, [run.id]: event.target.value }))} className="form-input form-input-compact ml-2 min-h-9 text-xs" /></label><button type="button" disabled={Boolean(busy)} onClick={() => void confirmRunDirect(run)} className="btn-primary min-h-10 px-3 text-sm text-white">Bezahlt am {formatDate(runPaidDates[run.id] || today(), locale)}</button><button type="button" disabled={Boolean(busy)} onClick={() => void skipRun(run)} className="rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 min-h-10 px-3 text-sm">Überspringen</button></div>}</div>)}</div> : <p className="p-5 text-sm text-gray-500">Für dieses Jahr sind noch keine privaten Fälligkeiten geplant.</p>}</section>
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white"><div className="border-b border-gray-100 p-4"><h2 className="font-semibold text-gray-900">Private Abgaben {year}</h2></div>{payments.length ? <div className="divide-y divide-gray-100">{payments.map(payment => <article key={payment.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium text-gray-900">{kinds.find(([kind]) => kind === payment.kind)?.[1] || payment.kind}</p><p className="mt-1 text-sm text-gray-500">{payment.period || payment.year} · fällig {formatDate(payment.dueDate, locale)} · {money(payment.amount)} · {payment.paidOn ? `Bezahlt am ${formatDate(payment.paidOn, locale)}` : 'Offen'} · {payment.source === 'notice' ? 'Bescheid' : payment.source === 'recurring_expense' ? 'Fixkostenlauf' : 'Manuell'}</p></div><div className="flex gap-2">{!payment.paidOn && payment.source !== 'recurring_expense' && <button type="button" className="rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 min-h-9 px-3 text-xs" disabled={Boolean(busy)} onClick={() => { setPaidLevyDialog(payment); setPaidLevyOn(today()); }}>Als bezahlt markieren</button>}{payment.source !== 'recurring_expense' && <><button type="button" className="rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 min-h-9 px-3 text-xs" disabled={Boolean(busy)} onClick={() => setLevyDialog(payment)}>Bearbeiten</button><button type="button" className="rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 min-h-9 px-3 text-xs" disabled={Boolean(busy)} onClick={() => void deleteLevy(payment)}>Löschen</button></>}</div></article>)}</div> : <p className="p-5 text-sm text-gray-500">Für dieses Jahr sind noch keine privaten Abgaben erfasst.</p>}</section>
    </>}
    {dialog && <RecurringExpenseDialog expense={dialog.expense} scope={dialog.scope} onClose={() => setDialog(null)} onSave={saveExpense} />}
    {levyDialog !== undefined && <DialogShell titleId="levy-payment-dialog" icon={ReceiptText} title={levyDialog ? 'Private Abgabe bearbeiten' : 'Private Abgabe erfassen'} description="Private Abgaben werden nicht in die EÜR übernommen." onClose={() => setLevyDialog(undefined)} onSubmit={saveLevy} footer={<><button type="button" disabled={Boolean(busy)} onClick={() => setLevyDialog(undefined)} className="min-h-10 rounded-lg border border-gray-300 px-4 text-sm">Abbrechen</button><button type="submit" disabled={Boolean(busy)} className="btn-primary min-h-10 rounded-lg px-4 text-sm text-white">Speichern</button></>}><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-gray-700">Abgabenart<select name="kind" defaultValue={levyDialog?.kind || 'est_vz'} className={input}>{kinds.map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label><label className="text-sm font-medium text-gray-700">Jahr<input name="year" type="number" defaultValue={levyDialog?.year || year} className={input} /></label><label className="text-sm font-medium text-gray-700">Zeitraum<input name="period" placeholder={`${year}-01`} defaultValue={levyDialog?.period || `${year}-01`} className={input} /></label><label className="text-sm font-medium text-gray-700">Fällig am<input name="dueDate" type="date" required defaultValue={levyDialog?.dueDate || today()} className={input} /></label><label className="text-sm font-medium text-gray-700">Betrag<input name="amount" inputMode="decimal" required defaultValue={levyDialog?.amount ?? ''} className={input} /></label><label className="text-sm font-medium text-gray-700">Zahlungsstatus<input name="paidOn" type="date" defaultValue={levyDialog?.paidOn || ''} max={today()} className={input} /></label><label className="text-sm font-medium text-gray-700">Quelle<select name="source" defaultValue={levyDialog?.source === 'recurring_expense' ? 'manual' : levyDialog?.source || 'manual'} className={input}><option value="notice">Bescheid</option><option value="manual">Manuell</option></select></label><label className="text-sm font-medium text-gray-700 sm:col-span-2">Notiz<textarea name="notes" defaultValue={levyDialog?.notes || ''} className={`${input} min-h-20`} /></label></div></DialogShell>}
    {paidLevyDialog && <DialogShell titleId="confirm-levy-title" icon={Check} title="Private Zahlung bestätigen" description="Die Zahlung bleibt außerhalb der EÜR." onClose={() => setPaidLevyDialog(null)} onSubmit={event => { event.preventDefault(); void setPaidLevy(); }} footer={<><button type="button" disabled={Boolean(busy)} onClick={() => setPaidLevyDialog(null)} className="min-h-10 rounded-lg border border-gray-300 px-4 text-sm">Abbrechen</button><button type="submit" disabled={Boolean(busy)} className="btn-primary min-h-10 rounded-lg px-4 text-sm text-white">Bestätigen</button></>}><label className="block text-sm font-medium text-gray-700">Bezahlt am<input type="date" value={paidLevyOn} max={today()} onChange={event => setPaidLevyOn(event.target.value)} className={input} /></label></DialogShell>}
  </div>;
}
