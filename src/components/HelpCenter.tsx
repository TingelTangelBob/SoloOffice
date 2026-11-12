import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, BookOpen, Calculator, CalendarDays, ChevronRight, FileText, FolderOpen, LifeBuoy, Receipt, Rocket, Search, Settings, Upload, Users, Wallet } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { EmptyState } from './EmptyState';
import { useCompany } from '../context/CompanyContext';
import { useExtensions } from '../hooks/useExtensions';
import { useSupportAvailability } from '../hooks/useSupportAvailability';
import { formatCountLabel, getTerminology } from '../utils/terminology';
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  POPULAR_ARTICLE_IDS,
  articlesByCategory,
  categoryCounts,
  getArticle,
  getCategory,
  isArticleVisible,
  searchHelp,
} from '../help/index';
import type { HelpArticle, HelpBlock, HelpCategory } from '../help/index';
import { displayCategory } from '../help/display';
import { parseInline } from '../help/inline';
import { splitHelpPage } from '../help/pages';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Rocket, Users, CalendarDays, FileText, Wallet, Receipt, Calculator, Upload, Settings, BookOpen,
};

const CATEGORY_PREFIX = 'kategorie-';

interface HelpCenterProps {
  /** Teil des Hashs nach `#help/`: Artikel-Id oder `kategorie-<id>`. */
  initialRoute?: string;
  onNavigate: (page: string, filter?: string) => void;
}

function Inline({ text }: { text: string }) {
  return <>{parseInline(text).map((segment, index) => segment.bold ? <strong key={index} className="font-semibold text-gray-900">{segment.text}</strong> : <span key={index}>{segment.text}</span>)}</>;
}

const NOTE_LABELS = { info: 'Hinweis', warning: 'Wichtig', tip: 'Tipp' } as const;
const NOTE_VARIANT = { info: 'notice-info', warning: 'notice-warning', tip: 'notice-success' } as const;

function Block({ block, onNavigate }: { block: HelpBlock; onNavigate: HelpCenterProps['onNavigate'] }) {
  switch (block.type) {
    case 'paragraph':
      return <p className="leading-7 text-gray-700"><Inline text={block.text} /></p>;
    case 'heading':
      return <h3 className="pt-2 text-lg font-semibold text-gray-900">{block.text}</h3>;
    case 'steps':
      return <ol className="list-decimal space-y-2 pl-6 leading-7 text-gray-700 marker:font-semibold">{block.items.map((item, i) => <li key={i} className="pl-1"><Inline text={item} /></li>)}</ol>;
    case 'list':
      return <ul className="list-disc space-y-2 pl-6 leading-7 text-gray-700">{block.items.map((item, i) => <li key={i} className="pl-1"><Inline text={item} /></li>)}</ul>;
    case 'note':
      return (
        <div className={`notice ${NOTE_VARIANT[block.tone]} leading-6`} role="note">
          <p><strong className="font-semibold">{NOTE_LABELS[block.tone]}: </strong><Inline text={block.text} /></p>
        </div>
      );
    case 'definitions':
      return (
        <dl className="space-y-3">
          {block.items.map((item, i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <dt className="font-semibold text-gray-900">{item.term}</dt>
              <dd className="mt-1 leading-7 text-gray-700"><Inline text={item.text} /></dd>
            </div>
          ))}
        </dl>
      );
    case 'table':
      return (
        <div className="max-w-full overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>{block.head.map((cell, i) => <th key={i} scope="col" className="px-3 py-2 font-semibold">{cell}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-700">
              {block.rows.map((row, r) => (
                <tr key={r}>{row.map((cell, c) => c === 0 ? <th key={c} scope="row" className="px-3 py-2 align-top font-semibold text-gray-900">{cell}</th> : <td key={c} className="px-3 py-2 align-top"><Inline text={cell} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'link': {
      const target = splitHelpPage(block.page);
      return (
        <p>
          <button type="button" onClick={() => onNavigate(target.page, target.filter)} className="btn-secondary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium">
            {block.label}<ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </p>
      );
    }
  }
}

function ArticleCard({ article, onOpen, showCategory }: { article: HelpArticle; onOpen: (id: string) => void; showCategory?: string }) {
  return (
    <li>
      <button type="button" onClick={() => onOpen(article.id)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        <span className="min-w-0">
          <span className="block font-medium text-gray-900">{article.title}</span>
          <span className="mt-0.5 block text-sm text-gray-600">{article.summary}</span>
          {showCategory && <span className="mt-1 block text-xs text-gray-600">{showCategory}</span>}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
      </button>
    </li>
  );
}

export function HelpCenter({ initialRoute, onNavigate }: HelpCenterProps) {
  const { company } = useCompany();
  const { isEnabled } = useExtensions();
  const supportAvailable = useSupportAvailability();
  const terminology = getTerminology(company.terminologyProfile);
  const [query, setQuery] = useState('');

  const modules = useMemo(() => ({
    jobs: company.jobTrackingEnabled === true,
    quotes: company.quotesEnabled === true,
    vat: isEnabled('taxes'),
  }), [company.jobTrackingEnabled, company.quotesEnabled, isEnabled]);
  const visible = useMemo(() => HELP_ARTICLES.filter(article => isArticleVisible(article, modules)), [modules]);
  const categories = useMemo(() => HELP_CATEGORIES.map(category => displayCategory(category, terminology)), [terminology]);
  const categoryTitle = (id: string) => categories.find(category => category.id === id)?.title ?? getCategory(id)?.title ?? id;
  const counts = useMemo(() => categoryCounts(visible), [visible]);

  const openArticle = (id: string) => onNavigate('help', id);
  const openCategory = (id: string) => onNavigate('help', `${CATEGORY_PREFIX}${id}`);
  const home = () => onNavigate('help');

  const results = useMemo(() => searchHelp(query, visible), [query, visible]);
  const searching = query.trim().length > 0;

  // Nach einem Wechsel der Ansicht (Artikel, Kategorie, Übersicht) den Fokus auf die Überschrift der neuen
  // Ansicht setzen und nach oben scrollen. Beim ersten Laden der Seite bleibt der Fokus unangetastet.
  const viewHeadingRef = useRef<HTMLHeadingElement>(null);
  const searchLabelRef = useRef<HTMLLabelElement>(null);
  const shownRoute = useRef(initialRoute);
  useEffect(() => {
    if (shownRoute.current === initialRoute) return;
    shownRoute.current = initialRoute;
    const target = viewHeadingRef.current ?? searchLabelRef.current;
    if (!target) return;
    for (let node: HTMLElement | null = target.parentElement; node; node = node.parentElement) {
      if (node.scrollTop > 0) node.scrollTop = 0;
    }
    window.scrollTo({ top: 0 });
    target.focus({ preventScroll: true });
  }, [initialRoute]);

  // Artikel
  if (initialRoute && !initialRoute.startsWith(CATEGORY_PREFIX)) {
    const found = getArticle(initialRoute);
    const article = found && isArticleVisible(found, modules) ? found : undefined;
    if (!article) {
      return (
        <div className="page-root space-y-6">
          <PageHeader icon={LifeBuoy} title="Hilfe & Support" />
          <EmptyState variant="metric" title="Artikel nicht gefunden" description="Diesen Hilfeartikel gibt es nicht oder er ist für Ihre aktiven Module nicht verfügbar." action={{ label: 'Zurück zur Übersicht', onClick: home }} />
        </div>
      );
    }
    const related = (article.related ?? []).map(getArticle).filter((a): a is HelpArticle => !!a && isArticleVisible(a, modules));
    return (
      <div className="page-root space-y-6">
        <PageHeader icon={LifeBuoy} title="Hilfe & Support" shortTitle="Hilfe" />
        <article className="mx-auto w-full max-w-[70ch] space-y-4">
          <nav aria-label="Brotkrumen" className="text-sm text-gray-600">
            <ol className="flex flex-wrap items-center gap-1">
              <li><button type="button" onClick={home} className="font-medium text-primary-custom hover:underline">Hilfe</button></li>
              <li aria-hidden="true">›</li>
              <li><button type="button" onClick={() => openCategory(article.category)} className="font-medium text-primary-custom hover:underline">{categoryTitle(article.category)}</button></li>
              <li aria-hidden="true">›</li>
              <li aria-current="page" className="text-gray-700">{article.title}</li>
            </ol>
          </nav>
          <h2 ref={viewHeadingRef} tabIndex={-1} className="text-2xl font-semibold leading-tight text-gray-900 focus:outline-none">{article.title}</h2>
          <p className="text-lg leading-7 text-gray-700">{article.summary}</p>
          {article.blocks.map((block, index) => <Block key={index} block={block} onNavigate={onNavigate} />)}
          {related.length > 0 && (
            <section aria-labelledby="help-related" className="space-y-3 pt-4">
              <h2 id="help-related" className="text-lg font-semibold text-gray-900">Verwandte Artikel</h2>
              <ul className="space-y-2">{related.map(item => <ArticleCard key={item.id} article={item} onOpen={openArticle} />)}</ul>
            </section>
          )}
          <p className="pt-2">
            <button type="button" onClick={home} className="inline-flex items-center gap-2 text-sm font-medium text-primary-custom hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Zurück zur Übersicht</button>
          </p>
        </article>
      </div>
    );
  }

  // Kategorie
  if (initialRoute?.startsWith(CATEGORY_PREFIX)) {
    const category = categories.find(item => item.id === initialRoute.slice(CATEGORY_PREFIX.length));
    if (!category) {
      return (
        <div className="page-root space-y-6">
          <PageHeader icon={LifeBuoy} title="Hilfe & Support" />
          <EmptyState variant="metric" title="Kategorie nicht gefunden" action={{ label: 'Zurück zur Übersicht', onClick: home }} />
        </div>
      );
    }
    const list = articlesByCategory(category.id).filter(article => isArticleVisible(article, modules));
    return (
      <div className="page-root space-y-6">
        <PageHeader icon={LifeBuoy} title="Hilfe & Support" shortTitle="Hilfe" />
        <div className="mx-auto w-full max-w-[70ch] space-y-4">
          <nav aria-label="Brotkrumen" className="text-sm text-gray-600">
            <ol className="flex flex-wrap items-center gap-1">
              <li><button type="button" onClick={home} className="font-medium text-primary-custom hover:underline">Hilfe</button></li>
              <li aria-hidden="true">›</li>
              <li aria-current="page" className="text-gray-700">{category.title}</li>
            </ol>
          </nav>
          <h2 ref={viewHeadingRef} tabIndex={-1} className="text-2xl font-semibold text-gray-900 focus:outline-none">{category.title}</h2>
          <p className="text-gray-700">{category.description}</p>
          {list.length === 0
            ? <EmptyState variant="metric" title="Hier entstehen gerade neue Artikel" description="Zu diesem Thema gibt es noch keine Hilfeartikel. Schauen Sie bald wieder vorbei oder nutzen Sie die Suche." action={{ label: 'Zurück zur Übersicht', onClick: home }} />
            : <ul className="space-y-2">{list.map(article => <ArticleCard key={article.id} article={article} onOpen={openArticle} />)}</ul>}
        </div>
      </div>
    );
  }

  // Startseite
  const popular = POPULAR_ARTICLE_IDS.map(getArticle).filter((a): a is HelpArticle => !!a && isArticleVisible(a, modules));
  return (
    <div className="page-root space-y-8">
      <PageHeader icon={LifeBuoy} title="Hilfe & Support" shortTitle="Hilfe" />
      <section aria-label="Suche" className="mx-auto w-full max-w-3xl space-y-3">
        <label ref={searchLabelRef} tabIndex={-1} htmlFor="help-search" className="block text-lg font-semibold text-gray-900 focus:outline-none">Wonach suchen Sie?</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" aria-hidden="true" />
          <input id="help-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Zum Beispiel: Leistungsdatum, Mahnung, Import" autoComplete="off" className="form-input h-12 w-full pl-11 text-base" />
        </div>
        <p className="text-sm text-gray-600" role="status" aria-live="polite">
          {searching ? (results.length === 0 ? 'Keine Treffer.' : formatCountLabel(results.length, 'Treffer', 'Treffer')) : ''}
        </p>
        {searching && (results.length > 0
          ? <ul className="space-y-2" aria-label="Suchergebnisse">{results.map(({ article }) => <ArticleCard key={article.id} article={article} onOpen={openArticle} showCategory={categoryTitle(article.category)} />)}</ul>
          : <p className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-700">Zu „{query.trim()}“ gibt es keinen Artikel. Versuchen Sie ein anderes Wort oder stöbern Sie in den Kategorien.</p>)}
      </section>

      {!searching && (
        <>
          <section aria-labelledby="help-categories" className="space-y-3">
            <h2 id="help-categories" className="text-lg font-semibold text-gray-900">Themen</h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {categories.map((category: HelpCategory) => {
                const Icon = CATEGORY_ICONS[category.icon] ?? FolderOpen;
                return (
                  <li key={category.id}>
                    <button type="button" onClick={() => openCategory(category.id)} className="flex h-full w-full items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-light-custom text-primary-custom"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                      <span className="min-w-0">
                        <span className="block font-semibold text-gray-900">{category.title}</span>
                        <span className="mt-0.5 block text-sm text-gray-600">{category.description}</span>
                        <span className="mt-1 block text-xs text-gray-600">{formatCountLabel(counts[category.id], 'Artikel', 'Artikel')}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {popular.length > 0 && (
            <section aria-labelledby="help-popular" className="space-y-3">
              <h2 id="help-popular" className="text-lg font-semibold text-gray-900">Häufig gebraucht</h2>
              <ul className="grid gap-2 lg:grid-cols-2">{popular.map(article => <ArticleCard key={article.id} article={article} onOpen={openArticle} />)}</ul>
            </section>
          )}

          <section aria-labelledby="help-contact" className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 id="help-contact" className="font-semibold text-gray-900">Keine Antwort gefunden?</h2>
            {supportAvailable ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-700">Schreiben Sie uns. Wir antworten in der Regel innerhalb eines Werktags.</p>
                <button type="button" onClick={() => onNavigate('support')} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"><LifeBuoy className="h-4 w-4" aria-hidden="true" />Support kontaktieren</button>
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-700">Ein Ticket-Support steht in dieser Installation nicht zur Verfügung. Kontaktmöglichkeiten finden Sie unter solooffice.de.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
