import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Boxes, Calculator, CheckCircle2, FileSpreadsheet, ReceiptText, ShieldCheck, X } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { useInvoices } from '../context/InvoiceContext';
import { useAuth } from '../context/AuthContext';
import { apiService } from '../services/api';
import type { CreditNote, EuerEntry } from '../types';
import { PageHeader } from './PageHeader';
import { formatCurrency, formatDate } from '../utils/formatters';
import { dismissNotice, isNoticeDismissed } from '../utils/dismissedNoticeStorage';
import { useExtensions } from '../hooks/useExtensions';
import { useForecast } from '../hooks/useForecast';
import { TAX_TEXTS } from '../../backend/shared/taxTexts.js';

interface TaxOverviewProps {
  onNavigate: (page: string, filter?: string) => void;
}

export function TaxOverview({ onNavigate }: TaxOverviewProps) {
  const { can, workspace } = useAuth();
  const { invoices } = useInvoices();
  const { company } = useCompany();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [noticeDismissed, setNoticeDismissed] = useState(() => isNoticeDismissed('tax-euer-preparation'));
  const { isEnabled, loading: extensionsLoading, error: extensionsError } = useExtensions();
  const hasSettingsPermission = can('workspace.settings');
  const taxesEnabled = isEnabled('taxes');
  const { forecast, loading: forecastLoading, error: forecastError } = useForecast(year, hasSettingsPermission && taxesEnabled);
  const workspaceId = workspace?.id ?? null;
  const sourceDataKey = `${workspaceId ?? 'none'}:${year}`;
  const [sourceData, setSourceData] = useState<{ key: string; creditNotes: CreditNote[]; euerEntries: EuerEntry[] }>({ key: '', creditNotes: [], euerEntries: [] });
  const creditNotes = sourceData.key === sourceDataKey ? sourceData.creditNotes : [];
  const euerEntries = sourceData.key === sourceDataKey ? sourceData.euerEntries : [];
  const locale = company?.locale || 'de-DE';
  const formatAmount = (amount: number) => formatCurrency(amount, locale, company?.numberFormat, company?.currency);

  useEffect(() => {
    let active = true;
    let requestVersion = 0;
    if (!workspaceId) {
      setSourceData({ key: sourceDataKey, creditNotes: [], euerEntries: [] });
      return () => { active = false; };
    }
    const refresh = () => {
      const version = ++requestVersion;
      void Promise.allSettled([apiService.getCreditNotes(), apiService.getEuerEntries(year)]).then(([notesResult, entriesResult]) => {
        if (!active || requestVersion !== version) return;
        setSourceData({ key: sourceDataKey, creditNotes: notesResult.status === 'fulfilled' ? notesResult.value : [], euerEntries: entriesResult.status === 'fulfilled' ? entriesResult.value : [] });
      });
    };
    refresh();
    window.addEventListener('solooffice-finance-changed', refresh);
    return () => {
      active = false;
      requestVersion += 1;
      window.removeEventListener('solooffice-finance-changed', refresh);
    };
  }, [invoices, sourceDataKey, year, workspaceId]);

  const paidInvoiceSummary = useMemo(() => {
    const payments = euerEntries.filter(entry => entry.entryType === 'income' && entry.sourceType === 'invoice_payment' && entry.sourceId);
    const linkedInvoiceIds = new Set(payments.map(entry => entry.sourceId));
    const legacyPaidInvoices = invoices.filter(invoice => (
      invoice.status === 'paid'
      && Number(String(invoice.issueDate).slice(0, 4)) === year
      && !linkedInvoiceIds.has(invoice.id)
    ));
    const paidCreditNotes = creditNotes.filter(note => Number(String(note.issueDate).slice(0, 4)) === year && note.status === 'paid' && !linkedInvoiceIds.has(note.id));
    const income = payments.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
      + legacyPaidInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0)
      - paidCreditNotes.reduce((sum, note) => sum + Math.abs(Number(note.total || 0)), 0);
    return { count: linkedInvoiceIds.size + legacyPaidInvoices.length, income };
  }, [creditNotes, euerEntries, invoices, year]);

  const forecastContent = extensionsLoading ? (
    <p role="status" className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">Steuereinstellungen werden geladen …</p>
  ) : extensionsError ? (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{extensionsError}</p>
  ) : !hasSettingsPermission ? (
    <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">Für private Steuerschätzungen ist das Recht „Einstellungen verwalten“ erforderlich. Der Workspace-Administrator kann den Zugriff prüfen.</p>
  ) : !taxesEnabled ? (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4"><p className="text-sm text-gray-700">Aktiviere „Steuern &amp; Abgaben“, um die Schätzung für dieses Steuerjahr einzurichten.</p><button type="button" onClick={() => onNavigate('settings', 'extensions')} className="action-button mt-3">Erweiterungen öffnen <ArrowRight className="h-4 w-4" /></button></div>
  ) : forecastLoading ? (
    <p role="status" className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">Steuerschätzung wird geladen …</p>
  ) : forecastError ? (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{forecastError}</p>
  ) : !forecast ? (
    <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">Für dieses Steuerjahr liegt noch keine Schätzung vor.</p>
  ) : !forecast.profileComplete ? (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-medium">Das Steuerprofil ist noch nicht vollständig.</p>
      <p className="mt-1">Ergänze diese Angaben, um eine Schätzung zu erhalten:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">{forecast.missingFields.map(field => <li key={field}>{field}</li>)}</ul>
      <button type="button" onClick={() => onNavigate('settings', 'taxes')} className="action-button mt-3">Steuerprofil öffnen <ArrowRight className="h-4 w-4" /></button>
    </div>
  ) : (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-gray-200 p-4"><p className="text-sm text-gray-500">Voraussichtlicher Gewinn</p><p className="mt-2 text-xl font-bold text-gray-900">{formatAmount(forecast.profitAnnual)}</p><p className="mt-1 text-xs text-gray-500">Bisher {formatAmount(forecast.profitYtd)} · Bereich {formatAmount(forecast.profitBand.low)} bis {formatAmount(forecast.profitBand.high)}</p></article>
        <article className="rounded-xl border border-gray-200 p-4"><p className="text-sm text-gray-500">Steuern und Sozialbeiträge</p><p className="mt-2 text-xl font-bold text-gray-900">{formatAmount(forecast.annualBurden)}</p><p className="mt-1 text-xs text-gray-500">Steuern {formatAmount(forecast.taxes.total)} · Sozialbeiträge {formatAmount(forecast.social.total)}</p></article>
        <article className="rounded-xl border border-gray-200 p-4"><p className="text-sm text-gray-500">Verbleibende Rücklage</p><p className="mt-2 text-xl font-bold text-gray-900">{formatAmount(forecast.remainingReserve)}</p><p className="mt-1 text-xs text-gray-500">Berücksichtigt erfasste Zahlungen; Umsatzsteuer separat.</p></article>
        <article className="rounded-xl border border-gray-200 p-4"><p className="text-sm text-gray-500">Umsatzsteuer-Richtwert</p><p className="mt-2 text-xl font-bold text-gray-900">{formatAmount(forecast.vatRemainingReserve)}</p><p className="mt-1 text-xs text-gray-500">{forecast.vatStatus === 'small_business' ? 'Kleinunternehmerregelung im Profil; hier ist keine Umsatzsteuer angesetzt.' : forecast.vatStatus === 'education_exempt' ? 'Bildungsbefreiung im Profil; mögliche Mischfälle bitte prüfen.' : forecast.vatBasis === 'calculated' ? 'Aus erfassten Belegen berechnet.' : forecast.vatBasis === 'estimate' ? `${forecast.vatIncompleteEntries} Buchungen ohne vollständige USt-Angaben.` : 'Grobe Schätzung; Vorsteuer und Sonderfälle können abweichen.'}</p></article>
      </div>
      {forecast.parameterYear !== year && <p role="note" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">{TAX_TEXTS.missingYearNotice(year, forecast.parameterYear, forecast.paramsAsOf)}</p>}
      {forecast.warnings.length > 0 && <details className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><summary className="cursor-pointer font-medium">Hinweise zur Steuerschätzung ({forecast.warnings.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">{forecast.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></details>}
      <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => onNavigate('settings', 'taxes')} className="action-button">Steuerprofil öffnen <ArrowRight className="h-4 w-4" /></button><button type="button" onClick={() => onNavigate('vat')} className="action-button">Umsatzsteuer ansehen <ArrowRight className="h-4 w-4" /></button></div>
    </>
  );

  return <div className="page-root space-y-6">
    <PageHeader icon={Calculator} title="Steuern" subtitle="Steuerübersicht und Einnahmenüberschussrechnung" />

    {!noticeDismissed && <section className="relative rounded-xl border border-blue-100 bg-blue-50 p-5 pr-14">
      <button type="button" onClick={() => { dismissNotice('tax-euer-preparation'); setNoticeDismissed(true); }} className="absolute right-4 top-4 rounded-md p-1 text-blue-700 transition-colors hover:bg-blue-100" aria-label="Hinweis ausblenden"><X className="h-5 w-5" /></button>
      <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-blue-700" /><div><h2 className="font-semibold text-blue-950">EÜR einfach online vorbereiten</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-blue-900">Erfasste Zahlungseingänge und Teilzahlungen werden automatisch berücksichtigt. Sonstige Einnahmen und Ausgaben können Sie in der EÜR ergänzen und anschließend für Ihren Steuerberater exportieren.</p><p className="mt-2 text-xs text-blue-800">Die ELSTER-Übertragung ist bewusst noch nicht aktiv und wird separat geprüft.</p></div></div>
    </section>}

    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-gray-900">Steuerschätzung {year}</h2><p className="mt-1 text-sm text-gray-500">{TAX_TEXTS.tooltip(year)}</p></div><div className="flex flex-wrap items-center gap-3"><label className="sr-only" htmlFor="tax-overview-year">Steuerjahr auswählen</label><select id="tax-overview-year" value={year} onChange={event => setYear(Number(event.target.value))} className="form-input h-10 w-24 px-2 text-sm" aria-label="Steuerjahr auswählen">{Array.from({ length: 11 }, (_, index) => currentYear + 1 - index).map(option => <option key={option} value={option}>{option}</option>)}</select><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">{TAX_TEXTS.badge}</span></div></div>
      <div className="mt-5">{forecastContent}</div>
    </section>

    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-gray-900">EÜR-Daten {year}</h2><p className="mt-1 text-sm text-gray-500">Ein kompakter Überblick über automatisch übernommene Zahlungen.</p></div><span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">Arbeitsstand</span></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3 sm:gap-4">
        <article className="rounded-xl border border-gray-200 p-4 lg:p-5"><div className="flex items-center gap-3"><ReceiptText className="h-5 w-5 text-primary-custom" /><span className="text-sm text-gray-500">Rechnungen mit Zahlungseingang</span></div><p className="mt-3 text-2xl font-bold text-gray-900">{paidInvoiceSummary.count}</p><button type="button" onClick={() => onNavigate('invoices')} className="action-button mt-4">Rechnungen prüfen <ArrowRight className="h-4 w-4" /></button></article>
        <article className="rounded-xl border border-gray-200 p-4 lg:p-5"><div className="flex items-center gap-3"><FileSpreadsheet className="h-5 w-5 text-emerald-600" /><span className="text-sm text-gray-500">Automatische Einnahmen</span></div><p className={`mt-3 text-2xl font-bold ${paidInvoiceSummary.income < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{formatAmount(paidInvoiceSummary.income)}</p><button type="button" onClick={() => onNavigate('euer')} className="action-button mt-4">EÜR-Vorschau öffnen <ArrowRight className="h-4 w-4" /></button></article>
        <article className="rounded-xl border border-gray-200 p-4 lg:p-5"><div className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 text-amber-600" /><span className="text-sm text-gray-500">Nächster Schritt</span></div><p className="mt-3 font-semibold text-gray-900">Ausgaben ergänzen</p><button type="button" onClick={() => onNavigate('euer')} className="action-button mt-4">Ausgaben erfassen <ArrowRight className="h-4 w-4" /></button></article>
      </div>
    </section>

    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Vorbereitung für Steuererklärung und Jahresabschluss</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3"><div><p className="font-medium text-gray-900">1. Einnahmen prüfen</p><p className="mt-1 text-sm text-gray-600">Bezahlte Rechnungen und Gutschriften kontrollieren.</p></div><div><p className="font-medium text-gray-900">2. Ausgaben erfassen</p><p className="mt-1 text-sm text-gray-600">Betriebsausgaben mit Kategorie und Belegnotiz ergänzen.</p></div><div><p className="font-medium text-gray-900">3. Export teilen</p><p className="mt-1 text-sm text-gray-600">CSV, JSON oder PDF an den Steuerberater weitergeben.</p></div></div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <button type="button" onClick={() => onNavigate('euer')} className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-left transition hover:border-orange-400"><span className="flex items-center justify-between gap-3 font-semibold text-gray-900">EÜR öffnen <ArrowRight className="h-4 w-4 text-orange-600" /></span><span className="mt-1 block text-sm text-gray-600">Einnahmen-/Ausgabenjournal, Prüfhinweise und Steuerberater-Exporte.</span></button>
        <button type="button" onClick={() => onNavigate('fixed-assets')} className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-left transition hover:border-orange-300"><span className="flex items-center justify-between gap-3 font-semibold text-gray-900">Anlagenverzeichnis <Boxes className="h-4 w-4 text-orange-600" /></span><span className="mt-1 block text-sm text-gray-600">Anlagegüter erfassen und vorbereitende lineare Abschreibung prüfen.</span></button>
      </div>
      <p className="mt-4 text-xs text-gray-500">Stand: {formatDate(new Date(), locale, company?.dateFormat)} · Keine automatische Steuerberatung.</p>
    </section>
  </div>;
}
