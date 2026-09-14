import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { SortDirection } from '../utils/tableSort';

interface SortableTableHeaderProps {
  label: string;
  sortKey: string;
  activeKey: string;
  direction: SortDirection;
  onSort: (key: string) => void;
  className?: string;
  align?: 'left' | 'right';
  labelHidden?: boolean;
}

export function SortableTableHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  className = '',
  align = 'left',
  labelHidden = false,
}: SortableTableHeaderProps) {
  const active = activeKey === sortKey;
  const Icon = active ? (direction === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown;

  return (
    <th scope="col" aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'} className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex min-h-0 w-full items-center gap-1 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-custom ${align === 'right' ? 'justify-end text-right' : 'justify-start text-left'}`}
        aria-label={`${label} sortieren`}
        title={`${label} sortieren`}
      >
        <span className={labelHidden ? 'sr-only' : undefined}>{label}</span>
        <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-primary-custom' : 'text-gray-400'}`} aria-hidden="true" />
      </button>
    </th>
  );
}
