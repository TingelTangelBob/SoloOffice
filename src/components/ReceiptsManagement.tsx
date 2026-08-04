import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, FileScan, Link2, Loader2, Pencil, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { apiService } from '../services/api';
import type { EuerEntryPayload, Receipt, ReceiptExtractedData, ReceiptOcrStatus } from '../types';
import { fileToBase64, formatFileSize } from '../utils/fileUtils';
import { formatCurrency, formatDate, parseLocalizedNumber } from '../utils/formatters';
import { PageHeader } from './PageHeader';

interface ReceiptsManagementProps {
  onNavigate?: (page: string) => void;
}

type EditableReceiptField = 'vendorName' | 'documentDate' | 'documentNumber' | 'netAmount' | 'taxAmount' | 'grossAmount' | 'taxRate' | 'currency' | 'suggestedCategory';

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const supportedImageTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const statusLabels: Record<ReceiptOcrStatus, string> = {
  pending: 'Wartet auf OCR',
  processing: 'OCR läuft',
  completed: 'OCR abgeschlossen',
  failed: 'OCR fehlgeschlagen',
};

function inputValue(value: string | number | undefined) {
  return value === undefined ? '' : String(value);
}

function normalizeOptionalNumber(value: string, locale: string, numberFormat?: 'european' | 'american') {
  if (!value.trim()) return undefined;
  const parsed = parseLocalizedNumber(value, locale, numberFormat);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function ReceiptsManagement({ onNavigate }: ReceiptsManagementProps) {
  const { company } = useCompany();
  const receiptLabel = company.receiptLabel?.trim() || 'Belege';
  const locale = company.locale || 'de-DE';
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [reviewData, setReviewData] = useState<ReceiptExtractedData>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingReview, setSavingReview] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    let uploadedCount = 0;
    try {
      for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
          setError(`„${file.name}“ ist zu groß. Die maximale Größe beträgt 25 MB.`);
          continue;
        }
        if (!supportedImageTypes.has(file.type.toLowerCase())) {
          setError(`„${file.name}“ wird nicht unterstützt. Bitte JPG, PNG oder WEBP verwenden.`);
          continue;
        }

        const content = await fileToBase64(file);
        const created = await apiService.createReceipt({
          name: file.name,
          content,
          contentType: file.type.toLowerCase(),
          size: file.size,
        });
        setReceipts(current => [created, ...current]);
        uploadedCount += 1;
      }
      if (uploadedCount) {
        setNotice(`${uploadedCount === 1 ? 'Beleg' : `${uploadedCount} Belege`} hochgeladen und lokal verarbeitet. Bitte die Vorschläge prüfen.`);
      }
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
      setReviewData({ ...detail.extractedData });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Der Beleg konnte nicht geöffnet werden.');
    }
  };

  const updateReviewField = (field: EditableReceiptField, value: string) => {
    setReviewData(current => ({ ...current, [field]: value }));
  };

  const saveReview = async () => {
    if (!selectedReceipt) return;
    setSavingReview(true);
    setError('');
    try {
      const normalized: ReceiptExtractedData = {
        vendorName: reviewData.vendorName?.trim() || undefined,
        documentDate: reviewData.documentDate?.trim() || undefined,
        documentNumber: reviewData.documentNumber?.trim() || undefined,
        netAmount: normalizeOptionalNumber(inputValue(reviewData.netAmount), locale, company.numberFormat),
        taxAmount: normalizeOptionalNumber(inputValue(reviewData.taxAmount), locale, company.numberFormat),
        grossAmount: normalizeOptionalNumber(inputValue(reviewData.grossAmount), locale, company.numberFormat),
        taxRate: normalizeOptionalNumber(inputValue(reviewData.taxRate), locale, company.numberFormat),
        currency: reviewData.currency?.trim().toUpperCase() || undefined,
        suggestedCategory: reviewData.suggestedCategory,
      };
      const updated = await apiService.updateReceipt(selectedReceipt.id, { extractedData: normalized });
      updateReceiptInState(updated);
      setReviewData({ ...updated.extractedData });
      setNotice('Die erkannten Felder wurden gespeichert.');
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
      if (selectedReceipt?.id === updated.id) setReviewData({ ...updated.extractedData });
      setNotice('Die lokale OCR wurde erneut ausgeführt. Bitte das Ergebnis prüfen.');
    } catch (ocrError) {
      setError(ocrError instanceof Error ? ocrError.message : 'Die OCR konnte nicht erneut ausgeführt werden.');
    } finally {
      setBusyId(null);
    }
  };

  const createEuerEntry = async () => {
    if (!selectedReceipt) return;
    const amount = reviewData.grossAmount ?? reviewData.netAmount;
    if (!Number.isFinite(amount) || Number(amount) < 0) {
      setError('Bitte zuerst einen gültigen Brutto- oder Nettobetrag erfassen.');
      return;
    }

    const entryDate = reviewData.documentDate && /^\d{4}-\d{2}-\d{2}$/.test(reviewData.documentDate)
      ? reviewData.documentDate
      : new Date().toISOString().slice(0, 10);
    const description = reviewData.vendorName?.trim() || selectedReceipt.name.replace(/\.[^.]+$/, '');
    const notes = [
      `Beleg: ${selectedReceipt.name}`,
      reviewData.documentNumber ? `Belegnummer: ${reviewData.documentNumber}` : '',
      'Erstellt aus lokalem OCR-Vorschlag; bitte steuerlich prüfen.',
    ].filter(Boolean).join(' · ');
    const payload: EuerEntryPayload = {
      entryType: 'expense',
      entryDate,
      description,
      category: 'other_expense',
      amount: Number(amount),
      taxRate: Number(reviewData.taxRate || 0),
      notes,
      sourceType: 'receipt',
      sourceId: selectedReceipt.id,
    };

    setBusyId(selectedReceipt.id);
    setError('');
    try {
      const entry = await apiService.createEuerEntry(payload);
      const linked = await apiService.linkReceiptToEuerEntry(selectedReceipt.id, entry.id);
      updateReceiptInState(linked);
      setNotice('EÜR-Ausgabe wurde angelegt und mit dem Beleg verknüpft.');
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : 'Die EÜR-Ausgabe konnte nicht angelegt werden.');
    } finally {
      setBusyId(null);
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

  return (
    <div className="space-y-6">
      <PageHeader icon={FileScan} title={receiptLabel} subtitle="Fotos lokal einlesen, prüfen und mit EÜR-Buchungen verknüpfen">
        <button type="button" onClick={() => onNavigate?.('euer')} className="action-button flex items-center gap-2">
          Zur EÜR<ArrowRight className="h-4 w-4" />
        </button>
        <label className="btn-primary inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-white transition-all hover:brightness-90">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? 'Wird verarbeitet …' : 'Foto hochladen'}
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </PageHeader>

      {(error || notice) && (
        <div className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {error ? <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />}
          <span className="flex-1">{error || notice}</span>
          <button type="button" onClick={() => { setError(''); setNotice(''); }} aria-label="Hinweis schließen"><X className="h-4 w-4" /></button>
        </div>
      )}

      <section className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-blue-950 shadow-sm">
        <div className="flex items-start gap-3">
          <FileScan className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
          <div>
            <h2 className="font-semibold">Lokale OCR mit Bestätigung</h2>
            <p className="mt-1 text-sm leading-6 text-blue-900">
              Das Bild wird im Backend-Container mit Tesseract gelesen. Datum, Lieferant und Beträge sind Vorschläge und werden erst nach deiner Prüfung in die EÜR übernommen.
            </p>
            <p className="mt-2 text-xs text-blue-800">Unterstützt: JPG, PNG und WEBP · maximal 25 MB · keine externe Schnittstelle</p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Gesamt</p><p className="mt-1 text-2xl font-bold text-gray-900">{statistics.total}</p></div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">OCR fertig</p><p className="mt-1 text-2xl font-bold text-emerald-700">{statistics.completed}</p></div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Mit EÜR verknüpft</p><p className="mt-1 text-2xl font-bold text-blue-700">{statistics.linked}</p></div>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-gray-900">Meine {receiptLabel}</h2><p className="mt-1 text-sm text-gray-500">Öffne einen Beleg, prüfe die OCR-Felder und übernimm ihn optional als EÜR-Ausgabe.</p></div>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="action-button flex items-center gap-2" disabled={uploading}><Upload className="h-4 w-4" />Neues Foto</button>
        </div>

        {loading ? <div className="py-12 text-center text-sm text-gray-500">{receiptLabel} werden geladen …</div> : receipts.length === 0 ? (
          <label className="mt-5 block cursor-pointer rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center transition hover:border-primary-custom hover:bg-blue-50">
            <Upload className="mx-auto h-8 w-8 text-gray-400" />
            <p className="mt-3 font-medium text-gray-800">Noch keine {receiptLabel}</p>
            <p className="mt-1 text-sm text-gray-500">Foto auswählen oder direkt mit der Kamera aufnehmen</p>
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {receipts.map(receipt => {
              const data = receipt.extractedData || {};
              const busy = busyId === receipt.id;
              return (
                <article key={receipt.id} className={`rounded-xl border p-4 transition ${selectedReceipt?.id === receipt.id ? 'border-primary-custom shadow-md' : 'border-gray-200 hover:border-gray-300'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><FileScan className="h-5 w-5" /></span><div className="min-w-0"><h3 className="truncate font-medium text-gray-900" title={receipt.name}>{receipt.name}</h3><p className="text-xs text-gray-500">{formatFileSize(receipt.size)} · {formatDate(receipt.createdAt, locale, company.dateFormat)}</p></div></div>
                    <button type="button" onClick={() => void deleteReceipt(receipt)} className="rounded-md p-1 text-gray-400 hover:bg-rose-50 hover:text-rose-700" disabled={busy} aria-label={`${receipt.name} löschen`}><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${receipt.ocrStatus === 'completed' ? 'bg-emerald-50 text-emerald-700' : receipt.ocrStatus === 'failed' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{statusLabels[receipt.ocrStatus]}</span>{receipt.ocrConfidence !== undefined && receipt.ocrConfidence > 0 && <span className="text-xs text-gray-500">{receipt.ocrConfidence.toFixed(0)} % Sicherheit</span>}</div>
                  <dl className="mt-4 space-y-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-gray-500">Lieferant</dt><dd className="truncate font-medium text-gray-800">{data.vendorName || 'Nicht erkannt'}</dd></div><div className="flex justify-between gap-3"><dt className="text-gray-500">Datum</dt><dd className="text-gray-800">{data.documentDate ? formatDate(data.documentDate, locale, company.dateFormat) : 'Nicht erkannt'}</dd></div><div className="flex justify-between gap-3"><dt className="text-gray-500">Brutto</dt><dd className="font-medium text-gray-800">{formatAmount(data.grossAmount)}</dd></div></dl>
                  {receipt.linkedEuerEntryId && <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-blue-700"><Link2 className="h-3.5 w-3.5" />Mit EÜR verknüpft</p>}
                  <div className="mt-4 flex gap-2"><button type="button" onClick={() => void openReview(receipt)} className="action-button flex flex-1 items-center justify-center gap-2"><Pencil className="h-4 w-4" />Prüfen</button>{receipt.ocrStatus === 'failed' && <button type="button" onClick={() => void retryOcr(receipt)} className="action-button px-3" disabled={busy} aria-label="OCR erneut ausführen">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</button>}</div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {selectedReceipt && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-900">Beleg prüfen</h2><p className="mt-1 text-sm text-gray-500">{selectedReceipt.name} · OCR-Vorschläge vor der Übernahme kontrollieren</p></div><button type="button" onClick={() => setSelectedReceipt(null)} className="rounded-md p-1 text-gray-500 hover:bg-gray-100" aria-label="Belegprüfung schließen"><X className="h-5 w-5" /></button></div>
          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-4">
              {selectedReceipt.content && <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50"><img src={`data:${selectedReceipt.contentType};base64,${selectedReceipt.content}`} alt={`Vorschau ${selectedReceipt.name}`} className="max-h-[32rem] w-full object-contain" /></div>}
              <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600"><p className="font-medium text-gray-800">So funktioniert die Zuordnung</p><p className="mt-1 leading-6">Speichere die korrigierten Felder und lege danach eine EÜR-Ausgabe an. Die Anwendung verknüpft die neue Buchung mit diesem Beleg.</p></div>
            </div>
            <div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-gray-700 sm:col-span-2">Lieferant / Aussteller<input value={inputValue(reviewData.vendorName)} onChange={event => updateReviewField('vendorName', event.target.value)} className="form-input mt-1 w-full" /></label>
                <label className="text-sm font-medium text-gray-700">Belegdatum<input type="date" value={inputValue(reviewData.documentDate)} onChange={event => updateReviewField('documentDate', event.target.value)} className="form-input mt-1 w-full" /></label>
                <label className="text-sm font-medium text-gray-700">Belegnummer<input value={inputValue(reviewData.documentNumber)} onChange={event => updateReviewField('documentNumber', event.target.value)} className="form-input mt-1 w-full" /></label>
                <label className="text-sm font-medium text-gray-700">Netto<input inputMode="decimal" value={inputValue(reviewData.netAmount)} onChange={event => updateReviewField('netAmount', event.target.value)} className="form-input mt-1 w-full" /></label>
                <label className="text-sm font-medium text-gray-700">MwSt. Betrag<input inputMode="decimal" value={inputValue(reviewData.taxAmount)} onChange={event => updateReviewField('taxAmount', event.target.value)} className="form-input mt-1 w-full" /></label>
                <label className="text-sm font-medium text-gray-700">Brutto<input inputMode="decimal" value={inputValue(reviewData.grossAmount)} onChange={event => updateReviewField('grossAmount', event.target.value)} className="form-input mt-1 w-full" /></label>
                <label className="text-sm font-medium text-gray-700">MwSt.-Satz in %<input inputMode="decimal" value={inputValue(reviewData.taxRate)} onChange={event => updateReviewField('taxRate', event.target.value)} className="form-input mt-1 w-full" /></label>
                <label className="text-sm font-medium text-gray-700 sm:col-span-2">Kategorie-Vorschlag
                  <select value={reviewData.suggestedCategory || 'other_expense'} onChange={event => updateReviewField('suggestedCategory', event.target.value)} className="form-input mt-1 w-full">
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
              </div>
              <div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => void saveReview()} className="btn-primary flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-white" disabled={savingReview}>{savingReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Prüfung speichern</button><button type="button" onClick={() => void createEuerEntry()} className="action-button flex items-center gap-2" disabled={Boolean(selectedReceipt.linkedEuerEntryId) || busyId === selectedReceipt.id}><Link2 className="h-4 w-4" />{selectedReceipt.linkedEuerEntryId ? 'Bereits in EÜR' : 'Als EÜR-Ausgabe übernehmen'}</button></div>
              {selectedReceipt.ocrError && <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><p className="font-medium">Lokale OCR konnte nicht ausgeführt werden</p><p className="mt-1">{selectedReceipt.ocrError}</p><button type="button" onClick={() => void retryOcr(selectedReceipt)} className="mt-2 inline-flex items-center gap-2 font-medium underline" disabled={busyId === selectedReceipt.id}><RefreshCw className="h-3.5 w-3.5" />Erneut versuchen</button></div>}
              {selectedReceipt.ocrText && <details className="mt-5 rounded-lg border border-gray-200"><summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-700">Erkannten OCR-Text anzeigen</summary><pre className="max-h-60 overflow-auto whitespace-pre-wrap border-t border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">{selectedReceipt.ocrText}</pre></details>}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
