import { ReactNode, useState } from 'react';
import { FileText, Users, Settings, BarChart3, Building2, Menu, X, Briefcase, Calendar, Home, FileCheck, Bell, Search } from 'lucide-react';
import { DynamicColors } from './DynamicColors';
import { useCompany } from '../context/CompanyContext';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useQuotes } from '../context/QuoteContext';
import { useJobs } from '../context/JobContext';

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

export function Layout({ children, currentPage, onPageChange }: LayoutProps) {
  const { company } = useCompany();
  const { customers } = useCustomers();
  const { invoices } = useInvoices();
  const { quotes } = useQuotes();
  const { jobEntries } = useJobs();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const baseNavItems = [
    { id: 'dashboard', label: 'Übersicht', icon: Home },
    { id: 'invoices', label: 'Rechnungen', icon: FileText },
  ];

  const quotesNavItem = { id: 'quotes', label: 'Angebote', icon: FileCheck };
  const jobNavItem = { id: 'jobs', label: 'Aufträge', icon: Briefcase };
  const calendarNavItem = { id: 'calendar', label: 'Kalender', icon: Calendar };
  const reportingNavItem = { id: 'reporting', label: 'Auswertung', icon: BarChart3 };
  const remindersNavItem = { id: 'reminders', label: 'Mahnungen', icon: Bell };
  const settingsNavItem = { id: 'settings', label: 'Einstellungen', icon: Settings };
  const bottomNavItems = [
    { id: 'customers', label: 'Kunden', icon: Users },
    settingsNavItem,
  ];

  const navItems = [
    ...baseNavItems,
    ...(company.quotesEnabled ? [quotesNavItem] : []),
    ...(company.jobTrackingEnabled ? [jobNavItem, calendarNavItem] : []),
    ...(company.remindersEnabled ? [remindersNavItem] : []),
    ...(company.reportingEnabled ? [reportingNavItem] : []),
  ];
  const allNavItems = [...navItems, ...bottomNavItems];

  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase('de-DE');
  const searchResults: SearchResult[] = normalizedSearchQuery
    ? [
        ...allNavItems
          .filter((item) => item.label.toLocaleLowerCase('de-DE').includes(normalizedSearchQuery))
          .map((item) => ({ id: item.id, title: item.label, subtitle: 'Bereich öffnen', page: item.id })),
        ...customers
          .filter((customer) => [customer.name, customer.customerNumber, customer.email].some((value) => value?.toLocaleLowerCase('de-DE').includes(normalizedSearchQuery)))
          .map((customer) => ({ id: customer.id, title: customer.name, subtitle: `Kunde ${customer.customerNumber}`, page: 'customers' })),
        ...invoices
          .filter((invoice) => [invoice.invoiceNumber, invoice.customerName, invoice.notes].some((value) => value?.toString().toLocaleLowerCase('de-DE').includes(normalizedSearchQuery)))
          .map((invoice) => ({ id: invoice.id, title: invoice.invoiceNumber || 'Rechnung', subtitle: `Rechnung · ${invoice.customerName}`, page: 'invoices' })),
        ...quotes
          .filter((quote) => [quote.quoteNumber, quote.customerName, quote.notes].some((value) => value?.toString().toLocaleLowerCase('de-DE').includes(normalizedSearchQuery)))
          .map((quote) => ({ id: quote.id, title: quote.quoteNumber || 'Angebot', subtitle: `Angebot · ${quote.customerName}`, page: 'quotes' })),
        ...jobEntries
          .filter((job) => [job.jobNumber, job.title, job.customerName, job.description].some((value) => value?.toString().toLocaleLowerCase('de-DE').includes(normalizedSearchQuery)))
          .map((job) => ({ id: job.id, title: job.title || job.jobNumber || 'Auftrag', subtitle: `Auftrag · ${job.customerName}`, page: 'jobs' })),
      ].slice(0, 10)
    : [];

  const handlePageChange = (page: string) => {
    onPageChange(page);
    setIsMobileMenuOpen(false);
  };

  return (
    <>
      <DynamicColors />
      <div className="min-h-screen bg-gray-50">
        <div className="flex relative min-h-screen">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="fixed top-3 left-3 z-30 lg:hidden p-2 rounded-md text-gray-500 bg-white shadow-sm hover:text-gray-700 hover:bg-gray-100 transition-colors touch-target"
            aria-label={isMobileMenuOpen ? 'Menü schließen' : 'Menü öffnen'}
          >
            {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>

          {isMobileMenuOpen && (
            <div
              className="fixed inset-0 bg-black bg-opacity-50 z-20 lg:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
            />
          )}

          <nav className={`
            fixed lg:sticky lg:top-0 lg:bottom-auto inset-y-0 left-0 z-20
            w-64 flex-shrink-0 bg-white shadow-sm transform transition-transform duration-300 ease-in-out
            lg:transform-none lg:shadow-none lg:h-screen lg:self-start
            ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          `}>
            <div className="flex h-full flex-col p-4">
              <button
                onClick={() => handlePageChange('dashboard')}
                className="w-full flex items-center px-2 py-2 mb-4 border-b border-gray-200 hover:opacity-80 transition-opacity pl-12 lg:pl-2"
              >
                {company.icon ? (
                  <img src={company.icon} alt="Company Icon" className="h-8 w-8 mr-3 rounded" />
                ) : (
                  <Building2 className="h-8 w-8 text-primary-custom mr-3" />
                )}
                <span className="text-xl font-bold text-gray-900">SoloOffice</span>
              </button>

              <div className="relative mb-4">
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
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => handlePageChange(item.id)}
                        className={`w-full flex items-center px-4 py-2 text-left rounded-lg transition-colors ${
                          currentPage === item.id
                            ? 'nav-active'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="h-5 w-5 mr-3 flex-shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
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
                          className={`w-full flex items-center px-4 py-2 text-left rounded-lg transition-colors ${
                            currentPage === item.id
                              ? 'nav-active'
                              : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <Icon className="h-5 w-5 mr-3 flex-shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </nav>

          <main className="flex-1 min-w-0 p-3 pt-16 sm:p-4 sm:pt-16 lg:p-6 lg:pt-6 min-h-screen safe-area-bottom">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
