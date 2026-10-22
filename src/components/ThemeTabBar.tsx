import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/** Innenabstand des Unterstrichs zum Tab-Rand, entspricht `left/right: 0.625rem` in `.theme-tab-button::after`. */
const INDICATOR_INSET = 10;
/** So viel vom Nachbartab bleibt sichtbar, wenn ein Tab ins Bild gescrollt wird. */
const REVEAL_PEEK = 32;

/**
 * Gemeinsame Tab-Leiste für Seitenbereiche mit mehreren Ansichten.
 * Layout, Touch-Ziel, Overflow und Theme-Farben kommen aus den globalen
 * `theme-tab-*`-Regeln, damit neue Tab-Leisten dieselbe Schnittstelle nutzen.
 *
 * Der Unterstrich ist ein einzelnes Element, das zum aktiven Tab gleitet. Er
 * wird nach jedem Wechsel und bei Größenänderungen neu vermessen und erst
 * nach der ersten Messung eingefügt – ein frisch eingefügtes Element hat
 * keinen Übergang, deshalb fährt er beim Aufbau der Seite nicht von links ein.
 *
 * Passt die Leiste nicht in die Breite, scrollt sie ohne sichtbare
 * Scrollleiste (die sich sonst über die Beschriftung legt); weiche Ränder
 * zeigen, dass weitere Tabs folgen, und ein angeklickter, halb verdeckter Tab
 * wird samt Ansatz des Nachbarn ins Bild gescrollt.
 */
export function ThemeTabBar<T extends string>({
  tabs,
  activeTab,
  onChange,
  ariaLabel,
  className = '',
}: ThemeTabBarProps<T>) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const barRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const updateOverflow = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    const start = bar.scrollLeft > 1;
    const end = bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1;
    setOverflow(previous => (previous.start === start && previous.end === end ? previous : { start, end }));
  }, []);

  const revealTab = useCallback((index: number) => {
    const bar = barRef.current;
    const button = tabRefs.current[index];
    if (!bar || !button || bar.scrollWidth <= bar.clientWidth) return;
    const barRect = bar.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const behavior: ScrollBehavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (buttonRect.left - REVEAL_PEEK < barRect.left) {
      bar.scrollBy({ left: buttonRect.left - REVEAL_PEEK - barRect.left, behavior });
    } else if (buttonRect.right + REVEAL_PEEK > barRect.right) {
      bar.scrollBy({ left: buttonRect.right + REVEAL_PEEK - barRect.right, behavior });
    }
  }, []);
  // Die Tab-Liste kommt von vielen Aufrufern als neues Array je Render; der
  // Effekt hängt deshalb an den IDs, nicht an der Array-Identität.
  const tabsKey = tabs.map(tab => tab.id).join('|');

  useLayoutEffect(() => {
    const index = tabs.findIndex(tab => tab.id === activeTab);
    const button = tabRefs.current[index];
    const list = listRef.current;
    if (!button || !list) {
      setIndicator(null);
      return;
    }
    const measure = () => {
      const next = {
        left: button.offsetLeft + INDICATOR_INSET,
        width: Math.max(0, button.offsetWidth - INDICATOR_INSET * 2),
      };
      setIndicator(previous => (previous && previous.left === next.left && previous.width === next.width ? previous : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(button);
    observer.observe(list);
    return () => observer.disconnect();
    // `tabs` selbst ist absichtlich keine Abhängigkeit, siehe `tabsKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, tabsKey]);

  useEffect(() => {
    revealTab(tabs.findIndex(tab => tab.id === activeTab));
    // Nur bei einem Wechsel des aktiven Tabs, siehe `tabsKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, revealTab, tabsKey]);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    updateOverflow();
    bar.addEventListener('scroll', updateOverflow, { passive: true });
    if (typeof ResizeObserver === 'undefined') return () => bar.removeEventListener('scroll', updateOverflow);
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(bar);
    if (listRef.current) observer.observe(listRef.current);
    return () => {
      bar.removeEventListener('scroll', updateOverflow);
      observer.disconnect();
    };
  }, [updateOverflow, tabsKey]);

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
    <div
      ref={barRef}
      className={`theme-tab-bar ${overflow.start ? 'theme-tab-bar-fade-start' : ''} ${overflow.end ? 'theme-tab-bar-fade-end' : ''} ${className}`.replace(/\s+/g, ' ').trim()}
      role="tablist"
      aria-orientation="horizontal"
      aria-label={ariaLabel}
    >
      <div ref={listRef} className="theme-tab-list">
        {indicator && indicator.width > 0 && (
          <span
            aria-hidden="true"
            className="theme-tab-indicator theme-tab-indicator-animated"
            style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
          />
        )}
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
              onClick={() => {
                // Ein Wechsel scrollt über den Effekt; ein erneuter Klick auf
                // den aktiven, halb verdeckten Tab scrollt direkt.
                if (isActive) revealTab(index);
                onChange(tab.id);
              }}
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
