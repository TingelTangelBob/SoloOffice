import { HELP_CATEGORIES } from './categories.js';
import { stripInline } from './inline.js';
import type { HelpArticle, HelpBlock, HelpCategoryId } from './types.js';
import { ersteSchritteArticles } from './articles/erste-schritte.js';
import { kundenAngeboteArticles } from './articles/kunden-angebote.js';
import { auftraegeKalenderArticles } from './articles/auftraege-kalender.js';
import { rechnungenArticles } from './articles/rechnungen.js';
import { mahnungenZahlungenArticles } from './articles/mahnungen-zahlungen.js';
import { belegeAusgabenArticles } from './articles/belege-ausgaben.js';
import { steuernArticles } from './articles/steuern.js';
import { datenImportArticles } from './articles/daten-import.js';
import { einstellungenKontoArticles } from './articles/einstellungen-konto.js';
import { begriffeArticles } from './articles/begriffe.js';

export { HELP_CATEGORIES, getCategory } from './categories.js';
export type { HelpArticle, HelpBlock, HelpCategory, HelpCategoryId } from './types.js';

export const HELP_ARTICLES: HelpArticle[] = [
  ...ersteSchritteArticles,
  ...kundenAngeboteArticles,
  ...auftraegeKalenderArticles,
  ...rechnungenArticles,
  ...mahnungenZahlungenArticles,
  ...belegeAusgabenArticles,
  ...steuernArticles,
  ...datenImportArticles,
  ...einstellungenKontoArticles,
  ...begriffeArticles,
];

/** Artikel-Ids der Startseite „Häufig gebraucht“ in Anzeigereihenfolge. */
export const POPULAR_ARTICLE_IDS: string[] = [
  'erste-rechnung-schreiben',
  'ersteinrichtung-fuenf-schritte',
  'angebot-in-auftrag-umwandeln',
  'zahlung-erfassen-teilzahlung',
  'mahngebuehren-verzugszinsen-einstellen',
  'rechnungsdatum-leistungsdatum-auftragsdatum',
];

export function getArticle(id: string): HelpArticle | undefined {
  return HELP_ARTICLES.find(article => article.id === id);
}

export function articlesByCategory(category: HelpCategoryId): HelpArticle[] {
  return HELP_ARTICLES.filter(article => article.category === category);
}

/** Module, die ein Artikel voraussetzen kann. */
export type HelpModuleFlags = Partial<Record<NonNullable<HelpArticle['requires']>, boolean>>;

/** Artikel, die für die aktiven Module gezeigt werden dürfen. */
export function isArticleVisible(article: HelpArticle, modules: HelpModuleFlags): boolean {
  return !article.requires || modules[article.requires] === true;
}

/** Kleinschreibung, Umlaute und ß ausgeschrieben, damit „Aufträge“ und „auftraege“ gleich suchen. */
export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9§ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function blockTexts(block: HelpBlock): string[] {
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
      return [block.label];
  }
}

/** Gesamter Artikeltext ohne Auszeichnung. */
export function articleBodyText(article: HelpArticle): string {
  return article.blocks.flatMap(blockTexts).map(stripInline).join(' ');
}

const WEIGHT_TITLE = 10;
const WEIGHT_KEYWORD = 6;
const WEIGHT_SUMMARY = 3;
const WEIGHT_BODY = 1;

export interface HelpSearchResult {
  article: HelpArticle;
  score: number;
}

interface SearchIndexEntry {
  article: HelpArticle;
  title: string;
  keywords: string[];
  summary: string;
  body: string;
}

function indexArticle(article: HelpArticle): SearchIndexEntry {
  return {
    article,
    title: normalizeSearchText(article.title),
    keywords: article.keywords.map(normalizeSearchText),
    summary: normalizeSearchText(article.summary),
    body: normalizeSearchText(articleBodyText(article)),
  };
}

function tokenScore(token: string, entry: SearchIndexEntry): number {
  let score = 0;
  if (entry.title.includes(token)) {
    score += WEIGHT_TITLE;
    // Wortanfang im Titel zählt etwas mehr als ein Treffer mitten im Wort.
    if (entry.title.split(' ').some(word => word.startsWith(token))) score += 2;
  }
  if (entry.keywords.some(keyword => keyword.includes(token))) score += WEIGHT_KEYWORD;
  if (entry.summary.includes(token)) score += WEIGHT_SUMMARY;
  if (entry.body.includes(token)) score += WEIGHT_BODY;
  return score;
}

/**
 * Sucht in Titel, Schlagwörtern, Zusammenfassung und Text. Jedes Suchwort muss
 * irgendwo vorkommen; der Titel wiegt am meisten. Reine Funktion: Die
 * Artikelliste kann zum Testen übergeben werden.
 */
export function searchHelp(query: string, articles: HelpArticle[] = HELP_ARTICLES): HelpSearchResult[] {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return [];
  const results: HelpSearchResult[] = [];
  for (const article of articles) {
    const entry = indexArticle(article);
    let total = 0;
    let matchesAll = true;
    for (const token of tokens) {
      const score = tokenScore(token, entry);
      if (score === 0) { matchesAll = false; break; }
      total += score;
    }
    if (matchesAll) results.push({ article, score: total });
  }
  return results.sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title, 'de'));
}

/** Anzahl Artikel je Kategorie (nur sichtbare). */
export function categoryCounts(articles: HelpArticle[]): Record<HelpCategoryId, number> {
  const counts = Object.fromEntries(HELP_CATEGORIES.map(category => [category.id, 0])) as Record<HelpCategoryId, number>;
  for (const article of articles) counts[article.category] += 1;
  return counts;
}
