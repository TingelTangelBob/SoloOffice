import { type ForwardedRef, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, FileScan, FileUp, Link2, Loader2, Pencil, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { apiService } from '../services/api';
import type { EuerEntryPayload, Receipt, ReceiptExtractedData, ReceiptOcrStatus } from '../types';
import { formatFileSize } from '../utils/fileUtils';
import { formatCurrency, formatDate, parseLocalizedNumber } from '../utils/formatters';
import { RECEIPT_UPLOAD_ACCEPT, uploadReceiptFiles } from '../utils/receiptUpload';
import { DialogShell } from './DialogShell';
import { ImportWizard } from './ImportWizard';
import { PageHeader } from './PageHeader';

interface ReceiptsManagementProps {
  onNavigate?: (page: string) => void;
  embedded?: boolean;
}

export interface ReceiptsManagementHandle {
  openUpload: () => void;
}

type EditableReceiptField = 'vendorName' | 'documentDate' | 'documentNumber' | 'netAmount' | 'taxAmount' | 'grossAmount' | 'taxRate' | 'currency' | 'suggestedCategory';

const statusLabels: Record<ReceiptOcrStatus, string> = {
  pending: 'Wartet auf Erkennung',
  processing: 'Erkennung läuft',
  completed: 'Beleg erkannt',
  failed: 'Erkennung fehlgeschlagen',
};

function inputValue(value: string | number | undefined) {
  return value === undefined ? '' : String(value);
}

function comparableValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeOptionalNumber(value: string, locale: string, numberFormat?: 'european' | 'american') {
  if (!value.trim()) return undefined;
  const parsed = parseLocalizedNumber(value, locale, numberFormat);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const ReceiptsManagement = forwardRef(function ReceiptsManagement(
  { onNavigate, embedded = false }: ReceiptsManagementProps,
  ref: ForwardedRef<ReceiptsManagementHandle>,
) {
  const { company } = useCompany();
  const receiptLabel = company.receiptLabel?.trim() || 'Belege';
  const locale = company.locale || 'de-DE';
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [reviewData, setReviewData] = useState<ReceiptExtractedData>({});
  const [originalReviewData, setOriginalReviewData] = useState<ReceiptExtractedData>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingReview, setSavingReview] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isImportOpen, setIsImportOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openUpload = useCallback(() => fileInputRef.current?.click(), []);
  useImperativeHandle(ref, () => ({ openUpload }), [openUpload]);

  const loadReceipts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReceipts(await apiService.getReceipts());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : `${receiptLabel} konnten nicht geladen werden.`);
    } finally {
      setLoading(false);
    }
  }, [receiptLabel]);

  useEffect(() => { void loadReceipts(); }, [loadReceipts]);

  useEffect(() => {
    if (!selectedReceipt) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedReceipt(null);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [selectedReceipt]);

  const updateReceiptInState = (updated: Receipt) => {
    setReceipts(current => current.map(receipt => receipt.id === updated.id ? updated : receipt));
    setSelectedReceipt(current => current?.id === updated.id ? updated : current);
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;

    setUploading(true);
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
      setUploading(false);
    }
  };

  const openReview = async (receipt: Receipt) => {
    setError('');
    try {
      const detail = receipt.content ? receipt : await apiService.getReceipt(receipt.id);
      setSelectedReceipt(detail);
      setOriginalReviewData({ ...(detail.ocrExtractedData || detail.extractedData || {}) });
      setReviewData({ ...detail.extractedData });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Der Beleg konnte nicht geöffnet werden.');
    }
  };

  const updateReviewField = (field: EditableReceiptField, value: string) => {
    setReviewData(current => ({ ...current, [field]: value }));
  };

  const isReviewFieldChanged = (field: EditableReceiptField) => comparableValue(reviewData[field]) !== comparableValue(originalReviewData[field]);
  const fieldClassName = (field: EditableReceiptField) => `mt-1.5 min-h-11 w-full rounded-lg border bg-white px-3 py-2.5 text-sm font-normal text-gray-900 shadow-sm outline-none transition placeholder:text-gray-400 focus:border-primary-custom focus:ring-2 focus:ring-primary-custom/20 ${isReviewFieldChanged(field) ? 'border-amber-300 bg-amber-50/30' : 'border-gray-300'}`;

  const normalizeReviewData = (): ReceiptExtractedData => ({
    vendorName: reviewData.vendorName?.trim() || undefined,
    documentDate: reviewData.documentDate?.trim() || undefined,
    documentNumber: reviewData.documentNumber?.trim() || undefined,
    netAmount: normalizeOptionalNumber(inputValue(reviewData.netAmount), locale, company.numberFormat),
    taxAmount: normalizeOptionalNumber(inputValue(reviewData.taxAmount), locale, company.numberFormat),
    grossAmount: normalizeOptionalNumber(inputValue(reviewData.grossAmount), locale, company.numberFormat),
    taxRate: normalizeOptionalNumber(inputValue(reviewData.taxRate), locale, company.numberFormat),
    currency: reviewData.currency?.trim().toUpperCase() || undefined,
    suggestedCategory: reviewData.suggestedCategory,
  });

  const persistReview = async () => {
    if (!selectedReceipt) return null;
    const updated = await apiService.updateReceipt(selectedReceipt.id, { extractedData: normalizeReviewData() });
    updateReceiptInState(updated);
    setReviewData({ ...updated.extractedData });
    return updated;
  };

  const saveReview = async () => {
    if (!selectedReceipt) return;
    setSavingReview(true);
    setError('');
    try {
      await persistReview();
      setNotice('Die Prüfung wurde als Entwurf gespeichert.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Die Belegprüfung konnte nicht gespeichert werden.');
    } finally {
      setSavingReview(false);
    }
  };

  const retryOcr = async (receipt: Receipt) => {
    setBusyId(receipt.id);
    setError('');
    try {
      const updated = await apiService.retryReceiptOcr(receipt.id);
      updateReceiptInState(updated);
      if (selectedReceipt?.id === updated.id) {
        setOriginalReviewData({ ...(updated.ocrExtractedData || updated.extractedData || {}) });
        setReviewData({ ...updated.extractedData });
      }
      setNotice('Die lokale Belegerkennung wurde erneut ausgeführt. Bitte das Ergebnis prüfen.');
    } catch (ocrError) {
      setError(ocrError instanceof Error ? ocrError.message : 'Die Belegerkennung konnte nicht erneut ausgeführt werden.');
    } finally {
      setBusyId(null);
    }
  };

  const createEuerEntry = async (receiptOverride?: Receipt, dataOverride?: ReceiptExtractedData) => {
    const receipt = receiptOverride || selectedReceipt;
    const data = dataOverride || reviewData;
    if (!receipt) return;
    const amount = data.grossAmount ?? data.netAmount;
    if (!Number.isFinite(amount) || Number(amount) < 0) {
      setError('Bitte zuerst einen gültigen Brutto- oder Nettobetrag erfassen.');
      return;
    }

    const entryDate = data.documentDate && /^\d{4}-\d{2}-\d{2}$/.test(data.documentDate)
      ? data.documentDate
      : new Date().toISOString().slice(0, 10);
    const description = data.vendorName?.trim() || receipt.name.replace(/\.[^.]+$/, '');
    const notes = [
      `Beleg: ${receipt.name}`,
      data.documentNumber ? `Belegnummer: ${data.documentNumber}` : '',
      'Erstellt aus lokaler Belegerkennung; bitte steuerlich prüfen.',
    ].filter(Boolean).join(' · ');
    const payload: EuerEntryPayload = {
      entryType: 'expense',
      entryDate,
      description,
      category: 'other_expense',
      amount: Number(amount),
      taxRate: Number(data.taxRate || 0),
      notes,
      sourceType: 'receipt',
      sourceId: receipt.id,
    };

    setBusyId(receipt.id);
    setError('');
    try {
      const result = await apiService.createEuerEntryFromReceipt(receipt.id, payload);
      updateReceiptInState(result.receipt);
      setNotice('EÜR-Ausgabe wurde angelegt und mit dem Beleg verknüpft.');
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : 'Die EÜR-Ausgabe konnte nicht angelegt werden.');
    } finally {
      setBusyId(null);
    }
  };

  const saveAndCreateEuerEntry = async () => {
    if (!selectedReceipt) return;
    setSavingReview(true);
    setError('');
    try {
      const updated = await persistReview();
      if (updated) await createEuerEntry(updated, updated.extractedData);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Die Belegprüfung konnte nicht gespeichert werden.');
    } finally {
      setSavingReview(false);
    }
  };

  const deleteReceipt = async (receipt: Receipt) => {
    if (!window.confirm(`„${receipt.name}“ wirklich löschen?`)) return;
    setBusyId(receipt.id);
    setError('');
    try {
      await apiService.deleteReceipt(receipt.id);
      setReceipts(current => current.filter(item => item.id !== receipt.id));
      setSelectedReceipt(current => current?.id === receipt.id ? null : current);
      setNotice('Beleg wurde gelöscht.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Der Beleg konnte nicht gelöscht werden.');
    } finally {
      setBusyId(null);
    }
  };

  const statistics = useMemo(() => ({
    total: receipts.length,
    completed: receipts.filter(receipt => receipt.ocrStatus === 'completed').length,
    linked: receipts.filter(receipt => receipt.linkedEuerEntryId).length,
  }), [receipts]);

  const formatAmount = (amount: number | undefined) => amount === undefined
    ? '—'
    : formatCurrency(amount, locale, company.numberFormat, company.currency);
  const selectedContentUrl = selectedReceipt?.content
    ? `data:${selectedReceipt.contentType};base64,${selectedReceipt.content}`
    : undefined;

  return (
    <>
      <input ref={fileInputRef} type="file" accept={RECEIPT_UPLOAD_ACCEPT} capture="environment" multiple className="hidden" onChange={handleUpload} disabled={uploading} />
      <div className="space-y-4 sm:space-y-6">
      {!embedded && <PageHeader icon={FileScan} title={receiptLabel} subtitle="Belege lokal einlesen, prüfen und mit EÜR-Buchungen verknüpfen">
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
        <button
          type="button"
          onClick={openUpload}
          disabled={uploading}
          className="btn-primary inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl px-2 text-white transition-all hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-60 xl:min-w-0 xl:px-4"
          aria-label={uploading ? 'Belege werden verarbeitet' : 'Beleg hochladen'}
          title={uploading ? 'Belege werden verarbeitet' : 'Beleg hochladen'}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          <span className="hidden xl:inline">{uploading ? 'Wird verarbeitet …' : 'Beleg hochladen'}</span>
        </button>
        <button type="button" onClick={() => setIsImportOpen(true)} className="action-button inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 px-2 xl:min-w-0 xl:px-4" aria-label="Ausgaben importieren" title="Ausgaben importieren">
          <FileUp className="h-4 w-4" />
          <span className="hidden xl:inline">Ausgaben importieren</span>
        </button>
      </PageHeader>}

      {(error || notice) && (
        <div className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {error ? <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />}
          <span className="flex-1">{error || notice}</span>
          <button type="button" onClick={() => { setError(''); setNotice(''); }} aria-label="Hinweis schließen"><X className="h-4 w-4" /></button>
        </div>
      )}

      <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950 shadow-sm sm:p-5">
        <div className="flex items-start gap-3">
          <FileScan className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
          <div>
            <h2 className="font-semibold">Lokale Belegerkennung mit Bestätigung</h2>
            <p className="mt-1 text-sm leading-5 text-blue-900 sm:leading-6">
              Bilder und eingescannte PDFs werden im Backend-Container mit Tesseract gelesen. Bei digital erzeugten PDFs wird der enthaltene Text übernommen. Aussteller, Datum und Beträge sind Vorschläge und werden erst nach deiner Prüfung in die EÜR übernommen.
            </p>
            <p className="mt-2 text-xs text-blue-800">Unterstützt: PDF, JPG, PNG und WEBP · maximal 25 MB · keine externe Schnittstelle</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4"><p className="text-[10px] font-medium uppercase leading-4 tracking-wide text-gray-500 sm:text-xs">Gesamt</p><p className="mt-1 text-xl font-bold text-gray-900 sm:text-2xl">{statistics.total}</p></div>
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4"><p className="text-[10px] font-medium uppercase leading-4 tracking-wide text-gray-500 sm:text-xs"><span className="sm:hidden">Erkannt</span><span className="hidden sm:inline">Erkennung fertig</span></p><p className="mt-1 text-xl font-bold text-emerald-700 sm:text-2xl">{statistics.completed}</p></div>
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4"><p className="text-[10px] font-medium uppercase leading-4 tracking-wide text-gray-500 sm:text-xs"><span className="sm:hidden">EÜR verknüpft</span><span className="hidden sm:inline">Mit EÜR verknüpft</span></p><p className="mt-1 text-xl font-bold text-blue-700 sm:text-2xl">{statistics.linked}</p></div>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-gray-900">Meine {receiptLabel}</h2><p className="mt-1 text-sm text-gray-500">Öffne einen Beleg, prüfe die erkannten Felder und übernimm ihn optional als EÜR-Ausgabe.</p></div>
          <button type="button" onClick={openUpload} className="action-button flex items-center gap-2" disabled={uploading}><Upload className="h-4 w-4" />Beleg hochladen</button>
        </div>

        {loading ? <div className="py-12 text-center text-sm text-gray-500">{receiptLabel} werden geladen …</div> : receipts.length === 0 ? (
          <button type="button" onClick={openUpload} className="mt-5 block w-full rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center transition hover:border-primary-custom hover:bg-blue-50" disabled={uploading}>
            <Upload className="mx-auto h-8 w-8 text-gray-400" />
            <span className="mt-3 block font-medium text-gray-800">Noch keine {receiptLabel}</span>
            <span className="mt-1 block text-sm text-gray-500">Datei auswählen oder direkt mit der Kamera aufnehmen</span>
          </button>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {receipts.map(receipt => {
              const data = receipt.extractedData || {};
              const busy = busyId === receipt.id;
              const displayName = receipt.name || data.documentNumber || 'Beleg';
              const fileMeta = [
                receipt.size > 0 ? formatFileSize(receipt.size) : '',
                receipt.createdAt ? formatDate(receipt.createdAt, locale, company.dateFormat) : '',
              ].filter(Boolean).join(' · ') || 'Datei';
              const statusClassName = receipt.ocrStatus === 'completed'
                ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                : receipt.ocrStatus === 'failed'
                  ? 'border-rose-100 bg-rose-50 text-rose-700'
                  : 'border-amber-100 bg-amber-50 text-amber-700';
              const statusDotClassName = receipt.ocrStatus === 'completed'
                ? 'bg-emerald-500'
                : receipt.ocrStatus === 'failed'
                  ? 'bg-rose-500'
                  : 'bg-amber-500';
              return (
                <article key={receipt.id} className={`document-card flex h-full min-w-0 flex-col rounded-xl border p-4 transition ${selectedReceipt?.id === receipt.id ? 'border-primary-custom shadow-md' : 'border-gray-200 hover:border-gray-300'}`}>
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><FileScan className="h-5 w-5" /></span>
                      <div className="min-w-0 flex-1">
                        <h3 className="break-words font-medium leading-5 text-gray-900" title={displayName}>{displayName}</h3>
                        <p className="mt-1 break-words text-xs leading-4 text-gray-500" title={fileMeta}>{fileMeta}</p>
                      </div>
                    </div>
                    <span className={`document-card-status inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium ${statusClassName}`} title={statusLabels[receipt.ocrStatus]} aria-label={`Status: ${statusLabels[receipt.ocrStatus]}`}>
                      <span className={`document-card-status-dot h-2 w-2 shrink-0 rounded-full ${statusDotClassName}`} aria-hidden="true" />
                      <span className="document-card-status-label whitespace-nowrap">{statusLabels[receipt.ocrStatus]}</span>
                    </span>
                  </div>
                  <dl className="mt-4 space-y-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-gray-500">Aussteller</dt><dd className="truncate font-medium text-gray-800">{data.vendorName || 'Nicht erkannt'}</dd></div><div className="flex justify-between gap-3"><dt className="text-gray-500">Datum</dt><dd className="text-gray-800">{data.documentDate ? formatDate(data.documentDate, locale, company.dateFormat) : 'Nicht erkannt'}</dd></div><div className="flex justify-between gap-3"><dt className="text-gray-500">Brutto</dt><dd className="font-medium text-gray-800">{formatAmount(data.grossAmount)}</dd></div></dl>
                  {receipt.linkedEuerEntryId && <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-blue-700"><Link2 className="h-3.5 w-3.5" />Mit EÜR verknüpft</p>}
                  <div className="mt-auto flex items-center gap-2 pt-4"><button type="button" onClick={() => void openReview(receipt)} className="action-button min-w-0 flex-1 justify-center"><Pencil className="h-4 w-4" />Prüfen</button><button type="button" onClick={() => void deleteReceipt(receipt)} className="action-button min-w-10 shrink-0 justify-center border-rose-200 px-3 text-rose-700 hover:bg-rose-50" disabled={busy} aria-label={`${displayName} löschen`} title="Löschen"><Trash2 className="h-4 w-4" /></button>{receipt.ocrStatus === 'failed' && <button type="button" onClick={() => void retryOcr(receipt)} className="action-button min-w-10 shrink-0 justify-center px-3" disabled={busy} aria-label="Erkennung erneut ausführen" title="Erkennung erneut ausführen">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</button>}</div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {selectedReceipt && (
        <DialogShell
          titleId="receipt-review-title"
          icon={Pencil}
          title="Beleg prüfen"
          description="Prüfe die erkannten Angaben und korrigiere sie bei Bedarf."
          onClose={() => setSelectedReceipt(null)}
          size="wide"
          zIndexClassName="z-[1100]"
          footer={(
            <>
              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={() => void saveReview()}
                className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={savingReview}
              >
                {savingReview ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : null}
                Prüfung speichern
              </button>
              <button
                type="button"
                onClick={() => void saveAndCreateEuerEntry()}
                className="btn-primary inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={Boolean(selectedReceipt.linkedEuerEntryId) || savingReview || busyId === selectedReceipt.id}
              >
                <Link2 className="h-4 w-4" />
                {selectedReceipt.linkedEuerEntryId ? 'Bereits in EÜR' : 'Als EÜR-Ausgabe übernehmen'}
              </button>
            </>
          )}
        >
          <div className="space-y-3 pb-2">
            {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

            <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
              <h3 className="text-xl font-semibold text-gray-900">Belegdaten</h3>
              <p className="mt-1 text-base text-gray-500">Grunddaten des eingelesenen Belegs.</p>
              <div className="mt-5 space-y-4">
                <label htmlFor="receipt-vendor" className="block text-sm font-medium text-gray-700">
                  Aussteller
                  <input id="receipt-vendor" value={inputValue(reviewData.vendorName)} onChange={event => updateReviewField('vendorName', event.target.value)} className={fieldClassName('vendorName')} />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label htmlFor="receipt-date" className="block text-sm font-medium text-gray-700">
                    Belegdatum
                    <input id="receipt-date" type="date" value={inputValue(reviewData.documentDate)} onChange={event => updateReviewField('documentDate', event.target.value)} className={fieldClassName('documentDate')} />
                  </label>
                  <label htmlFor="receipt-number" className="block text-sm font-medium text-gray-700">
                    Belegnummer
                    <input id="receipt-number" value={inputValue(reviewData.documentNumber)} onChange={event => updateReviewField('documentNumber', event.target.value)} className={fieldClassName('documentNumber')} />
                  </label>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-primary-custom border-l-2 bg-primary-light-custom p-5 sm:p-6">
              <h3 className="text-xl font-semibold text-gray-900">Betrag</h3>
              <p className="mt-1 text-base text-gray-500">Beträge werden für die weitere Verarbeitung übernommen.</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <label htmlFor="receipt-net" className="block text-sm font-medium text-gray-700">
                  Netto
                  <input id="receipt-net" inputMode="decimal" value={inputValue(reviewData.netAmount)} onChange={event => updateReviewField('netAmount', event.target.value)} className={fieldClassName('netAmount')} />
                </label>
                <label htmlFor="receipt-tax" className="block text-sm font-medium text-gray-700">
                  MwSt. Betrag
                  <input id="receipt-tax" inputMode="decimal" value={inputValue(reviewData.taxAmount)} onChange={event => updateReviewField('taxAmount', event.target.value)} className={fieldClassName('taxAmount')} />
                </label>
                <label htmlFor="receipt-gross" className="block text-sm font-medium text-gray-700">
                  Brutto
                  <input id="receipt-gross" inputMode="decimal" value={inputValue(reviewData.grossAmount)} onChange={event => updateReviewField('grossAmount', event.target.value)} className={fieldClassName('grossAmount')} />
                </label>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label htmlFor="receipt-tax-rate" className="block text-sm font-medium text-gray-700">
                  MwSt.-Satz in %
                  <input id="receipt-tax-rate" inputMode="decimal" value={inputValue(reviewData.taxRate)} onChange={event => updateReviewField('taxRate', event.target.value)} className={fieldClassName('taxRate')} />
                </label>
                <label htmlFor="receipt-currency" className="block text-sm font-medium text-gray-700">
                  Währung
                  <input id="receipt-currency" value={inputValue(reviewData.currency)} onChange={event => updateReviewField('currency', event.target.value)} className={fieldClassName('currency')} placeholder="EUR" />
                </label>
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
              <h3 className="text-xl font-semibold text-gray-900">Zuordnung</h3>
              <p className="mt-1 text-base text-gray-500">Der Vorschlag wird beim Übernehmen als EÜR-Ausgabe verwendet.</p>
              <label htmlFor="receipt-category" className="mt-5 block text-sm font-medium text-gray-700">
                Kategorie-Vorschlag
                <select id="receipt-category" value={reviewData.suggestedCategory || 'other_expense'} onChange={event => updateReviewField('suggestedCategory', event.target.value)} className={fieldClassName('suggestedCategory')}>
                  <option value="materials">Material und Waren</option>
                  <option value="office">Bürobedarf</option>
                  <option value="software">Software und Lizenzen</option>
                  <option value="telecommunications">Telefon und Internet</option>
                  <option value="travel">Reisekosten</option>
                  <option value="vehicle">Fahrzeugkosten</option>
                  <option value="marketing">Werbung und Marketing</option>
                  <option value="professional_services">Fremdleistungen</option>
                  <option value="insurance">Versicherungen</option>
                  <option value="bank_fees">Bankgebühren</option>
                  <option value="other_expense">Sonstige Betriebsausgaben</option>
                </select>
              </label>
            </section>

            {selectedReceipt.ocrError && (
              <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800 sm:p-6">
                <p className="font-medium">Lokale Belegerkennung konnte nicht ausgeführt werden</p>
                <p className="mt-1">{selectedReceipt.ocrError}</p>
                <button type="button" onClick={() => void retryOcr(selectedReceipt)} className="mt-3 inline-flex items-center gap-2 font-medium underline" disabled={busyId === selectedReceipt.id}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Erneut versuchen
                </button>
              </section>
            )}

            {selectedReceipt.ocrText && (
              <details className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">Erkannten Text anzeigen</summary>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap border-t border-gray-200 bg-gray-50 p-4 text-xs leading-5 text-gray-600">{selectedReceipt.ocrText}</pre>
              </details>
            )}
            {selectedReceipt.content && selectedContentUrl && (
              <details className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">Originalbeleg anzeigen</summary>
                <div className="flex min-h-48 items-center justify-center border-t border-gray-200 bg-gray-50 p-3">
                  {selectedReceipt.contentType.toLowerCase() === 'application/pdf' ? (
                    <object data={selectedContentUrl} type="application/pdf" aria-label={`Originalbeleg ${selectedReceipt.name}`} className="h-[28rem] w-full">
                      <p className="text-sm text-gray-600">Die PDF-Vorschau ist in diesem Browser nicht verfügbar. <a href={selectedContentUrl} download={selectedReceipt.name} className="font-medium text-blue-700 underline">PDF herunterladen</a></p>
                    </object>
                  ) : (
                    <img src={selectedContentUrl} alt={`Originalbeleg ${selectedReceipt.name}`} className="max-h-[28rem] w-full object-contain" />
                  )}
                </div>
              </details>
            )}
          </div>
        </DialogShell>
      )}
      {!embedded && (
        <ImportWizard
          resource="euerEntries"
          isOpen={isImportOpen}
          onClose={() => setIsImportOpen(false)}
          onImported={() => setNotice('Ausgaben wurden importiert und in der EÜR gespeichert.')}
        />
      )}
      </div>
    </>
  );
});
