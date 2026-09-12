import { ReactNode, useEffect, useState } from 'react';
import { LucideIcon } from 'lucide-react';
import { createPortal } from 'react-dom';

interface PageHeaderProps {
  /**
   * Wird nicht mehr dargestellt. Die Eigenschaft bleibt erhalten, weil rund
   * dreißig Seiten sie übergeben; die Ansicht ist inzwischen über
   * Seitenleiste und Kopfleiste eindeutig, ein zusätzliches Symbol schob den
   * Titel nur von der Ecke weg.
   */
  icon?: LucideIcon;
  title: string;
  shortTitle?: string;
  /**
   * Alte Seitenbeschreibung für die bestehende Seiten-API. Seitentitel
   * bleiben bewusst ruhig und zeigen keine zusätzliche Info-Schaltfläche.
   */
  subtitle?: string;
  children?: ReactNode;
  /**
   * Überlässt dem Aktionsbereich auf schmalen Geräten die ganze Kopfzeile.
   * Gedacht für eine aufgeklappte Suche: Sie braucht dort mehr Platz, als der
   * feste Anteil neben dem Seitentitel hergibt. Ab `lg` bleibt das Layout gleich.
   */
  actionsTakeOverRow?: boolean;
}

/**
 * Registriert den Titel und die Aktionen der aktuellen Ansicht in der
 * zentralen Kopfleiste. Der unsichtbare Platzhalter hält den vertikalen
 * Abstand der bestehenden Seitenlayouts stabil, während die sichtbare
 * Darstellung nur einmal in der Topbar erscheint.
 */
export function PageHeader({ title, shortTitle, children, actionsTakeOverRow = false }: PageHeaderProps) {
  // `actionsTakeOverRow` bleibt als API-Kompatibilität erhalten. Die Topbar
  // steuert die verfügbare Breite jetzt zentral für alle Ansichten.
  void actionsTakeOverRow;
  const [targets, setTargets] = useState<{ title: HTMLElement; actions: HTMLElement } | null>(null);

  useEffect(() => {
    const titleTarget = document.getElementById('topbar-page-title');
    const actionsTarget = document.getElementById('topbar-page-actions');
    if (titleTarget && actionsTarget) setTargets({ title: titleTarget, actions: actionsTarget });
  }, []);

  if (!targets) {
    return (
      <div className="page-header flex w-full flex-nowrap items-center gap-2 tablet:gap-3 lg:gap-4">
        <div className="flex min-w-0 basis-0 flex-1 items-center">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="min-w-0 truncate text-lg font-semibold leading-tight tracking-tight text-gray-900 lg:text-xl" title={title}>
              {shortTitle ? <><span className="sm:hidden">{shortTitle}</span><span className="hidden sm:inline">{title}</span></> : title}
            </h1>
          </div>
        </div>
        {children && <div className="flex min-w-0 items-center justify-end gap-1 whitespace-nowrap sm:gap-2">{children}</div>}
      </div>
    );
  }

  return (
    <>
      {createPortal(
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="topbar-page-title min-w-0 truncate text-base font-semibold tracking-tight text-gray-900 lg:text-lg" title={title}>
            {shortTitle ? <><span className="sm:hidden">{shortTitle}</span><span className="hidden sm:inline">{title}</span></> : title}
          </h1>
        </div>,
        targets.title,
      )}
      {children && createPortal(
        <div className="topbar-page-actions flex min-w-0 items-center justify-end gap-1 whitespace-nowrap sm:gap-2">
          {children}
        </div>,
        targets.actions,
      )}
      <span className="page-header-placeholder" aria-hidden="true" />
    </>
  );
}
