import { ReactNode } from 'react';

interface BulkSelectionHeaderProps {
  itemLabel: string;
  itemLabelPlural: string;
  visibleCount: number;
  selectedCount: number;
  allSelected: boolean;
  onSelectAll: (checked: boolean) => void;
  children?: ReactNode;
}

export function BulkSelectionHeader({
  itemLabel,
  itemLabelPlural,
  visibleCount,
  selectedCount,
  allSelected,
  onSelectAll,
  children,
}: BulkSelectionHeaderProps) {
  return (
    <div className="flex h-10 flex-nowrap items-center justify-between gap-2 overflow-x-auto overflow-y-hidden border-b border-gray-200 bg-gray-50 px-3 py-1 sm:px-4">
      <label className="flex min-h-8 cursor-pointer items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={allSelected && visibleCount > 0}
          onChange={(event) => onSelectAll(event.target.checked)}
          className="custom-checkbox"
          aria-label={`Alle ${itemLabelPlural} auswählen`}
        />
        <span>Alle auswählen</span>
      </label>

      {selectedCount > 0 && (
        <span className="mr-auto whitespace-nowrap text-xs font-medium text-primary-custom">
          {selectedCount} {selectedCount === 1 ? itemLabel : itemLabelPlural} ausgewählt
        </span>
      )}

      {selectedCount > 0 && (
        <div className="flex shrink-0 items-center justify-end gap-1.5">
          {children}
        </div>
      )}
    </div>
  );
}
