export interface PageState {
  page: string;
  filter?: string;
  searchTerm?: string;
  quoteId?: string;
  invoiceId?: string;
  jobSeriesId?: string;
}

const SETTINGS_TABS = ['app', 'general', 'invoices', 'appearance', 'system', 'extensions', 'taxes'] as const;
type SettingsTab = typeof SETTINGS_TABS[number];

function normalizePageState(page: string, filter?: string, searchTerm?: string, invoiceId?: string, jobSeriesId?: string): PageState {
  if (page === 'receipts') return { page: 'documents', filter: filter || 'receipts', searchTerm };
  if (page === 'incoming-e-invoices') return { page: 'documents', filter: filter || 'incoming', searchTerm };
  return { page, filter, searchTerm, quoteId: page === 'quote-editor' ? filter : undefined, invoiceId, jobSeriesId };
}

function readSettingsTab(url: URL): SettingsTab | undefined {
  const value = url.searchParams.get('settingsTab');
  return SETTINGS_TABS.includes(value as SettingsTab) ? value as SettingsTab : undefined;
}

export function readPageState(url: URL): PageState {
  const hash = url.hash.slice(1);
  if (!hash) return { page: 'dashboard' };

  const [page, filter, searchTerm, invoiceId, jobSeriesId] = hash.split('/');
  const pageState = normalizePageState(page || 'dashboard', filter, searchTerm, invoiceId, jobSeriesId);
  if (pageState.page !== 'settings') return pageState;

  // Ein ausdrücklich im Hash gewählter Unterbereich hat Vorrang vor dem Query-Tab.
  if (filter && SETTINGS_TABS.includes(filter as SettingsTab)) return pageState;
  return { ...pageState, filter: readSettingsTab(url) };
}

export function buildPageUrl(
  currentHref: string,
  page: string,
  filter?: string,
  searchTerm?: string,
  invoiceId?: string,
  jobSeriesId?: string,
): URL {
  const url = new URL(currentHref);
  let hash = page;
  if (filter) hash += `/${filter}`;
  if (searchTerm) hash += `/${searchTerm}`;
  if (invoiceId) {
    if (!filter) hash += '/';
    if (!searchTerm) hash += '/';
    hash += `/${invoiceId}`;
  }
  if (jobSeriesId) {
    if (!filter) hash += '/';
    if (!searchTerm) hash += '/';
    if (!invoiceId) hash += '/';
    hash += `/${jobSeriesId}`;
  }
  url.hash = hash;
  if (page !== 'settings') url.searchParams.delete('settingsTab');
  return url;
}

export function navigatePage(
  history: Pick<History, 'state' | 'pushState'>,
  currentHref: string,
  page: string,
  filter?: string,
  searchTerm?: string,
  invoiceId?: string,
  jobSeriesId?: string,
): PageState {
  const url = buildPageUrl(currentHref, page, filter, searchTerm, invoiceId, jobSeriesId);
  history.pushState(history.state, '', url);
  return readPageState(url);
}
