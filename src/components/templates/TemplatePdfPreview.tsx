import { useEffect, useId, useRef, useState } from 'react';
import { Download, FileText, Loader2, Maximize2, X } from 'lucide-react';
import type { Company, DocumentTemplate } from '../../types';
import { generateTemplatePreview, renderTemplatePreviewPages } from '../../utils/templatePreview';
import type { PreviewOperation, PreviewPage } from '../../utils/pdf/previewRecorder';

const PREVIEW_DEBOUNCE_MS = 80;

const fontFamilies: Record<string, string> = {
  helvetica: 'Helvetica, Arial, sans-serif',
  times: '"Times New Roman", Times, serif',
  courier: '"Courier New", Courier, monospace',
};

const textAnchors = { left: 'start', center: 'middle', right: 'end' } as const;

function PreviewShape({ operation }: { operation: PreviewOperation }) {
  switch (operation.kind) {
    case 'rect':
      return (
        <rect
          x={operation.x}
          y={operation.y}
          width={operation.width}
          height={operation.height}
          fill={operation.fill ?? 'none'}
          stroke={operation.stroke ?? 'none'}
          strokeWidth={operation.lineWidth}
        />
      );
    case 'line':
      return <line x1={operation.x1} y1={operation.y1} x2={operation.x2} y2={operation.y2} stroke={operation.stroke} strokeWidth={operation.lineWidth} />;
    case 'image':
      return <image href={operation.href} x={operation.x} y={operation.y} width={operation.width} height={operation.height} preserveAspectRatio="none" />;
    case 'text':
      return (
        <>
          {operation.lines.map((line, index) => (
            <text
              key={index}
              x={operation.x}
              y={operation.y + index * operation.lineStep}
              fill={operation.color}
              fontSize={operation.fontSize}
              fontFamily={fontFamilies[operation.family] || fontFamilies.helvetica}
              fontWeight={operation.style.includes('bold') ? 700 : 400}
              fontStyle={operation.style.includes('italic') ? 'italic' : 'normal'}
              textAnchor={textAnchors[operation.align]}
              letterSpacing={operation.charSpace || undefined}
              style={{ whiteSpace: 'pre' }}
            >
              {line}
            </text>
          ))}
        </>
      );
  }
}

function PreviewSheet({ page }: { page: PreviewPage }) {
  return (
    <svg viewBox="0 0 210 297" className="block h-auto w-full" style={{ backgroundColor: '#ffffff' }} aria-hidden="true">
      {page.map((operation, index) => <PreviewShape key={index} operation={operation} />)}
    </svg>
  );
}

interface TemplateDocumentPreviewProps {
  template: DocumentTemplate;
  company: Company;
}

/**
 * Sofortige Vorschau einer Vorlage: Der PDF-Renderer zeichnet dieselben
 * Seiten als SVG, ohne eine PDF-Datei zu laden. Ein Klick öffnet das echte PDF.
 */
export function TemplateDocumentPreview({ template, company }: TemplateDocumentPreviewProps) {
  const [pages, setPages] = useState<PreviewPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    const timeoutId = window.setTimeout(() => {
      void renderTemplatePreviewPages(template, company)
        .then(result => {
          if (generation !== generationRef.current) return;
          setPages(result);
          setError(null);
        })
        .catch(() => {
          if (generation === generationRef.current) setError('Die Vorschau konnte nicht erstellt werden. Bitte prüfen Sie Logo- und Vorlagendaten.');
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [company, template]);

  return (
    <>
      {error && <div className="mb-3 w-full max-w-[720px] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
      <button
        type="button"
        onClick={() => setPdfOpen(true)}
        className="group relative block w-full max-w-[720px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-custom focus-visible:ring-offset-2"
        aria-label="Vorschau als PDF öffnen"
      >
        <span className="flex flex-col gap-4">
          {pages
            ? pages.map((page, index) => (
                <span key={index} className="block overflow-hidden rounded-sm shadow-[0_1px_3px_rgb(15_23_42/0.12),0_8px_24px_rgb(15_23_42/0.08)]">
                  <PreviewSheet page={page} />
                </span>
              ))
            : <span className="block aspect-[210/297] w-full animate-pulse rounded-sm" style={{ backgroundColor: '#ffffff' }} />}
        </span>
        <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-md bg-gray-900/80 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" /> Als PDF öffnen
        </span>
      </button>
      {pdfOpen && <TemplatePdfDialog template={template} company={company} onClose={() => setPdfOpen(false)} />}
    </>
  );
}

interface TemplatePdfDialogProps {
  template: DocumentTemplate;
  company: Company;
  onClose: () => void;
}

/** Echtes PDF der Vorlage in einem Dialog, erst beim Öffnen erzeugt. */
function TemplatePdfDialog({ template, company, onClose }: TemplatePdfDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    void generateTemplatePreview(template, company)
      .then(result => {
        if (!active) return;
        createdUrl = URL.createObjectURL(result.blob);
        setUrl(createdUrl);
        setFileName(result.fileName);
      })
      .catch(() => {
        if (active) setError('Das PDF konnte nicht erstellt werden.');
      });
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [company, template]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>('[data-preview-close]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 sm:p-4"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="grid h-[100dvh] w-full max-w-4xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-white shadow-2xl sm:h-[calc(100dvh-2rem)] sm:rounded-2xl"
      >
        <header className="flex min-w-0 items-center gap-3 border-b border-gray-200 px-3 py-2.5 sm:px-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-light-custom text-primary-custom">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 sm:text-base">{fileName || 'PDF-Vorschau'}</h2>
          {url && (
            <a
              href={url}
              download={fileName}
              className="inline-flex h-10 w-10 min-h-0 min-w-0 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              title="Herunterladen"
              aria-label="PDF herunterladen"
            >
              <Download className="h-5 w-5" />
            </a>
          )}
          <button type="button" onClick={onClose} data-preview-close className="inline-flex h-10 w-10 min-h-0 min-w-0 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900" aria-label="Vorschau schließen">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="relative min-h-0 bg-gray-200 p-2 sm:p-4">
          {!url && !error && (
            <div className="absolute inset-0 flex items-center justify-center" role="status">
              <span className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-gray-600 shadow"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />PDF wird erzeugt …</span>
            </div>
          )}
          {error && <div className="mx-auto max-w-xl rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
          {url && <iframe src={`${url}#view=FitH&toolbar=0&navpanes=0`} title={fileName} className="h-full w-full rounded-lg border-0 bg-white shadow-sm" />}
        </div>
      </div>
    </div>
  );
}
