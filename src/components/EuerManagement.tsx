import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, Download, FileJson, Info, Pencil, Plus, Trash2, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { useInvoices } from '../context/InvoiceContext';
import { apiService } from '../services/api';
import type { CreditNote, EuerEntry, EuerEntryCategory, EuerEntryPayload, EuerEntryType } from '../types';
import { formatCurrency, formatDate, parseLocalizedNumber } from '../utils/formatters';
import { LocalizedNumberInput } from './LocalizedNumberInput';
import { PageHeader } from './PageHeader';

type EntryDraft = {
  entryType: EuerEntryType;
  entryDate: string;
  description: string;
  category: EuerEntryCategory;
  amount: string;
  taxRate: string;
  notes: string;
};

interface EuerRow {
  id: string;
  entryType: EuerEntryType;
  entryDate: string;
  description: string;
  category: EuerEntryCategory;
  amount: number;
  taxRate: number;
  notes?: string;
  automatic: boolean;
  sourceLabel?: string;
}

const categoryLabels: Record<EuerEntryCategory, string> = {
  other_income: 'Sonstige Einnahmen',
  materials: 'Material und Waren',
  office: 'Bürobedarf',
  software: 'Software und Lizenzen',
  telecommunications: 'Telefon und Internet',
  travel: 'Reisekosten',
  vehicle: 'Fahrzeugkosten',
  marketing: 'Werbung und Marketing',
  professional_services: 'Fremdleistungen',
  insurance: 'Versicherungen',
  bank_fees: 'Bankgebühren',
  other_expense: 'Sonstige Betriebsausgaben',
};

const expenseCategories: EuerEntryCategory[] = [
  'materials', 'office', 'software', 'telecommunications', 'travel', 'vehicle',
  'marketing', 'professional_services', 'insurance', 'bank_fees', 'other_expense',
];

const emptyDraft = (): EntryDraft => ({
  entryType: 'expense',
  entryDate: new Date().toISOString().slice(0, 10),
  description: '',
  category: 'office',
  amount: '',
  taxRate: '19',
  notes: '',
});

const dateKey = (value: Date | string) => String(value).slice(0, 10);

export function EuerManagement() {
  const { invoices } = useInvoices();
  const { company } = useCompany();
  const currentYear = new Date().getFullYear();
  const locale = company?.locale || 'de-DE';
  const [year, setYear] = useState(currentYear);
  const [entries, setEntries] = useState<EuerEntry[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialogEntry, setDialogEntry] = useState<EuerEntry | null | undefined>(undefined);
  const [draft, setDraft] = useState<EntryDraft>(emptyDraft());

  const formatAmount = (amount: number) => formatCurrency(amount, locale, company?.numberFormat, company?.currency);
  const years = Array.from({ length: 6 }, (_, index) => currentYear - index);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [entryData, creditNoteData] = await Promise.all([
        apiService.getEuerEntries(year),
        apiService.getCreditNotes(),
      ]);
      setEntries(entryData);
      setCreditNotes(creditNoteData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'EÜR-Buchungen konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { void loadEntries(); }, [loadEntries]);

  const rows = useMemo<EuerRow[]>(() => {
    const automaticRows = [...invoices, ...creditNotes]
      .filter(invoice => invoice.status === 'paid' && new Date(invoice.issueDate).getFullYear() === year)
      .map(invoice => {
        const isCreditNote = invoice.documentType === 'credit_note';
        const amount = isCreditNote ? -Math.abs(Number(invoice.total || 0)) : Math.abs(Number(invoice.total || 0));
        return {
          id: `invoice-${invoice.id}`,
          entryType: 'income' as const,
          entryDate: dateKey(invoice.issueDate),
          description: isCreditNote ? `Gutschrift ${invoice.invoiceNumber}` : `Rechnung ${invoice.invoiceNumber}`,
          category: 'other_income' as const,
          amount,
          taxRate: 0,
          automatic: true,
          sourceLabel: isCreditNote ? 'Automatisch · Gutschrift' : 'Automatisch · Bezahlt',
        };
      });
    const manualRows = entries.map(entry => ({
      id: entry.id,
      entryType: entry.entryType,
      entryDate: dateKey(entry.entryDate),
      description: entry.description,
      category: entry.category,
      amount: Number(entry.amount || 0),
      taxRate: Number(entry.taxRate || 0),
      notes: entry.notes,
      automatic: false,
    }));
    return [...automaticRows, ...manualRows].sort((a, b) => b.entryDate.localeCompare(a.entryDate));
  }, [creditNotes, entries, invoices, year]);

  const summary = useMemo(() => {
    const income = rows.filter(row => row.entryType === 'income').reduce((sum, row) => sum + row.amount, 0);
    const expenses = rows.filter(row => row.entryType === 'expense').reduce((sum, row) => sum + row.amount, 0);
    return { income, expenses, profit: income - expenses, count: rows.length };
  }, [rows]);

  const monthly = useMemo(() => Array.from({ length: 12 }, (_, month) => {
    const monthRows = rows.filter(row => new Date(`${row.entryDate}T00:00:00`).getMonth() === month);
    const income = monthRows.filter(row => row.entryType === 'income').reduce((sum, row) => sum + row.amount, 0);
    const expenses = monthRows.filter(row => row.entryType === 'expense').reduce((sum, row) => sum + row.amount, 0);
    return { month, income, expenses, profit: income - expenses };
  }), [rows]);

  const openNew = () => {
    setDraft(emptyDraft());
    setDialogEntry(null);
    setError('');
  };

  const openEdit = (entry: EuerEntry) => {
    setDraft({
      entryType: entry.entryType,
      entryDate: dateKey(entry.entryDate),
      description: entry.description,
      category: entry.category,
      amount: String(entry.amount),
      taxRate: String(entry.taxRate ?? 0),
      notes: entry.notes || '',
    });
    setDialogEntry(entry);
    setError('');
  };

  const closeDialog = () => setDialogEntry(undefined);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const amount = parseLocalizedNumber(draft.amount, locale, company?.numberFormat);
    const taxRate = parseLocalizedNumber(draft.taxRate, locale, company?.numberFormat);
    if (!draft.entryDate || !draft.description.trim() || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      setError('Bitte Datum, Beschreibung, Betrag und MwSt.-Satz prüfen.');
      return;
    }

    const payload: EuerEntryPayload = {
      entryType: draft.entryType,
      entryDate: draft.entryDate,
      description: draft.description.trim(),
      category: draft.category,
      amount,
      taxRate,
      notes: draft.notes.trim() || undefined,
    };
    setBusy(true);
    setError('');
    try {
      if (dialogEntry) {
        const updated = await apiService.updateEuerEntry(dialogEntry.id, payload);
        setEntries(current => current.map(entry => entry.id === updated.id ? updated : entry));
        setNotice('EÜR-Buchung wurde aktualisiert.');
      } else {
        const created = await apiService.createEuerEntry(payload);
        if (new Date(created.entryDate).getFullYear() === year) setEntries(current => [created, ...current]);
        setNotice('EÜR-Buchung wurde gespeichert.');
      }
      closeDialog();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'EÜR-Buchung konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: EuerRow) => {
    if (entry.automatic || !window.confirm(`„${entry.description}“ wirklich löschen?`)) return;
    setBusy(true);
    try {
      await apiService.deleteEuerEntry(entry.id);
      setEntries(current => current.filter(item => item.id !== entry.id));
      setNotice('EÜR-Buchung wurde gelöscht.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'EÜR-Buchung konnte nicht gelöscht werden.');
    } finally {
      setBusy(false);
    }
  };

  const download = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportCsv = () => {
    const header = ['Datum', 'Typ', 'Beschreibung', 'Kategorie', 'Betrag', 'MwSt.-Satz', 'Quelle', 'Notiz'];
    const csvRows = rows.map(row => [
      row.entryDate,
      row.entryType === 'income' ? 'Einnahme' : 'Ausgabe',
      row.description,
      categoryLabels[row.category],
      row.amount.toFixed(2).replace('.', ','),
      `${row.taxRate}`,
      row.sourceLabel || 'Manuell',
      row.notes || '',
    ]);
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    download([header, ...csvRows].map(row => row.map(escape).join(';')).join('\r\n'), `euer_${year}.csv`, 'text/csv;charset=utf-8');
    setNotice('CSV-Export wurde erstellt.');
  };

  const exportJson = () => {
    download(JSON.stringify({
      exportType: 'EÜR-Arbeitsstand',
      year,
      createdAt: new Date().toISOString(),
      summary,
      entries: rows,
      note: 'Kein amtlicher ELSTER-Datensatz. Vor der Abgabe steuerlich prüfen.',
    }, null, 2), `euer_${year}.json`, 'application/json;charset=utf-8');
    setNotice('JSON-Export wurde erstellt.');
  };

  return <div className="space-y-6">
    <PageHeader icon={Calculator} title="Einnahmenüberschussrechnung" subtitle="Einnahmen minus Betriebsausgaben – einfach online vorbereiten">
      <select value={year} onChange={event => setYear(Number(event.target.value))} className="form-input w-auto">
        {years.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
      <button onClick={openNew} className="btn-primary flex items-center gap-2 rounded-xl px-4 py-2 text-white transition-all duration-300 hover:brightness-90"><Plus className="h-4 w-4" />Buchung</button>
    </PageHeader>

    <section className="rounded-xl border border-blue-100 bg-blue-50 p-5">
      <div className="flex items-start gap-3"><Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" /><div><h2 className="font-semibold text-blue-950">Deine EÜR für {year}</h2><p className="mt-1 text-sm leading-6 text-blue-900">Bezahlte Rechnungen und bezahlte Gutschriften werden automatisch übernommen. Ergänze Ausgaben und sonstige Einnahmen, damit dein Ergebnis vollständig wird.</p><p className="mt-2 text-xs text-blue-800">Hinweis: Im aktuellen Rechnungsmodell ist kein Zahlungseingangsdatum hinterlegt. Automatische Belege werden deshalb zunächst über das Rechnungsdatum zugeordnet und sollten vor der Abgabe geprüft werden.</p></div></div>
    </section>

    {notice && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</div>}
    {error && <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><span>{error}</span><button onClick={() => setError('')} aria-label="Fehler schließen"><X className="h-4 w-4" /></button></div>}

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-sm text-gray-500"><TrendingUp className="h-4 w-4 text-emerald-600" />Einnahmen</div><p className="mt-3 text-2xl font-bold text-emerald-700">{formatAmount(summary.income)}</p></article>
      <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-sm text-gray-500"><TrendingDown className="h-4 w-4 text-rose-600" />Ausgaben</div><p className="mt-3 text-2xl font-bold text-rose-700">{formatAmount(summary.expenses)}</p></article>
      <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-sm text-gray-500"><Calculator className="h-4 w-4 text-primary-custom" />Überschuss</div><p className={`mt-3 text-2xl font-bold ${summary.profit >= 0 ? 'text-gray-900' : 'text-rose-700'}`}>{formatAmount(summary.profit)}</p></article>
      <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div className="text-sm text-gray-500">Buchungen</div><p className="mt-3 text-2xl font-bold text-gray-900">{summary.count}</p><p className="mt-1 text-xs text-gray-500">automatisch und manuell</p></article>
    </div>

    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-900">Monatsübersicht</h2><p className="mt-1 text-sm text-gray-500">Schneller Überblick über Einnahmen, Ausgaben und Überschuss.</p></div><div className="flex gap-2"><button onClick={exportCsv} className="action-button"><Download className="h-4 w-4" />CSV für Steuerberater</button><button onClick={exportJson} className="action-button"><FileJson className="h-4 w-4" />JSON exportieren</button></div></div>
      <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500"><th className="px-3 py-3">Monat</th><th className="px-3 py-3 text-right">Einnahmen</th><th className="px-3 py-3 text-right">Ausgaben</th><th className="px-3 py-3 text-right">Überschuss</th></tr></thead><tbody>{monthly.map(item => <tr key={item.month} className="border-b border-gray-100"><td className="px-3 py-3 font-medium text-gray-700">{new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(year, item.month, 1))}</td><td className="px-3 py-3 text-right text-emerald-700">{formatAmount(item.income)}</td><td className="px-3 py-3 text-right text-rose-700">{formatAmount(item.expenses)}</td><td className={`px-3 py-3 text-right font-medium ${item.profit >= 0 ? 'text-gray-900' : 'text-rose-700'}`}>{formatAmount(item.profit)}</td></tr>)}</tbody></table></div>
    </section>

    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-900">Buchungen</h2><p className="mt-1 text-sm text-gray-500">Automatische Belege und manuell erfasste Geschäftsvorfälle.</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">ELSTER-Übertragung in Prüfung</span></div>
      {loading ? <div className="py-10 text-center text-sm text-gray-500">EÜR-Buchungen werden geladen …</div> : rows.length === 0 ? <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">Für {year} sind noch keine Buchungen vorhanden.</div> : <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[860px] text-sm"><thead><tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500"><th className="px-3 py-3">Datum</th><th className="px-3 py-3">Beschreibung</th><th className="px-3 py-3">Kategorie</th><th className="px-3 py-3">Quelle</th><th className="px-3 py-3 text-right">Betrag</th><th className="px-3 py-3 text-right">Aktionen</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-b border-gray-100"><td className="px-3 py-3 whitespace-nowrap text-gray-600">{formatDate(row.entryDate, locale, company?.dateFormat)}</td><td className="px-3 py-3"><div className="font-medium text-gray-900">{row.description}</div>{row.notes && <div className="mt-1 text-xs text-gray-500">{row.notes}</div>}</td><td className="px-3 py-3 text-gray-600">{categoryLabels[row.category]}</td><td className="px-3 py-3 text-xs text-gray-500">{row.sourceLabel || 'Manuell'}</td><td className={`px-3 py-3 text-right font-medium ${row.entryType === 'income' ? 'text-emerald-700' : 'text-rose-700'}`}>{row.entryType === 'expense' ? '-' : row.amount < 0 ? '-' : '+'}{formatAmount(Math.abs(row.amount))}</td><td className="px-3 py-3"><div className="flex justify-end gap-2">{!row.automatic && <><button onClick={() => openEdit(entries.find(entry => entry.id === row.id)!)} className="action-button" disabled={busy}><Pencil className="h-4 w-4" />Bearbeiten</button><button onClick={() => void remove(row)} className="action-button text-rose-700" disabled={busy}><Trash2 className="h-4 w-4" />Löschen</button></>}</div></td></tr>)}</tbody></table></div>}
    </section>

    {dialogEntry !== undefined && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-xl font-semibold text-gray-900">{dialogEntry ? 'EÜR-Buchung bearbeiten' : 'EÜR-Buchung erfassen'}</h2><p className="mt-1 text-sm text-gray-500">Beträge werden als Bruttobeträge erfasst.</p></div><button type="button" onClick={closeDialog} aria-label="Dialog schließen"><X className="h-5 w-5 text-gray-500" /></button></div><div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium text-gray-700">Art<select value={draft.entryType} onChange={event => { const entryType = event.target.value as EuerEntryType; setDraft(current => ({ ...current, entryType, category: entryType === 'income' ? 'other_income' : current.category === 'other_income' ? 'office' : current.category })); }} className="form-input mt-1 w-full"><option value="expense">Ausgabe</option><option value="income">Einnahme</option></select></label><label className="text-sm font-medium text-gray-700">Datum<input required type="date" value={draft.entryDate} onChange={event => setDraft(current => ({ ...current, entryDate: event.target.value }))} className="form-input mt-1 w-full" /></label><label className="text-sm font-medium text-gray-700 md:col-span-2">Beschreibung<input required value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} className="form-input mt-1 w-full" placeholder="z. B. Büromaterial" /></label><label className="text-sm font-medium text-gray-700">Kategorie<select value={draft.category} onChange={event => setDraft(current => ({ ...current, category: event.target.value as EuerEntryCategory }))} className="form-input mt-1 w-full">{(draft.entryType === 'income' ? ['other_income'] : expenseCategories).map(category => <option key={category} value={category}>{categoryLabels[category as EuerEntryCategory]}</option>)}</select></label><label className="text-sm font-medium text-gray-700">Betrag<LocalizedNumberInput required min="0" step="0.01" value={draft.amount} locale={locale} numberFormat={company?.numberFormat} onValueChange={value => setDraft(current => ({ ...current, amount: value === '' ? '' : String(value) }))} className="form-input mt-1 w-full" /></label><label className="text-sm font-medium text-gray-700">MwSt.-Satz in %<LocalizedNumberInput required min="0" max="100" step="0.01" value={draft.taxRate} locale={locale} numberFormat={company?.numberFormat} onValueChange={value => setDraft(current => ({ ...current, taxRate: value === '' ? '' : String(value) }))} className="form-input mt-1 w-full" /></label><label className="text-sm font-medium text-gray-700 md:col-span-2">Notiz / Beleghinweis<textarea value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} className="form-input mt-1 w-full" rows={3} placeholder="Optional: Belegnummer oder kurze Erläuterung" /></label></div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={closeDialog} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button><button type="submit" disabled={busy} className="btn-primary rounded-lg px-4 py-2 text-white transition-colors hover:brightness-90">{busy ? 'Speichern …' : 'Speichern'}</button></div></form></div>}
  </div>;
}
