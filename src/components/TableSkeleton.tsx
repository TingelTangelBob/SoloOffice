/**
 * Ladeplatzhalter für Listen und Karten.
 *
 * Statt eines Kreisels zeigt der Platzhalter schon die Form der kommenden
 * Tabelle: eine Kopfzeile und einige Zeilen mit unterschiedlich breiten
 * Balken. Der Lichtlauf kommt aus `.skeleton` in index.css und steht bei
 * reduzierter Bewegung still. Für Vorlesehilfen bleibt nur der Statustext.
 */

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  /** Statustext für Vorlesehilfen, etwa „Rechnungen werden geladen“. */
  label: string;
  /** Kopfzeile weglassen, wenn die Liste keine Spaltenüberschriften hat. */
  withHeader?: boolean;
  className?: string;
}

/* Breiten je Spalte in Prozent der Zelle, damit die Zeilen nicht wie ein
   Raster wirken. Wiederholt sich ab der sechsten Spalte. */
const CELL_WIDTHS = [72, 48, 84, 56, 40, 64];
/* Leichte Variation je Zeile, sonst sieht jede Zeile gleich aus. */
const ROW_VARIATION = [0, -12, 8, -6, 14, -10, 4, -8];

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton block ${className}`.trim()} />;
}

export function TableSkeleton({ rows = 6, columns = 5, label, withHeader = true, className = '' }: TableSkeletonProps) {
  return (
    <div role="status" aria-live="polite" className={`w-full ${className}`.trim()}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="divide-y divide-gray-100">
        {withHeader && (
          <div className="flex items-center gap-4 bg-gray-50 px-4 py-3">
            {Array.from({ length: columns }, (_, column) => (
              <span key={column} className="skeleton h-2.5" style={{ width: `${Math.max(24, CELL_WIDTHS[column % CELL_WIDTHS.length] * 0.5)}%`, maxWidth: '8rem', flex: '1 1 0' }} />
            ))}
          </div>
        )}
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: columns }, (_, column) => {
              const width = Math.min(96, Math.max(28, CELL_WIDTHS[column % CELL_WIDTHS.length] + ROW_VARIATION[row % ROW_VARIATION.length]));
              return (
                <span key={column} className="flex-1">
                  <span className="skeleton block h-3" style={{ width: `${width}%` }} />
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
