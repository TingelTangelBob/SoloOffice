import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Boxes, Calculator, CheckCircle2, FileSpreadsheet, ReceiptText, ShieldCheck, X } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { useInvoices } from '../context/InvoiceContext';
import { apiService } from '../services/api';
import type { CreditNote } from '../types';
import { PageHeader } from './PageHeader';
import { formatCurrency, formatDate } from '../utils/formatters';
import { dismissNotice, isNoticeDismissed } from '../utils/dismissedNoticeStorage';

interface TaxOverviewProps {
  onNavigate: (page: string) => void;
}

export function TaxOverview({ onNavigate }: TaxOverviewProps) {
  const { invoices } = useInvoices();
  const { company } = useCompany();
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const year = new Date().getFullYear();
  const [noticeDismissed, setNoticeDismissed] = useState(() => isNoticeDismissed('tax-euer-preparation'));
  const locale = company?.locale || 'de-DE';
  const formatAmount = (amount: number) => formatCurrency(amount, locale, company?.numberFormat, company?.currency);

  useEffect(() => {
    void apiService.getCreditNotes().then(setCreditNotes).catch(() => setCreditNotes([]));
  }, []);

  const paidInvoiceSummary = useMemo(() => {
    const paidDocuments = [...invoices, ...creditNotes].filter(invoice => new Date(invoice.issueDate).getFullYear() === year && invoice.status === 'paid');
    const income = paidDocuments.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
    return { count: paidDocuments.length, income };
  }, [creditNotes, invoices, year]);

  return <div className="space-y-6">
    <PageHeader icon={Calculator} title="Steuern" subtitle="Steuerübersicht und Einnahmenüberschussrechnung" />

    {!noticeDismissed && <section className="relative rounded-xl border border-blue-100 bg-blue-50 p-5 pr-14">
      <button type="button" onClick={() => { dismissNotice('tax-euer-preparation'); setNoticeDismissed(true); }} className="absolute right-4 top-4 rounded-md p-1 text-blue-700 transition-colors hover:bg-blue-100" aria-label="Hinweis ausblenden"><X className="h-5 w-5" /></button>
      <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-blue-700" /><div><h2 className="font-semibold text-blue-950">EÜR einfach online vorbereiten</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-blue-900">Einnahmen aus bezahlten Rechnungen werden automatisch berücksichtigt. Sonstige Einnahmen und Ausgaben können Sie in der EÜR ergänzen und anschließend für Ihren Steuerberater exportieren.</p><p className="mt-2 text-xs text-blue-800">Die ELSTER-Übertragung ist bewusst noch nicht aktiv und wird separat geprüft.</p></div></div>
    </section>}

    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-gray-900">Steuervorschau {year}</h2><p className="mt-1 text-sm text-gray-500">Ein kompakter Überblick über die aktuell vorbereiteten Daten.</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">Arbeitsstand</span></div>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <article className="rounded-xl border border-gray-200 p-5"><div className="flex items-center gap-3"><ReceiptText className="h-5 w-5 text-primary-custom" /><span className="text-sm text-gray-500">Bezahlte Rechnungen</span></div><p className="mt-3 text-2xl font-bold text-gray-900">{paidInvoiceSummary.count}</p><p className="mt-1 text-sm text-gray-600">Automatische Einnahmenbasis</p><button type="button" onClick={() => onNavigate('invoices')} className="action-button mt-4">Rechnungen prüfen <ArrowRight className="h-4 w-4" /></button></article>
        <article className="rounded-xl border border-gray-200 p-5"><div className="flex items-center gap-3"><FileSpreadsheet className="h-5 w-5 text-emerald-600" /><span className="text-sm text-gray-500">Automatische Einnahmen</span></div><p className="mt-3 text-2xl font-bold text-emerald-700">{formatAmount(paidInvoiceSummary.income)}</p><p className="mt-1 text-sm text-gray-600">Rechnungsdatum als Zuordnungsdatum</p><button type="button" onClick={() => onNavigate('euer')} className="action-button mt-4">EÜR-Vorschau öffnen <ArrowRight className="h-4 w-4" /></button></article>
        <article className="rounded-xl border border-gray-200 p-5"><div className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 text-amber-600" /><span className="text-sm text-gray-500">Nächster Schritt</span></div><p className="mt-3 font-semibold text-gray-900">Ausgaben ergänzen</p><p className="mt-1 text-sm text-gray-600">Damit der Überschuss vollständiger wird.</p><button type="button" onClick={() => onNavigate('euer')} className="action-button mt-4">Ausgaben erfassen <ArrowRight className="h-4 w-4" /></button></article>
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
