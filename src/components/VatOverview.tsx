import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ExternalLink, Plus } from 'lucide-react';
import type { VatOverview as VatOverviewData, VatPayment, VatPaymentPayload, VatPeriodResult } from '../types/vat';
import { financeApi } from '../services/financeApi';
import { useAuth } from '../context/AuthContext';
import { useExtensions } from '../hooks/useExtensions';
import { euerKennzahlRows, vatAmountLabel, vatDateLabel, vatKennzahlRows, vatPaymentKindLabel, vatPaymentStatusLabel, vatPeriodAmountLabel, vatPeriodKeyLabel, vatPeriodLabel, vatPeriodPaymentIds } from '../utils/vatDisplay';
import { defaultVatPeriod } from '../utils/vatCardDisplay';
import { PageHeader } from './PageHeader';
import { Notice } from './Notice';
import { TableSkeleton } from './TableSkeleton';
import { VatPaymentDialog } from './VatPaymentDialog';
import { ConfirmationModal } from './ConfirmationModal';

interface Props { onNavigate: (page: string, filter?: string) => void }

const thisYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 7 }, (_, index) => thisYear - 3 + index);
const statusTone = (period: VatPeriodResult) => period.overdue ? 'text-red-700 bg-red-50' : period.paymentStatus === 'paid' || period.paymentStatus === 'settled' ? 'text-green-800 bg-green-50' : period.paymentStatus === 'partial' ? 'text-amber-800 bg-amber-50' : 'text-gray-700 bg-gray-100';
const taxStatusLabel: Record<NonNullable<VatOverviewData['vatStatus']>, string> = { small_business: 'Kleinunternehmer (§ 19 UStG)', regular: 'Regelbesteuerung', education_exempt: 'Bildungsbefreiung' };

function StatusPill({ period }: { period: VatPeriodResult }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusTone(period)}`}>{vatPaymentStatusLabel(period.paymentStatus, period.overdue)}</span>;
}

export function VatOverview({ onNavigate }: Props) {
  const { workspace, can } = useAuth();
  const { isEnabled, loading: extensionsLoading } = useExtensions();
  const workspaceId = workspace?.id ?? null;
  const writable = can('data.write');
  const [year, setYear] = useState(thisYear);
  const [overview, setOverview] = useState<VatOverviewData | null>(null);
  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [paymentDialog, setPaymentDialog] = useState<{ payment?: VatPayment; period?: VatPeriodResult } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VatPayment | null>(null);
  const [busyPayment, setBusyPayment] = useState('');
  const [expandedWarnings, setExpandedWarnings] = useState(false);
  const requestVersion = useRef(0);
  const activeWorkspace = useRef(workspaceId);
  activeWorkspace.current = workspaceId;
  const enabled = isEnabled('taxes');

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!workspaceId || !enabled) { setOverview(null); setLoading(false); setError(''); return; }
    setLoading(true); setError('');
    try {
      const result = await financeApi.getVatOverview(year);
      if (requestVersion.current !== version || activeWorkspace.current !== workspaceId) return;
      setOverview(result);
      setSelectedKey(current => result.periods.some(period => period.key === current) ? current : defaultVatPeriod(result.periods, result.nextDue)?.key ?? '');
    } catch (loadError) {
      if (requestVersion.current === version && activeWorkspace.current === workspaceId) {
        const message = loadError instanceof Error ? loadError.message : 'Umsatzsteuer-Übersicht konnte nicht geladen werden.';
        setError(/403|Erweiterung|Berechtigung/i.test(message) ? 'Die Umsatzsteuer-Übersicht ist nicht verfügbar. Prüfe die Erweiterungen in den Einstellungen.' : message);
        setOverview(null);
      }
    } finally { if (requestVersion.current === version && activeWorkspace.current === workspaceId) setLoading(false); }
  }, [workspaceId, enabled, year]);

  useEffect(() => { void load(); return () => { requestVersion.current += 1; }; }, [load]);
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener('solooffice-finance-changed', refresh);
    return () => window.removeEventListener('solooffice-finance-changed', refresh);
  }, [load]);

  const period = overview?.periods.find(item => item.key === selectedKey) ?? overview?.periods[0] ?? null;
  const selectedPayments = useMemo(() => period && overview ? vatPeriodPaymentIds(period, overview.payments) : [], [period, overview]);
  const allPayments = overview?.payments.filter(payment => payment.taxYear === year || payment.periodKey?.startsWith(`${year}-`) || payment.periodKey === String(year)) ?? [];
  const periodOptions = overview?.periods.map(item => ({ key: item.key, label: item.label })) ?? [];
  const selectedRows = period && overview ? vatKennzahlRows(period.kennzahlen, year) : [];
  const euerRows = overview ? euerKennzahlRows(overview.euer, year) : [];

  const savePayment = async (payload: VatPaymentPayload, id?: string) => {
    const targetWorkspace = workspaceId;
    await financeApi.saveVatPayment(payload, id);
    if (activeWorkspace.current !== targetWorkspace) return;
    setPaymentDialog(null);
    setNotice(id ? 'Zahlung wurde aktualisiert.' : 'Zahlung wurde erfasst.');
    await load();
  };
  const removePayment = async () => {
    if (!deleteTarget || !writable) return;
    const targetWorkspace = workspaceId;
    setBusyPayment(deleteTarget.id); setError('');
    try {
      await financeApi.deleteVatPayment(deleteTarget.id);
      if (activeWorkspace.current !== targetWorkspace) return;
      setDeleteTarget(null); setNotice('Zahlung wurde gelöscht.'); await load();
    } catch (removeError) { if (activeWorkspace.current === targetWorkspace) setError(removeError instanceof Error ? removeError.message : 'Zahlung konnte nicht gelöscht werden.'); }
    finally { if (activeWorkspace.current === targetWorkspace) setBusyPayment(''); }
  };
  const bookPayment = async (payment: VatPayment) => {
    if (!writable || !payment.paidOn) return;
    const targetWorkspace = workspaceId;
    setBusyPayment(payment.id); setError('');
    try {
      await financeApi.bookVatPayment(payment.id);
      if (activeWorkspace.current !== targetWorkspace) return;
      setNotice('Zahlung wurde in die EÜR übernommen.'); await load();
    } catch (bookError) { if (activeWorkspace.current === targetWorkspace) setError(bookError instanceof Error ? bookError.message : 'Zahlung konnte nicht in die EÜR übernommen werden.'); }
    finally { if (activeWorkspace.current === targetWorkspace) setBusyPayment(''); }
  };

  const header = <PageHeader title="Umsatzsteuer" subtitle="Voranmeldungszeiträume aus deinen erfassten Belegen berechnet – Orientierung, keine Steuerberatung">
    <label className="sr-only" htmlFor="vat-year">Steuerjahr</label>
    <select id="vat-year" aria-label="Steuerjahr" className="form-input form-input-compact w-28 text-sm" value={year} onChange={event => setYear(Number(event.target.value))}>
      {yearOptions.map(option => <option key={option} value={option}>{option}</option>)}
    </select>
  </PageHeader>;

  if (extensionsLoading) return <div className="space-y-5">{header}<TableSkeleton rows={5} label="Umsatzsteuer-Übersicht wird geladen" /></div>;
  if (!enabled) return <div className="space-y-5">{header}<Notice variant="info" title="Erweiterung nicht aktiv">Aktiviere „Steuern & Abgaben“, um die Umsatzsteuer-Übersicht zu öffnen.<button type="button" className="ml-2 inline-flex items-center gap-1 font-medium text-primary-custom hover:underline" onClick={() => onNavigate('settings', 'extensions')}>Zu den Erweiterungen <ExternalLink className="h-3.5 w-3.5" /></button></Notice></div>;

  return (
    <div className="space-y-5 pb-8">
      {header}
      <p className="-mt-3 text-xs text-gray-500">Keine ELSTER-Übermittlung · unverbindliche Orientierung</p>
      {error && <Notice variant="error" onDismiss={() => setError('')}>{error}{/Erweiterungen/i.test(error) && <button type="button" className="ml-2 font-medium underline" onClick={() => onNavigate('settings', 'extensions')}>Einstellungen öffnen</button>}</Notice>}
      {notice && <Notice variant="success" onDismiss={() => setNotice('')}>{notice}</Notice>}
      {loading ? <TableSkeleton rows={6} label="Umsatzsteuer-Übersicht wird geladen" /> : overview && <>
        {overview.parameterYear !== year && <Notice variant="warning">Für {year} fehlen geprüfte Parameter. Diese Übersicht verwendet das Parameterjahr {overview.parameterYear} (Stand {overview.paramsAsOf}).</Notice>}
        {overview.vatStatus === null && <Notice variant="warning">Im Steuerprofil ist kein Umsatzsteuer-Status hinterlegt. Prüfe die Angaben in den Einstellungen.</Notice>}
        {!overview.applicable ? <section className="rounded-xl border border-gray-200 bg-white p-6 text-center dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Keine Umsatzsteuer-Voranmeldung</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-gray-600 dark:text-gray-300">Für den hinterlegten Status {overview.vatStatus ? `„${taxStatusLabel[overview.vatStatus]}“ ` : ''}wird keine reguläre Voranmeldung berechnet. Sonderfälle wie Reverse-Charge-Leistungen können dennoch Umsatzsteuer auslösen; Hinweise dazu findest du unten.</p>
        </section> : <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"><p className="text-xs text-gray-500">Umsatzsteuer-Status</p><p className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{overview.vatStatus ? taxStatusLabel[overview.vatStatus] : 'Nicht hinterlegt'}</p></article>
            <article className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"><p className="text-xs text-gray-500">Versteuerung</p><p className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{overview.accounting === 'cash' ? 'Ist-Versteuerung' : 'Soll-Versteuerung'}</p>{overview.accountingSource === 'default' && <p className="mt-1 text-xs text-gray-500">Standard nach Tätigkeit, im Steuerprofil änderbar. <button type="button" className="text-primary-custom hover:underline" onClick={() => onNavigate('settings', 'taxes')}>Steuerprofil öffnen</button></p>}</article>
            <article className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"><p className="text-xs text-gray-500">Voranmeldungszeitraum</p><p className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{{ monthly: 'Monatlich', quarterly: 'Vierteljährlich', annual: 'Jährlich' }[overview.periodType]}</p></article>
            <article className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"><p className="text-xs text-gray-500">Dauerfristverlängerung</p><p className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{overview.permanentExtension ? 'Aktiv' : 'Nicht hinterlegt'}</p>{overview.permanentExtension && <p className="mt-1 text-xs text-gray-500">Sondervorauszahlung: {overview.annual.specialPrepayment.amount === null ? 'Richtwert fehlt' : vatAmountLabel(overview.annual.specialPrepayment.amount)} · {overview.annual.specialPrepayment.source === 'profile' ? 'laut Profil' : overview.annual.specialPrepayment.source === 'previous_year' ? 'aus Vorjahresdaten' : 'Quelle fehlt'}{overview.annual.specialPrepayment.dueDate ? ` · fällig ${vatDateLabel(overview.annual.specialPrepayment.dueDate)}` : ''}{overview.annual.specialPrepayment.paid > 0 ? ` · bezahlt ${vatAmountLabel(overview.annual.specialPrepayment.paid)}` : ''}</p>}</article>
          </section>
          {overview.vatStatus === 'small_business' && <Notice variant="info">Kleinunternehmer ohne Reverse-Charge-Ausgaben: Für dieses Jahr werden keine steuerpflichtigen Umsätze und keine Vorsteuer berechnet.</Notice>}

          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700"><div><h2 className="font-semibold text-gray-900 dark:text-gray-100">Voranmeldungszeiträume</h2><p className="text-xs text-gray-500">Zahllast und Fälligkeiten aus den erfassten Daten</p></div></div>
            <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/50"><tr><th className="px-4 py-3">Zeitraum</th><th className="px-4 py-3 text-right">Zahllast / Überschuss</th><th className="px-4 py-3">Fälligkeit</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Datenlage</th></tr></thead><tbody className="divide-y divide-gray-100 dark:divide-gray-700">{overview.periods.map(item => <tr key={item.key} onClick={() => setSelectedKey(item.key)} className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 ${period?.key === item.key ? 'bg-primary-light-custom/40' : ''}`}><td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{vatPeriodLabel(item)}</td><td className="px-4 py-3 text-right font-medium">{vatPeriodAmountLabel(item)}</td><td className="px-4 py-3" title={item.dueDate && item.statutoryDueDate && item.dueDate !== item.statutoryDueDate ? `Gesetzlicher Termin vor Verschiebung: ${vatDateLabel(item.statutoryDueDate)}` : undefined}>{item.dueDate ? vatDateLabel(item.dueDate) : '–'}{item.dueDate && item.statutoryDueDate && item.dueDate !== item.statutoryDueDate && <span className="ml-1 text-xs text-gray-500" aria-label="Termin wegen Wochenende oder Feiertag verschoben">(verschoben)</span>}</td><td className="px-4 py-3"><StatusPill period={item} /></td><td className="px-4 py-3">{item.complete ? <span className="text-green-800">Vollständig</span> : <button type="button" onClick={event => { event.stopPropagation(); onNavigate('euer', 'vat-incomplete'); }} className="text-left text-amber-800 hover:underline">{item.incompleteEntryIds.length + item.legacyInvoiceIds.length} Buchungen ohne USt-Angaben</button>}</td></tr>)}</tbody></table></div>
            <div className="divide-y divide-gray-100 md:hidden dark:divide-gray-700">{overview.periods.map(item => <div key={item.key} className={`px-4 py-3 ${period?.key === item.key ? 'bg-primary-light-custom/40' : ''}`}><button type="button" onClick={() => setSelectedKey(item.key)} className="block w-full text-left"><span className="flex items-center justify-between gap-2"><span className="font-medium text-gray-900 dark:text-gray-100">{item.label}</span><StatusPill period={item} /></span><span className="mt-1 flex items-center justify-between gap-2 text-sm"><span className="font-semibold">{vatPeriodAmountLabel(item)}</span><span className="text-xs text-gray-500">Fällig {vatDateLabel(item.dueDate)}</span></span></button>{!item.complete && <button type="button" onClick={() => onNavigate('euer', 'vat-incomplete')} className="mt-1 block text-left text-xs text-amber-800 hover:underline">{item.incompleteEntryIds.length + item.legacyInvoiceIds.length} Buchungen ohne USt-Angaben → in der EÜR öffnen</button>}</div>)}</div>
          </section>

          {period && <section className="grid gap-5 xl:grid-cols-2">
            <article className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Kennzahlen · {period.label}</h2>
              {!period.complete && <Notice variant="warning">Schätzung aus unvollständigen Buchungen. Fehlende Angaben werden nicht stillschweigend ergänzt.</Notice>}
              <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead className="sr-only"><tr><th>Kennzahl</th><th>Bezeichnung</th><th>Betrag</th></tr></thead><tbody className="divide-y divide-gray-100 dark:divide-gray-700">{selectedRows.map(row => <tr key={row.key}><td className="w-14 py-2 font-semibold text-gray-500">{row.number}</td><td className="py-2 pr-3">{row.label}</td><td className="py-2 text-right font-medium">{vatAmountLabel(row.amount)}</td></tr>)}</tbody></table></div>
              <details className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-700"><summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-200">Rechenweg anzeigen ({period.items.length} Positionen)</summary>{period.items.length === 0 ? <p className="mt-3 text-sm text-gray-500">Für diesen Zeitraum sind keine einzelnen Positionen vorhanden.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="text-gray-500"><tr><th className="py-2 pr-3">Datum</th><th className="py-2 pr-3">Beleg / Rechnung</th><th className="py-2 pr-3">Satz</th><th className="py-2 pr-3 text-right">Netto</th><th className="py-2 pr-3 text-right">Steuer</th><th className="py-2">Kz</th></tr></thead><tbody className="divide-y divide-gray-100 dark:divide-gray-700">{period.items.map((item, index) => <tr key={`${item.sourceType}-${item.sourceId}-${index}`}><td className="py-2 pr-3">{vatDateLabel(item.date)}</td><td className="max-w-48 truncate py-2 pr-3" title={item.label}>{item.label}{item.estimated && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-900">Schätzung</span>}</td><td className="py-2 pr-3">{item.rate === null ? '–' : `${item.rate} %`}</td><td className="py-2 pr-3 text-right">{vatAmountLabel(item.net)}</td><td className="py-2 pr-3 text-right">{vatAmountLabel(item.tax)}</td><td className="py-2">{item.kennzahl}</td></tr>)}</tbody></table></div>}</details>
            </article>
            <article className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Zahlungen · {period.label}</h2>
              {writable && <button type="button" onClick={() => setPaymentDialog({ period })} className="btn-primary mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm"><Plus className="h-4 w-4" />Zahlung erfassen</button>}
              {selectedPayments.length === 0 ? <p className="mt-3 text-sm text-gray-500">Für diesen Zeitraum sind noch keine Zahlungen erfasst.</p> : <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-700">{selectedPayments.map(payment => <PaymentRow key={payment.id} payment={payment} busy={busyPayment === payment.id} writable={writable} onEdit={() => setPaymentDialog({ payment })} onDelete={() => setDeleteTarget(payment)} onBook={() => void bookPayment(payment)} tenDayRule={overview.euer.payments.some(item => item.paymentId === payment.id && item.tenDayRule)} euerYear={overview.euer.payments.find(item => item.paymentId === payment.id)?.euerYear} />)}</ul>}
            </article>
          </section>}

          <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-gray-900 dark:text-gray-100">Zahlungen und Erstattungen · {year}</h2><p className="text-xs text-gray-500">Buchungen mit Zahlungsdatum wirken sich auf die EÜR aus.</p></div>{writable && <button type="button" onClick={() => setPaymentDialog({ period: period ?? undefined })} className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm"><Plus className="h-4 w-4" />Zahlung erfassen</button>}</div>
            {allPayments.length === 0 ? <p className="mt-4 text-sm text-gray-500">Noch keine Zahlungen oder Erstattungen erfasst.</p> : <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-700">{allPayments.map(payment => <PaymentRow key={payment.id} payment={payment} busy={busyPayment === payment.id} writable={writable} onEdit={() => setPaymentDialog({ payment })} onDelete={() => setDeleteTarget(payment)} onBook={() => void bookPayment(payment)} tenDayRule={overview.euer.payments.some(item => item.paymentId === payment.id && item.tenDayRule)} euerYear={overview.euer.payments.find(item => item.paymentId === payment.id)?.euerYear} />)}</div>}
          </section>
        </>}

        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">EÜR-Zuordnung (Bruttomethode)</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Die EÜR berücksichtigt Einnahmen und Ausgaben grundsätzlich brutto und ordnet die Umsatzsteuer nach Zu- und Abfluss zu. USt-Zahlungen sind betriebliche Vorgänge und keine privaten Abgaben.</p>
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[500px] text-sm"><thead className="sr-only"><tr><th>Kennzahl</th><th>Bezeichnung</th><th>Betrag</th></tr></thead><tbody className="divide-y divide-gray-100 dark:divide-gray-700">{euerRows.map(row => <tr key={row.key}><td className="w-14 py-2 font-semibold text-gray-500">{row.number}</td><td className="py-2 pr-3">{row.label}</td><td className="py-2 text-right font-medium">{vatAmountLabel(row.amount)}</td></tr>)}</tbody></table></div>
        </section>

          {(overview.warnings.length > 0 || overview.limitations.length > 0) && <details className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800" open={expandedWarnings} onToggle={event => setExpandedWarnings(event.currentTarget.open)}><summary className="cursor-pointer font-medium text-gray-800 dark:text-gray-100">Hinweise und Grenzen <span className="ml-1 text-xs text-gray-500">({overview.warnings.length + overview.limitations.length})</span></summary><div className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-300">{overview.warnings.map((item, index) => <p key={`warning-${index}`} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />{item}</p>)}{overview.limitations.map((item, index) => <p key={`limit-${index}`} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />{item}</p>)}</div></details>}
      </>}

      {paymentDialog && <VatPaymentDialog key={paymentDialog.payment?.id ?? 'new-payment'} payment={paymentDialog.payment} taxYear={year} periodOptions={periodOptions} defaultPeriodKey={paymentDialog.payment?.periodKey ?? paymentDialog.period?.key ?? null} defaultAmount={paymentDialog.period ? Math.max(0, paymentDialog.period.balance) : overview?.annual.balance ?? 0} defaultDueDate={paymentDialog.payment?.dueDate ?? paymentDialog.period?.dueDate} onClose={() => setPaymentDialog(null)} onSave={savePayment} />}
      <ConfirmationModal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => void removePayment()} title="USt-Zahlung löschen" message={deleteTarget ? `${vatPaymentKindLabel(deleteTarget.kind)} über ${vatAmountLabel(deleteTarget.amount)} wirklich löschen? Eine bereits erzeugte EÜR-Buchung wird storniert.` : ''} confirmText="Löschen" isDestructive />
    </div>
  );
}

function PaymentRow({ payment, busy, writable, onEdit, onDelete, onBook, tenDayRule, euerYear }: {
  payment: VatPayment; busy: boolean; writable: boolean; onEdit: () => void; onDelete: () => void; onBook: () => void;
  tenDayRule: boolean; euerYear?: number;
}) {
  const periodLabel = payment.periodKey ? vatPeriodKeyLabel(payment.periodKey) : payment.kind === 'special_prepayment' ? 'Sondervorauszahlung' : `${payment.taxYear}`;
  return <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0"><p className="font-medium text-gray-900 dark:text-gray-100">{vatPaymentKindLabel(payment.kind)} · {periodLabel} <span className="font-semibold">{vatAmountLabel(payment.amount)}</span></p><p className="text-xs text-gray-500">{payment.paidOn ? `Bezahlt am ${vatDateLabel(payment.paidOn)}` : 'Noch nicht bezahlt'}{payment.dueDate ? ` · fällig ${vatDateLabel(payment.dueDate)}` : ''}{payment.source === 'legacy_levy' ? ' · Altbestand' : ''}{tenDayRule && euerYear ? ` · zählt zur EÜR ${euerYear} (§ 11 EStG)` : ''}</p>{payment.notes && <p className="mt-1 text-xs text-gray-500">{payment.notes}</p>}</div>
    {writable && <div className="flex flex-wrap gap-2">{payment.paidOn && !payment.euerEntryId && <button type="button" disabled={busy} onClick={onBook} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"><ArrowDownToLine className="h-3.5 w-3.5" />In EÜR übernehmen</button>}<button type="button" disabled={busy} onClick={onEdit} className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50">Bearbeiten</button><button type="button" disabled={busy} onClick={onDelete} className="rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">Löschen</button></div>}
  </li>;
}
