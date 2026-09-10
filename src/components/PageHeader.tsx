import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

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
  /** Wird nicht mehr dargestellt; siehe `icon`. */
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
 * Überschrift einer Seite samt Seitenaktionen in derselben Zeile.
 *
 * Bis zur Einführung der Kopfleiste war dieser Bereich auf schmalen Geräten
 * fest am oberen Rand verankert und trug dort Symbol, Titel und Untertitel.
 * Die Verortung übernimmt jetzt die Kopfleiste; hier bleibt der Titel als
 * ruhige Überschrift dicht an der oberen linken Ecke.
 */
export function PageHeader({ title, shortTitle, children, actionsTakeOverRow = false }: PageHeaderProps) {
  return (
    <div className="page-header flex w-full flex-nowrap items-center gap-2 tablet:gap-3 lg:gap-4">
      <div className={`min-w-0 basis-0 flex-1 items-center ${actionsTakeOverRow ? 'hidden lg:flex' : 'flex'}`}>
        <h1
          className="min-w-0 truncate text-lg font-semibold leading-tight tracking-tight text-gray-900 lg:text-xl"
          title={title}
        >
          {shortTitle ? <><span className="sm:hidden">{shortTitle}</span><span className="hidden sm:inline">{title}</span></> : title}
        </h1>
      </div>
      {children && (
        <div
          className={`flex min-w-0 items-center justify-end gap-1 whitespace-nowrap sm:gap-2 lg:max-w-none lg:shrink-0 lg:overflow-visible ${
            actionsTakeOverRow ? 'flex-1' : 'max-w-[58%] shrink-0 overflow-x-auto'
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
