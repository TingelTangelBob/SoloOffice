import { useContext, useEffect, useRef, useState, type FormEventHandler, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';
import { FeedbackContext } from '../context/FeedbackContext';

interface DialogShellProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  onChange?: FormEventHandler<HTMLFormElement>;
  size?: 'md' | 'lg' | 'wide' | 'xl';
  /** Kleine Dialoge wachsen mit dem Inhalt und scrollen erst am Maximalmaß. */
  fitContent?: boolean;
  zIndexClassName?: string;
  /**
   * Fragt bei Klick auf den Hintergrund, bei Esc und beim Schließen-Knopf nach,
   * sobald Eingaben vorliegen. Jede Änderung eines Feldes im Dialog zählt.
   * Dialoge, die ihre Schließen-Rückfrage selbst führen, bleiben ohne diese Option.
   */
  unsavedChangesGuard?: boolean;
  /** Ergänzt Änderungen, die kein Feld auslösen (etwa Auswahl per Schaltfläche). */
  isDirty?: boolean;
}

const sizeClasses: Record<NonNullable<DialogShellProps['size']>, string> = {
  md: 'max-w-md',
  lg: 'max-w-3xl',
  wide: 'max-w-5xl',
  xl: 'max-w-6xl',
};

const openDialogs: Array<{ id: symbol; close: () => void }> = [];
let escapeListenerAttached = false;
const handleDialogEscape = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const closeTopDialog = openDialogs.at(-1)?.close;
  if (!closeTopDialog) return;
  event.preventDefault();
  closeTopDialog();
};

const FOCUSABLE_SELECTOR = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]';

function getFocusableItems(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(item => !item.hasAttribute('disabled') && item.getAttribute('tabindex') !== '-1' && item.getClientRects().length > 0);
}

export function DialogShell({
  title,
  description,
  icon: Icon,
  titleId,
  onClose,
  children,
  footer,
  headerActions,
  onSubmit,
  onChange,
  size = 'lg',
  fitContent = false,
  zIndexClassName = 'z-50',
  unsavedChangesGuard = false,
  isDirty = false,
}: DialogShellProps) {
  const dialogId = useRef(Symbol('dialog'));
  const dialogRef = useRef<HTMLFormElement & HTMLElement>(null);
  // Auslöser vor dem ersten Rendern merken, denn ein `autoFocus`-Element im
  // Inhalt verschiebt den Fokus schon beim Einhängen.
  const [triggerElement] = useState<HTMLElement | null>(() => (
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null
  ));
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const feedback = useContext(FeedbackContext);
  const [fieldsEdited, setFieldsEdited] = useState(false);
  const hasChanges = unsavedChangesGuard && Boolean(feedback) && (fieldsEdited || isDirty);
  const hasChangesRef = useRef(hasChanges);
  hasChangesRef.current = hasChanges;
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  const confirmPending = useRef(false);

  // Ohne Eingaben schließt der Dialog sofort. Mit Eingaben fragt die bestehende
  // Rückfrage nach; „Weiter bearbeiten“ lässt den Dialog offen.
  const requestClose = async () => {
    if (confirmPending.current) return;
    const currentFeedback = feedbackRef.current;
    if (!hasChangesRef.current || !currentFeedback) {
      closeRef.current();
      return;
    }
    confirmPending.current = true;
    try {
      const discard = await currentFeedback.confirm({
        title: 'Ungespeicherte Änderungen',
        message: 'Es gibt ungespeicherte Eingaben. Möchten Sie diese wirklich verwerfen?',
        confirmText: 'Änderungen verwerfen',
        cancelText: 'Weiter bearbeiten',
        isDestructive: true,
      });
      if (discard) closeRef.current();
    } finally {
      confirmPending.current = false;
    }
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    const entry = { id: dialogId.current, close: () => { void requestCloseRef.current(); } };
    openDialogs.push(entry);
    if (!escapeListenerAttached) {
      document.addEventListener('keydown', handleDialogEscape);
      escapeListenerAttached = true;
    }
    return () => {
      const dialogIndex = openDialogs.findIndex(dialog => dialog.id === entry.id);
      if (dialogIndex !== -1) openDialogs.splice(dialogIndex, 1);
      if (!openDialogs.length && escapeListenerAttached) {
        document.removeEventListener('keydown', handleDialogEscape);
        escapeListenerAttached = false;
      }
    };
  }, []);

  // Fokus: beim Öffnen in den Dialog (ein bereits fokussiertes Feld im Inhalt
  // bleibt unangetastet), Tab bleibt im obersten Dialog, beim Schließen
  // zurück zum Auslöser.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    if (!dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      if (openDialogs.at(-1)?.id !== dialogId.current) return;
      const target = event.target;
      if (!(target instanceof Node) || !dialog.contains(target)) return;
      const items = getFocusableItems(dialog);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (target === first || target === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && target === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trapTab);
    return () => {
      document.removeEventListener('keydown', trapTab);
      const active = document.activeElement;
      if (triggerElement && (!active || active === document.body || dialog.contains(active))) {
        // Seiten rendern ihre Knöpfe beim Öffnen teils neu (etwa die Seitenaktionen
        // der Kopfleiste); dann dient die Beschriftung als Ersatz-Auslöser.
        const label = triggerElement.getAttribute('aria-label');
        const target = triggerElement.isConnected
          ? triggerElement
          : (label ? document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(label)}"]`) : null);
        target?.focus({ preventScroll: true });
      }
    };
  }, [triggerElement]);

  const dialogHeightClass = fitContent
    ? 'h-auto max-h-[calc(100dvh-1.5rem)] sm:max-h-[min(calc(100dvh-2.5rem),42rem)]'
    : 'h-[calc(100dvh-1.5rem)] max-h-[calc(100dvh-1.5rem)] sm:h-[calc(100dvh-2.5rem)] sm:max-h-[calc(100dvh-2.5rem)]';
  const dialogGridClass = fitContent
    ? 'grid-rows-[auto_minmax(0,1fr)_auto]'
    : 'grid-rows-[auto_minmax(0,1fr)_auto]';
  const compactHeader = size === 'md';
  const content = (
    <>
      {/* Zusätzliche Kopfaktionen (etwa der Umschalter Auftrag/Urlaub) stehen
          auf schmalen Geräten in einer eigenen Zeile über dem Titel. Nebeneinander
          bliebe für die Beschreibung sonst nur ein Wort pro Zeile übrig. */}
      <header
        className={`flex shrink-0 items-start justify-between gap-x-4 gap-y-3 bg-white px-5 py-4 sm:flex-nowrap ${compactHeader ? 'sm:px-6 sm:py-5' : 'sm:px-10 sm:py-7'} ${
          headerActions ? 'flex-wrap' : 'flex-nowrap'
        }`}
      >
        {compactHeader ? (
          /* Schmale Dialoge (max-w-md): Symbol links, Titel und Beschreibung in
             einer Spalte rechts davon. Die Beschreibung sitzt direkt unter dem
             Titel und beginnt auf dessen Linie. Titel und Symbol bleiben eine
             Stufe kleiner, sonst bricht „Materialvorlage bearbeiten“ neben dem
             Symbol um. */
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {Icon && (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-primary-light-custom text-primary-custom sm:h-12 sm:w-12">
                <Icon className="h-6 w-6" />
              </div>
            )}
            <div className="min-w-0">
              <h2 id={titleId} className="min-w-0 text-lg font-semibold leading-tight text-gray-900 sm:text-xl">
                {title}
              </h2>
              {description && <p className="mt-1 text-sm leading-5 text-gray-500 sm:text-base sm:leading-6">{description}</p>}
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-start gap-5">
            {/* Auf dem Handy ohne Symbolkachel: Sie nahm ein Viertel der Breite,
                der Untertitel lief dadurch über vier bis fünf schmale Zeilen. */}
            {Icon && (
              <div className="mt-0.5 hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-primary-light-custom text-primary-custom sm:flex sm:h-[60px] sm:w-[60px]">
                <Icon className="h-6 w-6 sm:h-8 sm:w-8" />
              </div>
            )}
            <div className="min-w-0">
              <h2 id={titleId} className="text-xl font-semibold leading-tight text-gray-900 sm:text-3xl">
                {title}
              </h2>
              {description && <p className="mt-1 text-sm leading-6 text-gray-500 sm:text-lg sm:leading-7">{description}</p>}
            </div>
          </div>
        )}
        <div
          className={`flex shrink-0 items-center justify-end gap-2 ${
            headerActions ? 'order-first w-full sm:order-none sm:w-auto' : ''
          }`}
        >
          {headerActions}
          <button
            type="button"
            onClick={() => { void requestClose(); }}
            className="inline-flex h-10 w-10 min-h-0 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
            aria-label="Dialog schließen"
          >
            <X className="h-6 w-6 sm:h-7 sm:w-7" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-8 sm:py-2">
        {children}
      </div>

      {footer && (
        <footer className="form-action-bar shrink-0 border-t border-gray-200 bg-white px-5 py-4 sm:px-8 sm:py-5">
          {footer}
        </footer>
      )}
    </>
  );

  return (
    <div
      className={`dialog-overlay fixed inset-0 ${zIndexClassName} flex items-center justify-center overflow-hidden bg-gray-950/55 p-3 backdrop-blur-[2px] sm:p-5`}
      onMouseDown={event => {
        if (event.target === event.currentTarget) void requestClose();
      }}
      onChangeCapture={unsavedChangesGuard ? () => setFieldsEdited(true) : undefined}
    >
      {onSubmit ? (
        <form
          onSubmit={onSubmit}
          onChange={onChange}
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`focus:outline-none form-consistent-fields grid ${dialogHeightClass} w-full ${sizeClasses[size]} ${dialogGridClass} overflow-hidden rounded-lg bg-white shadow-2xl`}
        >
          {content}
        </form>
      ) : (
        <section
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`focus:outline-none form-consistent-fields grid ${dialogHeightClass} w-full ${sizeClasses[size]} ${dialogGridClass} overflow-hidden rounded-lg bg-white shadow-2xl`}
        >
          {content}
        </section>
      )}
    </div>
  );
}
