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
      className="dialog-overlay fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="confirmation-dialog w-full max-w-md rounded-lg shadow-lg">
        <div className="confirmation-dialog-header flex items-center justify-between gap-3 border-b p-6">
          <div className="flex min-w-0 items-center space-x-3">
            <div className={`confirmation-dialog-icon rounded-full p-2 ${isGoBDWarning ? 'confirmation-dialog-icon--warning' : isDestructive ? 'confirmation-dialog-icon--destructive' : ''}`}>
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h3 id={titleId} className="confirmation-dialog-title min-w-0 text-lg font-semibold">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="confirmation-dialog-close shrink-0"
            aria-label="Dialog schließen"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="confirmation-dialog-content p-6">
          {isGoBDWarning && (
            <div className="confirmation-dialog-warning mb-4 rounded-lg border p-4">
              <h4 className="mb-2 text-sm font-semibold">
                GoBD-Konformitätshinweis
              </h4>
              <p className="text-sm">
                Nach den Grundsätzen zur ordnungsmäßigen Führung und Aufbewahrung von Büchern (GoBD)
                sind Änderungen an bereits versendeten Rechnungen kritisch zu bewerten.
              </p>
            </div>
          )}

          <p className="confirmation-dialog-message whitespace-pre-line leading-relaxed">{message}</p>
        </div>

        <div className="confirmation-dialog-actions form-action-bar border-t p-6">
          <button
            type="button"
            onClick={onClose}
            className="confirmation-dialog-cancel rounded-lg border px-4 py-2 transition-colors"
          >
            {cancelText}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={handleConfirm}
            className={`confirmation-dialog-confirm rounded-lg px-4 py-2 transition-colors ${
              isDestructive
                ? 'confirmation-dialog-confirm--destructive'
                : isGoBDWarning
                ? 'confirmation-dialog-confirm--warning'
                : ''
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
