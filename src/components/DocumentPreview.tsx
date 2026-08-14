import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Edit,
  ExternalLink,
  File,
  FileText,
  Image,
  Loader2,
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
  Send,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { useCustomers } from '../context/CustomerContext';
import { downloadBlob, generateInvoicePDF, generateJobPDF, generateQuotePDF } from '../utils/pdfGenerator';
import type { PreviewDocument } from '../utils/previewDocuments';
import { getTerminology } from '../utils/terminology';
import logger from '../utils/logger';

interface DocumentPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  documents?: PreviewDocument[];
  initialIndex?: number;
  onEdit?: (document: PreviewDocument) => void;
  onSend?: (document: PreviewDocument) => void;
  onReject?: (document: PreviewDocument) => void | Promise<void>;
}

interface PreparedDocument {
  blob: Blob;
  fileName: string;
}

const TOOL_BUTTON = 'document-preview-tool-button inline-flex h-10 w-10 min-h-0 min-w-0 shrink-0 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-custom disabled:cursor-not-allowed disabled:opacity-40';

function attachmentBlob(document: PreviewDocument): Blob {
  if (!document.content) throw new Error('Der Dateiinhalt fehlt.');
  const binary = atob(document.content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: document.contentType || 'application/octet-stream' });
}

function effectiveContentType(document?: PreviewDocument): string {
  if (!document) return '';
  if (document.type === 'invoice-pdf' && document.pdfFormat === 'xrechnung') return 'application/xml';
  if (document.type !== 'attachment') return 'application/pdf';
  return document.contentType || '';
}

function formatFileSize(bytes?: number): string | null {
  if (!bytes || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fileTypeLabel(contentType: string): string {
  if (contentType === 'application/pdf') return 'PDF';
  if (contentType === 'application/xml' || contentType === 'text/xml') return 'XML';
  if (contentType.startsWith('image/')) return 'Bild';
  if (contentType.startsWith('text/')) return 'Textdatei';
  return contentType || 'Datei';
}

function FileTypeIcon({ contentType, className = 'h-5 w-5' }: { contentType: string; className?: string }) {
  if (contentType.startsWith('image/')) return <Image className={className} aria-hidden="true" />;
  if (contentType === 'application/pdf' || contentType.includes('xml')) return <FileText className={className} aria-hidden="true" />;
  return <File className={className} aria-hidden="true" />;
}

export function DocumentPreview({ isOpen, onClose, documents = [], initialIndex = 0, onEdit, onSend, onReject }: DocumentPreviewProps) {
  const { company } = useCompany();
  const { customers } = useCustomers();
  const terminology = getTerminology(company.terminologyProfile);
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewBlobRef = useRef<Blob | null>(null);
  const loadedFileNameRef = useRef<string | null>(null);
  const loadedDocumentIdRef = useRef<string | null>(null);
  const loadSequenceRef = useRef(0);

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCompact, setIsCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isActionPending, setIsActionPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const currentDocument = documents[currentIndex];
  const contentType = effectiveContentType(currentDocument);
  const isPdf = contentType === 'application/pdf';
  const isImage = contentType.startsWith('image/');
  const isText = contentType.startsWith('text/') || contentType === 'application/xml';
  const canPreview = isPdf || isImage || isText;
  const canEdit = Boolean(onEdit && currentDocument && currentDocument.type !== 'attachment' && isPdf);
  const canSend = Boolean(onSend && currentDocument?.type === 'invoice-pdf' && currentDocument.invoice?.status === 'draft');
  const canReject = Boolean(onReject && currentDocument?.type === 'quote-pdf' && currentDocument.quote?.status === 'sent');

  const releasePreview = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    previewBlobRef.current = null;
    loadedFileNameRef.current = null;
    loadedDocumentIdRef.current = null;
    setPreviewUrl(null);
  }, []);

  const prepareDocument = useCallback(async (document: PreviewDocument): Promise<PreparedDocument> => {
    if (document.type === 'attachment') {
      return { blob: attachmentBlob(document), fileName: document.name };
    }

    if (document.type === 'invoice-pdf' && document.invoice) {
      const customer = customers.find(entry => entry.id === document.invoice?.customerId);
      if (!customer) throw new Error(`${terminology.entity.singular} nicht gefunden.`);
      const format = document.pdfFormat || 'zugferd';
      const blob = await generateInvoicePDF(document.invoice, { format, company, customer });
      const fileName = format === 'xrechnung'
        ? `${document.invoice.invoiceNumber}_xrechnung.xml`
        : `${document.invoice.invoiceNumber}${format === 'zugferd' ? '' : `_${format}`}.pdf`;
      return { blob, fileName };
    }

    if (document.type === 'job-pdf' && document.job) {
      const customer = customers.find(entry => entry.id === document.job?.customerId);
      if (!customer) throw new Error(`${terminology.entity.singular} nicht gefunden.`);
      const blob = await generateJobPDF(document.job, { company, customer });
      const number = document.job.jobNumber || document.job.id.slice(-8).toUpperCase();
      return { blob, fileName: `${terminology.work.confirmationLabel}_${number}.pdf` };
    }

    if (document.type === 'quote-pdf' && document.quote) {
      const customer = customers.find(entry => entry.id === document.quote?.customerId);
      if (!customer) throw new Error(`${terminology.entity.singular} nicht gefunden.`);
      const blob = await generateQuotePDF(document.quote, { company, customer });
      return { blob, fileName: `${document.quote.quoteNumber.replace(/\//g, '-')}.pdf` };
    }

    throw new Error('Das Dokument enthält keine gültigen Vorschaudaten.');
  }, [company, customers, terminology]);

  const loadDocument = useCallback(async () => {
    if (!currentDocument) {
      releasePreview();
      setError(null);
      setIsLoading(false);
      return;
    }

    const sequence = ++loadSequenceRef.current;
    releasePreview();
    setIsLoading(true);
    setError(null);

    try {
      const prepared = await prepareDocument(currentDocument);
      if (sequence !== loadSequenceRef.current) return;
      const url = URL.createObjectURL(prepared.blob);
      previewUrlRef.current = url;
      previewBlobRef.current = prepared.blob;
      loadedFileNameRef.current = prepared.fileName;
      loadedDocumentIdRef.current = currentDocument.id;
      setPreviewUrl(url);
    } catch (loadError) {
      if (sequence !== loadSequenceRef.current) return;
      logger.error('Fehler beim Laden der Dokumentvorschau:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Das Dokument konnte nicht geladen werden.');
    } finally {
      if (sequence === loadSequenceRef.current) setIsLoading(false);
    }
  }, [currentDocument, prepareDocument, releasePreview]);

  const navigateDocument = useCallback((direction: -1 | 1) => {
    setCurrentIndex(index => Math.min(Math.max(index + direction, 0), Math.max(documents.length - 1, 0)));
  }, [documents.length]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const updateCompactState = () => setIsCompact(mediaQuery.matches);
    updateCompactState();
    mediaQuery.addEventListener('change', updateCompactState);
    return () => mediaQuery.removeEventListener('change', updateCompactState);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setCurrentIndex(Math.min(Math.max(initialIndex, 0), Math.max(documents.length - 1, 0)));
    setIsExpanded(false);
  }, [documents.length, initialIndex, isOpen]);

  useEffect(() => {
    setZoom(100);
    setRotation(0);
    if (isOpen) void loadDocument();
    return () => { loadSequenceRef.current += 1; };
  }, [currentDocument?.id, isOpen, loadDocument]);

  useEffect(() => {
    if (isOpen) return;
    loadSequenceRef.current += 1;
    releasePreview();
    setError(null);
  }, [isOpen, releasePreview]);

  useEffect(() => () => {
    loadSequenceRef.current += 1;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'Tab') {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], iframe, object, [tabindex]:not([tabindex="-1"])',
        ) || []).filter(element => !element.hasAttribute('hidden'));
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
        return;
      }

      const target = event.target as HTMLElement | null;
      const isEditing = target?.matches('input, textarea, select, [contenteditable="true"]');
      if (isEditing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowLeft' && currentIndex > 0) navigateDocument(-1);
      if (event.key === 'ArrowRight' && currentIndex < documents.length - 1) navigateDocument(1);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, documents.length, isOpen, navigateDocument, onClose]);

  const handleDownload = async () => {
    if (!currentDocument || isDownloading) return;
    setIsDownloading(true);
    setError(null);
    try {
      const prepared = loadedDocumentIdRef.current === currentDocument.id && previewBlobRef.current && loadedFileNameRef.current
        ? { blob: previewBlobRef.current, fileName: loadedFileNameRef.current }
        : await prepareDocument(currentDocument);
      downloadBlob(prepared.blob, prepared.fileName);
    } catch (downloadError) {
      logger.error('Fehler beim Herunterladen des Dokuments:', downloadError);
      setError(downloadError instanceof Error ? downloadError.message : 'Das Dokument konnte nicht heruntergeladen werden.');
    } finally {
      setIsDownloading(false);
    }
  };

  const openInNewTab = () => {
    if (!previewUrl) return;
    const openedWindow = window.open(previewUrl, '_blank', 'noopener,noreferrer');
    if (openedWindow) openedWindow.opener = null;
  };

  const handleEdit = () => {
    if (currentDocument && onEdit) onEdit(currentDocument);
  };

  const handleSend = () => {
    if (currentDocument && onSend) onSend(currentDocument);
  };

  const handleReject = async () => {
    if (!currentDocument || !onReject || isActionPending) return;
    setIsActionPending(true);
    setError(null);
    try {
      await onReject(currentDocument);
    } catch (actionError) {
      logger.error('Fehler beim Ändern des Dokumentstatus:', actionError);
      setError(actionError instanceof Error ? actionError.message : 'Der Dokumentstatus konnte nicht geändert werden.');
    } finally {
      setIsActionPending(false);
    }
  };

  if (!isOpen) return null;

  const sizeLabel = formatFileSize(currentDocument?.size || previewBlobRef.current?.size);

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center overflow-hidden bg-gray-950/70 backdrop-blur-[2px] sm:p-4"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={isLoading}
        className={`grid min-h-0 w-full grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-white shadow-2xl ${
          isExpanded
            ? 'h-[100dvh] max-w-none rounded-none'
            : 'h-[100dvh] max-w-7xl rounded-none sm:h-[calc(100dvh-2rem)] sm:rounded-2xl'
        }`}
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="flex min-w-0 items-center gap-3 border-b border-gray-200 bg-white px-3 py-2.5 sm:px-5 sm:py-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-light-custom text-primary-custom">
            <FileTypeIcon contentType={contentType} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-sm font-semibold text-gray-900 sm:text-base">
              {currentDocument?.name || 'Dokumentvorschau'}
            </h2>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className={TOOL_BUTTON} title="Vorschau schließen" aria-label="Vorschau schließen">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex min-w-0 items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-2 py-1.5 sm:px-4">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto py-0.5">
            {documents.length > 1 && (
              <div className="flex shrink-0 items-center gap-1 border-r border-gray-200 pr-2">
                <button type="button" onClick={() => navigateDocument(-1)} disabled={currentIndex === 0} className={TOOL_BUTTON} title="Vorheriges Dokument" aria-label="Vorheriges Dokument">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => navigateDocument(1)} disabled={currentIndex === documents.length - 1} className={TOOL_BUTTON} title="Nächstes Dokument" aria-label="Nächstes Dokument">
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            )}

            {isImage && canPreview && (
              <div className="flex shrink-0 items-center gap-1 border-r border-gray-200 pr-2">
                <button type="button" onClick={() => setZoom(value => Math.max(value - 25, 25))} disabled={zoom <= 25} className={TOOL_BUTTON} title="Verkleinern" aria-label="Verkleinern">
                  <ZoomOut className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => setZoom(100)} className="document-preview-tool-button h-10 min-h-0 min-w-[3.5rem] shrink-0 rounded-lg px-2 text-xs font-medium tabular-nums text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-custom" title="Originalgröße">
                  {zoom} %
                </button>
                <button type="button" onClick={() => setZoom(value => Math.min(value + 25, 300))} disabled={zoom >= 300} className={TOOL_BUTTON} title="Vergrößern" aria-label="Vergrößern">
                  <ZoomIn className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => setRotation(value => (value + 90) % 360)} className={TOOL_BUTTON} title="Im Uhrzeigersinn drehen" aria-label="Im Uhrzeigersinn drehen">
                  <RotateCw className="h-5 w-5" />
                </button>
                {(zoom !== 100 || rotation !== 0) && (
                  <button type="button" onClick={() => { setZoom(100); setRotation(0); }} className={TOOL_BUTTON} title="Ansicht zurücksetzen" aria-label="Ansicht zurücksetzen">
                    <RotateCcw className="h-5 w-5" />
                  </button>
                )}
              </div>
            )}

            {previewUrl && canPreview && (
              <button type="button" onClick={openInNewTab} className={`${TOOL_BUTTON} gap-2 px-2.5 sm:w-auto`} title="In neuem Tab öffnen" aria-label="In neuem Tab öffnen">
                <ExternalLink className="h-5 w-5" />
                <span className="hidden whitespace-nowrap sm:inline">Neuer Tab</span>
              </button>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {canEdit && (
              <button type="button" onClick={handleEdit} className={`${TOOL_BUTTON} gap-2 px-2.5 sm:w-auto`} title="Bearbeiten" aria-label="Bearbeiten">
                <Edit className="h-5 w-5" />
                <span className="hidden whitespace-nowrap sm:inline">Bearbeiten</span>
              </button>
            )}
            {canSend && (
              <button type="button" onClick={handleSend} className={`${TOOL_BUTTON} gap-2 px-2.5 sm:w-auto`} title="Rechnung versenden" aria-label="Rechnung versenden">
                <Send className="h-5 w-5" />
                <span className="hidden whitespace-nowrap sm:inline">Versenden</span>
              </button>
            )}
            {canReject && (
              <button type="button" onClick={() => void handleReject()} disabled={isActionPending} className={`${TOOL_BUTTON} gap-2 px-2.5 text-rose-600 hover:text-rose-700 sm:w-auto`} title="Als abgelehnt markieren" aria-label="Als abgelehnt markieren">
                <X className="h-5 w-5" />
                <span className="hidden whitespace-nowrap sm:inline">Ablehnen</span>
              </button>
            )}
            <button type="button" onClick={() => setIsExpanded(value => !value)} className={`${TOOL_BUTTON} hidden sm:inline-flex`} title={isExpanded ? 'Fensteransicht' : 'Ansicht ausfüllen'} aria-label={isExpanded ? 'Fensteransicht' : 'Ansicht ausfüllen'}>
              {isExpanded ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </button>
            <button type="button" onClick={() => void handleDownload()} disabled={isDownloading || !currentDocument} className="btn-primary inline-flex h-10 min-h-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50" title="Dokument herunterladen">
              {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="hidden sm:inline">Herunterladen</span>
            </button>
          </div>
        </div>

        <div className="relative min-h-0 overflow-hidden bg-gray-200 p-2 sm:p-4">
          {isLoading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-gray-100/90 text-gray-600" role="status">
              <Loader2 className="h-9 w-9 animate-spin text-primary-custom" />
              <p className="text-sm">Dokument wird vorbereitet …</p>
            </div>
          )}

          {!isLoading && error && (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-md rounded-xl border border-rose-200 bg-white p-6 text-center shadow-sm">
                <File className="mx-auto h-10 w-10 text-rose-500" />
                <h3 className="mt-3 font-semibold text-gray-900">Vorschau nicht verfügbar</h3>
                <p className="mt-1 text-sm text-gray-600">{error}</p>
                <button type="button" onClick={() => void loadDocument()} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-rose-600 px-4 text-sm font-medium text-white hover:bg-rose-700">
                  Erneut versuchen
                </button>
              </div>
            </div>
          )}

          {!isLoading && !error && !currentDocument && (
            <div className="flex h-full items-center justify-center text-sm text-gray-600">Kein Dokument ausgewählt.</div>
          )}

          {!isLoading && !error && currentDocument && !canPreview && (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
                <FileTypeIcon contentType={contentType} className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-3 font-semibold text-gray-900">Keine integrierte Vorschau</h3>
                <p className="mt-1 text-sm text-gray-600">Dieser Dateityp kann hier nicht sicher angezeigt werden. Die Datei kann direkt heruntergeladen werden.</p>
              </div>
            </div>
          )}

          {!isLoading && !error && previewUrl && isImage && (
            <div className="h-full overflow-auto rounded-lg bg-[linear-gradient(45deg,#e5e7eb_25%,transparent_25%),linear-gradient(-45deg,#e5e7eb_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e5e7eb_75%),linear-gradient(-45deg,transparent_75%,#e5e7eb_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] p-6">
              <div className="flex min-h-full min-w-full items-center justify-center">
                <img
                  src={previewUrl}
                  alt={currentDocument.name}
                  className="max-w-none rounded-sm bg-white shadow-lg transition-transform duration-200"
                  style={{ width: `${zoom}%`, transform: `rotate(${rotation}deg)` }}
                />
              </div>
            </div>
          )}

          {!isLoading && !error && previewUrl && isPdf && isCompact && (
            <div className="flex h-full items-center justify-center">
              <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
                <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-light-custom text-primary-custom">
                  <FileText className="h-8 w-8" />
                </span>
                <h3 className="mt-4 truncate font-semibold text-gray-900">{currentDocument.name}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">Mobile Browser zeigen eingebettete PDFs nicht zuverlässig. Öffnen Sie das Dokument in einem neuen Tab oder laden Sie es herunter.</p>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <button type="button" onClick={openInNewTab} className="btn-primary inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-white">
                    <ExternalLink className="h-4 w-4" /> Öffnen
                  </button>
                  <button type="button" onClick={() => void handleDownload()} disabled={isDownloading} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    <Download className="h-4 w-4" /> Herunterladen
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Das PDF-Modul des Browsers stellt häufig ein leeres contentDocument
              bereit, obwohl die Vorschau bereits sichtbar ist. Deshalb wird
              die Einbettung nicht per Timeout ersetzt. */}
          {!isLoading && !error && previewUrl && isPdf && !isCompact && (
            <iframe
              src={`${previewUrl}#view=FitH&toolbar=1&navpanes=0`}
              className="h-full w-full rounded-lg border-0 shadow-sm"
              title={`Vorschau von ${currentDocument.name}`}
            />
          )}

          {!isLoading && !error && previewUrl && isText && (
            <iframe src={previewUrl} sandbox="" className="h-full w-full rounded-lg border-0 bg-white shadow-sm" title={`Vorschau von ${currentDocument.name}`} />
          )}
        </div>

        <footer className="flex min-h-10 items-center justify-between gap-3 border-t border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 sm:px-5">
          <span className="min-w-0 truncate">{[fileTypeLabel(contentType), sizeLabel].filter(Boolean).join(' · ')}</span>
          {documents.length > 1 && <span className="hidden shrink-0 md:inline">Mit ← und → zwischen Dokumenten wechseln</span>}
        </footer>
      </section>
    </div>
  );
}
