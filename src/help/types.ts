/** Kategorien der Hilfe. Die Reihenfolge steht in `categories.ts`. */
export type HelpCategoryId =
  | 'erste-schritte'
  | 'kunden-angebote'
  | 'auftraege-kalender'
  | 'rechnungen'
  | 'mahnungen-zahlungen'
  | 'belege-ausgaben'
  | 'steuern'
  | 'daten-import'
  | 'einstellungen-konto'
  | 'begriffe';

export interface HelpCategory {
  id: HelpCategoryId;
  title: string;
  description: string;
  /** Name eines lucide-Symbols; die Oberfläche bildet ihn auf eine Komponente ab. */
  icon: string;
}

/**
 * Bausteine eines Artikels. Im Fließtext (`text`, `items`) ist genau eine
 * Auszeichnung erlaubt: `**fett**` für Schaltflächen und Menüpunkte.
 */
export type HelpBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string }
  /** Nummerierte Schritte. */
  | { type: 'steps'; items: string[] }
  | { type: 'list'; items: string[] }
  | { type: 'note'; tone: 'info' | 'warning' | 'tip'; text: string }
  | { type: 'definitions'; items: { term: string; text: string }[] }
  | { type: 'table'; head: string[]; rows: string[][] }
  /** Sprung in die App: `page` oder `page/filter`, z. B. `invoices` oder `settings/invoices`. */
  | { type: 'link'; label: string; page: string };

export interface HelpArticle {
  /** kebab-case, stabil, Teil der Adresse (`#help/<id>`). */
  id: string;
  category: HelpCategoryId;
  title: string;
  /** Ein Satz. */
  summary: string;
  keywords: string[];
  blocks: HelpBlock[];
  /** Ids verwandter Artikel. */
  related?: string[];
  /** Nur zeigen, wenn das Modul aktiv ist. */
  requires?: 'jobs' | 'quotes' | 'vat';
}
