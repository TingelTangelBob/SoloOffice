import { useId, useMemo, useState } from 'react';
import { Building2, Calculator, Database, FileText, Palette, Puzzle, Search, SlidersHorizontal, X, type LucideIcon } from 'lucide-react';
import {
  SETTINGS_AREA_DEFINITIONS,
  SETTINGS_GROUPS,
  type SettingsArea,
} from '../../utils/settingsNavigation';
import { searchSettings, type SettingsSearchResult } from '../../utils/settingsSearch';

const AREA_ICONS: Record<SettingsArea, LucideIcon> = {
  general: Building2,
  invoices: FileText,
  app: SlidersHorizontal,
  extensions: Puzzle,
  taxes: Calculator,
  appearance: Palette,
  system: Database,
};

interface SettingsNavProps {
  activeArea: SettingsArea;
  dirtyAreas: ReadonlySet<SettingsArea>;
  onSelectArea: (area: SettingsArea) => void;
  onSelectResult: (result: SettingsSearchResult) => void;
}

function SettingsSearch({ onSelectResult }: Pick<SettingsNavProps, 'onSelectResult'>) {
  const [query, setQuery] = useState('');
  const inputId = useId();
  const listId = useId();
  const results = useMemo(() => searchSettings(query), [query]);
  const hasQuery = query.trim().length > 0;

  const select = (result: SettingsSearchResult) => {
    onSelectResult(result);
    setQuery('');
  };

  return (
    <div className="settings-search relative">
      <label htmlFor={inputId} className="sr-only">Einstellungen durchsuchen</label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
      <input
        id={inputId}
        type="text"
        inputMode="search"
        enterKeyHint="search"
        value={query}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && results[0]) {
            event.preventDefault();
            select(results[0]);
          }
          if (event.key === 'Escape') setQuery('');
        }}
        placeholder="Einstellung suchen …"
        autoComplete="off"
        aria-controls={hasQuery ? listId : undefined}
        aria-expanded={hasQuery}
        role="combobox"
        aria-autocomplete="list"
        className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary-custom"
      />
      {hasQuery && (
        <button
          type="button"
          onClick={() => setQuery('')}
          className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 min-h-0 min-w-0 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Suche leeren"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {hasQuery && (
        <div id={listId} role="listbox" aria-label="Suchergebnisse" className="settings-search-results">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500">Keine passende Einstellung gefunden.</p>
          ) : results.map(result => (
            <button
              key={`${result.area}-${result.sectionId}`}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => select(result)}
              className="flex w-full min-w-0 flex-col items-start rounded-md px-3 py-2 text-left hover:bg-gray-100 focus-visible:bg-gray-100"
            >
              <span className="truncate text-sm font-medium text-gray-900">{result.sectionTitle}</span>
              <span className="truncate text-xs text-gray-500">{result.areaLabel}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Seitennavigation der Einstellungen. Ab `lg` eine gruppierte Leiste links.
 * Darunter zeigen schmale Geräte alle Bereiche als Chips, die in Zeilen
 * umbrechen: Jeder Bereich ist mit einem Tipp erreichbar, ohne Auswahlfeld
 * und ohne waagerecht scrollende Reiter.
 */
export function SettingsNav({ activeArea, dirtyAreas, onSelectArea, onSelectResult }: SettingsNavProps) {
  return (
    <nav aria-label="Einstellungsbereiche" className="settings-nav">
      <SettingsSearch onSelectResult={onSelectResult} />

      <div className="mt-3 space-y-3 lg:hidden">
        {SETTINGS_GROUPS.map(group => (
          <div key={group.id}>
            <p className="settings-nav-group">{group.label}</p>
            <ul className="mt-1.5 flex flex-wrap gap-2">
              {group.areas.map(area => {
                const Icon = AREA_ICONS[area];
                const active = area === activeArea;
                const dirty = dirtyAreas.has(area);
                return (
                  <li key={area}>
                    <a
                      href={`#settings/${area}`}
                      onClick={event => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                        event.preventDefault();
                        onSelectArea(area);
                      }}
                      aria-current={active ? 'page' : undefined}
                      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${active ? 'border-transparent bg-accent-tint text-primary-on-surface' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{SETTINGS_AREA_DEFINITIONS[area].label}</span>
                      {dirty && <span className="settings-dirty-dot" title="Ungespeicherte Änderungen" aria-label="ungespeichert" />}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-4 hidden space-y-4 lg:block">
        {SETTINGS_GROUPS.map(group => (
          <div key={group.id}>
            <p className="settings-nav-group">{group.label}</p>
            <ul className="mt-1 space-y-0.5">
              {group.areas.map(area => {
                const Icon = AREA_ICONS[area];
                const active = area === activeArea;
                const dirty = dirtyAreas.has(area);
                return (
                  <li key={area}>
                    <a
                      href={`#settings/${area}`}
                      onClick={event => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                        event.preventDefault();
                        onSelectArea(area);
                      }}
                      aria-current={active ? 'page' : undefined}
                      className={`settings-nav-item ${active ? 'settings-nav-item-active' : ''}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{SETTINGS_AREA_DEFINITIONS[area].label}</span>
                      {dirty && <span className="settings-dirty-dot" title="Ungespeicherte Änderungen" aria-label="ungespeichert" />}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
