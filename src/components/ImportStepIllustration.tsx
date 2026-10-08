import type { ReactNode, SVGProps } from 'react';

export type ImportIllustrationStep = 'upload' | 'detect' | 'check' | 'finish';

interface ImportStepIllustrationProps {
  step: ImportIllustrationStep;
  className?: string;
}

/**
 * Ruhige Strichzeichnungen für die Kurzanleitung der Datenübernahme. Die
 * Motive tragen keine eigenen Farben: Konturen folgen der Textfarbe,
 * getönte Flächen und Haken der Akzentfarbe des Themes.
 */
type StrokeProps = Omit<SVGProps<SVGElement>, 'ref'>;

const line: StrokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  vectorEffect: 'non-scaling-stroke',
};
const thin: StrokeProps = { ...line, strokeWidth: 1.1 };
const accent: StrokeProps = { ...line, stroke: 'var(--primary-color)', strokeWidth: 2 };

const motives: Record<ImportIllustrationStep, ReactNode> = {
  upload: (
    <>
      {/* Datei mit zwei Textzeilen */}
      <rect x={22} y={5} width={20} height={15} rx={1.5} {...line} />
      <path d="M26 10h12M26 14h8" {...thin} />
      {/* Pfeil in die Ablage */}
      <path d="M32 21v8" {...line} />
      <path d="M27.5 24.5 32 29l4.5-4.5" {...accent} />
      {/* Ablagefläche */}
      <path d="M6 31h52v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" fill="var(--accent-tint)" />
      <rect x={6} y={31} width={52} height={12} rx={2} {...line} />
    </>
  ),
  detect: (
    <>
      {/* Tabelle mit Kopfzeile */}
      <path d="M7 9h26v7H7z" fill="var(--accent-tint)" />
      <rect x={7} y={9} width={26} height={30} rx={1.5} {...line} />
      <path d="M7 16h26M7 24h26M7 32h26M16 9v30M25 9v30" {...thin} />
      {/* Erkannte Kategorien */}
      <path d="M33 13h11M33 24h11M33 35h11" {...thin} />
      <rect x={44} y={9} width={14} height={8} rx={2} {...line} />
      <rect x={44} y={20} width={14} height={8} rx={2} {...line} />
      <rect x={44} y={31} width={14} height={8} rx={2} {...line} />
    </>
  ),
  check: (
    <>
      {/* Geprüfte Zeilen */}
      <rect x={6} y={6} width={33} height={36} rx={2} {...line} />
      <path d="M11 15.5 13 18l4-5M11 24.5 13 27l4-5M11 33.5 13 36l4-5" {...accent} />
      <path d="M21 17h13M21 26h13M21 35h13" {...thin} />
      {/* Prüfblick auf die Summen */}
      <circle cx={48} cy={23} r={9} {...line} />
      <path d="M54.5 29.5 59 34" {...line} />
      <path d="M43.5 23 47 26.5l5.5-7" {...accent} />
    </>
  ),
  finish: (
    <>
      {/* Abgeschlossene Übernahme */}
      <rect x={28} y={7} width={30} height={34} rx={2} {...line} />
      <path d="M36 16h16M36 24h16M36 32h12" {...thin} />
      <circle cx={21} cy={24} r={14} {...line} fill="var(--accent-tint)" />
      <path d="M14 24.5 19.5 30l9-12" {...accent} strokeWidth={2.6} />
    </>
  ),
};

export function ImportStepIllustration({ step, className = 'h-12 w-16' }: ImportStepIllustrationProps) {
  return (
    <svg viewBox="0 0 64 48" className={className} role="presentation" aria-hidden="true" focusable="false">
      {motives[step]}
    </svg>
  );
}
