import { SETTINGS_AREAS } from '../utils/settingsNavigation.js';
import { HELP_CATEGORY_IDS } from './categories.js';
import { splitHelpPage } from './pages.js';
import type { HelpArticle, HelpBlock } from './types.js';

/**
 * Seiten, auf die ein Link-Baustein zeigen darf. Abgeleitet aus dem Router
 * (`pageToLoader` in `utils/pageLoaders.ts`, Sonderfälle in `App.tsx`); ein
 * Test gleicht die Liste mit `pageLoaders.ts` ab.
 */
export const HELP_LINKABLE_PAGES: readonly string[] = [
  'dashboard', 'setup', 'customers', 'jobs', 'calendar', 'invoices', 'recurring-invoices', 'credit-notes',
  'taxes', 'euer', 'vat', 'fixed-costs', 'fixed-assets', 'documents', 'quotes', 'reporting', 'reminders',
  'settings', 'profile', 'workspace', 'support', 'templates', 'positions', 'data-import', 'help',
];

/** Seiten des Routers, die kein Hilfelink sein sollen (brauchen eine Kennung oder sind Alias). */
export const HELP_NON_LINKABLE_PAGES: readonly string[] = [
  'customer', 'quote-editor', 'tax-overview', 'receipts', 'incoming-e-invoices',
];

export const MAX_TITLE_LENGTH = 70;
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function blockStrings(block: HelpBlock): string[] {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
    case 'note':
      return [block.text];
    case 'steps':
    case 'list':
      return block.items;
    case 'definitions':
      return block.items.flatMap(item => [item.term, item.text]);
    case 'table':
      return [...block.head, ...block.rows.flat()];
    case 'link':
      return [block.label, block.page];
  }
}

export function isValidHelpLink(page: string): boolean {
  const { page: head, filter } = splitHelpPage(page);
  if (!HELP_LINKABLE_PAGES.includes(head)) return false;
  if (head === 'settings' && filter) return (SETTINGS_AREAS as readonly string[]).includes(filter);
  return true;
}

/** Liefert eine Liste verständlicher Fehlermeldungen; leer heißt gültig. */
export function validateHelpArticles(articles: HelpArticle[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const article of articles) ids.add(article.id);
  const seen = new Set<string>();

  for (const article of articles) {
    const where = `Artikel „${article.id}“`;
    if (!KEBAB_CASE.test(article.id)) errors.push(`${where}: Id ist nicht in kebab-case.`);
    if (seen.has(article.id)) errors.push(`${where}: Id kommt mehrfach vor.`);
    seen.add(article.id);
    if (!(HELP_CATEGORY_IDS as string[]).includes(article.category)) errors.push(`${where}: unbekannte Kategorie „${article.category}“.`);
    if (!article.title.trim()) errors.push(`${where}: Titel ist leer.`);
    if (article.title.length > MAX_TITLE_LENGTH) errors.push(`${where}: Titel hat ${article.title.length} Zeichen (höchstens ${MAX_TITLE_LENGTH}).`);
    if (!article.summary.trim()) errors.push(`${where}: Zusammenfassung ist leer.`);
    if (article.keywords.length === 0) errors.push(`${where}: mindestens ein Schlagwort nötig.`);
    if (article.keywords.some(keyword => !keyword.trim())) errors.push(`${where}: leeres Schlagwort.`);
    if (article.blocks.length === 0) errors.push(`${where}: keine Inhaltsblöcke.`);
    for (const relatedId of article.related ?? []) {
      if (!ids.has(relatedId)) errors.push(`${where}: verwandter Artikel „${relatedId}“ existiert nicht.`);
      if (relatedId === article.id) errors.push(`${where}: verweist auf sich selbst.`);
    }
    article.blocks.forEach((block, index) => {
      const label = `${where}, Block ${index + 1} (${block.type})`;
      if ((block.type === 'steps' || block.type === 'list') && block.items.length === 0) errors.push(`${label}: keine Einträge.`);
      if (block.type === 'definitions' && block.items.length === 0) errors.push(`${label}: keine Einträge.`);
      if (block.type === 'table') {
        if (block.head.length === 0 || block.rows.length === 0) errors.push(`${label}: Tabelle ohne Kopf oder Zeilen.`);
        block.rows.forEach((row, rowIndex) => {
          if (row.length !== block.head.length) errors.push(`${label}: Zeile ${rowIndex + 1} hat ${row.length} statt ${block.head.length} Spalten.`);
        });
      }
      if (block.type === 'link' && !isValidHelpLink(block.page)) errors.push(`${label}: Seite „${block.page}“ ist kein gültiges Ziel.`);
      for (const text of blockStrings(block)) {
        if (!text.trim()) errors.push(`${label}: leerer Text.`);
        if ((text.split('**').length - 1) % 2 !== 0) errors.push(`${label}: ungerade Anzahl „**“ in „${text.slice(0, 40)}“.`);
      }
    });
  }
  return errors;
}
