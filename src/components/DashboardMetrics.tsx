import type { ReactNode } from 'react';
import { ChevronRight, Minus, TrendingDown, TrendingUp } from 'lucide-react';

/**
 * Bausteine der Übersicht.
 *
 * Das Raster folgt einem einheitlichen Kartenaufbau: oben eine große Kennzahl
 * in Festbreitenziffern, darunter eine ruhige Beschreibung, rechts oben ein
 * kompakter Hinweis (Anzahl oder Veränderung). Listen sitzen randlos in der
 * Karte, die weiterführende Aktion steht mittig im Kartenfuß.
 *
 * Die Bausteine verwenden bewusst nur Farbklassen, für die `DynamicColors.tsx`
 * bereits eine Entsprechung im Dunkelmodus definiert. Eigene Farbwerte hätten
 * dort keine Regel und blieben im dunklen Theme unverändert hell.
 */

export type MetricTone = 'neutral' | 'positive' | 'negative' | 'info' | 'warning';

const TONE_CLASS: Record<MetricTone, string> = {
  neutral: 'bg-gray-100 text-gray-600',
  positive: 'bg-emerald-50 text-emerald-700',
  negative: 'bg-rose-50 text-rose-700',
  info: 'bg-blue-50 text-blue-700',
  warning: 'bg-amber-50 text-amber-700',
};

export function MetricCard({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <section className={`flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm ${className}`}>
      {children}
    </section>
  );
}

/**
 * `bordered` trennt Kopf und Inhalt mit einer Linie. Gedacht für Karten, deren
 * Inhalt direkt an der Kartenkante beginnt – Listen und Balken.
 */
export function MetricCardHeader({
  bordered = false,
  className = '',
  children,
}: {
  bordered?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-3 px-4 py-4 lg:px-6 ${
        bordered ? 'border-b border-gray-200' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function MetricCardTitle({ className = '', children }: { className?: string; children: ReactNode }) {
  return <h3 className={`truncate text-base font-semibold text-gray-900 ${className}`}>{children}</h3>;
}

/**
 * Die Kennzahl selbst. Festbreitenziffern halten Beträge über mehrere Karten
 * hinweg auf derselben Rasterbreite, damit die Spalte beim Überfliegen ruhig
 * bleibt.
 */
export function MetricValue({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <p className={`truncate font-mono text-2xl font-semibold leading-none tracking-tight text-gray-900 tabular-nums ${className}`}>
      {children}
    </p>
  );
}

export function MetricCardDescription({ className = '', children }: { className?: string; children: ReactNode }) {
  return <p className={`mt-2 text-xs text-gray-500 ${className}`}>{children}</p>;
}

export function MetricCardContent({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`min-w-0 ${className}`}>{children}</div>;
}

/** Kompakter Hinweis rechts oben in der Kartenkopfzeile. */
export function MetricBadge({
  tone = 'neutral',
  className = '',
  children,
}: {
  tone?: MetricTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Veränderung gegenüber einem Vergleichszeitraum. Das Vorzeichen bestimmt Farbe
 * und Symbol; angezeigt wird der Betrag ohne Vorzeichen, weil Pfeil und Farbe
 * die Richtung bereits tragen.
 */
export function DeltaBadge({
  value,
  formattedValue,
  label,
  className = '',
}: {
  value: number;
  formattedValue: string;
  label?: string;
  className?: string;
}) {
  const tone: MetricTone = value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;

  return (
    <MetricBadge tone={tone} className={className}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{formattedValue}</span>
      {label && <span className="font-normal">{label}</span>}
    </MetricBadge>
  );
}

/**
 * Weiterführende Aktion im Kartenfuß. `mt-auto` hält sie auch dann am unteren
 * Rand, wenn die Karte im Raster auf die Höhe der Nachbarkarte gestreckt wird.
 */
export function MetricCardFooterAction({
  onClick,
  children,
  ariaLabel,
}: {
  onClick: () => void;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <div className="mt-auto border-t border-gray-200 px-4 py-2 lg:px-6">
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className="mx-auto flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-primary-custom transition-colors hover:bg-gray-50"
      >
        {children}
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ShareBarList({ className = '', children, ...rest }: { className?: string; children: ReactNode } & { 'aria-label'?: string }) {
  return (
    <ul className={`flex w-full flex-col ${className}`} {...rest}>
      {children}
    </ul>
  );
}

/**
 * Anteilszeile: Beschriftung links, Betrag rechts, dahinter ein Balken, dessen
 * Breite den Anteil trägt.
 *
 * Der Balken beginnt bündig an der Kartenkante und liegt hinter der
 * Beschriftung – dadurch bleibt für lange Namen die volle Zeilenbreite. Sein
 * Ende bleibt über `calc()` immer links der Betragsspalte: Sonst liefe der
 * Balkenrand mitten durch die Ziffern, und zwar genau dann, wenn die Karte
 * schmal ist.
 */
const VALUE_COLUMN = '7rem';
/** Betragsspalte plus Abstand plus rechter Innenabstand der Zeile. */
const BAR_RESERVE = '9.25rem';

export function ShareBarItem({
  share,
  label,
  value,
}: {
  share: number;
  label: string;
  value: string;
}) {
  const clamped = Math.min(100, Math.max(0, share));
  // Der Rand markiert das Balkenende. Unter etwa einem Drittel Anteil wäre er
  // sonst kaum noch von der Fläche zu unterscheiden.
  const edgeMix = Math.min(100, Math.max(36, clamped * 1.75));

  return (
    <li className="relative flex h-12 min-w-0 items-center gap-3 overflow-hidden px-4 lg:px-6">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 border-r-2 border-solid"
        style={{
          width: `calc((100% - ${BAR_RESERVE}) * ${clamped / 100})`,
          borderRightColor: `color-mix(in srgb, var(--dashboard-bar-color) ${edgeMix}%, transparent)`,
          backgroundImage:
            'linear-gradient(to right, color-mix(in srgb, var(--dashboard-bar-color) 4%, transparent), color-mix(in srgb, var(--dashboard-bar-color) 30%, transparent))',
        }}
      />
      <span className="relative z-10 min-w-0 flex-1 truncate text-sm text-gray-900">{label}</span>
      <span
        className="relative z-10 shrink-0 truncate text-right font-mono text-sm font-medium text-gray-900 tabular-nums"
        style={{ width: VALUE_COLUMN }}
      >
        {value}
      </span>
    </li>
  );
}

export function MetricEmptyState({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-gray-500 lg:px-6">{children}</p>;
}
