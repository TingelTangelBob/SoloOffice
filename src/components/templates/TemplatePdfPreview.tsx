import { useEffect, useRef, useState } from 'react';
import { Edit, FileText, Loader2, Maximize, Minimize, X } from 'lucide-react';
import type { Company, DocumentTemplate } from '../../types';
import { generateTemplatePreview } from '../../utils/templatePreview';

interface TemplatePdfPreviewDialogProps {
  titleId: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onClose: () => void;
  onEdit?: () => void;
}

interface TemplatePdfPreviewProps {
  template: DocumentTemplate;
  company: Company;
  large?: boolean;
  /**
   * Als eigenständiger Vorschaudialog rendern – mit derselben Kopfleiste wie
   * die Dokumentvorschau der Rechnungen und Aufträge (Name, Werkzeuge,
   * Schließen), damit sich beide Vorschauen gleich bedienen lassen.
   */
  dialog?: TemplatePdfPreviewDialogProps;
}

const PREVIEW_DEBOUNCE_MS = 300;
const TOOL_BUTTON = 'inline-flex h-10 w-10 min-h-0 min-w-0 shrink-0 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-custom';

export function TemplatePdfPreview({ template, company, large = false, dialog }: TemplatePdfPreviewProps) {
  const previewUrlRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    const previousUrl = previewUrlRef.current;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setError(null);
    setIsLoading(true);

    const timeoutId = window.setTimeout(() => {
      void generateTemplatePreview(template, company)
        .then(result => {
          if (generation !== generationRef.current) return;
          const nextUrl = URL.createObjectURL(result.blob);
          previewUrlRef.current = nextUrl;
          setPreviewUrl(nextUrl);
        })
        .catch(() => {
          if (generation !== generationRef.current) return;
          setError('Die PDF-Vorschau konnte nicht erstellt werden. Bitte prüfen Sie Logo- und Vorlagendaten.');
        })
        .finally(() => {
          if (generation === generationRef.current) setIsLoading(false);
        });
    }, PREVIEW_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [company, template]);

  const iframeSrc = previewUrl ? `${previewUrl}#view=FitH&toolbar=1&navpanes=0` : undefined;

  if (dialog) {
    return (
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <header className="flex min-w-0 items-center gap-2 border-b border-gray-200 bg-white px-3 py-2.5 sm:gap-3 sm:px-5 sm:py-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-light-custom text-primary-custom">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 id={dialog.titleId} className="min-w-0 truncate text-sm font-semibold text-gray-900 sm:text-base">{template.name}</h2>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {dialog.onEdit && (
              <button type="button" onClick={dialog.onEdit} className={TOOL_BUTTON} title="Vorlage bearbeiten" aria-label="Vorlage bearbeiten">
                <Edit className="h-5 w-5" />
              </button>
            )}
            <button type="button" onClick={dialog.onToggleExpanded} className={`${TOOL_BUTTON} hidden sm:inline-flex`} title={dialog.expanded ? 'Fensteransicht' : 'Ansicht auffüllen'} aria-label={dialog.expanded ? 'Fensteransicht' : 'Ansicht auffüllen'}>
              {dialog.expanded ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </button>
            <button type="button" onClick={dialog.onClose} className={TOOL_BUTTON} title="Vorschau schließen" aria-label="Vorschau schließen" data-preview-close>
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="relative min-h-0 overflow-hidden bg-gray-200 p-2 sm:p-4">
          {isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-200/80" role="status">
              <span className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-gray-600 shadow"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />PDF-Vorschau wird erzeugt …</span>
            </div>
          )}
          {error && (
            <div className="mx-auto max-w-xl rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>
          )}
          {iframeSrc && (
            <iframe src={iframeSrc} title={`${template.name} als PDF`} className="h-full w-full rounded-lg border-0 bg-white shadow-sm" />
          )}
        </div>

      </div>
    );
  }

  return (
    <div className={large ? 'flex min-h-0 flex-col items-center gap-3' : 'space-y-2'}>
      {isLoading && <p className="text-sm text-gray-500" role="status">PDF-Vorschau wird erzeugt …</p>}
      {error && (
        <div className="w-full max-w-xl rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}
      {previewUrl && iframeSrc && (
        <div className={large ? 'flex min-h-0 w-full max-w-[760px] overflow-hidden rounded-lg border border-gray-300 bg-gray-100 shadow-sm' : 'space-y-2'}>
          <iframe
            src={iframeSrc}
            title={`${template.name} als PDF`}
            className={large ? 'h-[min(78dvh,820px)] w-full border-0 bg-white' : 'h-[min(48vw,420px)] w-full rounded border-0 bg-white'}
          />
        </div>
      )}
    </div>
  );
}
