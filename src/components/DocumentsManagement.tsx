import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, FileCheck2, FileScan, FileUp, LayoutGrid, ReceiptText, RefreshCw, Upload, X } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { apiService } from '../services/api';
import type { DateFormat, IncomingEInvoice, Receipt } from '../types';
import { formatCurrency, formatDate } from '../utils/formatters';
import { RECEIPT_UPLOAD_ACCEPT, uploadReceiptFiles } from '../utils/receiptUpload';
import { IncomingEInvoicesManagement, type IncomingEInvoicesManagementHandle } from './IncomingEInvoicesManagement';
import { ImportWizard } from './ImportWizard';
import { PageHeader } from './PageHeader';
import { ReceiptsManagement, type ReceiptsManagementHandle } from './ReceiptsManagement';
import { ThemeTabBar } from './ThemeTabBar';

type DocumentsTab = 'all' | 'receipts' | 'incoming';
type DocumentKind = Exclude<DocumentsTab, 'all'>;

interface DocumentsManagementProps {
  initialTab?: string;
  onNavigate?: (page: string, filter?: string, searchTerm?: string, invoiceId?: string) => void;
}

interface UnifiedDocument {
  id: string;
  kind: DocumentKind;
  title: string;
  typeLabel: string;
  meta: string;
  date?: Date | string;
  supplier?: string;
  amount?: number;
  currency: string;
  statusLabel: string;
  statusClassName: string;
  statusDotClassName: string;
  linkedLabel?: string;
}

function normalizeTab(value?: string): DocumentsTab {
  if (value === 'receipts' || value === 'sonstige-belege') return 'receipts';
  if (value === 'incoming' || value === 'incoming-e-invoices' || value === 'e-rechnungen') return 'incoming';
  return 'all';
}

function toUnifiedReceipt(receipt: Receipt, locale: string, dateFormat: DateFormat): UnifiedDocument {
  const data = receipt.extractedData || {};
  const statusLabel = receipt.ocrStatus === 'completed'
    ? 'Beleg erkannt'
    : receipt.ocrStatus === 'failed'
      ? 'Erkennung fehlgeschlagen'
      : receipt.ocrStatus === 'processing'
        ? 'Erkennung läuft'
        : 'Wartet auf Erkennung';

  return {
    id: receipt.id,
    kind: 'receipts',
    title: receipt.name || data.documentNumber || 'Beleg',
    typeLabel: 'Sonstiger Beleg',
    meta: [
      receipt.size > 0 ? `${Math.round(receipt.size / 1024)} KB` : '',
      receipt.createdAt ? formatDate(receipt.createdAt, locale, dateFormat) : '',
    ].filter(Boolean).join(' · ') || 'Datei',
    date: data.documentDate || receipt.createdAt,
    supplier: data.vendorName,
    amount: data.grossAmount,
    currency: data.currency || 'EUR',
    statusLabel,
    statusClassName: receipt.ocrStatus === 'completed'
      ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
      : receipt.ocrStatus === 'failed'
        ? 'border-rose-100 bg-rose-50 text-rose-700'
        : 'border-amber-100 bg-amber-50 text-amber-700',
    statusDotClassName: receipt.ocrStatus === 'completed'
      ? 'bg-emerald-500'
      : receipt.ocrStatus === 'failed'
        ? 'bg-rose-500'
        : 'bg-amber-500',
    linkedLabel: receipt.linkedEuerEntryId ? 'Mit EÜR verknüpft' : undefined,
  };
}

function toUnifiedIncoming(invoice: IncomingEInvoice, locale: string, dateFormat: DateFormat): UnifiedDocument {
  const validated = invoice.validationStatus === 'validated';
  return {
    id: invoice.id,
    kind: 'incoming',
    title: invoice.filename || 'E-Rechnung',
    typeLabel: invoice.format,
    meta: [
      invoice.size > 0 ? `${Math.round(invoice.size / 1024)} KB` : '',
      invoice.receivedAt ? formatDate(invoice.receivedAt, locale, dateFormat) : '',
    ].filter(Boolean).join(' · ') || 'XML-Datei',
    date: invoice.issueDate || invoice.receivedAt,
    supplier: invoice.supplierName,
    amount: invoice.grossAmount,
    currency: invoice.currency || 'EUR',
    statusLabel: validated ? 'E-Rechnung geprüft' : 'Prüfung fehlgeschlagen',
    statusClassName: validated
      ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
      : 'border-rose-100 bg-rose-50 text-rose-700',
    statusDotClassName: validated ? 'bg-emerald-500' : 'bg-rose-500',
    linkedLabel: invoice.linkedCustomerId ? 'Kunde zugeordnet' : undefined,
  };
}

export function DocumentsManagement({ initialTab, onNavigate }: DocumentsManagementProps) {
  const { company } = useCompany();
  const [activeTab, setActiveTab] = useState<DocumentsTab>(() => normalizeTab(initialTab));
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [incomingInvoices, setIncomingInvoices] = useState<IncomingEInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const receiptsManagementRef = useRef<ReceiptsManagementHandle>(null);
  const incomingEInvoicesRef = useRef<IncomingEInvoicesManagementHandle>(null);
  const receiptUploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setActiveTab(normalizeTab(initialTab));
  }, [initialTab]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [receiptResult, incomingResult] = await Promise.all([
        apiService.getReceipts(),
        apiService.getIncomingEInvoices(),
      ]);
      setReceipts(receiptResult);
      setIncomingInvoices(incomingResult);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Belege konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const documents = useMemo(() => [
    ...receipts.map(receipt => toUnifiedReceipt(receipt, company.locale || 'de-DE', company.dateFormat || 'DD.MM.YYYY')),
    ...incomingInvoices.map(invoice => toUnifiedIncoming(invoice, company.locale || 'de-DE', company.dateFormat || 'DD.MM.YYYY')),
  ].sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime()), [company.dateFormat, company.locale, incomingInvoices, receipts]);

  const tabCounts = {
    all: documents.length,
    receipts: receipts.length,
    incoming: incomingInvoices.length,
  };

  const selectTab = (tab: DocumentsTab) => {
    setActiveTab(tab);
    setError('');
    setNotice('');
    if (tab === 'all') void loadOverview();
    onNavigate?.('documents', tab === 'all' ? undefined : tab);
  };

  const handleOverviewUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;

    setUploadingReceipt(true);
    setError('');
    setNotice('');
    try {
      const result = await uploadReceiptFiles(files);
      if (result.created.length) {
        setReceipts(current => [...result.created.slice().reverse(), ...current]);
        setNotice(`${result.created.length === 1 ? 'Beleg' : `${result.created.length} Belege`} hochgeladen und lokal verarbeitet. Bitte die Vorschläge prüfen.`);
      }
      if (result.errors.length) setError(result.errors.join(' '));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Der Beleg konnte nicht hochgeladen werden.');
    } finally {
      setUploadingReceipt(false);
    }
  };

  const openReceiptUpload = () => {
    if (activeTab === 'receipts') receiptsManagementRef.current?.openUpload();
    else receiptUploadInputRef.current?.click();
  };

  const openIncomingUpload = () => incomingEInvoicesRef.current?.openUpload();

  const formatAmount = (document: UnifiedDocument) => document.amount === undefined
    ? 'Nicht erkannt'
    : formatCurrency(document.amount, company.locale || 'de-DE', company.numberFormat, document.currency || company.currency);

  return (
    <>
      <input ref={receiptUploadInputRef} type="file" accept={RECEIPT_UPLOAD_ACCEPT} capture="environment" multiple className="hidden" onChange={handleOverviewUpload} disabled={uploadingReceipt} />
      <div className="space-y-4 sm:space-y-6">
      <PageHeader icon={FileScan} title="Belege" subtitle="Normale Belege und elektronische Rechnungen an einem Ort verwalten">
        {(activeTab === 'all' || activeTab === 'receipts') && (
          <>
            <button
              type="button"
              onClick={openReceiptUpload}
              className="btn-primary inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl px-2 text-white transition-all hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-60 xl:min-w-0 xl:px-4"
              disabled={uploadingReceipt}
              aria-label={uploadingReceipt ? 'Belege werden verarbeitet' : 'Beleg hochladen'}
              title={uploadingReceipt ? 'Belege werden verarbeitet' : 'Beleg hochladen'}
            >
              {uploadingReceipt ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              <span className="hidden xl:inline">{uploadingReceipt ? 'Wird verarbeitet …' : 'Beleg hochladen'}</span>
            </button>
            <button type="button" onClick={() => setIsImportOpen(true)} className="action-button inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 px-2 xl:min-w-0 xl:px-4" aria-label="Ausgaben importieren" title="Ausgaben importieren">
              <FileUp className="h-4 w-4" />
              <span className="hidden xl:inline">Ausgaben importieren</span>
            </button>
          </>
        )}
        {activeTab === 'receipts' && (
          <button
            type="button"
            onClick={() => onNavigate?.('euer')}
            className="action-button inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 px-2 xl:min-w-0 xl:px-4"
            aria-label="Zur EÜR öffnen"
            title="Zur EÜR öffnen"
          >
            <span className="hidden md:inline xl:hidden">EÜR</span>
            <span className="hidden xl:inline">Zur EÜR</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
        {activeTab === 'incoming' && (
          <button type="button" onClick={openIncomingUpload} className="btn-primary inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl px-2 text-white transition-all hover:brightness-90 xl:min-w-0 xl:px-4" aria-label="E-Rechnung als XML übernehmen" title="E-Rechnung als XML übernehmen">
            <Upload className="h-4 w-4" />
            <span className="hidden xl:inline">XML übernehmen</span>
          </button>
        )}
      </PageHeader>

      <ThemeTabBar
        className="sticky top-16 z-20 w-full lg:top-2"
        ariaLabel="Belegarten"
        activeTab={activeTab}
        onChange={selectTab}
        tabs={[
          { id: 'all' as const, label: 'Alle', icon: LayoutGrid, count: tabCounts.all },
          { id: 'receipts' as const, label: 'Sonstige Belege', icon: ReceiptText, count: tabCounts.receipts },
          { id: 'incoming' as const, label: 'E-Rechnungen', icon: FileCheck2, count: tabCounts.incoming },
        ]}
      />

      {(error || notice) && (
        <div className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {error ? <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />}
          <span className="flex-1">{error || notice}</span>
          <button type="button" onClick={() => { setError(''); setNotice(''); }} aria-label="Hinweis schließen"><X className="h-4 w-4" /></button>
        </div>
      )}

      {activeTab === 'all' && (
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Alle Belege</h2>
              <p className="mt-1 text-sm text-gray-500">Normale Belege und E-Rechnungen werden gemeinsam angezeigt. Die Originalquellen und ihre jeweiligen Prüfregeln bleiben getrennt erhalten.</p>
            </div>
            <button type="button" onClick={() => void loadOverview()} className="action-button inline-flex items-center gap-2" disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Aktualisieren
            </button>
          </div>

          {loading ? <div className="py-12 text-center text-sm text-gray-500">Belege werden geladen …</div> : documents.length === 0 ? (
            <div className="mt-5 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
              <FileScan className="mx-auto h-8 w-8 text-gray-400" />
              <p className="mt-3 font-medium text-gray-800">Noch keine Belege</p>
              <p className="mt-1 text-sm text-gray-500">Nutze oben die Upload-Aktionen oder wähle eine Belegart, um einen normalen Beleg oder eine E-Rechnung zu übernehmen.</p>
            </div>
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {documents.map(document => {
                const isIncoming = document.kind === 'incoming';
                const Icon = isIncoming ? FileCheck2 : FileScan;
                return (
                  <article key={`${document.kind}-${document.id}`} className="document-card flex h-full min-w-0 flex-col rounded-xl border border-gray-200 p-4 transition hover:border-gray-300 hover:shadow-sm">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isIncoming ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'}`}><Icon className="h-5 w-5" /></span>
                        <div className="min-w-0 flex-1">
                          <h3 className="break-words font-medium leading-5 text-gray-900" title={document.title}>{document.title}</h3>
                          <p className="mt-1 break-words text-xs leading-4 text-gray-500" title={`${document.typeLabel} · ${document.meta}`}>{document.typeLabel} · {document.meta}</p>
                        </div>
                      </div>
                      <span className={`document-card-status inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium ${document.statusClassName}`} title={document.statusLabel} aria-label={`Status: ${document.statusLabel}`}>
                        <span className={`document-card-status-dot h-2 w-2 shrink-0 rounded-full ${document.statusDotClassName}`} aria-hidden="true" />
                        <span className="document-card-status-label whitespace-nowrap">{document.statusLabel}</span>
                      </span>
                    </div>
                    <dl className="mt-4 space-y-2 text-sm">
                      <div className="flex justify-between gap-3"><dt className="text-gray-500">Aussteller</dt><dd className="truncate font-medium text-gray-800">{document.supplier || 'Nicht erkannt'}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-gray-500">Datum</dt><dd className="text-gray-800">{document.date ? formatDate(document.date, company.locale || 'de-DE', company.dateFormat || 'DD.MM.YYYY') : 'Nicht erkannt'}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-gray-500">Betrag</dt><dd className="font-medium text-gray-800">{formatAmount(document)}</dd></div>
                    </dl>
                    {document.linkedLabel && <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-blue-700"><CheckCircle2 className="h-3.5 w-3.5" />{document.linkedLabel}</p>}
                    <button type="button" onClick={() => selectTab(document.kind)} className="action-button mt-auto flex w-full items-center justify-center gap-2 pt-3">
                      {isIncoming ? <FileCheck2 className="h-4 w-4" /> : <FileScan className="h-4 w-4" />}
                      {isIncoming ? 'E-Rechnung prüfen' : 'Beleg prüfen'}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {activeTab === 'receipts' && <ReceiptsManagement ref={receiptsManagementRef} onNavigate={onNavigate} embedded />}
      {activeTab === 'incoming' && <IncomingEInvoicesManagement ref={incomingEInvoicesRef} embedded />}
      <ImportWizard
        resource="euerEntries"
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImported={() => setNotice('Ausgaben wurden importiert und in der EÜR gespeichert.')}
      />
      </div>
    </>
  );
}
