import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ChevronDown,
  Download,
  FileJson,
  FileScan,
  FileText,
  History,
  Info,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { useInvoices } from '../context/InvoiceContext';
import { apiService } from '../services/api';
import type {
  CreditNote,
  EuerEntry,
  EuerEntryCategory,
  EuerEntryHistory,
  EuerEntryPayload,
  EuerEntrySourceType,
  EuerEntryType,
} from '../types';
import { formatCurrency, formatDate, parseLocalizedNumber } from '../utils/formatters';
import { LocalizedNumberInput } from './LocalizedNumberInput';
import { PageHeader } from './PageHeader';
import { dismissNotice, isNoticeDismissed } from '../utils/dismissedNoticeStorage';
import { Notice } from './Notice';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { DialogShell } from './DialogShell';

type EntryDraft = {
  entryType: EuerEntryType;
  entryDate: string;
  description: string;
  category: EuerEntryCategory;
  amount: string;
  taxRate: string;
  notes: string;
  sourceType: EuerEntrySourceType;
  sourceId: string;
  correctionReason: string;
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
  sourceId?: string;
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

const categorySuggestions: Array<{ category: EuerEntryCategory; words: string[] }> = [
  { category: 'software', words: ['software', 'cloud', 'hosting', 'lizenz', 'saas'] },
  { category: 'telecommunications', words: ['telefon', 'internet', 'mobilfunk', 'telekommunikation'] },
  { category: 'office', words: ['büro', 'papier', 'drucker', 'schreibwaren', 'toner'] },
  { category: 'materials', words: ['material', 'ware', 'rohstoff', 'ersatzteil'] },
  { category: 'travel', words: ['bahn', 'hotel', 'reise', 'flug', 'taxi', 'übernacht'] },
  { category: 'vehicle', words: ['tank', 'diesel', 'benzin', 'park', 'fahrzeug', 'kfz'] },
  { category: 'marketing', words: ['werbung', 'anzeige', 'marketing', 'druck'] },
  { category: 'professional_services', words: ['beratung', 'steuerberater', 'anwalt', 'fremdleistung'] },
  { category: 'insurance', words: ['versicherung', 'beitrag'] },
  { category: 'bank_fees', words: ['bank', 'gebühr', 'konto', 'transaktion'] },
];

const suggestCategory = (description: string): EuerEntryCategory => {
  const normalized = description.toLocaleLowerCase('de-DE');
  return categorySuggestions.find(item => item.words.some(word => normalized.includes(word)))?.category || 'other_expense';
};

const emptyDraft = (sourceType: EuerEntrySourceType = 'manual'): EntryDraft => ({
  entryType: sourceType === 'invoice_payment' ? 'income' : 'expense',
  entryDate: new Date().toISOString().slice(0, 10),
  description: '',
  category: sourceType === 'invoice_payment' ? 'other_income' : 'office',
  amount: '',
  taxRate: sourceType === 'invoice_payment' ? '0' : '19',
  notes: '',
  sourceType,
  sourceId: '',
  correctionReason: '',
});

const dateKey = (value: Date | string) => String(value).slice(0, 10);
const getEuerInfoNoticeId = (year: number) => `euer-automatic-documents-${year}`;
const sourceLabels: Record<EuerEntrySourceType, string> = {
  manual: 'Manuell',
  invoice_payment: 'Teilzahlung',
  receipt: 'Beleg',
  correction: 'Korrektur',
};

interface EuerManagementProps {
  onNavigate?: (page: string) => void;
}

export function EuerManagement({ onNavigate }: EuerManagementProps) {
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
  const [infoNoticeDismissed, setInfoNoticeDismissed] = useState(() => isNoticeDismissed(getEuerInfoNoticeId(currentYear)));
  const [dialogEntry, setDialogEntry] = useState<EuerEntry | null | undefined>(undefined);
  const [draft, setDraft] = useState<EntryDraft>(emptyDraft());
  const [historyEntry, setHistoryEntry] = useState<EuerEntry | null>(null);
  const [history, setHistory] = useState<EuerEntryHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const formatAmount = (amount: number) => formatCurrency(amount, locale, company?.numberFormat, company?.currency);
  const years = Array.from({ length: 6 }, (_, index) => currentYear - index);
  const invoiceOptions = useMemo(() => invoices.filter(invoice => invoice.documentType !== 'credit_note'), [invoices]);
  const paymentTotals = useMemo(() => {
    const totals = new Map<string, number>();
    entries.forEach(entry => {
      if (entry.sourceType !== 'invoice_payment' || !entry.sourceId || entry.status === 'voided') return;
      totals.set(entry.sourceId, (totals.get(entry.sourceId) || 0) + Number(entry.amount || 0));
    });
    return totals;
  }, [entries]);
  const getRemainingAmount = (invoice: { id: string; total: number }) =>
    Math.max(0, Number(invoice.total || 0) - (paymentTotals.get(invoice.id) || 0));
  const entriesById = useMemo(() => new Map(entries.map(entry => [entry.id, entry])), [entries]);

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
  useEffect(() => { setInfoNoticeDismissed(isNoticeDismissed(getEuerInfoNoticeId(year))); }, [year]);

  const rows = useMemo<EuerRow[]>(() => {
    const linkedInvoiceIds = new Set(entries
      .filter(entry => entry.sourceType === 'invoice_payment' && entry.sourceId)
      .map(entry => entry.sourceId));
    const automaticRows = [...invoices, ...creditNotes]
      .filter(invoice => invoice.status === 'paid' && new Date(invoice.issueDate).getFullYear() === year)
      .filter(invoice => !linkedInvoiceIds.has(invoice.id))
      .map(invoice => {
        const isCreditNote = invoice.documentType === 'credit_note';
        const amount = isCreditNote ? -Math.abs(Number(invoice.total || 0)) : Math.abs(Number(invoice.total || 0));
        const taxRate = Number(invoice.subtotal) > 0 ? Number(((Number(invoice.taxAmount || 0) / Number(invoice.subtotal)) * 100).toFixed(2)) : 0;
        return {
          id: `invoice-${invoice.id}`,
          entryType: 'income' as const,
          entryDate: dateKey(invoice.issueDate),
          description: isCreditNote ? `Gutschrift ${invoice.invoiceNumber}` : `Rechnung ${invoice.invoiceNumber}`,
          category: 'other_income' as const,
          amount,
          taxRate,
          automatic: true,
          sourceLabel: isCreditNote ? 'Automatisch · Gutschrift' : 'Automatisch · Bezahlt',
          sourceId: invoice.id,
        };
      });
    const manualRows = entries.map(entry => {
      const sourceInvoice = entry.sourceType === 'invoice_payment' ? invoiceOptions.find(invoice => invoice.id === entry.sourceId) : undefined;
      return {
        id: entry.id,
        entryType: entry.entryType,
        entryDate: dateKey(entry.entryDate),
        description: entry.description,
        category: entry.category,
        amount: Number(entry.amount || 0),
        taxRate: Number(entry.taxRate || 0),
        notes: entry.notes,
        automatic: false,
        sourceLabel: sourceInvoice ? `${sourceLabels.invoice_payment} · ${sourceInvoice.invoiceNumber}` : sourceLabels[entry.sourceType || 'manual'],
        sourceId: entry.sourceId,
      };
    });
    return [...automaticRows, ...manualRows].sort((a, b) => b.entryDate.localeCompare(a.entryDate));
  }, [creditNotes, entries, invoiceOptions, invoices, year]);

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

  const checkHints = useMemo(() => {
    const hints: string[] = [];
    entries.forEach(entry => {
      if (!entry.notes?.trim() && entry.sourceType !== 'invoice_payment') hints.push(`„${entry.description}“ hat noch keinen Beleg- oder Notizhinweis.`);
      if (entry.entryType === 'expense' && entry.category === 'other_expense') hints.push(`„${entry.description}“ nutzt noch die allgemeine Kategorie.`);
      if (entry.sourceType === 'invoice_payment' && !entry.sourceId) hints.push(`„${entry.description}“ ist als Teilzahlung erfasst, aber keiner Rechnung zugeordnet.`);
    });
    invoiceOptions.forEach(invoice => {
      const payments = entries.filter(entry => entry.sourceType === 'invoice_payment' && entry.sourceId === invoice.id);
      if (!payments.length) return;
      const paidAmount = payments.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      if (paidAmount > Number(invoice.total || 0) + 0.01) hints.push(`Teilzahlungen zu ${invoice.invoiceNumber} überschreiten den Rechnungsbetrag.`);
      if (invoice.status === 'paid' && Math.abs(paidAmount - Number(invoice.total || 0)) > 0.01) hints.push(`Teilzahlungen zu ${invoice.invoiceNumber} stimmen nicht mit dem Status „Bezahlt“ überein.`);
    });
    return hints;
  }, [entries, invoiceOptions]);

  const openNew = () => { setDraft(emptyDraft()); setDialogEntry(null); setError(''); };
  const openPayment = () => { setDraft(emptyDraft('invoice_payment')); setDialogEntry(null); setError(''); };
  const openCorrection = (entry: EuerEntry) => {
    const correctionType: EuerEntryType = entry.entryType === 'income' ? 'expense' : 'income';
    setDraft({
      entryType: correctionType,
      entryDate: dateKey(entry.entryDate),
      description: `Korrektur zu: ${entry.description}`,
      category: correctionType === 'income' ? 'other_income' : entry.category,
      amount: String(Math.abs(Number(entry.amount || 0))),
      taxRate: String(entry.taxRate ?? 0),
      notes: `Gegenbuchung zu EÜR-Buchung ${entry.id}`,
      sourceType: 'correction',
      sourceId: entry.id,
      correctionReason: '',
    });
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
      sourceType: entry.sourceType || 'manual',
      sourceId: entry.sourceId || '',
      correctionReason: entry.correctionReason || '',
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
    if (draft.sourceType === 'correction' && !draft.correctionReason.trim()) {
      setError('Für eine Korrektur ist ein Korrekturgrund erforderlich.');
      return;
    }
    if (draft.sourceType === 'invoice_payment') {
      if (!draft.sourceId) {
        setError('Bitte ordnen Sie die Teilzahlung einer Rechnung zu.');
        return;
      }
      const invoice = invoiceOptions.find(item => item.id === draft.sourceId);
      if (invoice && amount > getRemainingAmount(invoice) + 0.01) {
        setError(`Die Teilzahlung darf den offenen Rechnungsbetrag von ${formatAmount(getRemainingAmount(invoice))} nicht überschreiten.`);
        return;
      }
    }
    const payload: EuerEntryPayload = {
      entryType: draft.entryType,
      entryDate: draft.entryDate,
      description: draft.description.trim(),
      category: draft.category,
      amount,
      taxRate,
      notes: draft.notes.trim() || undefined,
      sourceType: draft.sourceType,
      sourceId: draft.sourceId || undefined,
      correctionReason: draft.correctionReason.trim() || undefined,
    };
    setBusy(true);
    setError('');
    try {
      if (dialogEntry) {
        const updated = await apiService.updateEuerEntry(dialogEntry.id, payload);
        setEntries(current => current.map(entry => entry.id === updated.id ? updated : entry));
        setNotice('EÜR-Buchung wurde aktualisiert und protokolliert.');
      } else {
        const created = await apiService.createEuerEntry(payload);
        if (new Date(created.entryDate).getFullYear() === year) setEntries(current => [created, ...current]);
        setNotice(payload.sourceType === 'invoice_payment' ? 'Teilzahlung wurde gespeichert.' : 'EÜR-Buchung wurde gespeichert.');
      }
      closeDialog();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'EÜR-Buchung konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: EuerRow) => {
    if (entry.automatic || !window.confirm(`„${entry.description}“ stornieren? Die Buchung bleibt in der Historie erhalten.`)) return;
    setBusy(true);
    try {
      await apiService.deleteEuerEntry(entry.id, 'Stornierung durch Benutzer');
      setEntries(current => current.filter(item => item.id !== entry.id));
      setNotice('EÜR-Buchung wurde storniert und bleibt im Änderungsverlauf erhalten.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'EÜR-Buchung konnte nicht storniert werden.');
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async (entry: EuerEntry) => {
    setHistoryEntry(entry);
    setHistoryLoading(true);
    try {
      setHistory(await apiService.getEuerEntryHistory(entry.id));
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : 'Der Änderungsverlauf konnte nicht geladen werden.');
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const download = (content: string | Blob, filename: string, type?: string) => {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
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
    const header = ['Datum', 'Typ', 'Beschreibung', 'Kategorie', 'Betrag brutto', 'MwSt.-Satz', 'Quelle', 'Quell-ID', 'Notiz'];
    const csvRows = rows.map(row => [
      row.entryDate,
      row.entryType === 'income' ? 'Einnahme' : 'Ausgabe',
      row.description,
      categoryLabels[row.category],
      row.amount.toFixed(2).replace('.', ','),
      `${row.taxRate}`,
      row.sourceLabel || 'Manuell',
      row.sourceId || '',
      row.notes || '',
    ]);
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const content = '\uFEFF' + [header, ...csvRows].map(row => row.map(escape).join(';')).join('\r\n');
    download(content, `euer_${year}_steuerberater.csv`, 'text/csv;charset=utf-8');
    setNotice('CSV-Export für den Steuerberater wurde erstellt.');
  };

  const exportJson = () => {
    download(JSON.stringify({
      schemaVersion: '1.0',
      exportType: 'EÜR-Arbeitsstand',
      period: { year },
      createdAt: new Date().toISOString(),
      company: company ? { name: company.name, taxId: company.taxId, taxNumber: company.taxIdentificationNumber, taxBusinessType: company.taxBusinessType, legalForm: company.legalForm } : undefined,
      summary,
      monthly,
      checkHints,
      entries: rows,
      note: 'Kein amtlicher ELSTER-Datensatz. Vor der Abgabe steuerlich prüfen.',
    }, null, 2), `euer_${year}_steuerberater.json`, 'application/json;charset=utf-8');
    setNotice('JSON-Export für den Steuerberater wurde erstellt.');
  };

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const pageWidth = doc.internal.pageSize.getWidth();
    let cursor = 16;
    doc.setFontSize(18);
    doc.text('Einnahmenüberschussrechnung', 14, cursor);
    cursor += 8;
    doc.setFontSize(10);
    doc.text(`${company?.name || 'Unternehmen'} · Geschäftsjahr ${year}`, 14, cursor);
    cursor += 6;
    doc.text(`Steuernummer: ${company?.taxIdentificationNumber || 'nicht hinterlegt'} · Betriebsart: ${company?.taxBusinessType || 'nicht hinterlegt'} · Rechtsform: ${company?.legalForm || 'nicht hinterlegt'}`, 14, cursor);
    cursor += 10;
    doc.setFontSize(11);
    doc.text(`Einnahmen: ${formatAmount(summary.income)}   Ausgaben: ${formatAmount(summary.expenses)}   Überschuss: ${formatAmount(summary.profit)}`, 14, cursor);
    cursor += 10;
    doc.setFontSize(9);
    doc.text('Datum', 14, cursor);
    doc.text('Beschreibung', 42, cursor);
    doc.text('Kategorie', 115, cursor);
    doc.text('Quelle', 175, cursor);
    doc.text('Betrag', pageWidth - 42, cursor, { align: 'right' });
    cursor += 5;
    doc.line(14, cursor, pageWidth - 14, cursor);
    cursor += 6;
    rows.forEach(row => {
      if (cursor > 190) {
        doc.addPage();
        cursor = 16;
      }
      doc.text(row.entryDate, 14, cursor);
      doc.text(doc.splitTextToSize(row.description, 68)[0], 42, cursor);
      doc.text(doc.splitTextToSize(categoryLabels[row.category], 54)[0], 115, cursor);
      doc.text(doc.splitTextToSize(row.sourceLabel || 'Manuell', 45)[0], 175, cursor);
      doc.text(`${row.entryType === 'expense' ? '-' : row.amount < 0 ? '-' : '+'}${formatAmount(Math.abs(row.amount))}`, pageWidth - 14, cursor, { align: 'right' });
      cursor += 5;
    });
    if (checkHints.length) {
      if (cursor > 175) { doc.addPage(); cursor = 16; }
      cursor += 4;
      doc.setFontSize(10);
      doc.text('Prüfhinweise', 14, cursor);
      cursor += 5;
      doc.setFontSize(8);
      checkHints.slice(0, 8).forEach(hint => { doc.text(`• ${doc.splitTextToSize(hint, pageWidth - 30)[0]}`, 16, cursor); cursor += 4; });
    }
    doc.setFontSize(8);
    doc.text('Arbeitsstand, kein amtlicher ELSTER-Datensatz. Vor Abgabe steuerlich prüfen.', 14, 202);
    doc.save(`euer_${year}_steuerberater.pdf`);
    setNotice('PDF-Export für den Steuerberater wurde erstellt.');
  };

  return <div className="space-y-6">
    <PageHeader icon={Calculator} title="Einnahmenüberschussrechnung" subtitle="Einnahmen minus Betriebsausgaben – einfach online vorbereiten">
      <select value={year} onChange={event => setYear(Number(event.target.value))} className="form-input h-11 w-[4.5rem] shrink-0 px-2 text-sm sm:w-auto sm:px-3" aria-label="Jahr auswählen" title="Jahr auswählen">
        {years.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
      <ActionMenu
        ariaLabel="Buchungsart auswählen"
        title="Buchungsart auswählen"
        variant="primary"
        icon={<><Plus className="h-4 w-4" /><span className="hidden sm:inline">Buchung</span><ChevronDown className="hidden h-4 w-4 sm:inline" /></>}
        containerClassName="shrink-0"
        triggerClassName="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium transition-all duration-300 sm:min-w-0 sm:px-4"
        menuClassName="min-w-60"
      >
        <ActionMenuItem icon={<Plus className="h-4 w-4" />} tone="orange" onClick={openNew}>Manuelle Buchung</ActionMenuItem>
        <ActionMenuItem icon={<FileScan className="h-4 w-4" />} tone="blue" onClick={() => onNavigate?.('receipts')}>Beleg hinzufügen</ActionMenuItem>
        <ActionMenuItem icon={<ReceiptText className="h-4 w-4" />} tone="green" onClick={openPayment}>Teilzahlung</ActionMenuItem>
      </ActionMenu>
    </PageHeader>

    {!infoNoticeDismissed && <section className="relative rounded-xl border border-blue-100 bg-blue-50 p-5 pr-14">
      <button type="button" onClick={() => { dismissNotice(getEuerInfoNoticeId(year)); setInfoNoticeDismissed(true); }} className="absolute right-4 top-4 rounded-md p-1 text-blue-700 transition-colors hover:bg-blue-100" aria-label="Hinweis schließen"><X className="h-5 w-5" /></button>
      <div className="flex items-start gap-3"><Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" /><div><h2 className="font-semibold text-blue-950">Deine EÜR für {year}</h2><p className="mt-1 text-sm leading-6 text-blue-900">Das Einnahmen-/Ausgabenjournal ist der Kern deiner EÜR. Bezahlte Rechnungen und Gutschriften werden automatisch übernommen; Teilzahlungen, Belege und weitere Geschäftsvorfälle kannst du ergänzen.</p><p className="mt-2 text-xs text-blue-800">Hinweis: Im aktuellen Rechnungsmodell ist kein Zahlungseingangsdatum hinterlegt. Automatische Rechnungszeilen werden deshalb zunächst über das Rechnungsdatum zugeordnet und sollten vor der Abgabe geprüft werden.</p></div></div>
    </section>}

    {notice && <Notice variant="success" onDismiss={() => setNotice('')}>{notice}</Notice>}
    {error && <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Fehler schließen"><X className="h-4 w-4" /></button></div>}

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-sm text-gray-500"><TrendingUp className="h-4 w-4 text-emerald-600" />Einnahmen</div><p className="mt-3 text-2xl font-bold text-emerald-700">{formatAmount(summary.income)}</p></article>
      <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-sm text-gray-500"><TrendingDown className="h-4 w-4 text-rose-600" />Ausgaben</div><p className="mt-3 text-2xl font-bold text-rose-700">{formatAmount(summary.expenses)}</p></article>
      <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-sm text-gray-500"><Calculator className="h-4 w-4 text-primary-custom" />Überschuss</div><p className={`mt-3 text-2xl font-bold ${summary.profit >= 0 ? 'text-gray-900' : 'text-rose-700'}`}>{formatAmount(summary.profit)}</p></article>
      <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div className="text-sm text-gray-500">Buchungen</div><p className="mt-3 text-2xl font-bold text-gray-900">{summary.count}</p><p className="mt-1 text-xs text-gray-500">automatisch und manuell</p></article>
    </div>

    {checkHints.length > 0 && <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div><h2 className="font-semibold text-amber-950">Prüfhinweise ({checkHints.length})</h2><p className="mt-1 text-sm text-amber-900">Diese Hinweise helfen bei der Vorbereitung und ersetzen keine steuerliche Prüfung.</p><ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">{checkHints.slice(0, 6).map(hint => <li key={hint}>{hint}</li>)}</ul>{checkHints.length > 6 && <p className="mt-2 text-xs text-amber-800">Weitere Hinweise sind im Steuerberater-Export enthalten.</p>}</div></div></section>}

    <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-gray-900">Monatsübersicht</h2><p className="mt-1 text-sm text-gray-500">Schneller Überblick über Einnahmen, Ausgaben und Überschuss.</p></div>
          <ActionMenu ariaLabel="Steuerberater-Export öffnen" title="Steuerberater-Export" icon={<Download className="h-4 w-4" />} containerClassName="shrink-0" menuClassName="min-w-56">
            <ActionMenuItem icon={<Download className="h-4 w-4" />} tone="blue" onClick={exportCsv}>CSV Steuerberater</ActionMenuItem>
            <ActionMenuItem icon={<FileJson className="h-4 w-4" />} tone="indigo" onClick={exportJson}>JSON Steuerberater</ActionMenuItem>
            <ActionMenuItem icon={<FileText className="h-4 w-4" />} tone="green" onClick={exportPdf}>PDF Steuerberater</ActionMenuItem>
          </ActionMenu>
        </div>
        <div className="mt-5 hidden overflow-x-auto tablet:block">
          <table className="w-full min-w-[640px]">
            <thead className="bg-gray-50"><tr><th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Monat</th><th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Einnahmen</th><th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Ausgaben</th><th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Überschuss</th></tr></thead>
            <tbody className="divide-y divide-gray-200 bg-white">{monthly.map(item => <tr key={item.month} className="hover:bg-gray-50"><td className="px-4 py-3 font-medium text-gray-900">{new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(year, item.month, 1))}</td><td className="px-4 py-3 text-right text-emerald-700">{formatAmount(item.income)}</td><td className="px-4 py-3 text-right text-rose-700">{formatAmount(item.expenses)}</td><td className={`px-4 py-3 text-right font-medium ${item.profit >= 0 ? 'text-gray-900' : 'text-rose-700'}`}>{formatAmount(item.profit)}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="divide-y divide-gray-100 tablet:hidden">{monthly.map(item => <article key={item.month} className="py-4 first:pt-0 last:pb-0"><div className="flex items-center justify-between gap-3"><span className="font-medium text-gray-900">{new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(year, item.month, 1))}</span><span className={`font-semibold ${item.profit >= 0 ? 'text-gray-900' : 'text-rose-700'}`}>{formatAmount(item.profit)}</span></div><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-gray-500">Einnahmen</p><p className="mt-1 text-emerald-700">{formatAmount(item.income)}</p></div><div><p className="text-xs text-gray-500">Ausgaben</p><p className="mt-1 text-rose-700">{formatAmount(item.expenses)}</p></div></div></article>)}</div>
      </div>
    </section>

    <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="p-5"><h2 className="text-lg font-semibold text-gray-900">Buchungen</h2><p className="mt-1 text-sm text-gray-500">Automatische Belege und manuell erfasste Geschäftsvorfälle.</p></div>
      {loading ? <div className="px-5 pb-10 text-center text-sm text-gray-500">EÜR-Buchungen werden geladen …</div> : rows.length === 0 ? <div className="mx-5 mb-5 rounded-lg border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">Für {year} sind noch keine Buchungen vorhanden.</div> : <>
        <div className="hidden w-full min-w-0 max-w-full overflow-x-auto tablet:block">
          <table className="w-full table-fixed">
            <thead className="bg-gray-50"><tr><th className="w-28 px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Datum</th><th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Beschreibung</th><th className="w-40 px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Kategorie</th><th className="w-36 px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Quelle</th><th className="w-32 px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Betrag</th><th className="sticky right-0 z-20 w-14 bg-gray-50 px-2 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 2xl:w-56 2xl:px-4"><span className="sr-only">Aktionen</span></th></tr></thead>
            <tbody className="divide-y divide-gray-200 bg-white">{rows.map(row => { const entry = entriesById.get(row.id); return <tr key={row.id} className="group hover:bg-gray-50"><td className="w-28 whitespace-nowrap px-3 py-4 text-sm text-gray-900">{formatDate(row.entryDate, locale, company?.dateFormat)}</td><td className="max-w-0 px-3 py-4 text-sm"><div className="truncate font-medium text-gray-900" title={row.description}>{row.description}</div>{row.notes && <div className="mt-1 truncate text-xs text-gray-500" title={row.notes}>{row.notes}</div>}</td><td className="w-40 max-w-0 px-3 py-4 text-sm text-gray-600"><span className="block truncate" title={categoryLabels[row.category]}>{categoryLabels[row.category]}</span></td><td className="w-36 max-w-0 px-3 py-4 text-xs text-gray-500"><span className="block truncate" title={row.sourceLabel || 'Manuell'}>{row.sourceLabel || 'Manuell'}</span></td><td className={`w-32 whitespace-nowrap px-3 py-4 text-right text-sm font-medium ${row.entryType === 'income' ? 'text-emerald-700' : 'text-rose-700'}`}>{row.entryType === 'expense' ? '-' : row.amount < 0 ? '-' : '+'}{formatAmount(Math.abs(row.amount))}</td><td className="sticky right-0 z-10 w-14 bg-white px-2 py-4 text-sm transition-colors group-hover:bg-gray-50 2xl:w-56 2xl:px-4">{entry && <><div className="hidden 2xl:flex flex-wrap justify-end gap-1"><button type="button" onClick={() => openEdit(entry)} className="action-icon-button action-icon-indigo" title="Bearbeiten" disabled={busy}><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => openCorrection(entry)} className="action-icon-button action-icon-blue" title="Korrektur" disabled={busy}><RotateCcw className="h-4 w-4" /></button><button type="button" onClick={() => void openHistory(entry)} className="action-icon-button action-icon-blue" title="Historie" disabled={busy}><History className="h-4 w-4" /></button><button type="button" onClick={() => void remove(row)} className="action-icon-button action-icon-red" title="Stornieren" disabled={busy}><Trash2 className="h-4 w-4" /></button></div><ActionMenu containerClassName="hidden tablet:block 2xl:hidden" triggerClassName="action-icon-button action-icon-blue"><ActionMenuItem icon={<Pencil className="h-4 w-4" />} tone="indigo" onClick={() => openEdit(entry)} disabled={busy}>Bearbeiten</ActionMenuItem><ActionMenuItem icon={<RotateCcw className="h-4 w-4" />} tone="blue" onClick={() => openCorrection(entry)} disabled={busy}>Korrektur</ActionMenuItem><ActionMenuItem icon={<History className="h-4 w-4" />} tone="blue" onClick={() => void openHistory(entry)} disabled={busy}>Historie</ActionMenuItem><ActionMenuItem icon={<Trash2 className="h-4 w-4" />} tone="red" onClick={() => void remove(row)} disabled={busy}>Stornieren</ActionMenuItem></ActionMenu></>}</td></tr>; })}</tbody>
          </table>
        </div>
        <div className="divide-y divide-gray-100 tablet:hidden">{rows.map(row => { const entry = entriesById.get(row.id); return <article key={row.id} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-gray-900" title={row.description}>{row.description}</p><p className="mt-1 text-xs text-gray-500">{formatDate(row.entryDate, locale, company?.dateFormat)} · {categoryLabels[row.category]}</p></div><div className="flex shrink-0 items-start gap-2"><p className={`whitespace-nowrap text-sm font-semibold ${row.entryType === 'income' ? 'text-emerald-700' : 'text-rose-700'}`}>{row.entryType === 'expense' ? '-' : row.amount < 0 ? '-' : '+'}{formatAmount(Math.abs(row.amount))}</p>{entry && <ActionMenu containerClassName="self-center" triggerClassName="action-icon-button action-icon-blue"><ActionMenuItem icon={<Pencil className="h-4 w-4" />} tone="indigo" onClick={() => openEdit(entry)} disabled={busy}>Bearbeiten</ActionMenuItem><ActionMenuItem icon={<RotateCcw className="h-4 w-4" />} tone="blue" onClick={() => openCorrection(entry)} disabled={busy}>Korrektur</ActionMenuItem><ActionMenuItem icon={<History className="h-4 w-4" />} tone="blue" onClick={() => void openHistory(entry)} disabled={busy}>Historie</ActionMenuItem><ActionMenuItem icon={<Trash2 className="h-4 w-4" />} tone="red" onClick={() => void remove(row)} disabled={busy}>Stornieren</ActionMenuItem></ActionMenu>}</div></div><div className="mt-3 flex items-center justify-between gap-3 text-xs text-gray-500"><span className="truncate">{row.sourceLabel || 'Manuell'}</span>{row.automatic && <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 font-medium text-gray-600">Automatisch</span>}</div>{row.notes && <p className="mt-2 line-clamp-2 text-xs text-gray-500">{row.notes}</p>}</article>; })}</div>
      </>}
    </section>

    {dialogEntry !== undefined && (
      <DialogShell
        titleId="euer-entry-dialog-title"
        icon={dialogEntry ? Pencil : draft.sourceType === 'correction' ? RotateCcw : Plus}
        title={dialogEntry ? 'EÜR-Buchung bearbeiten' : draft.sourceType === 'invoice_payment' ? 'Teilzahlung erfassen' : draft.sourceType === 'correction' ? 'Korrektur erfassen' : 'EÜR-Buchung erfassen'}
        description="Beträge werden als Bruttobeträge erfasst. Änderungen werden protokolliert."
        onClose={closeDialog}
        onSubmit={submit}
        size="xl"
        footer={(
          <>
            <button type="button" onClick={closeDialog} className="min-h-12 rounded-lg border border-gray-300 bg-white px-8 py-2 text-base font-medium text-gray-700 transition hover:bg-gray-50">Abbrechen</button>
            <button type="submit" disabled={busy} className="btn-primary min-h-12 rounded-lg px-8 py-2 text-base font-semibold text-white transition hover:brightness-90">{busy ? 'Speichern …' : dialogEntry ? 'Änderungen speichern' : draft.sourceType === 'correction' ? 'Korrektur speichern' : 'Speichern'}</button>
          </>
        )}
      >
        {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        <div className="space-y-3 pb-2">
              <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-labelledby="euer-entry-data-title">
                <div className="mb-3">
                  <h3 id="euer-entry-data-title" className="text-xl font-semibold text-gray-900">Buchungsdaten</h3>
                  <p className="mt-1 text-base text-gray-500">Grunddaten des Geschäftsvorfalls.</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-base font-medium text-gray-700">Art<select value={draft.entryType} onChange={event => { const entryType = event.target.value as EuerEntryType; setDraft(current => ({ ...current, entryType, category: entryType === 'income' ? 'other_income' : current.category === 'other_income' ? 'office' : current.category })); }} className="form-input mt-1 w-full"><option value="expense">Ausgabe</option><option value="income">Einnahme</option></select></label>
                  <label className="text-base font-medium text-gray-700">Datum<input required type="date" value={draft.entryDate} onChange={event => setDraft(current => ({ ...current, entryDate: event.target.value }))} className="form-input mt-1 w-full" /></label>
                  <label className="text-base font-medium text-gray-700 md:col-span-2">Beschreibung<input required value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value, category: current.entryType === 'expense' && (current.category === 'office' || current.category === 'other_expense') ? suggestCategory(event.target.value) : current.category }))} className="form-input mt-1 w-full" placeholder="z. B. Büromaterial" /></label>
                  <label className="text-base font-medium text-gray-700">Kategorie<select value={draft.category} onChange={event => setDraft(current => ({ ...current, category: event.target.value as EuerEntryCategory }))} className="form-input mt-1 w-full">{(draft.entryType === 'income' ? ['other_income'] : expenseCategories).map(category => <option key={category} value={category}>{categoryLabels[category as EuerEntryCategory]}</option>)}</select></label>
                  <label className="text-base font-medium text-gray-700">Buchungsart<select value={draft.sourceType} onChange={event => { const sourceType = event.target.value as EuerEntrySourceType; setDraft(current => ({ ...current, sourceType, sourceId: sourceType === 'invoice_payment' ? current.sourceId : '', entryType: sourceType === 'invoice_payment' ? 'income' : current.entryType, category: sourceType === 'invoice_payment' ? 'other_income' : current.category })); }} className="form-input mt-1 w-full"><option value="manual">Manuelle Buchung</option><option value="invoice_payment">Teilzahlung zu einer Rechnung</option><option value="correction">Korrektur / Gegenbuchung</option></select></label>
                </div>
              </section>

              {draft.sourceType === 'invoice_payment' && <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-labelledby="euer-entry-source-title">
                <div className="mb-3"><h3 id="euer-entry-source-title" className="text-xl font-semibold text-gray-900">Zuordnung</h3><p className="mt-1 text-base text-gray-500">Ordne die Teilzahlung einer Rechnung zu.</p></div>
                <label className="text-base font-medium text-gray-700">Rechnung<select required value={draft.sourceId} onChange={event => { const sourceId = event.target.value; const invoice = invoiceOptions.find(item => item.id === sourceId); setDraft(current => ({ ...current, sourceId, description: invoice ? `Teilzahlung Rechnung ${invoice.invoiceNumber}` : current.description, taxRate: invoice && Number(invoice.subtotal) > 0 ? String(Number(((Number(invoice.taxAmount || 0) / Number(invoice.subtotal)) * 100).toFixed(2))) : current.taxRate })); }} className="form-input mt-1 w-full"><option value="">Rechnung auswählen</option>{invoiceOptions.filter(invoice => getRemainingAmount(invoice) > 0.01 || invoice.id === draft.sourceId).map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {invoice.customerName} · offen {formatAmount(getRemainingAmount(invoice))}</option>)}</select></label>
              </section>}

              <section className="rounded-xl border border-primary-custom border-l-2 bg-primary-light-custom p-5 sm:p-6" aria-labelledby="euer-entry-amount-title">
                <div className="mb-3"><h3 id="euer-entry-amount-title" className="text-xl font-semibold text-gray-900">Betrag</h3><p className="mt-1 text-base text-gray-500">Beträge werden als Bruttobeträge erfasst.</p></div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-base font-medium text-gray-700">Betrag<LocalizedNumberInput required min="0" step="0.01" value={draft.amount} locale={locale} numberFormat={company?.numberFormat} onValueChange={value => setDraft(current => ({ ...current, amount: value === '' ? '' : String(value) }))} className="form-input mt-1 w-full" /></label>
                  <label className="text-base font-medium text-gray-700">MwSt.-Satz in %<LocalizedNumberInput required min="0" max="100" step="0.01" value={draft.taxRate} locale={locale} numberFormat={company?.numberFormat} onValueChange={value => setDraft(current => ({ ...current, taxRate: value === '' ? '' : String(value) }))} className="form-input mt-1 w-full" /></label>
                </div>
              </section>

              <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-labelledby="euer-entry-notes-title">
                <div className="mb-3"><h3 id="euer-entry-notes-title" className="text-xl font-semibold text-gray-900">Notizen</h3><p className="mt-1 text-base text-gray-500">Optionale Hinweise zum Geschäftsvorfall.</p></div>
                <label className="text-base font-medium text-gray-700">Notiz / Beleghinweis<textarea value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} className="form-input mt-1 w-full" rows={3} placeholder="Optional: Belegnummer oder kurze Erläuterung" /></label>
                {draft.sourceType === 'correction' && <label className="mt-4 block text-base font-medium text-gray-700">Korrekturgrund<textarea required value={draft.correctionReason} onChange={event => setDraft(current => ({ ...current, correctionReason: event.target.value }))} className="form-input mt-1 w-full" rows={2} placeholder="Warum wird dieser Geschäftsvorfall korrigiert?" /></label>}
              </section>
            </div>
      </DialogShell>
    )}

    {historyEntry && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><section className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold text-gray-900">Änderungsverlauf</h2><p className="mt-1 text-sm text-gray-500">{historyEntry.description}</p></div><button type="button" onClick={() => setHistoryEntry(null)} aria-label="Historie schließen"><X className="h-5 w-5 text-gray-500" /></button></div>{historyLoading ? <div className="py-10 text-center text-sm text-gray-500">Historie wird geladen …</div> : history.length === 0 ? <div className="py-10 text-center text-sm text-gray-500">Noch keine Historieneinträge vorhanden.</div> : <div className="mt-5 space-y-3">{history.map(item => <article key={item.id} className="rounded-lg border border-gray-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 font-medium text-gray-900"><CheckCircle2 className="h-4 w-4 text-primary-custom" />{item.action === 'created' ? 'Erstellt' : item.action === 'updated' ? 'Geändert' : 'Storniert'}</span><span className="text-xs text-gray-500">{formatDate(item.changedAt, locale, company?.dateFormat)}</span></div>{item.reason && <p className="mt-2 text-sm text-gray-700">Grund: {item.reason}</p>}{(item.oldData || item.newData) && <details className="mt-2"><summary className="cursor-pointer text-xs font-medium text-gray-500">Technische Werte anzeigen</summary><pre className="mt-2 max-h-40 overflow-auto rounded bg-gray-50 p-2 text-xs text-gray-600">{JSON.stringify({ vorher: item.oldData, nachher: item.newData }, null, 2)}</pre></details>}</article>)}</div>}</section></div>}
  </div>;
}
