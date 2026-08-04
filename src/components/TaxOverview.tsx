import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Calculator, CheckCircle2, FileSpreadsheet, ReceiptText, ShieldCheck } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { useInvoices } from '../context/InvoiceContext';
import { apiService } from '../services/api';
import type { CreditNote } from '../types';
import { PageHeader } from './PageHeader';
import { formatCurrency, formatDate } from '../utils/formatters';

interface TaxOverviewProps {
  onNavigate: (page: string) => void;
}

export function TaxOverview({ onNavigate }: TaxOverviewProps) {
  const { invoices } = useInvoices();
  const { company } = useCompany();
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const locale = company?.locale || 'de-DE';
  const formatAmount = (amount: number) => formatCurrency(amount, locale, company?.numberFormat, company?.currency);

  useEffect(() => {
    void apiService.getCreditNotes().then(setCreditNotes).catch(() => setCreditNotes([]));
  }, []);

  const paidInvoiceSummary = useMemo(() => {
    const paidDocuments = [...invoices, ...creditNotes].filter(invoice => {
      const invoiceYear = new Date(invoice.issueDate).getFullYear();
      return invoiceYear === year && invoice.status === 'paid';
    });
    const income = paidDocuments.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
    return { count: paidDocuments.length, income };
  }, [creditNotes, invoices, year]);

  const years = Array.from({ length: 6 }, (_, index) => currentYear - index);

  return <div className="space-y-6">
    <PageHeader icon={Calculator} title="Steuern" subtitle="Steuerübersicht und Einnahmenüberschussrechnung">
      <select value={year} onChange={event => setYear(Number(event.target.value))} className="form-input w-auto">
        {years.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
      <button onClick={() => onNavigate('euer')} className="btn-primary flex items-center gap-2 rounded-xl px-4 py-2 text-white transition-all duration-300 hover:brightness-90">
        EÜR öffnen <ArrowRight className="h-4 w-4" />
      </button>
    </PageHeader>

    <section className="rounded-xl border border-blue-100 bg-blue-50 p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-blue-700" />
        <div>
          <h2 className="font-semibold text-blue-950">EÜR einfach online vorbereiten</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-blue-900">
            Einnahmen aus bezahlten Rechnungen werden automatisch berücksichtigt. Sonstige Einnahmen und Ausgaben können Sie in der EÜR ergänzen und anschließend als CSV oder JSON für Ihren Steuerberater exportieren.
          </p>
          <p className="mt-2 text-xs text-blue-800">Die ELSTER-Übertragung ist bewusst noch nicht aktiv und wird separat geprüft.</p>
        </div>
      </div>
    </section>

    <div className="grid gap-4 md:grid-cols-3">
      <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3"><ReceiptText className="h-5 w-5 text-primary-custom" /><span className="text-sm text-gray-500">Bezahlte Rechnungen {year}</span></div>
        <p className="mt-3 text-2xl font-bold text-gray-900">{paidInvoiceSummary.count}</p>
        <p className="mt-1 text-sm text-gray-600">Automatische Einnahmenbasis</p>
      </article>
      <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3"><FileSpreadsheet className="h-5 w-5 text-emerald-600" /><span className="text-sm text-gray-500">Automatische Einnahmen</span></div>
        <p className="mt-3 text-2xl font-bold text-emerald-700">{formatAmount(paidInvoiceSummary.income)}</p>
        <p className="mt-1 text-sm text-gray-600">Rechnungsdatum als Zuordnungsdatum</p>
      </article>
      <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 text-amber-600" /><span className="text-sm text-gray-500">Nächster Schritt</span></div>
        <p className="mt-3 font-semibold text-gray-900">Ausgaben ergänzen</p>
        <p className="mt-1 text-sm text-gray-600">Damit der Gewinn vollständig wird.</p>
      </article>
    </div>

    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Vorbereitung für Steuererklärung und Jahresabschluss</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div><p className="font-medium text-gray-900">1. Einnahmen prüfen</p><p className="mt-1 text-sm text-gray-600">Bezahlte Rechnungen und Gutschriften kontrollieren.</p></div>
        <div><p className="font-medium text-gray-900">2. Ausgaben erfassen</p><p className="mt-1 text-sm text-gray-600">Betriebsausgaben mit Kategorie und Belegnotiz ergänzen.</p></div>
        <div><p className="font-medium text-gray-900">3. Export teilen</p><p className="mt-1 text-sm text-gray-600">CSV oder JSON an den Steuerberater weitergeben.</p></div>
      </div>
      <button onClick={() => onNavigate('euer')} className="action-button mt-6 text-primary-custom"><Calculator className="h-4 w-4" />EÜR für {year} bearbeiten</button>
      <p className="mt-4 text-xs text-gray-500">Stand: {formatDate(new Date(), locale, company?.dateFormat)} · Keine automatische Steuerberatung.</p>
    </section>
  </div>;
}
