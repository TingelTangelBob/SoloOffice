import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';

export type DashboardEmptyVariant =
  | 'chart'
  | 'bars'
  | 'customers'
  | 'calendar'
  | 'jobs'
  | 'series'
  | 'invoices'
  | 'paid'
  | 'quotes'
  | 'receipts'
  | 'metric';

/**
 * Kleine Illustrationen für leere Kacheln.
 *
 * Bewusst als Inline-SVG im Stil der Lucide-Symbole: Linien in der
 * Akzentfarbe (`currentColor`), Flächen als zarte Tönung derselben Farbe,
 * Hilfslinien neutral. Die Klassen stehen in `index.css`
 * (`.dashboard-empty-illustration`) und folgen damit auch dem Dunkelmodus.
 */
function Illustration({ variant }: { variant: DashboardEmptyVariant }) {
  switch (variant) {
    case 'chart':
      return <>
        <rect className="empty-fill" x="8" y="8" width="104" height="66" rx="12" />
        <path className="empty-muted" d="M22 60h76M22 44h76M22 28h76" strokeDasharray="2 6" />
        <path className="empty-soft" d="M22 60 L40 54 L56 57 L74 40 L96 30 L96 60 Z" />
        <path className="empty-line" d="M22 60 L40 54 L56 57 L74 40 L96 30" />
        <circle className="empty-surface" cx="96" cy="30" r="5" />
        <circle className="empty-line" cx="96" cy="30" r="5" />
      </>;
    case 'bars':
      return <>
        <rect className="empty-fill" x="8" y="8" width="104" height="66" rx="12" />
        <path className="empty-muted" d="M20 62h80" />
        <rect className="empty-soft" x="26" y="44" width="8" height="18" rx="2" />
        <rect className="empty-line" x="36" y="36" width="8" height="26" rx="2" />
        <rect className="empty-soft" x="54" y="38" width="8" height="24" rx="2" />
        <rect className="empty-line" x="64" y="48" width="8" height="14" rx="2" />
        <rect className="empty-soft" x="82" y="30" width="8" height="32" rx="2" />
        <rect className="empty-line" x="92" y="40" width="8" height="22" rx="2" />
      </>;
    case 'customers':
      return <>
        <circle className="empty-fill" cx="60" cy="42" r="34" />
        <circle className="empty-muted" cx="80" cy="34" r="8" />
        <path className="empty-muted" d="M68 62c1-8 6-13 12-13s11 5 12 13" />
        <circle className="empty-surface" cx="52" cy="32" r="10" />
        <circle className="empty-line" cx="52" cy="32" r="10" />
        <path className="empty-surface" d="M34 64c1-11 8-18 18-18s17 7 18 18Z" />
        <path className="empty-line" d="M34 64c1-11 8-18 18-18s17 7 18 18" />
      </>;
    case 'calendar':
      return <>
        <rect className="empty-fill" x="20" y="14" width="80" height="60" rx="10" />
        <path className="empty-line" d="M20 30h80" />
        <path className="empty-line" d="M40 8v12M80 8v12" />
        <rect className="empty-line" x="20" y="14" width="80" height="60" rx="10" />
        <path className="empty-muted" d="M34 44h8M52 44h8M70 44h8M34 58h8M52 58h8" />
        <rect className="empty-soft" x="68" y="53" width="12" height="10" rx="3" />
      </>;
    case 'jobs':
      return <>
        <rect className="empty-fill" x="26" y="12" width="68" height="62" rx="10" />
        <rect className="empty-line" x="26" y="12" width="68" height="62" rx="10" />
        <rect className="empty-surface" x="46" y="6" width="28" height="12" rx="4" />
        <rect className="empty-line" x="46" y="6" width="28" height="12" rx="4" />
        <path className="empty-line" d="M38 36l4 4 7-8" />
        <path className="empty-muted" d="M56 36h26M56 52h20" />
        <circle className="empty-muted" cx="43" cy="52" r="4" />
      </>;
    case 'series':
      return <>
        <rect className="empty-fill" x="34" y="10" width="56" height="40" rx="9" />
        <rect className="empty-soft" x="26" y="20" width="56" height="40" rx="9" />
        <rect className="empty-surface" x="18" y="30" width="56" height="40" rx="9" />
        <rect className="empty-line" x="18" y="30" width="56" height="40" rx="9" />
        <path className="empty-muted" d="M28 44h20M28 56h30" />
        <path className="empty-line" d="M90 58a14 14 0 1 1-4-10M86 40v8h8" />
      </>;
    case 'invoices':
      return <>
        <path className="empty-fill" d="M32 8h40l18 18v48a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6V14a6 6 0 0 1 6-6Z" />
        <path className="empty-line" d="M32 8h40l18 18v48a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6V14a6 6 0 0 1 6-6Z" />
        <path className="empty-line" d="M72 8v12a6 6 0 0 0 6 6h12" />
        <path className="empty-muted" d="M38 38h20M38 50h36M38 62h16" />
        <path className="empty-line" d="M80 60a7 7 0 1 0 0 8M72 62h8M72 66h7" />
      </>;
    case 'paid':
      return <>
        <path className="empty-fill" d="M30 10h36l16 16v44a6 6 0 0 1-6 6H30a6 6 0 0 1-6-6V16a6 6 0 0 1 6-6Z" />
        <path className="empty-muted" d="M32 36h22M32 48h30M32 60h14" />
        <circle className="empty-surface" cx="80" cy="56" r="16" />
        <circle className="empty-line" cx="80" cy="56" r="16" />
        <path className="empty-line" d="M72 56l6 6 10-12" />
      </>;
    case 'quotes':
      return <>
        <path className="empty-fill" d="M30 8h44l16 16v48a6 6 0 0 1-6 6H30a6 6 0 0 1-6-6V14a6 6 0 0 1 6-6Z" />
        <path className="empty-line" d="M30 8h44l16 16v48a6 6 0 0 1-6 6H30a6 6 0 0 1-6-6V14a6 6 0 0 1 6-6Z" />
        <path className="empty-muted" d="M36 30h24M36 42h40" />
        <path className="empty-line" d="M36 62c5-8 9-8 11 0s6 6 10-1 7-5 10 1" />
      </>;
    case 'receipts':
      return <>
        <path className="empty-fill" d="M34 8h52v66l-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5-6.5 5Z" />
        <path className="empty-line" d="M34 8h52v66l-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5-6.5 5Z" />
        <path className="empty-muted" d="M44 24h32M44 36h20M44 48h26" />
        <path className="empty-line" d="M68 48h8M68 58h8" />
      </>;
    case 'metric':
    default:
      return <>
        <rect className="empty-fill" x="16" y="14" width="88" height="56" rx="12" />
        <path className="empty-muted" d="M30 32h28" />
        <path className="empty-line" d="M30 50h40" />
        <path className="empty-line" d="M80 54l7-8 7 4 8-12" />
      </>;
  }
}

export function DashboardEmptyState({ variant, title, description, action, compact = false }: {
  variant: DashboardEmptyVariant;
  title: string;
  description?: ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  /** Für schmale Kennzahl-Kacheln: kleinere Illustration, weniger Abstand. */
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-1 flex-col items-center justify-center text-center ${compact ? 'gap-2 px-4 py-4' : 'gap-3 px-4 py-8 lg:px-6'}`}>
      <svg
        viewBox="0 0 120 84"
        className={`dashboard-empty-illustration shrink-0 ${compact ? 'h-12 w-[4.5rem]' : 'h-20 w-28'}`}
        aria-hidden="true"
        focusable="false"
      >
        <Illustration variant={variant} />
      </svg>
      <div className="max-w-xs">
        <p className="text-sm font-medium text-gray-900">{title}</p>
        {description && <p className="mt-1 text-xs text-gray-500">{description}</p>}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-primary-custom transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {action.label}
        </button>
      )}
    </div>
  );
}
