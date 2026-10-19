import {
  SETTINGS_AREA_DEFINITIONS,
  orderedSettingsAreas,
  type SettingsArea,
} from './settingsNavigation.js';

export interface SettingsSearchResult {
  area: SettingsArea;
  areaLabel: string;
  sectionId: string;
  sectionTitle: string;
}

/** Umlaute als ae/oe/ue, damit „Waehrung“ und „Währung“ gleich behandelt werden. */
function normalize(value: string): string {
  return value
    .toLocaleLowerCase('de-DE')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Umlaute ohne e, für Eingaben wie „Wahrung“ auf Tastaturen ohne Umlaute. */
function normalizeLoose(value: string): string {
  return value
    .toLocaleLowerCase('de-DE')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .trim();
}

/**
 * Durchsucht Bereiche und Abschnitte der Einstellungen. Jedes Suchwort muss
 * in Titel, Bereich oder Stichworten vorkommen; Treffer im Abschnittstitel
 * stehen vorn.
 */
export function searchSettings(query: string, limit = 8): SettingsSearchResult[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const scored: Array<{ result: SettingsSearchResult; score: number; order: number }> = [];
  let order = 0;
  for (const area of orderedSettingsAreas()) {
    const definition = SETTINGS_AREA_DEFINITIONS[area];
    for (const section of definition.sections) {
      order += 1;
      const title = normalize(section.title);
      const areaLabel = normalize(definition.label);
      const keywords = section.keywords.map(normalize);
      const loose = [section.title, definition.label, ...section.keywords].map(normalizeLoose);
      const haystack = [title, areaLabel, ...keywords, ...loose].join(' ');
      if (!terms.every(term => haystack.includes(term))) continue;
      const score = terms.reduce((sum, term) => {
        if (title.startsWith(term)) return sum + 4;
        if (title.includes(term)) return sum + 3;
        if (keywords.some(keyword => keyword.startsWith(term))) return sum + 2;
        return sum + 1;
      }, 0);
      scored.push({
        result: { area, areaLabel: definition.label, sectionId: section.id, sectionTitle: section.title },
        score,
        order,
      });
    }
  }

  return scored
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, limit)
    .map(entry => entry.result);
}
