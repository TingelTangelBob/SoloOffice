import type { FormEventHandler, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';

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
  zIndexClassName?: string;
}

const sizeClasses: Record<NonNullable<DialogShellProps['size']>, string> = {
  md: 'max-w-md',
  lg: 'max-w-3xl',
  wide: 'max-w-5xl',
  xl: 'max-w-6xl',
};

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
  zIndexClassName = 'z-50',
}: DialogShellProps) {
  const content = (
    <>
      {/* Zusätzliche Kopfaktionen (etwa der Umschalter Auftrag/Urlaub) stehen
          auf schmalen Geräten in einer eigenen Zeile über dem Titel. Nebeneinander
          bliebe für die Beschreibung sonst nur ein Wort pro Zeile übrig. */}
      <header
        className={`flex shrink-0 items-start justify-between gap-x-4 gap-y-3 bg-white px-5 py-4 sm:flex-nowrap sm:px-10 sm:py-7 ${
          headerActions ? 'flex-wrap' : 'flex-nowrap'
        }`}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-5">
          {Icon && (
            <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-primary-light-custom text-primary-custom sm:h-[60px] sm:w-[60px]">
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
        <div
          className={`flex shrink-0 items-center justify-end gap-2 ${
            headerActions ? 'order-first w-full sm:order-none sm:w-auto' : ''
          }`}
        >
          {headerActions}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
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
      className={`fixed inset-0 ${zIndexClassName} flex items-center justify-center overflow-hidden bg-gray-950/55 p-3 backdrop-blur-[2px] sm:p-5`}
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {onSubmit ? (
        <form
          onSubmit={onSubmit}
          onChange={onChange}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`grid h-[calc(100dvh-1.5rem)] max-h-[calc(100dvh-1.5rem)] w-full ${sizeClasses[size]} grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl bg-white shadow-2xl sm:h-[calc(100dvh-2.5rem)] sm:max-h-[calc(100dvh-2.5rem)]`}
        >
          {content}
        </form>
      ) : (
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`grid h-[calc(100dvh-1.5rem)] max-h-[calc(100dvh-1.5rem)] w-full ${sizeClasses[size]} grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl bg-white shadow-2xl sm:h-[calc(100dvh-2.5rem)] sm:max-h-[calc(100dvh-2.5rem)]`}
        >
          {content}
        </section>
      )}
    </div>
  );
}
