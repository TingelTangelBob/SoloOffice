import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { HELP_ARTICLES, HELP_CATEGORIES, POPULAR_ARTICLE_IDS, articlesByCategory, getArticle, isArticleVisible, normalizeSearchText, searchHelp } from '../../.test-dist/help/index.js';
import { HELP_LINKABLE_PAGES, HELP_NON_LINKABLE_PAGES, isValidHelpLink, validateHelpArticles } from '../../.test-dist/help/validate.js';
import { parseInline } from '../../.test-dist/help/inline.js';
import { displayCategory } from '../../.test-dist/help/display.js';
import { getTerminology } from '../../.test-dist/utils/terminology.js';

const base = { category: 'begriffe', summary: 'Zusammenfassung.', keywords: ['x'], blocks: [{ type: 'paragraph', text: 'Text' }] };
const article = (overrides) => ({ ...base, id: 'a', title: 'Titel', ...overrides });

test('alle Hilfeartikel sind gültig', () => {
  assert.deepEqual(validateHelpArticles(HELP_ARTICLES), []);
});

test('es gibt zehn Kategorien und die Musterartikel sind vorhanden', () => {
  assert.equal(HELP_CATEGORIES.length, 10);
  assert.ok(getArticle('rechnungsdatum-leistungsdatum-auftragsdatum'));
  assert.ok(getArticle('erste-rechnung-schreiben'));
  assert.equal(articlesByCategory('begriffe').length >= 1, true);
  for (const id of POPULAR_ARTICLE_IDS) assert.ok(getArticle(id), id);
});

test('Validierung erkennt typische Fehler', () => {
  const errors = validateHelpArticles([
    article({ id: 'Falsch_ID' }),
    article({ id: 'doppelt' }), article({ id: 'doppelt' }),
    article({ id: 'lang', title: 'x'.repeat(71) }),
    article({ id: 'ohne-wort', keywords: [] }),
    article({ id: 'leer', blocks: [{ type: 'paragraph', text: '  ' }] }),
    article({ id: 'rel', related: ['gibt-es-nicht'] }),
    article({ id: 'link', blocks: [{ type: 'link', label: 'L', page: 'nirgendwo' }] }),
    article({ id: 'fett', blocks: [{ type: 'paragraph', text: 'ein **offenes' }] }),
    article({ id: 'tab', blocks: [{ type: 'table', head: ['a', 'b'], rows: [['1']] }] }),
  ]);
  for (const part of ['kebab-case', 'mehrfach', '71 Zeichen', 'Schlagwort', 'leerer Text', 'gibt-es-nicht', 'nirgendwo', '„**“', 'Spalten']) {
    assert.ok(errors.some(e => e.includes(part)), part);
  }
});

test('Link-Ziele: Seiten und Einstellungsbereiche', () => {
  assert.ok(isValidHelpLink('invoices'));
  assert.ok(isValidHelpLink('settings/invoices'));
  assert.ok(!isValidHelpLink('settings/gibt-es-nicht'));
  assert.ok(!isValidHelpLink('customer'));
});

test('Liste der Link-Seiten deckt den Router ab', () => {
  const source = readFileSync(new URL('../../src/utils/pageLoaders.ts', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const pageToLoader'), source.indexOf('};', source.indexOf('const pageToLoader')));
  const pages = [...block.matchAll(/^\s*'?([a-z-]+)'?:\s*'/gm)].map(m => m[1]);
  assert.ok(pages.length > 20);
  for (const page of pages) {
    assert.ok(HELP_LINKABLE_PAGES.includes(page) || HELP_NON_LINKABLE_PAGES.includes(page), `Seite ${page} fehlt in validate.ts`);
  }
  for (const page of HELP_LINKABLE_PAGES) assert.ok(pages.includes(page), `${page} ist kein Router-Ziel`);
});

test('Suche: Umlaute, Groß-/Kleinschreibung und Gewichtung', () => {
  assert.equal(normalizeSearchText('Aufträge Straße ÜBER'), 'auftraege strasse ueber');
  const list = [
    article({ id: 'text', title: 'Anderes', summary: 'Etwas', keywords: ['z'], blocks: [{ type: 'paragraph', text: 'Das Leistungsdatum steht hier.' }] }),
    article({ id: 'titel', title: 'Leistungsdatum richtig setzen', keywords: ['z'] }),
    article({ id: 'wort', title: 'Zeiten', keywords: ['leistungsdatum'] }),
    article({ id: 'summe', title: 'Datum', summary: 'Ein Leistungsdatum ist wichtig.', keywords: ['z'] }),
  ];
  assert.deepEqual(searchHelp('LEISTUNGSDATUM', list).map(r => r.article.id), ['titel', 'wort', 'summe', 'text']);
  assert.deepEqual(searchHelp('   ', list), []);
  assert.deepEqual(searchHelp('gibtesnicht', list), []);
  assert.deepEqual(searchHelp('leistungsdatum richtig', list).map(r => r.article.id), ['titel']);
  assert.equal(searchHelp('auftraege', [article({ id: 'u', title: 'Aufträge anlegen' })]).length, 1);
});

test('Suche findet Leistungsdatum im Musterartikel', () => {
  assert.equal(searchHelp('Leistungsdatum')[0].article.id, 'rechnungsdatum-leistungsdatum-auftragsdatum');
});

test('Sichtbarkeit nach Modul', () => {
  const gated = article({ requires: 'jobs' });
  assert.equal(isArticleVisible(gated, {}), false);
  assert.equal(isArticleVisible(gated, { jobs: true }), true);
  assert.equal(isArticleVisible(article({}), {}), true);
});

test('Auszeichnung und Kategorie-Anzeige', () => {
  assert.deepEqual(parseInline('Klicken Sie **Speichern** jetzt'), [
    { text: 'Klicken Sie ', bold: false }, { text: 'Speichern', bold: true }, { text: ' jetzt', bold: false },
  ]);
  assert.deepEqual(parseInline('offen **nicht'), [{ text: 'offen **nicht', bold: false }]);
  const category = HELP_CATEGORIES.find(c => c.id === 'auftraege-kalender');
  assert.equal(displayCategory(category, getTerminology('customers')).title, 'Aufträge und Kalender');
  const other = getTerminology('students');
  assert.equal(displayCategory(category, other).title, other.work.plural === 'Aufträge' ? 'Aufträge und Kalender' : `${other.work.plural} und Kalender`);
  assert.equal(displayCategory(HELP_CATEGORIES[0], other), HELP_CATEGORIES[0]);
});
