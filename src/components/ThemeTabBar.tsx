import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface ThemeTabDefinition<T extends string = string> {
  id: T;
  label: ReactNode;
  icon?: LucideIcon;
  count?: number;
}

interface ThemeTabBarProps<T extends string = string> {
  tabs: readonly ThemeTabDefinition<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * Gemeinsame Tab-Leiste für Seitenbereiche mit mehreren Ansichten.
 * Layout, Touch-Ziel, Overflow und Theme-Farben kommen aus den globalen
 * `theme-tab-*`-Regeln, damit neue Tab-Leisten dieselbe Schnittstelle nutzen.
 */
export function ThemeTabBar<T extends string>({
  tabs,
  activeTab,
  onChange,
  ariaLabel,
  className = '',
}: ThemeTabBarProps<T>) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;

    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : event.key === 'ArrowRight'
          ? (index + 1) % tabs.length
          : (index - 1 + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;

    onChange(nextTab.id);
    requestAnimationFrame(() => tabRefs.current[nextIndex]?.focus());
  };

  return (
    <div className={`theme-tab-bar theme-scrollbar ${className}`.trim()} role="tablist" aria-orientation="horizontal" aria-label={ariaLabel}>
      <div className="theme-tab-list">
        {tabs.map((tab, index) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={event => handleKeyDown(event, index)}
              ref={element => { tabRefs.current[index] = element; }}
              className={`theme-tab-button ${isActive ? 'theme-tab-active' : ''}`.trim()}
            >
              <span className="theme-tab-label">
                {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
                <span className="truncate">{tab.label}</span>
              </span>
              {tab.count !== undefined && (
                <span className="theme-tab-count">{tab.count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
