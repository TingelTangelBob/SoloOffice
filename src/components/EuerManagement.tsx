import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  AlertTriangle,
  Calculator,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  FileJson,
  FileScan,
  FileText,
  History,
  Info,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  X,
} from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { useCustomers } from '../context/CustomerContext';
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
  EuerVatFields,
  Receipt,
} from '../types';
import { formatCurrency, formatDate, parseLocalizedNumber } from '../utils/formatters';
import { LocalizedNumberInput } from './LocalizedNumberInput';
import { VatFieldsEditor } from './VatFieldsEditor';
import { resolveTaxParams } from '../../backend/shared/taxParams/index.js';
import { needsVatData, suggestVatFromLegacy, validateVatAmounts } from '../utils/vatEntryForm';
import { PageHeader } from './PageHeader';
import { dismissNotice, isNoticeDismissed } from '../utils/dismissedNoticeStorage';
import { Notice } from './Notice';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { DialogShell } from './DialogShell';
import { useElementWidth } from '../hooks/useElementWidth';
import { ACTION_MENU_COLUMN_WIDTH, listTableLayout } from '../utils/tableLayout';
import { useFeedback } from '../context/FeedbackContext';
import { TableSkeleton } from './TableSkeleton';
import { EmptyState } from './EmptyState';
import { ImportWizard } from './ImportWizard';
import { getTerminology } from '../utils/terminology';
import { DueRecurringExpensesNotice } from './DueRecurringExpensesNotice';
import { RecurringExpenseDialog } from './RecurringExpenseDialog';
import { EuerAllowanceDialog } from './EuerAllowanceDialog';
import { isHomeOfficeAllowanceEntry } from '../utils/euerAllowanceDays';
import { financeApi } from '../services/financeApi';
import type { RecurringExpensePayload } from '../types/finance';
import { useAuth } from '../context/AuthContext';
import { DocumentPreview } from './DocumentPreview';
import { createInvoiceAttachmentPreviewDocuments } from '../utils/previewDocuments';
import type { PreviewDocument } from '../utils/previewDocuments';
import { loadImportedInvoiceOriginal } from '../utils/pdfGenerator';
import { blobToBase64 } from '../utils/blobUtils';
import { FloatingInfoTooltip } from './InfoTooltip';
import { getEuerHistoryChanges, isActiveEuerEntry } from '../utils/euerHistory';
/** Feste Spaltenbreiten inklusive Innenabstand; die Beschreibung nimmt den Rest ein. */
const EUER_COLUMN_WIDTHS = { date: 120, category: 240, source: 112, amount: 128 } as const;
const EUER_TABLE_LAYOUT = listTableLayout({
  baseColumnsWidth: EUER_COLUMN_WIDTHS.date + EUER_COLUMN_WIDTHS.category + EUER_COLUMN_WIDTHS.source + EUER_COLUMN_WIDTHS.amount,
  flexibleColumnMinWidth: 200,
  maxActions: 5,
});
const MONTHLY_AVERAGE_HELP = 'Der feste Jahresdurchschnitt teilt die Jahressumme durch 12. Der zweite Wert teilt im laufenden Jahr durch die bisher erreichten Monate und in anderen Jahren durch Monate mit Buchungen.';

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
  /** Kundenbezug einer Einnahme ohne Rechnung. */
  customerId: string;
  vatFields: EuerVatFields;
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
  invoiceId?: string;
  status?: 'active' | 'voided';}

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
  rent: 'Miete und Raumkosten',
  memberships: 'Kammern und Verbände',
  allowance: 'Pauschalen',
  other_expense: 'Sonstige Betriebsausgaben',
  vat_payment: 'Umsatzsteuer an das Finanzamt',
  vat_refund: 'Umsatzsteuer-Erstattung',
};

const expenseCategories: EuerEntryCategory[] = [
  'materials', 'office', 'software', 'telecommunications', 'travel', 'vehicle',
  'marketing', 'professional_services', 'insurance', 'bank_fees', 'rent', 'memberships', 'allowance', 'other_expense',
];

const categorySuggestions: Array<{ category: EuerEntryCategory; words: string[] }> = [
  { category: 'allowance', words: ['pauschale', 'pauschalen', 'homeoffice'] },
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

const todayLocal = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const monthLabel = (locale: string, year: number, month: number) => new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month, 15)));

const emptyDraft = (sourceType: EuerEntrySourceType = 'manual'): EntryDraft => ({
  entryType: sourceType === 'invoice_payment' ? 'income' : 'expense',
  entryDate: todayLocal(),
  description: '',
  category: sourceType === 'invoice_payment' ? 'other_income' : 'office',
  amount: '',
  taxRate: String(sourceType === 'invoice_payment'
    ? resolveTaxParams(new Date().getFullYear()).params.vat.zeroRate
    : resolveTaxParams(new Date().getFullYear()).params.vat.standardRate),
  notes: '',
  sourceType,
  sourceId: '',
  correctionReason: '',
  customerId: '',
  vatFields: { vatTreatment: null, netAmount: null, vatAmount: null, inputTaxDeductible: null, documentDate: null },
});

const dateKey = (value: Date | string) => String(value).slice(0, 10);
const getEuerInfoNoticeId = (year: number) => `euer-automatic-documents-${year}`;
const sourceLabels: Record<EuerEntrySourceType, string> = {
  manual: 'Manuell',
  invoice_payment: 'Rechnungszahlung',
  receipt: 'Beleg',
  correction: 'Korrektur',
  recurring_expense: 'Fixkosten',
  vat_payment: 'Umsatzsteuer',
};

interface EuerManagementProps {
  onNavigate?: (page: string, filter?: string) => void;
  /** `new` öffnet direkt eine neue Ausgabe (Schnellzugriff der Übersicht). */
  initialAction?: string;
}

export function EuerManagement({ onNavigate, initialAction }: EuerManagementProps) {
  const { confirm, notify } = useFeedback();
  const { can, workspace } = useAuth();
  const workspaceId = workspace?.id ?? null;
  const { invoices, refreshInvoices } = useInvoices();
  const { company } = useCompany();
  const currentYear = new Date().getFullYear();
  const locale = company?.locale || 'de-DE';
  const { ref: tableRef, width: tableWidth } = useElementWidth<HTMLDivElement>();
  const showInlineActions = tableWidth >= EUER_TABLE_LAYOUT.inlineActionsMinWidth;
  const [year, setYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [vatIncompleteOnly, setVatIncompleteOnly] = useState(initialAction === 'vat-incomplete');
  const [showVoided, setShowVoided] = useState(false);
  const [allEntries, setEntries] = useState<EuerEntry[]>([]);
  const entries = useMemo(() => allEntries.filter(entry => Number(entry.euerYear ?? dateKey(entry.entryDate).slice(0, 4)) === year), [allEntries, year]);
  const activeEntries = useMemo(() => entries.filter(isActiveEuerEntry), [entries]);
  const paymentEntries = useMemo(() => allEntries.filter(entry => isActiveEuerEntry(entry)
    && entry.sourceType === 'invoice_payment' && entry.entryType === 'income'
    && entry.sourceId && Number(entry.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(dateKey(entry.entryDate))), [allEntries]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [entriesLoadedScope, setEntriesLoadedScope] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isImportOpen, setIsImportOpen] = useState(false);
  const { customers } = useCustomers();
  const terminology = getTerminology(company?.terminologyProfile);
  const customerNames = useMemo(() => new Map(customers.map(customer => [customer.id, customer.name])), [customers]);
  const [infoNoticeDismissed, setInfoNoticeDismissed] = useState(() => isNoticeDismissed(getEuerInfoNoticeId(currentYear)));
  const [dialogEntry, setDialogEntry] = useState<EuerEntry | null | undefined>(undefined);
  const [quickExpenseMonth, setQuickExpenseMonth] = useState<number | null>(null);
  const isQuickExpense = quickExpenseMonth !== null && !dialogEntry;
  const [draft, setDraft] = useState<EntryDraft>(emptyDraft());
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const isEntryDialogOpen = dialogEntry !== undefined;
  useEffect(() => {
    if (!isEntryDialogOpen) return;
    let active = true;
    apiService.getReceipts().then(list => { if (active) setReceipts(list); }).catch(() => { if (active) setReceipts([]); });
    return () => { active = false; };
  }, [isEntryDialogOpen]);
  // Offene Belege: noch nicht mit einer aktiven EÜR-Buchung verknüpft; der Beleg dieser Buchung bleibt wählbar.
  const receiptOptions = useMemo(() => receipts.filter(receipt => !receipt.linkedEuerEntryId || receipt.linkedEuerEntryId === dialogEntry?.id || receipt.id === draft.sourceId), [receipts, dialogEntry, draft.sourceId]);
  const [historyEntry, setHistoryEntry] = useState<EuerEntry | null>(null);
  const [history, setHistory] = useState<EuerEntryHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [expenseTemplateEntry, setExpenseTemplateEntry] = useState<EuerEntry | null>(null);
  const [allowanceDialogOpen, setAllowanceDialogOpen] = useState(false);
  const [documentPreview, setDocumentPreview] = useState<{ isOpen: boolean; documents: PreviewDocument[] }>({ isOpen: false, documents: [] });
  const [previewLoadingInvoiceId, setPreviewLoadingInvoiceId] = useState<string | null>(null);
  const templateWorkspace = useRef(workspace?.id ?? null);
  const entryRequestVersion = useRef(0);
  const historyRequestVersion = useRef(0);
  templateWorkspace.current = workspace?.id ?? null;
  const currentEntriesScope = `${workspaceId ?? ''}:${year}`;
  const entriesReady = !loading && entriesLoadedScope === currentEntriesScope;


  const formatAmount = useCallback((amount: number) => formatCurrency(amount, locale, company?.numberFormat, company?.currency), [locale, company?.numberFormat, company?.currency]);
  // Zehn Jahre, damit auch übernommene Altdaten erreichbar sind.
  const years = Array.from({ length: 10 }, (_, index) => currentYear - index);
  const invoiceOptions = useMemo(() => invoices.filter(invoice => invoice.documentType !== 'credit_note'), [invoices]);
  const paymentTotals = useMemo(() => {
    const totals = new Map<string, number>();
    paymentEntries.forEach(entry => {
      if (!entry.sourceId) return;
      totals.set(entry.sourceId, (totals.get(entry.sourceId) || 0) + Number(entry.amount || 0));
    });
    return totals;
  }, [paymentEntries]);
  const getRemainingAmount = useCallback((invoice: { id: string; total: number }, excludingEntryId?: string) => {
    const excluded = excludingEntryId ? paymentEntries.find(entry => entry.id === excludingEntryId && entry.sourceId === invoice.id) : undefined;
    return Math.max(0, Math.round(Number(invoice.total || 0) * 100) - Math.round((paymentTotals.get(invoice.id) || 0) * 100) + Math.round(Number(excluded?.amount || 0) * 100)) / 100;
  }, [paymentEntries, paymentTotals]);
  const entriesById = useMemo(() => new Map(entries.map(entry => [entry.id, entry])), [entries]);

  const loadEntries = useCallback(async () => {
    const request = ++entryRequestVersion.current;
    const targetWorkspace = workspaceId;
    setLoading(true);
    setEntriesLoadedScope(null);
    setError('');
    try {
      const [entryData, creditNoteData] = await Promise.all([
        apiService.getEuerEntries(undefined, true),
        apiService.getCreditNotes(),
      ]);
      if (entryRequestVersion.current !== request || templateWorkspace.current !== targetWorkspace) return;
      setEntries(entryData);
      setCreditNotes(creditNoteData);
      setEntriesLoadedScope(`${targetWorkspace ?? ''}:${year}`);
    } catch (loadError) {
      if (entryRequestVersion.current === request && templateWorkspace.current === targetWorkspace) setError(loadError instanceof Error ? loadError.message : 'EÜR-Buchungen konnten nicht geladen werden.');
    } finally {
      if (entryRequestVersion.current === request && templateWorkspace.current === targetWorkspace) setLoading(false);
    }
  }, [year, workspaceId]);

  useEffect(() => {
    historyRequestVersion.current += 1;
    entryRequestVersion.current += 1; setSelectedMonth(null); setEntries([]); setCreditNotes([]); setError(''); setNotice(''); setHistoryEntry(null); setHistory([]); setExpenseTemplateEntry(null); setAllowanceDialogOpen(false); setBusy(false); setDialogEntry(undefined); setQuickExpenseMonth(null); setDraft(emptyDraft()); setIsImportOpen(false); setLoading(true);
    void loadEntries(); return () => { entryRequestVersion.current += 1; };
  }, [loadEntries]);
  useEffect(() => {
    if (initialAction === 'vat-incomplete') { setVatIncompleteOnly(true); return; }
    if (initialAction !== 'new') return;
    setDraft(emptyDraft());
    setDialogEntry(null);
    setError('');
  }, [initialAction]);
  useEffect(() => { setInfoNoticeDismissed(isNoticeDismissed(getEuerInfoNoticeId(year))); }, [year]);

  const legacyPaidInvoices = invoiceOptions.filter(invoice => invoice.status === 'paid' && getRemainingAmount(invoice) > 0.005);
  const legacyPaidCreditNotes = creditNotes.filter(note => note.status === 'paid');

  const allRows = useMemo<EuerRow[]>(() => {
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
        sourceLabel: entry.category === 'allowance'
          ? 'Pauschale'
          : sourceInvoice
          ? `${sourceLabels.invoice_payment} · ${sourceInvoice.invoiceNumber}`
          : entry.customerId && customerNames.get(entry.customerId)
            ? `${sourceLabels[entry.sourceType || 'manual']} · ${customerNames.get(entry.customerId)}`
            : sourceLabels[entry.sourceType || 'manual'],
        sourceId: entry.sourceId,
        invoiceId: sourceInvoice?.id,
        status: entry.status,
      };
    });
    return manualRows.sort((a, b) => b.entryDate.localeCompare(a.entryDate)
      || b.id.localeCompare(a.id, 'de-DE', { numeric: true, sensitivity: 'base' }));
  }, [customerNames, entries, invoiceOptions]);

  // Der Filter erweitert ausschließlich die Nachweisliste, niemals Summen oder Exporte.
  const rows = useMemo(() => allRows.filter(isActiveEuerEntry), [allRows]);
  const listedRows = showVoided ? allRows : rows;

  const monthFilteredRows = selectedMonth === null
    ? listedRows
    : listedRows.filter(row => Number(row.entryDate.slice(5, 7)) - 1 === selectedMonth);
  const incompleteRows = monthFilteredRows.filter(row => {
    const entry = entriesById.get(row.id);
    return entry && isActiveEuerEntry(entry) ? needsVatData(entry, Boolean(company?.isSmallBusiness)) : false;
  });
  const incompleteCount = incompleteRows.length;
  const visibleRows = vatIncompleteOnly ? incompleteRows : monthFilteredRows;
  const monthPrefix = selectedMonth === null ? null : `Im ${monthLabel(locale, year, selectedMonth)}`;
  const hasEuerYearShift = activeEntries.some(entry => entry.euerYear && entry.euerYear !== Number(dateKey(entry.entryDate).slice(0, 4)));
  const emptyBookingsMessage = vatIncompleteOnly
    ? monthPrefix ? `${monthPrefix} sind keine Buchungen mit unvollständigen USt-Angaben vorhanden.` : 'Keine Buchungen mit unvollständigen USt-Angaben.'
    : monthPrefix ? `${monthPrefix} sind keine Buchungen vorhanden.` : 'Keine Buchungen in diesem Zeitraum.';

  const summary = useMemo(() => {
    const income = rows.filter(row => row.entryType === 'income').reduce((sum, row) => sum + row.amount, 0);
    const expenses = rows.filter(row => row.entryType === 'expense').reduce((sum, row) => sum + row.amount, 0);
    return { income, expenses, profit: income - expenses, count: rows.length };
  }, [rows]);

  const monthly = useMemo(() => Array.from({ length: 12 }, (_, month) => {
    const monthRows = rows.filter(row => Number(row.entryDate.slice(5, 7)) - 1 === month);
    const income = monthRows.filter(row => row.entryType === 'income').reduce((sum, row) => sum + row.amount, 0);
    const expenses = monthRows.filter(row => row.entryType === 'expense').reduce((sum, row) => sum + row.amount, 0);
    return { month, income, expenses, profit: income - expenses, bookingCount: monthRows.length };
  }), [rows]);
  const activeAverageMonthCount = year === currentYear
    ? new Date().getMonth() + 1
    : monthly.filter(item => item.bookingCount > 0).length;
  const yearlyMonthlyAverage = {
    income: summary.income / 12,
    expenses: summary.expenses / 12,
    profit: summary.profit / 12,
  };
  const activeMonthlyAverage = activeAverageMonthCount > 0 ? {
    income: summary.income / activeAverageMonthCount,
    expenses: summary.expenses / activeAverageMonthCount,
    profit: summary.profit / activeAverageMonthCount,
  } : null;
  const activeAverageLabel = activeAverageMonthCount === 0
    ? 'Noch keine Buchungsmonate'
    : `über ${activeAverageMonthCount} ${activeAverageMonthCount === 1 ? 'Monat' : 'Monate'}`;

  const openInvoicePreview = async (invoiceId: string) => {
    const invoice = invoices.find(item => item.id === invoiceId) || creditNotes.find(item => item.id === invoiceId);
    if (!invoice) {
      notify({ variant: 'warning', message: 'Die zugehörige Rechnung ist nicht mehr verfügbar.' });
      return;
    }
    if (invoice.origin === 'imported') {
      if (!invoice.hasOriginalDocument) {
        notify({ variant: 'warning', message: `Für die übernommene Rechnung ${invoice.invoiceNumber} ist kein Original-PDF hinterlegt.` });
        return;
      }
      setPreviewLoadingInvoiceId(invoice.id);
      try {
        const { blob, name } = await loadImportedInvoiceOriginal(invoice);
        setDocumentPreview({
          isOpen: true,
          documents: [{ id: `original-${invoice.id}`, name, type: 'attachment', content: await blobToBase64(blob), contentType: blob.type, size: blob.size }],
        });
      } catch (previewError) {
        notify({ variant: 'error', message: previewError instanceof Error ? previewError.message : 'Das Rechnungsoriginal konnte nicht geladen werden.' });
      } finally {
        setPreviewLoadingInvoiceId(null);
      }
      return;
    }
    setDocumentPreview({ isOpen: true, documents: createInvoiceAttachmentPreviewDocuments(invoice) });
  };

  const checkHints = useMemo(() => {
    const hints: string[] = [];
    activeEntries.forEach(entry => {
      if (!entry.notes?.trim() && entry.sourceType !== 'invoice_payment') hints.push(`„${entry.description}“ hat noch keinen Beleg- oder Notizhinweis.`);
      if (entry.entryType === 'expense' && entry.category === 'other_expense') hints.push(`„${entry.description}“ nutzt noch die allgemeine Kategorie.`);
      if (entry.sourceType === 'invoice_payment' && !entry.sourceId) hints.push(`„${entry.description}“ ist als Rechnungszahlung erfasst, aber keiner Rechnung zugeordnet.`);
    });
    invoiceOptions.forEach(invoice => {
      const paidAmount = paymentTotals.get(invoice.id) || 0;
      if (paidAmount > Number(invoice.total || 0) + 0.01) hints.push(`Rechnungszahlungen zu ${invoice.invoiceNumber} überschreiten den Rechnungsbetrag.`);
      const remaining = getRemainingAmount(invoice);
      if (invoice.status === 'paid' && remaining > 0.005) hints.push(`Bei ${invoice.invoiceNumber} fehlen noch ${formatAmount(remaining)} an erfassten Zahlungseingängen.`);
    });
    return hints;
  }, [activeEntries, invoiceOptions, paymentTotals, formatAmount, getRemainingAmount]);

  const openNew = () => { setQuickExpenseMonth(null); setDraft(emptyDraft()); setDialogEntry(null); setError(''); };
  const openExpenseForMonth = (month: number) => {
    setSelectedMonth(month); setQuickExpenseMonth(month); setDraft({ ...emptyDraft(), entryDate: '' }); setDialogEntry(null); setError('');
  };
  const openPayment = (invoiceId?: string) => {
    setQuickExpenseMonth(null);
    const invoice = invoiceOptions.find(item => item.id === invoiceId);
    const paymentDraft = emptyDraft('invoice_payment');
    setDraft(invoice ? { ...paymentDraft, sourceId: invoice.id, description: `Zahlung Rechnung ${invoice.invoiceNumber}`, amount: String(getRemainingAmount(invoice)), entryDate: '', taxRate: Number(invoice.subtotal) > 0 ? String(Number(((Number(invoice.taxAmount || 0) / Number(invoice.subtotal)) * 100).toFixed(2))) : paymentDraft.taxRate } : paymentDraft);
    setDialogEntry(null); setError('');
  };
  const addExpenseAction = (month: number, mobile = false) => can('data.write') && (
    <button type="button" aria-label={`Ausgabe für ${monthLabel(locale, year, month)} hinzufügen`} title={`Ausgabe für ${monthLabel(locale, year, month)} hinzufügen`} disabled={!entriesReady || busy} onClick={() => openExpenseForMonth(month)} className={mobile ? 'inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 text-primary-custom transition hover:border-primary-custom hover:bg-primary-light-custom focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-custom disabled:cursor-not-allowed disabled:opacity-50 sm:px-2.5' : 'pointer-events-none absolute inset-y-0 right-0 inline-flex min-h-8 min-w-8 items-center justify-center gap-1.5 rounded-md border border-primary-custom bg-white px-2 text-sm font-medium text-primary-custom opacity-0 shadow-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-custom disabled:cursor-not-allowed disabled:opacity-50 2xl:whitespace-nowrap'}>
      <Plus className="h-4 w-4 shrink-0" aria-hidden="true" /><span className={mobile ? 'sr-only' : 'hidden 2xl:inline'}>Ausgaben</span>
    </button>
  );
  const homeOfficeEntries = entries.filter(entry => isHomeOfficeAllowanceEntry(entry, year));
  const saveAllowance = async (payload: EuerEntryPayload, existingEntryId?: string) => {
    if (existingEntryId) {
      const updated = await apiService.updateEuerEntry(existingEntryId, payload);
      setEntries(current => current.map(entry => entry.id === updated.id ? updated : entry));
      setNotice('Homeoffice-Pauschalposten wurde aktualisiert.');
      return;
    }
    const created = await apiService.createEuerEntry(payload);
    setEntries(current => [created, ...current]);
    setNotice('Pauschale wurde für das ausgewählte EÜR-Jahr erfasst.');
  };
  const removeHomeOfficeEntry = async (entryId: string) => {
    await apiService.deleteEuerEntry(entryId, 'Homeoffice-Pauschale ohne gespeicherte Tagesnachweise storniert');
    setEntries(current => current.map(entry => entry.id === entryId ? { ...entry, status: 'voided' } : entry));
    setNotice('Homeoffice-Pauschalposten wurde storniert und bleibt im Änderungsverlauf erhalten.');
  };
  const openCorrection = (entry: EuerEntry) => {
    setQuickExpenseMonth(null);
    if (!isActiveEuerEntry(entry)) return;
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
      customerId: '',
      vatFields: { vatTreatment: entry.vatTreatment ?? null, netAmount: entry.netAmount ?? null, vatAmount: entry.vatAmount ?? null, inputTaxDeductible: entry.inputTaxDeductible ?? null, documentDate: entry.documentDate ?? null },
    });
    setDialogEntry(null);
    setError('');
  };
  const openEdit = (entry: EuerEntry) => {
    if (entry.sourceType === 'vat_payment' || !isActiveEuerEntry(entry)) return;
    setQuickExpenseMonth(null);
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
      customerId: entry.customerId || '',
      vatFields: { vatTreatment: entry.vatTreatment ?? null, netAmount: entry.netAmount ?? null, vatAmount: entry.vatAmount ?? null, inputTaxDeductible: entry.inputTaxDeductible ?? null, documentDate: entry.documentDate ?? null },
    });
    setDialogEntry(entry);
    setError('');
  };
  const closeDialog = () => { setDialogEntry(undefined); setQuickExpenseMonth(null); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const amount = parseLocalizedNumber(draft.amount, locale, company?.numberFormat);
    const taxRate = parseLocalizedNumber(draft.taxRate, locale, company?.numberFormat);
    if (!draft.entryDate || !draft.description.trim() || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      setError('Bitte Datum, Beschreibung, Betrag und MwSt.-Satz prüfen.');
      return;
    }
    if (!dialogEntry && draft.sourceType !== 'invoice_payment' && draft.sourceType !== 'vat_payment' && !company?.isSmallBusiness && !draft.vatFields.vatTreatment) { setError('Bitte die Umsatzsteuer-Behandlung auswählen.'); return; }
    if (draft.sourceType !== 'invoice_payment' && draft.sourceType !== 'vat_payment') {
      const vatError = validateVatAmounts({ entryType: draft.entryType, amount, ...draft.vatFields });
      if (vatError) { setError(vatError); return; }
      if (draft.entryType === 'expense' && ['taxable', 'reverse_charge_eu', 'reverse_charge_domestic'].includes(String(draft.vatFields.vatTreatment)) && draft.vatFields.inputTaxDeductible == null) { setError('Bitte angeben, ob Vorsteuer abziehbar ist.'); return; }
    }
    if (draft.sourceType === 'receipt' && !draft.sourceId) { setError('Bitte den Beleg auswählen oder Ohne Beleg wählen.'); return; }
    if (draft.sourceType === 'correction' && !draft.correctionReason.trim()) {
      setError('Für eine Korrektur ist ein Korrekturgrund erforderlich.');
      return;
    }
    if (draft.sourceType === 'invoice_payment') {
      if (amount <= 0) { setError('Der Zahlungsbetrag muss größer als 0 € sein.'); return; }
      if (!draft.sourceId) { setError('Bitte ordnen Sie die Zahlung einer Rechnung zu.'); return; }
      const invoice = invoiceOptions.find(item => item.id === draft.sourceId);
      const currentPaymentAmount = dialogEntry?.sourceType === 'invoice_payment' && dialogEntry.sourceId === invoice?.id ? Number(dialogEntry.amount || 0) : 0;
      const availableAmount = invoice ? getRemainingAmount(invoice) + currentPaymentAmount : 0;
      if (invoice && amount > availableAmount + 0.01) {
        setError(`Der Zahlungsbetrag darf den verfügbaren Rechnungsbetrag von ${formatAmount(availableAmount)} nicht überschreiten.`);        return;
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
      customerId: draft.entryType === 'income' && draft.sourceType === 'manual' ? (draft.customerId || null) : null,
      documentDate: draft.vatFields.documentDate || null,
      vatTreatment: draft.vatFields.vatTreatment || null,
      netAmount: draft.vatFields.netAmount ?? null,
      vatAmount: draft.vatFields.vatAmount ?? null,
      inputTaxDeductible: draft.vatFields.inputTaxDeductible ?? null,
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
        setEntries(current => {
          const without = current.filter(item => item.id !== created.id);
          return Number(created.euerYear ?? String(created.entryDate).slice(0, 4)) === year ? [created, ...without] : without;
        });
        const paymentYear = Number(String(payload.entryDate).slice(0, 4));
        setNotice(payload.sourceType === 'invoice_payment' ? `Rechnungszahlung wurde für ${paymentYear} gespeichert.${paymentYear !== year ? ` Wählen Sie ${paymentYear}, um die Zahlung in der EÜR zu sehen.` : ''}` : 'EÜR-Buchung wurde gespeichert.');      }
      closeDialog();
      if (payload.sourceType === 'invoice_payment' || dialogEntry?.sourceType === 'invoice_payment') {
        await refreshInvoices().catch(() => setError('Die Buchung wurde gespeichert. Der Rechnungsstatus konnte noch nicht aktualisiert werden; lade die Seite neu.'));
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'EÜR-Buchung konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: EuerRow) => {
    if (entry.automatic || entry.status === 'voided' || entriesById.get(entry.id)?.sourceType === 'vat_payment') return;
    const confirmed = await confirm({
      title: 'Buchung stornieren',
      message: `„${entry.description}“ stornieren? Die Buchung bleibt in der Historie erhalten.`,
      confirmText: 'Stornieren',
      isDestructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await apiService.deleteEuerEntry(entry.id, 'Stornierung durch Benutzer');
      setEntries(current => current.map(item => item.id === entry.id ? { ...item, status: 'voided' } : item));
      setNotice('EÜR-Buchung wurde storniert. Über „Stornierte Buchungen anzeigen“ bleibt der Änderungsverlauf erreichbar.');
      if (entriesById.get(entry.id)?.sourceType === 'invoice_payment') {
        await refreshInvoices().catch(() => setError('Die Buchung wurde storniert. Der Rechnungsstatus konnte noch nicht aktualisiert werden; lade die Seite neu.'));
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'EÜR-Buchung konnte nicht storniert werden.');
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async (entry: EuerEntry) => {
    const request = ++historyRequestVersion.current;
    const targetWorkspace = workspaceId;
    setHistoryEntry(entry);
    setHistory([]);
    setHistoryError('');
    setHistoryLoading(true);
    try {
      const loadedHistory = await apiService.getEuerEntryHistory(entry.id);
      if (request === historyRequestVersion.current && templateWorkspace.current === targetWorkspace) setHistory(loadedHistory);
    } catch (historyError) {
      if (request === historyRequestVersion.current && templateWorkspace.current === targetWorkspace) setHistoryError(historyError instanceof Error ? historyError.message : 'Der Änderungsverlauf konnte nicht geladen werden.');
    } finally {
      if (request === historyRequestVersion.current && templateWorkspace.current === targetWorkspace) setHistoryLoading(false);
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
    const header = ['Datum', 'Typ', 'Beschreibung', 'Kategorie', 'Betrag brutto', 'Netto', 'USt', 'USt-Behandlung', 'MwSt.-Satz', 'Quelle', 'Quell-ID', 'Notiz'];
    const csvRows = rows.map(row => {
      const entry = entriesById.get(row.id);
      return [
      row.entryDate,
      row.entryType === 'income' ? 'Einnahme' : 'Ausgabe',
      row.description,
      categoryLabels[row.category],
      row.amount.toFixed(2).replace('.', ','),
      entry?.netAmount == null ? '' : entry.netAmount.toFixed(2).replace('.', ','),
      entry?.vatAmount == null ? '' : entry.vatAmount.toFixed(2).replace('.', ','),
      entry?.vatTreatment || '',
      `${row.taxRate}`,
      row.sourceLabel || 'Manuell',
      row.sourceId || '',
      row.notes || '',
    ]; });
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
    doc.text('Netto / USt', pageWidth - 65, cursor, { align: 'right' });
    doc.text('Betrag', pageWidth - 14, cursor, { align: 'right' });
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
      const vatEntry = entriesById.get(row.id);
      doc.text(vatEntry?.netAmount != null || vatEntry?.vatAmount != null ? `${formatAmount(vatEntry.netAmount || 0)} / ${formatAmount(vatEntry.vatAmount || 0)}` : '—', pageWidth - 65, cursor, { align: 'right' });
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

  return <div className="page-root space-y-6">
    <PageHeader icon={Calculator} title="Einnahmenüberschussrechnung" shortTitle="EÜR" subtitle="Einnahmen minus Betriebsausgaben – einfach online vorbereiten">
      <select value={year} onChange={event => setYear(Number(event.target.value))} className="form-input select-compact h-11 w-[5.25rem] shrink-0 pl-3 text-sm sm:w-auto" aria-label="Jahr auswählen" title="Jahr auswählen">
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
        {can('data.write') && <ActionMenuItem icon={<Calculator className="h-4 w-4" />} tone="indigo" disabled={!entriesReady} onClick={() => setAllowanceDialogOpen(true)}>Pauschale erfassen</ActionMenuItem>}
        <ActionMenuItem icon={<FileScan className="h-4 w-4" />} tone="blue" onClick={() => onNavigate?.('receipts')}>Beleg hinzufügen</ActionMenuItem>
        <ActionMenuItem icon={<ReceiptText className="h-4 w-4" />} tone="green" disabled={!entriesReady} onClick={() => openPayment()}>Rechnungszahlung</ActionMenuItem>
        <ActionMenuItem icon={<Upload className="h-4 w-4" />} tone="indigo" onClick={() => setIsImportOpen(true)}>Aus Datei importieren</ActionMenuItem>
      </ActionMenu>
    </PageHeader>
    <ImportWizard
      resource="euerEntries"
      isOpen={isImportOpen}
      onClose={() => setIsImportOpen(false)}
      onImported={async () => {
        setNotice('Einnahmen und Ausgaben wurden importiert.');
        await loadEntries();
      }}
    />
    {allowanceDialogOpen && <EuerAllowanceDialog
      key={`${workspaceId ?? 'none'}:${year}`}
      year={year}
      locale={locale}
      timeZone={company?.timeZone}
      numberFormat={company?.numberFormat}
      canWrite={can('data.write')}
      entriesReady={entriesReady}
      existingHomeOfficeEntries={homeOfficeEntries}
      onClose={() => setAllowanceDialogOpen(false)}
      onSave={saveAllowance}
      onRemoveExistingHomeOfficeEntry={removeHomeOfficeEntry}
    />}

    {!infoNoticeDismissed && <section className="relative rounded-xl border border-blue-100 bg-blue-50 p-5 pr-14">
      <button type="button" onClick={() => { dismissNotice(getEuerInfoNoticeId(year)); setInfoNoticeDismissed(true); }} className="absolute right-4 top-4 rounded-md p-1 text-blue-700 transition-colors hover:bg-blue-100" aria-label="Hinweis schließen"><X className="h-5 w-5" /></button>
      <div className="flex items-start gap-3"><Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" /><div><h2 className="font-semibold text-blue-950">Ihre EÜR für {year}</h2><p className="mt-1 text-sm leading-5 text-blue-900 sm:leading-6">Erfasste Zahlungen, Belege und Geschäftsvorfälle bilden Ihre EÜR. Ein Rechnungsstatus allein erzeugt keine Einnahme; erfassen Sie Zahlungen mit dem tatsächlichen Zahlungsdatum.</p></div></div>
    </section>}

    {entriesReady && legacyPaidInvoices.length > 0 && <Notice variant="warning" title={`Zahlung nachtragen (${legacyPaidInvoices.length})`}>
      <p>Bei diesen als bezahlt markierten Rechnungen fehlen Zahlungsbuchungen für den gesamten Betrag oder einen Restbetrag. Nur bereits erfasste Zahlungen sind in den EÜR-Summen enthalten. Tragen Sie den fehlenden Betrag mit dem tatsächlichen Zahlungsdatum nach.</p>
      {can('data.write') && <ul className="mt-3 divide-y divide-amber-200">{legacyPaidInvoices.map(invoice => (
        <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
          <span className="min-w-0 text-sm"><span className="font-medium">{invoice.invoiceNumber}</span> · {invoice.customerName} · fehlt {formatAmount(getRemainingAmount(invoice))}</span>
          <button type="button" onClick={() => openPayment(invoice.id)} className="action-button">Zahlung nachtragen</button>
        </li>
      ))}</ul>}
    </Notice>}
    {entriesReady && legacyPaidCreditNotes.length > 0 && <Notice variant="warning" title={`Gutschriften prüfen (${legacyPaidCreditNotes.length})`}>
      <p>Der Status „Bezahlt“ allein belegt keine Rückzahlung oder Verrechnung. Diese Gutschriften erzeugen hier keine automatische Buchung. Prüfen Sie den tatsächlichen Vorgang.</p>
      <button type="button" onClick={() => onNavigate?.('credit-notes')} className="action-button mt-3">Gutschriften öffnen</button>
    </Notice>}

    {notice && <Notice variant="success" onDismiss={() => setNotice('')}>{notice}</Notice>}
    {error && <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Fehler schließen"><X className="h-4 w-4" /></button></div>}

    <DueRecurringExpensesNotice onBooked={() => { void loadEntries(); }} />

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-sm text-gray-500"><TrendingUp className="h-4 w-4 text-emerald-600" />Einnahmen</div><p className="mt-3 text-2xl font-bold text-emerald-700">{formatAmount(summary.income)}</p></article>
      <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-sm text-gray-500"><TrendingDown className="h-4 w-4 text-rose-600" />Ausgaben</div><p className="mt-3 text-2xl font-bold text-rose-700">{formatAmount(summary.expenses)}</p></article>
      <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-sm text-gray-500"><Calculator className="h-4 w-4 text-primary-custom" />Überschuss</div><p className={`mt-3 text-2xl font-bold ${summary.profit >= 0 ? 'text-gray-900' : 'text-rose-700'}`}>{formatAmount(summary.profit)}</p></article>
      <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div className="text-sm text-gray-500">Buchungen</div><p className="mt-3 text-2xl font-bold text-gray-900">{summary.count}</p><p className="mt-1 text-xs text-gray-500">aktive Einnahmen und Ausgaben</p></article>
    </div>

    {checkHints.length > 0 && <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div><h2 className="font-semibold text-amber-950">Prüfhinweise ({checkHints.length})</h2><p className="mt-1 text-sm text-amber-900">Diese Hinweise helfen bei der Vorbereitung und ersetzen keine steuerliche Prüfung.</p><ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">{checkHints.slice(0, 6).map(hint => <li key={hint}>{hint}</li>)}</ul>{checkHints.length > 6 && <p className="mt-2 text-xs text-amber-800">Weitere Hinweise sind im Steuerberater-Export enthalten.</p>}</div></div></section>}

    <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold text-gray-900">Monatsübersicht</h2><p className="mt-1 text-sm text-gray-500">Schneller Überblick über Einnahmen, Ausgaben und Überschuss. Ein Klick auf einen Monat filtert die Buchungen darunter.</p>{hasEuerYearShift && <p className="mt-1 text-xs text-gray-500">Monatswerte folgen dem Buchungsdatum. Einzelne Zahlungen können nach § 11 EStG einem anderen EÜR-Jahr zugeordnet sein.</p>}</div>
          <ActionMenu ariaLabel="Steuerberater-Export öffnen" title="Steuerberater-Export" icon={<Download className="h-4 w-4" />} containerClassName="shrink-0" menuClassName="min-w-56">
            <ActionMenuItem icon={<Download className="h-4 w-4" />} tone="blue" onClick={exportCsv}>CSV Steuerberater</ActionMenuItem>
            <ActionMenuItem icon={<FileJson className="h-4 w-4" />} tone="indigo" onClick={exportJson}>JSON Steuerberater</ActionMenuItem>
            <ActionMenuItem icon={<FileText className="h-4 w-4" />} tone="green" onClick={exportPdf}>PDF Steuerberater</ActionMenuItem>
          </ActionMenu>
        </div>
        <div className="mt-5 hidden overflow-x-auto xl:block">
          <table className="w-full min-w-[640px]">
            <thead className="bg-gray-50"><tr><th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Monat</th><th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Einnahmen</th><th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Ausgaben</th><th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Überschuss</th></tr></thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {monthly.map(item => <tr key={item.month} className={selectedMonth === item.month ? 'bg-primary-light-custom' : 'hover:bg-gray-50'}>
                <td className="px-4 py-3 font-medium text-gray-900"><button type="button" aria-pressed={selectedMonth === item.month} onClick={() => setSelectedMonth(current => current === item.month ? null : item.month)} className="rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-custom">{monthLabel(locale, year, item.month)}</button></td>
                <td className="px-4 py-3 text-right text-emerald-700">{formatAmount(item.income)}</td>
                <td className="px-4 py-3 text-right text-rose-700">
                  <div className="group relative flex min-h-8 items-center justify-end">
                    <span className={can('data.write') ? 'transition-opacity group-hover:opacity-0 group-focus-within:opacity-0' : ''}>{formatAmount(item.expenses)}</span>
                    {addExpenseAction(item.month)}
                  </div>
                </td>
                <td className={`px-4 py-3 text-right font-medium ${item.profit >= 0 ? 'text-gray-900' : 'text-rose-700'}`}>{formatAmount(item.profit)}</td>
              </tr>)}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-gray-50">
              <tr>
                <td className="px-4 py-3 font-semibold text-gray-900"><span className="inline-flex items-center gap-1">Ø pro Monat<FloatingInfoTooltip label="Berechnung des Monatsdurchschnitts" text={MONTHLY_AVERAGE_HELP} /></span></td>
                <td className="px-4 py-3 text-right font-semibold text-emerald-700">{formatAmount(yearlyMonthlyAverage.income)}</td>
                <td className="px-4 py-3 text-right font-semibold text-rose-700">{formatAmount(yearlyMonthlyAverage.expenses)}</td>
                <td className={`px-4 py-3 text-right font-semibold ${yearlyMonthlyAverage.profit >= 0 ? 'text-gray-900' : 'text-rose-700'}`}>{formatAmount(yearlyMonthlyAverage.profit)}</td>
              </tr>
              <tr>
                <td className="px-4 pb-3 pl-4 text-xs font-normal text-gray-500">{activeAverageLabel}</td>
                <td className="px-4 pb-3 text-right text-xs font-medium text-gray-500">{activeMonthlyAverage ? formatAmount(activeMonthlyAverage.income) : '–'}</td>
                <td className="px-4 pb-3 text-right text-xs font-medium text-gray-500">{activeMonthlyAverage ? formatAmount(activeMonthlyAverage.expenses) : '–'}</td>
                <td className="px-4 pb-3 text-right text-xs font-medium text-gray-500">{activeMonthlyAverage ? formatAmount(activeMonthlyAverage.profit) : '–'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="divide-y divide-gray-100 xl:hidden">{monthly.map(item => (
          <article key={item.month} className="py-2 first:pt-0 last:pb-0">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setSelectedMonth(current => current === item.month ? null : item.month)} aria-pressed={selectedMonth === item.month} className={`flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left ${selectedMonth === item.month ? 'bg-primary-light-custom' : ''}`}>
                <span className="font-medium text-gray-900">{monthLabel(locale, year, item.month)}</span>
                <span className={`font-semibold ${item.profit >= 0 ? 'text-gray-900' : 'text-rose-700'}`}>{formatAmount(item.profit)}</span>
              </button>
              {addExpenseAction(item.month, true)}
            </div>
            <p className="mt-0.5 px-2 text-xs text-gray-500">Einnahmen <span className="font-medium text-emerald-700">{formatAmount(item.income)}</span> · Ausgaben <span className="font-medium text-rose-700">{formatAmount(item.expenses)}</span></p>
          </article>
        ))}</div>
        <div className="mt-4 border-t-2 border-gray-200 pt-4 xl:hidden">
          <div className="flex items-start justify-between gap-3">
            <span><span className="inline-flex items-center gap-1 font-semibold text-gray-900">Ø pro Monat<FloatingInfoTooltip label="Berechnung des Monatsdurchschnitts" text={MONTHLY_AVERAGE_HELP} /></span><span className="mt-1 block text-xs font-normal text-gray-500">{activeAverageLabel}</span></span>
            <span className="text-right">
              <span className={`block font-semibold ${yearlyMonthlyAverage.profit >= 0 ? 'text-gray-900' : 'text-rose-700'}`}>{formatAmount(yearlyMonthlyAverage.profit)}</span>
              <span className="mt-1 block text-xs font-normal text-gray-500">{activeMonthlyAverage ? formatAmount(activeMonthlyAverage.profit) : '–'}</span>
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-xs text-gray-500">Einnahmen</p><p className="mt-1 font-semibold text-emerald-700">{formatAmount(yearlyMonthlyAverage.income)}</p><p className="mt-1 text-xs text-gray-500">{activeMonthlyAverage ? formatAmount(activeMonthlyAverage.income) : '–'}</p></div>
            <div><p className="text-xs text-gray-500">Ausgaben</p><p className="mt-1 font-semibold text-rose-700">{formatAmount(yearlyMonthlyAverage.expenses)}</p><p className="mt-1 text-xs text-gray-500">{activeMonthlyAverage ? formatAmount(activeMonthlyAverage.expenses) : '–'}</p></div>
          </div>
        </div>
      </div>
    </section>

    <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5"><div><h2 className="text-lg font-semibold text-gray-900">Buchungen</h2><p className="mt-1 text-sm text-gray-500">Erfasste Zahlungen, Belege und weitere Geschäftsvorfälle.</p>{selectedMonth !== null && <p className="mt-2 text-sm text-gray-700">Nur <strong>{monthLabel(locale, year, selectedMonth)}</strong> · {monthFilteredRows.length} {monthFilteredRows.length === 1 ? 'Buchung' : 'Buchungen'} <button type="button" onClick={() => setSelectedMonth(null)} className="ml-2 font-medium text-primary-custom hover:underline">Alle Monate anzeigen</button></p>}</div><button type="button" aria-pressed={vatIncompleteOnly} onClick={() => setVatIncompleteOnly(value => !value)} className={`rounded-lg border px-3 py-2 text-sm ${vatIncompleteOnly ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-gray-300 text-gray-700'}`}>USt unvollständig ({incompleteCount})</button></div>
      <label className="mx-5 mb-4 flex w-fit items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={showVoided} onChange={event => setShowVoided(event.target.checked)} className="rounded border-gray-300 text-primary-custom focus:ring-primary-custom" />Stornierte Buchungen anzeigen</label>
      {loading ? <TableSkeleton rows={6} columns={6} label="EÜR-Buchungen werden geladen …" className="border-t border-gray-100" /> : listedRows.length === 0 ? <EmptyState variant="bars" title={`Für ${year} sind noch keine Buchungen vorhanden.`} action={{ label: 'Buchung erfassen', onClick: openNew }} /> : <>
        <div ref={tableRef} className="hidden w-full min-w-0 max-w-full overflow-hidden xl:block">
          <table className="w-full table-fixed">
            <colgroup>
              <col style={{ width: EUER_COLUMN_WIDTHS.date }} />
              <col />
              <col style={{ width: EUER_COLUMN_WIDTHS.category }} />
              <col style={{ width: EUER_COLUMN_WIDTHS.source }} />
              <col style={{ width: EUER_COLUMN_WIDTHS.amount }} />
              <col style={{ width: showInlineActions ? EUER_TABLE_LAYOUT.actionsColumnWidth : ACTION_MENU_COLUMN_WIDTH }} />
            </colgroup>
            <thead className="bg-gray-50"><tr><th className="whitespace-nowrap px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Datum</th><th className="whitespace-nowrap px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Beschreibung</th><th className="whitespace-nowrap px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Kategorie</th><th className="whitespace-nowrap px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Quelle</th><th className="whitespace-nowrap px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Betrag</th><th style={{ width: showInlineActions ? EUER_TABLE_LAYOUT.actionsColumnWidth : ACTION_MENU_COLUMN_WIDTH }} className={`sticky right-0 z-20 whitespace-nowrap bg-gray-50 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 ${showInlineActions ? 'px-3' : 'px-2'}`}><span className="sr-only">Aktionen</span></th></tr></thead>
            <tbody className="divide-y divide-gray-200 bg-white">{visibleRows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">{emptyBookingsMessage}</td></tr>}{visibleRows.map(row => { const entry = entriesById.get(row.id); return <tr key={row.id} className={`group ${row.status === 'voided' ? 'bg-gray-50' : 'hover:bg-gray-50'}`}><td className="whitespace-nowrap px-3 py-2.5 text-sm text-gray-900">{formatDate(row.entryDate, locale, company?.dateFormat)}</td><td className="max-w-0 px-3 py-2.5 text-sm"><div className="flex min-w-0 items-center gap-1"><div className="min-w-0 truncate font-medium text-gray-900" title={row.description}>{row.description}</div>{row.invoiceId && <button type="button" onClick={() => void openInvoicePreview(row.invoiceId!)} disabled={previewLoadingInvoiceId === row.invoiceId} aria-label="PDF-Vorschau öffnen" title="PDF-Vorschau" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-primary-custom hover:bg-primary-light-custom focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-custom disabled:opacity-60">{previewLoadingInvoiceId === row.invoiceId ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}</button>}</div>{row.status === 'voided' && <span className="mt-1 inline-block text-xs font-medium text-gray-500">Storniert · nicht in den Summen</span>}{row.notes && <div className="mt-1 truncate text-xs text-gray-500" title={row.notes}>{row.notes}</div>}{entry && isActiveEuerEntry(entry) && needsVatData(entry, Boolean(company?.isSmallBusiness)) && <div className="mt-1 text-xs text-amber-700">USt-Angaben unvollständig</div>}{entry?.euerYear && entry.euerYear !== Number(String(entry.entryDate).slice(0, 4)) && <div className="mt-1 text-xs text-gray-500">zählt zu {entry.euerYear} (§ 11 EStG)</div>}</td><td className="max-w-0 px-3 py-2.5 text-sm text-gray-600"><span className="block truncate" title={categoryLabels[row.category]}>{categoryLabels[row.category]}</span></td><td className="max-w-0 px-3 py-2.5 text-xs text-gray-500"><span className="block truncate" title={row.sourceLabel || 'Manuell'}>{row.sourceLabel || 'Manuell'}</span></td><td className={`whitespace-nowrap px-3 py-2.5 text-right text-sm font-medium ${row.status === 'voided' ? 'text-gray-500 line-through' : row.entryType === 'income' ? 'text-emerald-700' : 'text-rose-700'}`}>{row.entryType === 'expense' ? '-' : row.amount < 0 ? '-' : '+'}{formatAmount(Math.abs(row.amount))}</td><td style={{ width: showInlineActions ? EUER_TABLE_LAYOUT.actionsColumnWidth : ACTION_MENU_COLUMN_WIDTH }} className={`sticky right-0 z-10 bg-white py-2.5 text-sm transition-colors group-hover:bg-gray-50 ${showInlineActions ? 'px-3' : 'px-2'}`}>{entry && !isActiveEuerEntry(entry) ? <button type="button" onClick={() => void openHistory(entry)} className="action-icon-button action-icon-blue" aria-label="Änderungsverlauf der stornierten Buchung öffnen" title="Änderungsverlauf" disabled={busy}><History className="h-4 w-4" /></button> : entry && entry.sourceType === 'vat_payment' ? <button type="button" onClick={() => onNavigate?.('vat')} className="action-icon-button action-icon-blue" title="USt-Zahlung verwalten" aria-label="USt-Zahlung in der Umsatzsteuer-Übersicht verwalten"><Landmark className="h-4 w-4" /></button> : entry && (showInlineActions ? <div className="flex flex-nowrap items-center justify-end gap-1"><button type="button" onClick={() => openEdit(entry)} className="action-icon-button action-icon-indigo" title="Bearbeiten" disabled={busy}><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => openCorrection(entry)} className="action-icon-button action-icon-blue" title="Korrektur" disabled={busy}><RotateCcw className="h-4 w-4" /></button><button type="button" onClick={() => void openHistory(entry)} className="action-icon-button action-icon-blue" title="Historie" disabled={busy}><History className="h-4 w-4" /></button>{entry.entryType === 'expense' && entry.category !== 'allowance' && can('data.write') && <button type="button" onClick={() => setExpenseTemplateEntry(entry)} className="action-icon-button action-icon-blue" title="Als Fixkosten speichern" disabled={busy}><CalendarClock className="h-4 w-4" /></button>}<button type="button" onClick={() => void remove(row)} className="action-icon-button action-icon-red" title="Stornieren" disabled={busy}><Trash2 className="h-4 w-4" /></button></div> : <ActionMenu triggerClassName="action-icon-button action-icon-blue"><ActionMenuItem icon={<Pencil className="h-4 w-4" />} tone="indigo" onClick={() => openEdit(entry)} disabled={busy}>Bearbeiten</ActionMenuItem><ActionMenuItem icon={<RotateCcw className="h-4 w-4" />} tone="blue" onClick={() => openCorrection(entry)} disabled={busy}>Korrektur</ActionMenuItem><ActionMenuItem icon={<History className="h-4 w-4" />} tone="blue" onClick={() => void openHistory(entry)} disabled={busy}>Historie</ActionMenuItem>{entry.entryType === 'expense' && entry.category !== 'allowance' && can('data.write') && <ActionMenuItem icon={<CalendarClock className="h-4 w-4" />} tone="blue" onClick={() => setExpenseTemplateEntry(entry)} disabled={busy}>Als Fixkosten speichern</ActionMenuItem>}<ActionMenuItem icon={<Trash2 className="h-4 w-4" />} tone="red" onClick={() => void remove(row)} disabled={busy}>Stornieren</ActionMenuItem></ActionMenu>)}</td></tr>; })}</tbody>
          </table>
        </div>
        <div className="divide-y divide-gray-100 xl:hidden">{visibleRows.length === 0 && <p className="py-8 text-center text-sm text-gray-500">{emptyBookingsMessage}</p>}{visibleRows.map(row => { const entry = entriesById.get(row.id); return <article key={row.id} className={`px-3 py-2.5 ${row.status === 'voided' ? 'bg-gray-50' : ''}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex min-w-0 items-center gap-1"><p className="min-w-0 break-words text-sm font-medium text-gray-900" title={row.description}>{row.description}</p>{row.invoiceId && <button type="button" onClick={() => void openInvoicePreview(row.invoiceId!)} disabled={previewLoadingInvoiceId === row.invoiceId} aria-label="PDF-Vorschau öffnen" title="PDF-Vorschau" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-primary-custom hover:bg-primary-light-custom focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-custom disabled:opacity-60">{previewLoadingInvoiceId === row.invoiceId ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}</button>}</div>{row.status === 'voided' && <span className="mt-1 inline-block text-xs font-medium text-gray-500">Storniert · nicht in den Summen</span>}<p className="mt-0.5 break-words text-xs text-gray-500">{formatDate(row.entryDate, locale, company?.dateFormat)} · {categoryLabels[row.category]} · {row.sourceLabel || 'Manuell'}{row.automatic ? ' · Automatisch' : ''}</p></div><div className="flex shrink-0 items-start gap-2"><p className={`whitespace-nowrap text-sm font-semibold ${row.status === 'voided' ? 'text-gray-500 line-through' : row.entryType === 'income' ? 'text-emerald-700' : 'text-rose-700'}`}>{row.entryType === 'expense' ? '-' : row.amount < 0 ? '-' : '+'}{formatAmount(Math.abs(row.amount))}</p>{entry && !isActiveEuerEntry(entry) ? <button type="button" onClick={() => void openHistory(entry)} className="action-icon-button action-icon-blue" aria-label="Änderungsverlauf der stornierten Buchung öffnen" title="Änderungsverlauf" disabled={busy}><History className="h-4 w-4" /></button> : entry && entry.sourceType === 'vat_payment' ? <button type="button" onClick={() => onNavigate?.('vat')} className="action-icon-button action-icon-blue" title="USt-Zahlung verwalten" aria-label="USt-Zahlung in der Umsatzsteuer-Übersicht verwalten"><Landmark className="h-4 w-4" /></button> : entry && <ActionMenu containerClassName="self-center" triggerClassName="action-icon-button action-icon-blue"><ActionMenuItem icon={<Pencil className="h-4 w-4" />} tone="indigo" onClick={() => openEdit(entry)} disabled={busy}>Bearbeiten</ActionMenuItem><ActionMenuItem icon={<RotateCcw className="h-4 w-4" />} tone="blue" onClick={() => openCorrection(entry)} disabled={busy}>Korrektur</ActionMenuItem><ActionMenuItem icon={<History className="h-4 w-4" />} tone="blue" onClick={() => void openHistory(entry)} disabled={busy}>Historie</ActionMenuItem>{entry.entryType === 'expense' && entry.category !== 'allowance' && can('data.write') && <ActionMenuItem icon={<CalendarClock className="h-4 w-4" />} tone="blue" onClick={() => setExpenseTemplateEntry(entry)} disabled={busy}>Als Fixkosten speichern</ActionMenuItem>}<ActionMenuItem icon={<Trash2 className="h-4 w-4" />} tone="red" onClick={() => void remove(row)} disabled={busy}>Stornieren</ActionMenuItem></ActionMenu>}</div></div>{row.notes && <p className="mt-2 line-clamp-2 text-xs text-gray-500">{row.notes}</p>}{entry && isActiveEuerEntry(entry) && needsVatData(entry, Boolean(company?.isSmallBusiness)) && <p className="mt-2 text-xs text-amber-700">USt-Angaben unvollständig</p>}</article>; })}</div>
      </>}
    </section>

    {dialogEntry !== undefined && (
      <DialogShell
        titleId="euer-entry-dialog-title"
        icon={dialogEntry ? Pencil : draft.sourceType === 'correction' ? RotateCcw : Plus}
        title={isQuickExpense ? 'Ausgabe erfassen' : dialogEntry ? 'EÜR-Buchung bearbeiten' : draft.sourceType === 'invoice_payment' ? 'Rechnungszahlung erfassen' : draft.sourceType === 'correction' ? 'Korrektur erfassen' : 'EÜR-Buchung erfassen'}
        description={undefined}        onClose={closeDialog}
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
              <section className={isQuickExpense ? '' : 'rounded-xl border border-gray-200 bg-white p-5 sm:p-6'} aria-labelledby={isQuickExpense ? undefined : 'euer-entry-data-title'}>
                {!isQuickExpense && <h3 id="euer-entry-data-title" className="mb-3 text-xl font-semibold text-gray-900">Buchungsdaten</h3>}
                <div className="grid gap-4 sm:grid-cols-2">
                  {!isQuickExpense && <label className="text-base font-medium text-gray-700">Art<select value={draft.entryType} onChange={event => { const entryType = event.target.value as EuerEntryType; setDraft(current => ({ ...current, entryType, category: entryType === 'income' ? 'other_income' : current.category === 'other_income' ? 'office' : current.category })); }} className="form-input mt-1 w-full"><option value="expense">Ausgabe</option><option value="income">Einnahme</option></select></label>}
                  <label className="text-base font-medium text-gray-700">{draft.sourceType === 'invoice_payment' ? 'Zahlungsdatum' : 'Datum'}<input required type="date" value={draft.entryDate} onChange={event => setDraft(current => ({ ...current, entryDate: event.target.value }))} className="form-input mt-1 w-full" /></label>
                  <label className="text-base font-medium text-gray-700 sm:col-span-2">Beschreibung<input required value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value, category: current.entryType === 'expense' && (current.category === 'office' || current.category === 'other_expense') ? suggestCategory(event.target.value) : current.category }))} className="form-input mt-1 w-full" placeholder="z. B. Büromaterial" /></label>
                  <label className="text-base font-medium text-gray-700">Kategorie<select value={draft.category} onChange={event => setDraft(current => ({ ...current, category: event.target.value as EuerEntryCategory }))} className="form-input mt-1 w-full">{(draft.entryType === 'income' ? ['other_income'] : expenseCategories).map(category => <option key={category} value={category}>{categoryLabels[category as EuerEntryCategory]}</option>)}</select></label>
                  {draft.entryType === 'expense' && draft.sourceType !== 'invoice_payment' && draft.sourceType !== 'correction' && receiptOptions.length > 0 && (
                    <label className="text-base font-medium text-gray-700 md:col-span-2">Beleg (optional)<select value={draft.sourceType === 'receipt' ? draft.sourceId : ''} onChange={event => {
                      const receipt = receiptOptions.find(item => item.id === event.target.value);
                      setDraft(current => receipt
                        ? { ...current, sourceType: 'receipt', sourceId: receipt.id, description: receipt.extractedData.vendorName || receipt.name, amount: receipt.extractedData.grossAmount != null ? String(receipt.extractedData.grossAmount) : current.amount, taxRate: receipt.extractedData.taxRate != null ? String(receipt.extractedData.taxRate) : current.taxRate, category: receipt.extractedData.suggestedCategory || current.category, vatFields: { ...current.vatFields, documentDate: receipt.extractedData.documentDate || current.vatFields.documentDate } }
                        : { ...current, sourceType: 'manual', sourceId: '' });
                    }} className="form-input mt-1 w-full"><option value="">Ohne Beleg</option>{receiptOptions.map(receipt => <option key={receipt.id} value={receipt.id}>{receipt.extractedData.vendorName || receipt.name}{receipt.extractedData.grossAmount != null ? ` · ${formatAmount(receipt.extractedData.grossAmount)}` : ''}</option>)}</select></label>
                  )}
                  {draft.entryType === 'income' && draft.sourceType === 'manual' && <label className="text-base font-medium text-gray-700 sm:col-span-2">{terminology.entity.singular} (optional)<select value={draft.customerId} onChange={event => setDraft(current => ({ ...current, customerId: event.target.value }))} className="form-input mt-1 w-full"><option value="">Ohne Zuordnung</option>{customers.filter(customer => customer.isActive !== false || customer.id === draft.customerId).map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>}
                  {!isQuickExpense && <label className="text-base font-medium text-gray-700">Buchungsart<select value={draft.sourceType} onChange={event => { const sourceType = event.target.value as EuerEntrySourceType; setDraft(current => ({ ...current, sourceType, sourceId: sourceType === 'invoice_payment' ? current.sourceId : '', entryType: sourceType === 'invoice_payment' ? 'income' : current.entryType, category: sourceType === 'invoice_payment' ? 'other_income' : current.category })); }} className="form-input mt-1 w-full"><option value="manual">Manuelle Buchung</option><option value="invoice_payment">Zahlung zu einer Rechnung</option><option value="correction">Korrektur / Gegenbuchung</option>{draft.sourceType === 'receipt' && <option value="receipt">Mit Beleg verknüpft</option>}</select></label>}
                </div>
              </section>

              {draft.sourceType === 'invoice_payment' && <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-labelledby="euer-entry-source-title">
                <div className="mb-3"><h3 id="euer-entry-source-title" className="text-xl font-semibold text-gray-900">Zuordnung</h3></div>
                <label className="text-base font-medium text-gray-700">Rechnung<select required value={draft.sourceId} onChange={event => { const sourceId = event.target.value; const invoice = invoiceOptions.find(item => item.id === sourceId); const currentPaymentAmount = dialogEntry?.sourceType === 'invoice_payment' && dialogEntry.sourceId === sourceId ? Number(dialogEntry.amount || 0) : 0; const availableAmount = invoice ? getRemainingAmount(invoice) + currentPaymentAmount : 0; setDraft(current => ({ ...current, sourceId, amount: invoice ? String(availableAmount) : '', entryDate: invoice?.status === 'paid' && getRemainingAmount(invoice) > 0.005 ? '' : current.entryDate, description: invoice ? `Zahlung Rechnung ${invoice.invoiceNumber}` : current.description, taxRate: invoice && Number(invoice.subtotal) > 0 ? String(Number(((Number(invoice.taxAmount || 0) / Number(invoice.subtotal)) * 100).toFixed(2))) : current.taxRate })); }} className="form-input mt-1 w-full"><option value="">Rechnung auswählen</option>{invoiceOptions.filter(invoice => invoice.status !== 'draft' && (getRemainingAmount(invoice) > 0.01 || invoice.id === draft.sourceId)).map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {invoice.customerName} · {invoice.status === 'paid' && getRemainingAmount(invoice) > 0.005 ? 'noch zu erfassen' : 'offen'} {formatAmount(getRemainingAmount(invoice))}</option>)}</select></label>
              </section>}

              <section className={isQuickExpense ? '' : 'rounded-xl border border-gray-200 bg-white p-5 sm:p-6'} aria-labelledby={isQuickExpense ? undefined : 'euer-entry-amount-title'}>
                {!isQuickExpense && <h3 id="euer-entry-amount-title" className="mb-3 text-xl font-semibold text-gray-900">Betrag</h3>}
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-base font-medium text-gray-700">{draft.vatFields.vatTreatment === 'reverse_charge_eu' || draft.vatFields.vatTreatment === 'reverse_charge_domestic' ? 'Betrag (Netto)' : 'Betrag (Brutto)'}<span className="relative mt-1 block"><LocalizedNumberInput minimumFractionDigits={2} required min="0" step="0.01" placeholder="0,00" value={draft.amount} locale={locale} numberFormat={company?.numberFormat} onValueChange={value => setDraft(current => ({ ...current, amount: value === '' ? '' : String(value) }))} className="form-input w-full pr-10" /><span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-500">€</span></span></label>
                  <label className="text-base font-medium text-gray-700">MwSt.-Satz in %<LocalizedNumberInput required min="0" max="100" step="0.01" value={draft.taxRate} locale={locale} numberFormat={company?.numberFormat} onValueChange={value => setDraft(current => ({ ...current, taxRate: value === '' ? '' : String(value) }))} className="form-input mt-1 w-full" /></label>
                </div>
              </section>

              {draft.sourceType !== 'invoice_payment' && <VatFieldsEditor flat={isQuickExpense} entryType={draft.entryType} amount={draft.amount} taxRate={draft.taxRate} entryDate={draft.entryDate} value={draft.vatFields} locale={locale} dateFormat={company?.dateFormat} numberFormat={company?.numberFormat} isSmallBusiness={company?.isSmallBusiness} onChange={vatFields => setDraft(current => ({ ...current, vatFields }))} onTaxRateChange={value => setDraft(current => ({ ...current, taxRate: String(value) }))} onAmountChange={value => setDraft(current => ({ ...current, amount: String(value) }))} suggestionLabel={dialogEntry && !dialogEntry.vatTreatment && Number(dialogEntry.taxRate) > 0 ? `Vorschlag aus Steuersatz ${dialogEntry.taxRate} %` : undefined} onAcceptSuggestion={dialogEntry ? () => { const proposal = suggestVatFromLegacy(dialogEntry); if (proposal) setDraft(current => ({ ...current, vatFields: proposal })); } : undefined} />}

              <section className={isQuickExpense ? '' : 'rounded-xl border border-gray-200 bg-white p-5 sm:p-6'} aria-labelledby={isQuickExpense ? undefined : 'euer-entry-notes-title'}>
                {!isQuickExpense && <h3 id="euer-entry-notes-title" className="mb-3 text-xl font-semibold text-gray-900">Notizen</h3>}
                <label className="text-base font-medium text-gray-700">Notiz / Beleghinweis<textarea value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} className="form-input mt-1 w-full" rows={3} placeholder="Optional: Belegnummer oder kurze Erläuterung" /></label>
                {draft.sourceType === 'correction' && <label className="mt-4 block text-base font-medium text-gray-700">Korrekturgrund<textarea required value={draft.correctionReason} onChange={event => setDraft(current => ({ ...current, correctionReason: event.target.value }))} className="form-input mt-1 w-full" rows={2} placeholder="Warum wird dieser Geschäftsvorfall korrigiert?" /></label>}
              </section>
            </div>
      </DialogShell>
    )}

    <DocumentPreview
      isOpen={documentPreview.isOpen}
      onClose={() => setDocumentPreview({ isOpen: false, documents: [] })}
      documents={documentPreview.documents}
      initialIndex={0}
    />

    {historyEntry && <DialogShell
      titleId="euer-history-dialog-title"
      title="Änderungsverlauf"
      description={historyEntry.description}
      icon={History}
      size="lg"
      fitContent
      onClose={() => { historyRequestVersion.current += 1; setHistoryEntry(null); }}
    >
      {historyLoading ? <div className="py-10 text-center text-sm text-gray-500">Historie wird geladen …</div> : historyError ? <p role="alert" className="py-6 text-sm text-red-700">{historyError}</p> : history.length === 0 ? <div className="py-10 text-center text-sm text-gray-500">Noch keine Historieneinträge vorhanden.</div> : <div className="space-y-3">{history.map(item => {
        const changes = getEuerHistoryChanges(item, {
          amount: formatAmount,
          date: value => formatDate(value, locale, company?.dateFormat),
          number: value => new Intl.NumberFormat(locale).format(value),
          categories: categoryLabels,
          customers: customerNames,
          sources: new Map([...invoiceOptions.map(invoice => [invoice.id, invoice.invoiceNumber] as const), ...entries.map(entry => [entry.id, entry.description] as const)]),
        });
        const changedAt = new Date(item.changedAt);
        return <article key={item.id} className="rounded-lg border border-gray-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-medium text-gray-900"><CheckCircle2 className="h-4 w-4 text-primary-custom" />{item.action === 'created' ? 'Erstellt' : item.action === 'updated' ? 'Geändert' : 'Storniert'}</span>
            <span className="text-xs text-gray-500">{formatDate(item.changedAt, locale, company?.dateFormat)} · {Number.isNaN(changedAt.getTime()) ? '—' : changedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          {item.reason && <p className="mt-2 text-sm text-gray-700">Grund: {item.reason}</p>}
          {changes.length > 0 ? <dl className="mt-3 space-y-3">{changes.map(change => <div key={change.key} className="text-sm">
            <dt className="font-medium text-gray-700">{change.label}</dt>
            <dd className="mt-1 grid gap-1 break-words text-gray-600 sm:grid-cols-2 sm:gap-4">
              {item.action !== 'created' && <span><span className="text-xs text-gray-500">Vorher: </span>{change.before}</span>}
              <span><span className="text-xs text-gray-500">{item.action === 'created' ? 'Erfasst: ' : 'Nachher: '}</span>{change.after}</span>
            </dd>
          </div>)}</dl> : <p className="mt-3 text-sm text-gray-500">Keine fachlichen Feldänderungen.</p>}
          {(item.oldData || item.newData) && <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-gray-500">Technische Werte anzeigen</summary><pre className="mt-2 max-h-40 overflow-auto rounded bg-gray-50 p-2 text-xs text-gray-600">{JSON.stringify({ vorher: item.oldData, nachher: item.newData }, null, 2)}</pre></details>}
        </article>;
      })}</div>}
    </DialogShell>}
    {expenseTemplateEntry && <RecurringExpenseDialog
      key={expenseTemplateEntry.id}
      scope="business"
      initialValues={{ name: expenseTemplateEntry.description, counterparty: '', category: expenseTemplateEntry.category, amountGross: Number(expenseTemplateEntry.amount), taxRate: expenseTemplateEntry.taxRate, interval: 'monthly', intervalCount: 1, intervalUnit: 'months', startDate: todayLocal(), endDate: null, noticePeriodDays: 0, cancelledOn: null, status: 'active', pauses: [], priceChanges: [], automaticBooking: false, scope: 'business', levyKind: null, linkedReceiptId: null, notes: `Als Vorlage aus der EÜR-Buchung vom ${expenseTemplateEntry.entryDate} erstellt.` }}
      onClose={() => setExpenseTemplateEntry(null)}
      onSave={async (payload: RecurringExpensePayload) => {
        const targetWorkspace = workspace?.id ?? null;
        await financeApi.saveExpense(payload);
        if (templateWorkspace.current !== targetWorkspace) return;
        setExpenseTemplateEntry(null);
        setNotice('Fixkostenvorlage wurde aus der EÜR-Buchung erstellt. Die bestehende EÜR-Ausgabe blieb unverändert.');
      }}
    />}
  </div>;
}
