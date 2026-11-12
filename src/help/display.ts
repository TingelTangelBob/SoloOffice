import type { TerminologyDefinition } from '../utils/terminology.js';
import type { HelpCategory } from './types.js';

/**
 * Anzeigename einer Kategorie. „Aufträge und Kalender“ übernimmt den Begriff
 * des gewählten Terminologieprofils (z. B. „Termine“, „Sitzungen“).
 */
export function displayCategory(category: HelpCategory, terminology?: TerminologyDefinition): HelpCategory {
  if (category.id !== 'auftraege-kalender' || !terminology) return category;
  const plural = terminology.work.plural;
  if (plural === 'Aufträge') return category;
  return {
    ...category,
    title: `${plural} und Kalender`,
    description: `${plural} planen, Termine eintragen und abrechnen.`,
  };
}
