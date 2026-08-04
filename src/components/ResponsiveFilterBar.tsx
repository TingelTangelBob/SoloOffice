import { createContext, ReactNode, SelectHTMLAttributes, useContext, useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';

interface ResponsiveFilterBarProps {
  search: ReactNode;
  filters: ReactNode;
  hasActiveFilters?: boolean;
}

const FilterPanelContext = createContext(false);

export function FilterSelect({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const isFilterOpen = useContext(FilterPanelContext);

  return (
    <div className="relative min-w-0">
      <select
        {...props}
        className={`w-full appearance-none !pr-10 ${className}`}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 transition-transform duration-200 ${
          isFilterOpen ? 'rotate-180' : ''
        }`}
      />
    </div>
  );
}

export function ResponsiveFilterBar({ search, filters, hasActiveFilters = false }: ResponsiveFilterBarProps) {
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  return (
    <FilterPanelContext.Provider value={isFilterOpen}>
      <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm sm:p-4">
        <div className="flex min-w-0 items-center gap-2 lg:gap-4">
          <button
            type="button"
            onClick={() => setIsFilterOpen((open) => !open)}
            className={`order-1 inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors lg:hidden ${
              hasActiveFilters || isFilterOpen
                ? 'border-primary-custom bg-primary-custom/10 text-primary-custom'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
            aria-expanded={isFilterOpen}
            aria-label="Filter anzeigen"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">Filter</span>
          </button>
          <div className="order-2 hidden shrink-0 items-center gap-2 lg:flex">{filters}</div>
          <div className="order-3 min-w-0 flex-1 lg:ml-auto lg:max-w-[22rem]">{search}</div>
        </div>

        {isFilterOpen && <div className="mt-3 grid gap-2 border-t border-gray-100 pt-3 lg:hidden">{filters}</div>}
      </div>
    </FilterPanelContext.Provider>
  );
}
