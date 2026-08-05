import { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';
import { FileText, Users, Settings, BarChart3, Building2, Menu, X, Briefcase, Calendar, Home, FileCheck, FileScan, Search, Copy, Calculator, ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen, CircleUserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DynamicColors } from './DynamicColors';
import { useCompany } from '../context/CompanyContext';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useQuotes } from '../context/QuoteContext';
import { useJobs } from '../context/JobContext';
import { getTerminology } from '../utils/terminology';
import { useAuth } from '../context/AuthContext';

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

export function Layout({ children, currentPage, onPageChange }: LayoutProps) {
  const { company } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);
  const { customers } = useCustomers();
  const { invoices } = useInvoices();
  const { quotes } = useQuotes();
  const { jobEntries } = useJobs();
  const { user, workspace } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [sidebarSettings, setSidebarSettings] = useState<SidebarSettings>(readSidebarSettings);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const invoiceAreaActive = currentPage === 'invoices' || invoiceSubPageIds.includes(currentPage);
  const [isInvoiceMenuOpen, setIsInvoiceMenuOpen] = useState(() => invoiceAreaActive);
  const invoiceAreaWasActive = useRef(invoiceAreaActive);
  const taxAreaActive = currentPage === 'taxes' || taxSubPageIds.includes(currentPage);
  const [isTaxMenuOpen, setIsTaxMenuOpen] = useState(() => taxAreaActive);
  const taxAreaWasActive = useRef(taxAreaActive);
  const isSidebarCompact = sidebarSettings.collapsed || sidebarSettings.width <= SIDEBAR_COMPACT_BREAKPOINT;

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
    const handleMouseUp = () => setIsResizingSidebar(false);

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

  const sidebarStyle = {
    '--sidebar-width': `${isSidebarCompact ? SIDEBAR_COMPACT_WIDTH : sidebarSettings.width}px`,
  } as CSSProperties;
  const wideContentPages = ['invoices', 'quotes', 'jobs', 'calendar', 'customers', 'reporting'];
  const contentWidthClass = currentPage === 'templates'
    ? 'max-w-[1440px]'
    : wideContentPages.includes(currentPage)
      ? 'max-w-[1600px]'
      : 'max-w-7xl';

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
    id: 'receipts',
    label: 'Belege',
    icon: FileScan,
  };

  const quotesNavItem = { id: 'quotes', label: 'Angebote', icon: FileCheck };
  const jobNavItem = { id: 'jobs', label: terminology.work.navLabel, icon: Briefcase };
  const calendarNavItem = { id: 'calendar', label: 'Kalender', icon: Calendar };
  const reportingNavItem = { id: 'reporting', label: 'Auswertungen', icon: BarChart3 };
  const settingsNavItem = { id: 'settings', label: 'Einstellungen', icon: Settings };
  const templatesNavItem = { id: 'templates', label: 'Vorlagen', icon: Copy };
  const bottomNavItems = [
    { id: 'customers', label: terminology.entity.navLabel, icon: Users },
    templatesNavItem,
    settingsNavItem,
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
    if (page === 'invoices') {
      setIsInvoiceMenuOpen(open => !open);
      setIsTaxMenuOpen(false);
    } else if (invoiceSubPageIds.includes(page)) {
      setIsInvoiceMenuOpen(true);
      setIsTaxMenuOpen(false);
    } else if (page === 'taxes') {
      setIsTaxMenuOpen(open => !open);
      setIsInvoiceMenuOpen(false);
    } else if (taxSubPageIds.includes(page)) {
      setIsTaxMenuOpen(true);
      setIsInvoiceMenuOpen(false);
    } else {
      setIsInvoiceMenuOpen(false);
      setIsTaxMenuOpen(false);
    }
    onPageChange(page);
    setIsMobileMenuOpen(false);
  };

  return (
    <>
      <DynamicColors />
      <div id="app-shell" className="min-h-screen bg-gray-50">
        <div className="flex relative min-h-screen">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="fixed left-3 top-2 z-50 inline-flex h-12 w-12 items-center justify-center rounded-md bg-white p-0 text-gray-500 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-700 lg:hidden"
            aria-label={isMobileMenuOpen ? 'Menü schließen' : 'Menü öffnen'}
          >
            {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>

          {isMobileMenuOpen && (
            <div
              className="fixed inset-0 z-30 bg-black bg-opacity-50 lg:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
            />
          )}

          <nav
            style={sidebarStyle}
            className={`
            fixed lg:sticky lg:top-0 lg:bottom-auto inset-y-0 left-0 z-40
            w-64 lg:w-[var(--sidebar-width)] flex-shrink-0 bg-white shadow-sm transform transition-[width,transform] duration-300 ease-in-out
            lg:transform-none lg:shadow-none lg:h-screen lg:self-start
            ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          `}
          >
            <div className="flex h-full flex-col p-4">
              <div className={`sidebar-brand relative mb-4 flex items-center border-b border-gray-200 pb-2 ${isSidebarCompact ? 'justify-center' : 'justify-between'}`}>
                <button
                  onClick={() => handlePageChange('dashboard')}
                  className={`flex items-center py-2 hover:opacity-80 transition-opacity ${isSidebarCompact ? 'justify-center px-0' : 'min-w-0 flex-1 pl-12 lg:pl-2'}`}
                  aria-label="Übersicht öffnen"
                >
                  {company.icon ? (
                    <img src={company.icon} alt="Company Icon" className={`h-8 w-8 rounded ${isSidebarCompact ? '' : 'mr-3'}`} />
                  ) : (
                    <Building2 className={`h-8 w-8 text-primary-custom ${isSidebarCompact ? '' : 'mr-3'}`} />
                  )}
                  <span className={`${isSidebarCompact ? 'hidden' : ''} truncate text-xl font-bold text-gray-900`}>SoloOffice</span>
                </button>
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="sidebar-toggle hidden h-9 w-9 min-h-0 min-w-0 items-center justify-center rounded-lg bg-white text-gray-500 shadow-sm transition hover:bg-gray-100 hover:text-gray-900 focus-visible:opacity-100 lg:inline-flex"
                  aria-label={isSidebarCompact ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}
                  title={isSidebarCompact ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}
                >
                  {isSidebarCompact ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                </button>
              </div>

              <div className={`${isSidebarCompact ? 'hidden' : 'relative mb-4'}`}>
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && searchResults[0]) {
                      handlePageChange(searchResults[0].page);
                      setSearchQuery('');
                    }
                  }}
                  placeholder="Suchen..."
                  aria-label="Globale Suche"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pr-3 text-sm text-gray-900 outline-none transition focus:border-primary-custom focus:ring-2 focus:ring-primary-custom/20"
                  style={{ paddingLeft: '2.25rem' }}
                />
                {searchQuery && (
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

              <ul className="space-y-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isParentActive = currentPage === item.id || item.children?.some(child => child.id === currentPage);
                  const isExpanded = item.id === 'invoices' ? isInvoiceMenuOpen : item.id === 'taxes' ? isTaxMenuOpen : isParentActive;
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => handlePageChange(item.id)}
                        className={`w-full flex items-center rounded-lg py-2 text-left text-sm transition-colors ${isSidebarCompact ? 'justify-center px-2' : 'px-4'} ${
                          isParentActive
                            ? 'nav-active'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className={`h-5 w-5 flex-shrink-0 ${isSidebarCompact ? '' : 'mr-3'}`} />
                        <span className={`${isSidebarCompact ? 'hidden' : ''} truncate`}>{item.label}</span>
                        {item.children && !isSidebarCompact && (
                          isExpanded
                            ? <ChevronDown className="ml-auto h-4 w-4" />
                            : <ChevronRight className="ml-auto h-4 w-4" />
                        )}
                      </button>
                      {item.children && isExpanded && !isSidebarCompact && (
                        <ul className="ml-6 mt-1 space-y-1 border-l-2 border-gray-200 pl-3">
                          {item.children.map((child) => (
                            <li key={child.id}>
                              <button
                                type="button"
                                onClick={() => handlePageChange(child.id)}
                                className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                                  currentPage === child.id
                                    ? 'font-medium text-primary-custom'
                                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                }`}
                              >
                                {child.label}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>

              <div className="mt-auto border-t border-gray-200 pt-4">
                <ul className="space-y-1">
                  {bottomNavItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.id}>
                        <button
                          onClick={() => handlePageChange(item.id)}
                          className={`w-full flex items-center rounded-lg py-2 text-left text-sm transition-colors ${isSidebarCompact ? 'justify-center px-2' : 'px-4'} ${
                            currentPage === item.id
                              ? 'nav-active'
                              : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <Icon className={`h-5 w-5 flex-shrink-0 ${isSidebarCompact ? '' : 'mr-3'}`} />
                          <span className={`${isSidebarCompact ? 'hidden' : ''} truncate`}>{item.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-3 border-t border-gray-200 pt-3">
                  <button
                    type="button"
                    onClick={() => handlePageChange('profile')}
                    className={`flex w-full items-center rounded-lg py-2 text-left transition-colors ${isSidebarCompact ? 'justify-center px-2' : 'px-3'} ${currentPage === 'profile' ? 'nav-active' : 'text-gray-700 hover:bg-gray-50'}`}
                    title={isSidebarCompact ? user?.displayName : undefined}
                  >
                    <CircleUserRound className={`h-5 w-5 flex-shrink-0 ${isSidebarCompact ? '' : 'mr-3'}`} />
                    <span className={`${isSidebarCompact ? 'hidden' : ''} min-w-0 truncate`}>
                      <span className="block truncate text-sm font-medium">{user?.displayName || 'Profil'}</span>
                      <span className="block truncate text-xs text-gray-500">{workspace?.name || 'Workspace'}</span>
                    </span>
                  </button>
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

          <main className="min-h-screen min-w-0 flex-1 p-3 pt-16 sm:p-4 sm:pt-16 lg:p-6 lg:pt-6 safe-area-bottom">
            <div className={`mx-auto w-full ${contentWidthClass}`}>
              {children}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
