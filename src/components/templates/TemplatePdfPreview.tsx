import { useEffect, useRef, useState } from 'react';
import type { Company, DocumentTemplate } from '../../types';
import { generateTemplatePreview } from '../../utils/templatePreview';

interface TemplatePdfPreviewProps {
  template: DocumentTemplate;
  company: Company;
  large?: boolean;
}

const PREVIEW_DEBOUNCE_MS = 300;

export function TemplatePdfPreview({ template, company, large = false }: TemplatePdfPreviewProps) {
  const previewUrlRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('Vorlagenvorschau.pdf');
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
          setFileName(result.fileName);
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

  return (
    <div className={large ? 'flex min-h-0 flex-col items-center gap-3' : 'space-y-2'}>
      {isLoading && <p className="text-sm text-gray-500" role="status">PDF-Vorschau wird erzeugt …</p>}
      {error && (
        <div className="w-full max-w-xl rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}
      {previewUrl && (
        <>
          <object
            data={previewUrl}
            type="application/pdf"
            aria-label={`${template.name} als PDF`}
            className={large ? 'h-[min(68dvh,700px)] w-[min(100%,520px)] rounded border border-gray-300 bg-white shadow-sm' : 'h-[min(48vw,420px)] w-full rounded border border-gray-300 bg-white'}
          >
            <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-sm text-gray-600">
              <span>Die PDF-Darstellung wird in diesem Browser nicht eingebettet.</span>
              <a className="font-medium text-primary-custom underline" href={previewUrl} target="_blank" rel="noreferrer">PDF in neuem Fenster öffnen</a>
            </div>
          </object>
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-gray-500">
            <span>Beispieldokument</span>
            <a className="font-medium text-primary-custom underline" href={previewUrl} download={fileName}>PDF herunterladen</a>
            <a className="font-medium text-primary-custom underline" href={previewUrl} target="_blank" rel="noreferrer">In neuem Fenster öffnen</a>
          </div>
        </>
      )}
    </div>
  );
}
