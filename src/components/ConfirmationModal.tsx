import { useEffect, useId, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  isGoBDWarning?: boolean;
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Bestätigen',
  cancelText = 'Abbrechen',
  isDestructive = false,
  isGoBDWarning = false
}: ConfirmationModalProps) {
  const titleId = useId();
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    confirmButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md rounded-lg bg-white shadow-lg">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 p-6">
          <div className="flex min-w-0 items-center space-x-3">
            <div className={`p-2 rounded-full ${isGoBDWarning ? 'bg-amber-100' : isDestructive ? 'bg-red-100' : 'bg-primary-custom/10'}`}>
              <AlertTriangle className={`h-6 w-6 ${isGoBDWarning ? 'text-amber-600' : isDestructive ? 'text-red-600' : 'text-primary-custom'}`} />
            </div>
            <h3 id={titleId} className="min-w-0 text-lg font-semibold text-gray-900">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-gray-500 hover:text-gray-700"
            aria-label="Dialog schließen"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {isGoBDWarning && (
            <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <h4 className="text-sm font-semibold text-amber-800 mb-2">
                GoBD-Konformitätshinweis
              </h4>
              <p className="text-sm text-amber-700">
                Nach den Grundsätzen zur ordnungsmäßigen Führung und Aufbewahrung von Büchern (GoBD)
                sind Änderungen an bereits versendeten Rechnungen kritisch zu bewerten.
              </p>
            </div>
          )}

          <p className="whitespace-pre-line leading-relaxed text-gray-600">{message}</p>
        </div>

        <div className="form-action-bar border-t border-gray-200 p-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-50"
          >
            {cancelText}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={handleConfirm}
            className={`rounded-lg px-4 py-2 text-white transition-colors ${
              isDestructive
                ? 'bg-red-600 hover:bg-red-700'
                : isGoBDWarning
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'btn-primary'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
