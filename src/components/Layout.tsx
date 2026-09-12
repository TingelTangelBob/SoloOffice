import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Users, Settings, BarChart3, Building2, X, Briefcase, Calendar, Home, FileCheck, FileScan, Search, Copy, Calculator, ChevronDown, ChevronRight, CreditCard, ExternalLink, FolderOpen, ListChecks, Clock3, LogOut, MoreHorizontal, Package, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DynamicColors } from './DynamicColors';
import { useCompany } from '../context/CompanyContext';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useQuotes } from '../context/QuoteContext';
import { useJobs } from '../context/JobContext';
import { getTerminology } from '../utils/terminology';
import { useAuth } from '../context/AuthContext';
import { DemoNotice } from './DemoNotice';
import { TopBar } from './TopBar';
import type { TopBarNotice } from './TopBar';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { isDemoMode } from '../services/demoApi';
import { PageSearchContext } from '../context/PageSearchContext';
import type { PageSearchContextValue, PageSearchRegistration } from '../context/PageSearchContext';

interface LayoutProps {
  children: ReactNode;
  currentPage: string;
  onPageChange: (page: string) => void;
}

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  page: string;
}

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  children?: Array<{ id: string; label: string }>;
}

const invoiceSubPageIds = ['recurring-invoices', 'reminders', 'credit-notes'];
const taxSubPageIds = ['euer', 'fixed-assets'];
const SIDEBAR_DEFAULT_WIDTH = 256;
const SIDEBAR_COMPACT_WIDTH = 72;
const SIDEBAR_MIN_WIDTH = 72;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_COMPACT_BREAKPOINT = 176;
const SIDEBAR_STORAGE_KEY = 'solooffice-sidebar-settings';
const LANDING_PAGE_URL = 'https://solooffice.de';

interface SidebarSettings {
  width: number;
  collapsed: boolean;
}

function readSidebarSettings(): SidebarSettings {
  if (typeof window === 'undefined') return { width: SIDEBAR_DEFAULT_WIDTH, collapsed: false };
  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (!stored) return { width: SIDEBAR_DEFAULT_WIDTH, collapsed: false };
    const parsed = JSON.parse(stored) as Partial<SidebarSettings>;
    const width = typeof parsed.width === 'number'
      ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, parsed.width))
      : SIDEBAR_DEFAULT_WIDTH;
    return { width, collapsed: parsed.collapsed === true };
  } catch {
    return { width: SIDEBAR_DEFAULT_WIDTH, collapsed: false };
  }
}

/** Initialen aus dem Anzeigenamen; bei nur einem Wort dessen erste zwei Zeichen. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '–';
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase('de-DE');
  return (parts[0][0] + parts[parts.length - 1][0]).toLocaleUpperCase('de-DE');
}

export function Layout({ children, currentPage, onPageChange }: LayoutProps) {
  const { company } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);
  const receiptLabel = company.receiptLabel?.trim() || 'Belege';
  const { customers } = useCustomers();
  const { invoices } = useInvoices();
  const { quotes } = useQuotes();
  const { jobEntries } = useJobs();
  const { user, workspace, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [sidebarSettings, setSidebarSettings] = useState<SidebarSettings>(readSidebarSettings);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Angemeldete Listenansicht, deren Liste das Suchfeld gerade live filtert.
  const [pageSearch, setPageSearch] = useState<PageSearchRegistration | null>(null);
  const registerPageSearch = useCallback((registration: PageSearchRegistration) => {
    setPageSearch(registration);
    // Jede Ansicht beginnt mit leerem Feld bzw. ihrer eigenen Vorbelegung –
    // sonst würde eine liegengebliebene Eingabe die nächste Liste filtern.
    setSearchQuery(registration.initialQuery ?? '');
  }, []);
  const unregisterPageSearch = useCallback(() => {
    setPageSearch(null);
    setSearchQuery('');
  }, []);
  const pageSearchValue = useMemo<PageSearchContextValue>(() => ({
    query: searchQuery,
    setQuery: setSearchQuery,
    registration: pageSearch,
    register: registerPageSearch,
    unregister: unregisterPageSearch,
  }), [searchQuery, pageSearch, registerPageSearch, unregisterPageSearch]);
  const invoiceAreaActive = currentPage === 'invoices' || invoiceSubPageIds.includes(currentPage);
  const [isInvoiceMenuOpen, setIsInvoiceMenuOpen] = useState(() => invoiceAreaActive);
  const invoiceAreaWasActive = useRef(invoiceAreaActive);
  const taxAreaActive = currentPage === 'taxes' || taxSubPageIds.includes(currentPage);
  const [isTaxMenuOpen, setIsTaxMenuOpen] = useState(() => taxAreaActive);
  const taxAreaWasActive = useRef(taxAreaActive);
  // Die mobile Drawer-Navigation bleibt immer beschriftet. Die kompakte
  // Icon-Leiste ist eine Desktop-Variante und darf nicht in den Drawer
  // hineinlaufen, wenn sie zuvor als Desktop-Präferenz gespeichert wurde.
  const isSidebarCompact = !isMobileMenuOpen && (sidebarSettings.collapsed || sidebarSettings.width <= SIDEBAR_COMPACT_BREAKPOINT);
  const companySetupComplete = [
    company.name,
    company.address,
    company.postalCode,
    company.city,
    company.email,
    company.taxId,
    company.bankAccount,
  ].every(value => Boolean(value?.trim()));

  useEffect(() => {
    if (!invoiceAreaActive) {
      setIsInvoiceMenuOpen(false);
    } else if (!invoiceAreaWasActive.current) {
      setIsInvoiceMenuOpen(true);
    }
    invoiceAreaWasActive.current = invoiceAreaActive;
  }, [invoiceAreaActive]);

  useEffect(() => {
    if (!taxAreaActive) {
      setIsTaxMenuOpen(false);
    } else if (!taxAreaWasActive.current) {
      setIsTaxMenuOpen(true);
    }
    taxAreaWasActive.current = taxAreaActive;
  }, [taxAreaActive]);

  useEffect(() => {
    setIsSearchOpen(false);
  }, [currentPage]);

  useEffect(() => {
    if (isSearchOpen) {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [isSearchOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(sidebarSettings));
    } catch {
      // Sidebar preferences are optional and must not block navigation.
    }
  }, [sidebarSettings]);

  useEffect(() => {
    if (!isResizingSidebar) return undefined;

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, event.clientX));
      setSidebarSettings(previous => ({
        width: nextWidth,
        collapsed: nextWidth > SIDEBAR_COMPACT_BREAKPOINT ? false : previous.collapsed,
      }));
    };
    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      // Unter der Schwelle rastet die Leiste in die Symbolbreite ein. Ohne das
      // bliebe eine Breite gespeichert, die nie dargestellt wird – das nächste
      // Ausklappen sprang dann auf einen Wert, den niemand eingestellt hat.
      setSidebarSettings(previous => (previous.width <= SIDEBAR_COMPACT_BREAKPOINT
        ? { width: SIDEBAR_DEFAULT_WIDTH, collapsed: true }
        : previous));
    };

    document.body.classList.add('sidebar-resizing');
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.body.classList.remove('sidebar-resizing');
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  const toggleSidebar = () => {
    setSidebarSettings(previous => previous.collapsed || previous.width <= SIDEBAR_COMPACT_BREAKPOINT
      ? { width: Math.max(SIDEBAR_DEFAULT_WIDTH, previous.width), collapsed: false }
      : { ...previous, collapsed: true });
  };

  /*
   * Beim Ziehen folgt die Leiste dem Zeiger, sonst der Umschaltung.
   *
   * Vorher galt auch während des Ziehens `isSidebarCompact`: Unterhalb von
   * 176 Pixeln sprang die Kante auf 72, während der Zeiger bei 150 stand. Der
   * Griff löste sich damit vom Mauszeiger.
   */
  const sidebarRenderWidth = isResizingSidebar
    ? sidebarSettings.width
    : (isSidebarCompact ? SIDEBAR_COMPACT_WIDTH : sidebarSettings.width);

  const sidebarStyle = {
    '--sidebar-width': `${sidebarRenderWidth}px`,
  } as CSSProperties;
  /* Zwei bewusst sichtbare Seitenraster: datenreiche Ansichten nutzen die
     gesamte verfügbare Breite, Formulare und Übersichten bleiben auf sehr
     großen Monitoren lesbar begrenzt. */
  const fullWidthPages = [
    'invoices', 'quotes', 'jobs', 'calendar', 'customers', 'reporting',
    'documents', 'templates', 'euer', 'fixed-assets', 'recurring-invoices',
    'credit-notes', 'reminders', 'positions',
  ];
  const contentWidthClass = fullWidthPages.includes(currentPage) ? 'max-w-none' : 'max-w-[1760px]';
  const accountName = user?.displayName?.trim() || 'Konto';
  const accountInitials = initialsOf(accountName);
  const appVersion = import.meta.env.VITE_APP_VERSION;
  const versionLabel = appVersion && appVersion !== 'dev' ? `v${appVersion.replace(/^v/i, '')}` : 'Entwicklungsstand';
  const openLandingPage = (path: string) => {
    window.open(`${LANDING_PAGE_URL}${path}`, '_blank', 'noopener,noreferrer');
  };

  const baseNavItems: NavItem[] = [
    { id: 'dashboard', label: 'Übersicht', icon: Home },
  ];

  const invoiceNavItem: NavItem = {
    id: 'invoices',
    label: 'Rechnungen',
    icon: FileText,
    children: [
      { id: 'recurring-invoices', label: 'Wiederkehrend' },
      ...(company.remindersEnabled ? [{ id: 'reminders', label: 'Mahnungen' }] : []),
      { id: 'credit-notes', label: 'Gutschriften' },
    ],
  };

  const taxNavItem: NavItem = {
    id: 'taxes',
    label: 'Steuern',
    icon: Calculator,
    children: [
      { id: 'euer', label: 'EÜR' },
      { id: 'fixed-assets', label: 'Anlagenverzeichnis' },
    ],
  };

  const receiptNavItem: NavItem = {
    id: 'documents',
    label: receiptLabel,
    icon: FileScan,
  };

  const quotesNavItem = { id: 'quotes', label: 'Angebote', icon: FileCheck };
  const jobNavItem = { id: 'jobs', label: terminology.work.navLabel, icon: Briefcase };
  const calendarNavItem = { id: 'calendar', label: 'Kalender', icon: Calendar };
  const reportingNavItem = { id: 'reporting', label: 'Auswertungen', icon: BarChart3 };
  const settingsNavItem = { id: 'settings', label: 'Einstellungen', icon: Settings };
  const workspaceNavItem = { id: 'workspace', label: 'Workspace', icon: Building2 };
  const templatesNavItem = { id: 'templates', label: 'Vorlagen', icon: Copy };
  const positionsNavItem = { id: 'positions', label: 'Positionen', icon: Package };
  const bottomNavItems = [
    { id: 'customers', label: terminology.entity.navLabel, icon: Users },
    positionsNavItem,
    templatesNavItem,
    settingsNavItem,
    workspaceNavItem,
  ];

  const navItems: NavItem[] = [
    ...baseNavItems,
    invoiceNavItem,
    taxNavItem,
    receiptNavItem,
    ...(company.quotesEnabled ? [quotesNavItem] : []),
    ...(company.jobTrackingEnabled ? [jobNavItem, calendarNavItem] : []),
    ...(company.reportingEnabled ? [reportingNavItem] : []),
  ];
  const allNavItems = [
    ...navItems.flatMap((item) => [item, ...(item.children || []).map(child => ({ ...child, icon: item.icon }))]),
    ...bottomNavItems,
  ];

  /*
   * Gruppierung der Seitenleiste.
   *
   * `navItems` bleibt als flache Liste bestehen, weil die Suche darauf
   * aufbaut. Die Gruppen ordnen dieselben Einträge nur für die Anzeige –
   * ohne Beschriftungen liest sich eine Leiste mit acht gleichrangigen
   * Punkten als eine einzige lange Aufzählung.
   */
  const navSections: { id: string; label: string; items: NavItem[] }[] = [
    { id: 'ueberblick', label: 'Überblick', items: baseNavItems },
    {
      id: 'dokumente',
      label: 'Dokumente',
      items: [
        invoiceNavItem,
        ...(company.quotesEnabled ? [quotesNavItem] : []),
        receiptNavItem,
      ],
    },
    ...(company.jobTrackingEnabled
      ? [{ id: 'arbeit', label: 'Arbeit', items: [jobNavItem, calendarNavItem] }]
      : []),
    {
      id: 'auswertung',
      label: 'Auswertung',
      items: [
        taxNavItem,
        ...(company.reportingEnabled ? [reportingNavItem] : []),
      ],
    },
  ].filter((section) => section.items.length > 0);

  /*
   * Hinweise der Kopfleiste.
   *
   * Bewusst aus dem vorhandenen Bestand abgeleitet statt aus einer eigenen
   * Benachrichtigungstabelle: Eine Glocke, die nichts Belastbares zeigt, wäre
   * eine Attrappe. Jeder Eintrag führt in die Ansicht, in der er sich
   * erledigen lässt.
   */
  const overdueCount = invoices.filter((invoice) => invoice.status === 'overdue').length;
  const draftCount = invoices.filter((invoice) => invoice.status === 'draft').length;
  const topBarNotices: TopBarNotice[] = [
    ...(overdueCount > 0 ? [{
      id: 'overdue',
      label: `${overdueCount} ${overdueCount === 1 ? 'überfällige Rechnung' : 'überfällige Rechnungen'}`,
      detail: 'Zahlungsziel überschritten.',
      page: 'invoices',
      tone: 'negative' as const,
    }] : []),
    ...(draftCount > 0 ? [{
      id: 'draft',
      label: `${draftCount} ${draftCount === 1 ? 'Entwurf' : 'Entwürfe'}`,
      detail: 'Noch nicht versendet.',
      page: 'invoices',
      tone: 'neutral' as const,
    }] : []),
  ];

  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase('de-DE');
  const searchResults: SearchResult[] = normalizedSearchQuery
    ? [
        ...allNavItems
          .filter((item) => item.label.toLocaleLowerCase('de-DE').includes(normalizedSearchQuery))
          .map((item) => ({ id: item.id, title: item.label, subtitle: 'Bereich öffnen', page: item.id })),
        ...customers
          .filter((customer) => [customer.name, customer.customerNumber, customer.email].some((value) => value?.toLocaleLowerCase('de-DE').includes(normalizedSearchQuery)))
          .map((customer) => ({ id: customer.id, title: customer.name, subtitle: `${terminology.entity.singular} ${customer.customerNumber}`, page: 'customers' })),
        ...invoices
          .filter((invoice) => [invoice.invoiceNumber, invoice.customerName, invoice.notes].some((value) => value?.toString().toLocaleLowerCase('de-DE').includes(normalizedSearchQuery)))
          .map((invoice) => ({ id: invoice.id, title: invoice.invoiceNumber || 'Rechnung', subtitle: `Rechnung · ${invoice.customerName}`, page: 'invoices' })),
        ...quotes
          .filter((quote) => [quote.quoteNumber, quote.customerName, quote.notes].some((value) => value?.toString().toLocaleLowerCase('de-DE').includes(normalizedSearchQuery)))
          .map((quote) => ({ id: quote.id, title: quote.quoteNumber || 'Angebot', subtitle: `Angebot · ${quote.customerName}`, page: 'quotes' })),
        ...jobEntries
          .filter((job) => [job.jobNumber, job.title, job.customerName, job.description].some((value) => value?.toString().toLocaleLowerCase('de-DE').includes(normalizedSearchQuery)))
          .map((job) => ({ id: job.id, title: job.title || job.jobNumber || terminology.work.singular, subtitle: `${terminology.work.singular} · ${job.customerName}`, page: 'jobs' })),
      ].slice(0, 10)
    : [];

  const handlePageChange = (page: string) => {
    if (page === 'invoices' || invoiceSubPageIds.includes(page)) {
      setIsInvoiceMenuOpen(true);
      setIsTaxMenuOpen(false);
    } else if (page === 'taxes' || taxSubPageIds.includes(page)) {
      setIsTaxMenuOpen(true);
      setIsInvoiceMenuOpen(false);
    } else {
      setIsInvoiceMenuOpen(false);
      setIsTaxMenuOpen(false);
    }
    onPageChange(page);
    setIsMobileMenuOpen(false);
  };

  /**
   * Untermenüs werden über eine eigene Schaltfläche auf- und zugeklappt. Das
   * Aufklappen ist damit keine Navigation und schließt die mobile Seitenleiste
   * nicht.
   */
  const toggleSubMenu = (itemId: string) => {
    if (itemId === 'invoices') {
      setIsInvoiceMenuOpen(open => !open);
      setIsTaxMenuOpen(false);
    } else if (itemId === 'taxes') {
      setIsTaxMenuOpen(open => !open);
      setIsInvoiceMenuOpen(false);
    }
  };

  /*
   * Globale Suche. Sie steht jetzt in der Kopfleiste statt in der
   * Seitenleiste; Zustand und Trefferliste bleiben hier, weil sie auf
   * `allNavItems`, Kunden, Rechnungen, Angebote und Aufträge zugreifen.
   */
  const searchSlot = (
    <div className={`topbar-search ${isSearchOpen ? 'topbar-search-open' : ''}`}>
      <button
        type="button"
        className="topbar-search-toggle md:hidden"
        onClick={() => setIsSearchOpen(true)}
        aria-label="Suche öffnen"
        title="Suche öffnen"
      >
        <Search className="h-5 w-5" />
      </button>
      <div className={`topbar-search-input-wrap ${isSearchOpen ? '' : 'hidden md:block'}`}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && isSearchOpen) {
              setIsSearchOpen(false);
              return;
            }
            if (!pageSearch && event.key === 'Enter' && searchResults[0]) {
              handlePageChange(searchResults[0].page);
              setSearchQuery('');
            }
          }}
          placeholder={pageSearch?.placeholder ?? 'Suchen...'}
          aria-label={pageSearch ? pageSearch.placeholder : 'Globale Suche'}
          className="topbar-search-input h-9 w-full min-w-0 rounded-lg border border-gray-200 bg-gray-50 py-0 pl-10 pr-10 text-sm text-gray-900 outline-none transition focus:border-primary-custom focus:ring-2 focus:ring-primary-custom/20"
        />
        {isSearchOpen && (
          <button
            type="button"
            className="topbar-search-close md:hidden"
            onClick={() => setIsSearchOpen(false)}
            aria-label="Suche schließen"
            title="Suche schließen"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {searchQuery && !pageSearch && (
          <div className="absolute left-0 right-0 top-full z-40 mt-2 max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            {searchResults.length > 0 ? searchResults.map((result) => (
              <button
                key={`${result.page}-${result.id}`}
                type="button"
                onClick={() => {
                  handlePageChange(result.page);
                  setSearchQuery('');
                }}
                className="w-full px-3 py-2 text-left hover:bg-gray-50"
              >
                <div className="truncate text-sm font-medium text-gray-900">{result.title}</div>
                <div className="truncate text-xs text-gray-500">{result.subtitle}</div>
              </button>
            )) : (
              <div className="px-3 py-3 text-sm text-gray-500">Keine Treffer</div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <DynamicColors />
      <div id="app-shell" data-demo-mode={isDemoMode ? 'true' : undefined} className="min-h-screen bg-gray-50">
        <div className="flex relative min-h-screen">
          {isMobileMenuOpen && (
            <div
              className="fixed inset-0 z-30 bg-black bg-opacity-50 lg:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
            />
          )}

          <nav
            style={sidebarStyle}
            className={`
            sidebar-shell
            fixed lg:sticky lg:top-0 lg:bottom-auto inset-y-0 left-0 z-40
            w-64 lg:w-[var(--sidebar-width)] flex-shrink-0 overflow-hidden bg-white shadow-sm transform transition-[width,transform] duration-300
            lg:transform-none lg:shadow-none lg:h-screen lg:self-start
            ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          `}
          >
            <div className={`flex h-full min-h-0 flex-col transition-[padding] duration-300 ease-out ${isSidebarCompact ? 'px-2 pb-2' : 'px-4 pb-4'}`}>
              {/* Der Kopfbereich ist immer exakt so hoch wie die Kopfleiste
                  (h-14). Er läuft dank negativer Ränder bis an die Kanten der
                  Seitenleiste, damit der Strich unter dem Logo bündig mit der
                  Unterkante der Kopfleiste liegt. Eingeklappt stehen Logo und
                  Umschalter untereinander. */}
              <div className={`sidebar-brand mb-3 flex h-14 shrink-0 border-b border-gray-200 ${isSidebarCompact ? '-mx-2 flex-col items-center justify-center gap-1.5 px-2' : '-mx-4 flex-row items-center justify-between gap-2 px-4'}`}>
                <button
                  type="button"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="inline-flex h-12 w-12 min-h-0 min-w-0 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 lg:hidden"
                  aria-label="Menü schließen"
                >
                  <X className="h-6 w-6" />
                </button>
                <button
                  onClick={() => handlePageChange('dashboard')}
                  className={`flex items-center hover:opacity-80 transition-opacity ${isSidebarCompact ? 'justify-center px-0 py-0.5' : 'min-w-0 flex-1 py-2 lg:pl-2'}`}
                  aria-label="Übersicht öffnen"
                >
                  {company.icon ? (
                    <img src={company.icon} alt="Company Icon" className={`${isSidebarCompact ? 'h-6 w-6' : 'h-8 w-8'} rounded transition-all duration-300 ease-out ${isSidebarCompact ? '' : 'mr-3'}`} />
                  ) : (
                    <Building2 className={`${isSidebarCompact ? 'h-6 w-6' : 'h-8 w-8'} text-primary-custom ${isSidebarCompact ? '' : 'mr-3'}`} />
                  )}
                  <span className={`${isSidebarCompact ? 'hidden' : ''} truncate text-xl font-bold text-gray-900`}>SoloOffice</span>
                </button>
              </div>

              <div className="theme-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
                {navSections.map((section) => (
                  <div className="nav-section" key={section.id}>
                    {isSidebarCompact
                      ? <div className="nav-group-rule" aria-hidden="true" />
                      : <p className="nav-group-label">{section.label}</p>}
                    <ul className="space-y-0.5">
                      {section.items.map((item) => {
                  const Icon = item.icon;
                  const isParentActive = currentPage === item.id || item.children?.some(child => child.id === currentPage);
                  const isExpanded = item.id === 'invoices' ? isInvoiceMenuOpen : item.id === 'taxes' ? isTaxMenuOpen : isParentActive;
                  const subMenuItems = isSidebarCompact ? undefined : item.children;
                  return (
                    <li key={item.id}>
                      <div
                        className={`nav-row flex items-center transition-colors ${
                          isParentActive ? 'nav-active' : 'nav-row-muted'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handlePageChange(item.id)}
                          aria-label={item.label}
                          aria-current={isParentActive ? 'page' : undefined}
                          title={isSidebarCompact ? item.label : undefined}
                          className={`flex min-w-0 flex-1 items-center py-1 text-left ${isSidebarCompact ? 'justify-center px-2' : 'pl-2.5 pr-1.5'}`}
                        >
                          <Icon className={`h-4 w-4 flex-shrink-0 ${isSidebarCompact ? '' : 'mr-2.5'}`} />
                          <span className={`${isSidebarCompact ? 'hidden' : ''} truncate`}>{item.label}</span>
                        </button>
                        {subMenuItems?.length ? (
                          <button
                            type="button"
                            onClick={() => toggleSubMenu(item.id)}
                            aria-expanded={isExpanded}
                            aria-controls={`nav-submenu-${item.id}`}
                            aria-label={`${item.label}: Untermenü ${isExpanded ? 'zuklappen' : 'aufklappen'}`}
                            title={isExpanded ? 'Untermenü zuklappen' : 'Untermenü aufklappen'}
                            className="mr-1 inline-flex h-6 w-6 min-h-0 min-w-0 shrink-0 items-center justify-center rounded-md text-current transition-colors hover:bg-black/5"
                          >
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4" />
                              : <ChevronRight className="h-4 w-4" />}
                          </button>
                        ) : null}
                      </div>
                      {subMenuItems?.length && isExpanded ? (
                        <ul id={`nav-submenu-${item.id}`} className="ml-[1.15rem] mb-0.5 mt-0.5 space-y-px border-l border-gray-200 pl-2.5">
                          {subMenuItems.map((child) => (
                            <li key={child.id}>
                              <button
                                type="button"
                                onClick={() => handlePageChange(child.id)}
                                aria-current={currentPage === child.id ? 'page' : undefined}
                                className={`nav-subrow w-full rounded-md px-2.5 py-1 text-left text-[13px] transition-colors ${
                                  currentPage === child.id ? 'nav-subrow-active' : 'nav-row-muted'
                                }`}
                              >
                                {child.label}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                      })}
                    </ul>
                  </div>
                ))}
              </div>

              <div className="shrink-0 border-t border-gray-200 pt-2">
                {!isSidebarCompact && <p className="nav-group-label">Verwaltung</p>}
                <ul className="space-y-0.5">
                  {bottomNavItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => handlePageChange(item.id)}
                          aria-label={item.label}
                          aria-current={currentPage === item.id ? 'page' : undefined}
                          title={isSidebarCompact ? item.label : undefined}
                          className={`nav-row flex w-full items-center py-1 text-left transition-colors ${isSidebarCompact ? 'justify-center px-2' : 'px-2.5'} ${
                            currentPage === item.id ? 'nav-active' : 'nav-row-muted'
                          }`}
                        >
                          <Icon className={`h-4 w-4 flex-shrink-0 ${isSidebarCompact ? '' : 'mr-2.5'}`} />
                          <span className={`${isSidebarCompact ? 'hidden' : ''} truncate`}>{item.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {!companySetupComplete && (
                  <button
                    type="button"
                    onClick={() => handlePageChange('settings')}
                    className={`sidebar-setup-notice ${isSidebarCompact ? 'justify-center' : ''}`}
                    aria-label="Firmendaten vervollständigen"
                    title={isSidebarCompact ? 'Firmendaten vervollständigen' : undefined}
                  >
                    <span className={`${isSidebarCompact ? 'hidden' : ''} sidebar-setup-copy`}>
                      <strong>Firmendaten vervollständigen:</strong>
                      <span>Pflichtangaben fehlen</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </button>
                )}

                <div className="sidebar-account mt-2">
                  <ActionMenu
                    containerClassName="w-full"
                    ariaLabel={`Konto von ${accountName} öffnen`}
                    title="Konto"
                    menuClassName="sidebar-account-menu min-w-[18rem]"
                    triggerClassName="sidebar-account-trigger"
                    icon={(
                      <span className="sidebar-account-content">
                        <span className="sidebar-account-avatar" aria-hidden="true">{accountInitials}</span>
                        <span className={`${isSidebarCompact ? 'hidden' : ''} sidebar-account-label min-w-0 flex-1 text-left`}>
                          <span className="block truncate text-sm font-semibold">{accountName}</span>
                          <span className="block truncate text-xs text-gray-500">{workspace?.name || 'Workspace'}</span>
                        </span>
                        <MoreHorizontal className="sidebar-account-more h-5 w-5 shrink-0" aria-hidden="true" />
                      </span>
                    )}
                  >
                    <div className="sidebar-account-menu-header">
                      <span className="sidebar-account-avatar" aria-hidden="true">{accountInitials}</span>
                      <span className="min-w-0">
                        <strong className="block truncate text-sm text-gray-900">{accountName}</strong>
                        <span className="block truncate text-xs text-gray-500">{workspace?.name || 'Workspace'}</span>
                      </span>
                    </div>
                    <div className="pt-1">
                      <ActionMenuItem icon={<UserRound className="h-4 w-4" />} onClick={() => handlePageChange('profile')}>Benutzerdaten</ActionMenuItem>
                      <ActionMenuItem icon={<FileText className="h-4 w-4" />} onClick={() => handlePageChange('workspace')}>Vertragsdaten</ActionMenuItem>
                      <ActionMenuItem icon={<CreditCard className="h-4 w-4" />} onClick={() => openLandingPage('/preise')}>Tarif</ActionMenuItem>
                      <ActionMenuItem icon={<FolderOpen className="h-4 w-4" />} onClick={() => handlePageChange('documents')}>Dokumente</ActionMenuItem>
                      {company.jobTrackingEnabled && <ActionMenuItem icon={<ListChecks className="h-4 w-4" />} onClick={() => handlePageChange('jobs')}>Aufgaben</ActionMenuItem>}
                      {company.jobTrackingEnabled && <ActionMenuItem icon={<Clock3 className="h-4 w-4" />} onClick={() => handlePageChange('calendar')}>Zeiterfassung</ActionMenuItem>}
                    </div>
                    <div className="sidebar-account-menu-section">
                      <ActionMenuItem icon={<ExternalLink className="h-4 w-4" />} onClick={() => openLandingPage('/datenschutz')}>Datenschutzerklärung</ActionMenuItem>
                      <ActionMenuItem icon={<ExternalLink className="h-4 w-4" />} onClick={() => openLandingPage('/impressum')}>Impressum</ActionMenuItem>
                    </div>
                    <div className="sidebar-account-meta">
                      <span>Kundennummer: —</span>
                      <span>{versionLabel}</span>
                    </div>
                    <div className="sidebar-account-menu-section">
                      <ActionMenuItem icon={<LogOut className="h-4 w-4" />} tone="red" onClick={() => { void logout(); }}>Abmelden</ActionMenuItem>
                    </div>
                  </ActionMenu>
                </div>
              </div>
            </div>
            <div
              className="absolute right-0 top-0 hidden h-full w-1 cursor-col-resize transition-colors hover:bg-primary-custom/40 lg:block"
              onMouseDown={() => setIsResizingSidebar(true)}
              onDoubleClick={() => setSidebarSettings({ width: SIDEBAR_DEFAULT_WIDTH, collapsed: false })}
              title="Seitenleistenbreite ändern"
              aria-hidden="true"
            />
          </nav>

          {/* Im Demo-Modus steht unten eine fest positionierte Hinweisleiste.
              Ohne zusätzlichen Abstand läge der letzte Inhalt darunter – auf
              Mobilgeräten trifft das sonst genau die Schaltflächen am
              Formularende. `demo-bar-space` ersetzt `safe-area-bottom`, statt
              es zu ergänzen (siehe Begründung in index.css). */}
          <div className="flex min-h-screen min-w-0 flex-1 flex-col">
            <TopBar
              searchSlot={searchSlot}
              isSidebarCompact={isSidebarCompact}
              onToggleSidebar={toggleSidebar}
              notices={topBarNotices}
              onNavigate={handlePageChange}
              onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
            />
            <main
              className={`min-w-0 flex-1 p-3 sm:p-4 lg:p-6 ${
                isDemoMode ? 'demo-bar-space' : 'safe-area-bottom'
              }`}
            >
              <PageSearchContext.Provider value={pageSearchValue}>
              <div className={`mx-auto w-full ${contentWidthClass}`}>
              {children}
              </div>
              </PageSearchContext.Provider>
            </main>
          </div>
        </div>
      </div>

      {/* Rendert nur im Demo-Modus; im Self-Hosting gibt die Komponente
          null zurück. */}
      <DemoNotice />
    </>
  );
}
