import { lazy, Suspense, useState, useEffect } from 'react';
import { AppProvider, useLoading } from './context/AppContext';
import { Layout } from './components/Layout';
import { useCompany } from './context/CompanyContext';
import { useQuotes } from './context/QuoteContext';

const Dashboard = lazy(() => import('./components/Dashboard').then(({ Dashboard: page }) => ({ default: page })));
const CustomerManagement = lazy(() => import('./components/CustomerManagement').then(({ CustomerManagement: page }) => ({ default: page })));
const InvoiceManagement = lazy(() => import('./components/InvoiceManagement').then(({ InvoiceManagement: page }) => ({ default: page })));
const QuoteManagement = lazy(() => import('./components/QuoteManagement').then(({ QuoteManagement: page }) => ({ default: page })));
const QuoteEditor = lazy(() => import('./components/QuoteEditor').then(({ QuoteEditor: page }) => ({ default: page })));
const Settings = lazy(() => import('./components/Settings').then(({ Settings: page }) => ({ default: page })));
const TemplatesManagement = lazy(() => import('./components/TemplatesManagement').then(({ TemplatesManagement: page }) => ({ default: page })));
const JobManagement = lazy(() => import('./components/JobManagement').then(({ JobManagement: page }) => ({ default: page })));
const Calendar = lazy(() => import('./components/Calendar').then(({ Calendar: page }) => ({ default: page })));
const ReportingManagement = lazy(() => import('./components/ReportingManagement').then(({ ReportingManagement: page }) => ({ default: page })));
const ReminderManagement = lazy(() => import('./components/ReminderManagement').then(({ ReminderManagement: page }) => ({ default: page })));
const RecurringInvoiceManagement = lazy(() => import('./components/RecurringInvoiceManagement').then(({ RecurringInvoiceManagement: page }) => ({ default: page })));
const CreditNoteManagement = lazy(() => import('./components/CreditNoteManagement').then(({ CreditNoteManagement: page }) => ({ default: page })));
const TaxOverview = lazy(() => import('./components/TaxOverview').then(({ TaxOverview: page }) => ({ default: page })));
const EuerManagement = lazy(() => import('./components/EuerManagement').then(({ EuerManagement: page }) => ({ default: page })));

interface PageState {
  page: string;
  filter?: string;
  searchTerm?: string;
  quoteId?: string;
}

interface AppContentProps {
  currentPageState: PageState;
  onPageChange: (page: string, filter?: string, searchTerm?: string) => void;
}

function PageLoading({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div className={`flex items-center justify-center ${fullScreen ? 'h-screen' : 'h-64'}`}>
      <div className="text-center">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
        <p className="mt-4 text-gray-600">Lade Ansicht...</p>
      </div>
    </div>
  );
}

function AppContent({ currentPageState, onPageChange }: AppContentProps) {
  const { loading } = useLoading();
  const { company } = useCompany();
  const { quotes } = useQuotes();

  const renderPage = () => {
    // Show loading state while data is being fetched
    if (loading) {
      return <PageLoading fullScreen />;
    }

    switch (currentPageState.page) {
      case 'dashboard':
        return <Dashboard onNavigate={onPageChange} />;
      case 'customers':
        return <CustomerManagement />;
      case 'jobs':
        // Redirect to settings if job tracking is not enabled
        if (!company.jobTrackingEnabled) {
          onPageChange('settings');
          return <Settings />;
        }
        return <JobManagement onNavigate={onPageChange} />;
      case 'calendar':
        // Redirect to settings if job tracking is not enabled
        if (!company.jobTrackingEnabled) {
          onPageChange('settings');
          return <Settings />;
        }
        return <Calendar onNavigate={onPageChange} />;
      case 'invoices':
        return <InvoiceManagement initialFilter={currentPageState.filter} initialSearchTerm={currentPageState.searchTerm} onNavigate={onPageChange} />;
      case 'recurring-invoices':
        return <RecurringInvoiceManagement />;
      case 'credit-notes':
        return <CreditNoteManagement />;
      case 'taxes':
      case 'tax-overview':
        return <TaxOverview onNavigate={onPageChange} />;
      case 'euer':
        return <EuerManagement />;
      case 'quotes':
        // Redirect to settings if quotes module is not enabled
        if (!company.quotesEnabled) {
          onPageChange('settings');
          return <Settings />;
        }
        return <QuoteManagement onNavigate={onPageChange} />;
      case 'quote-editor': {
        // Redirect to settings if quotes module is not enabled
        if (!company.quotesEnabled) {
          onPageChange('settings');
          return <Settings />;
        }
        const quoteToEdit = currentPageState.quoteId
          ? quotes.find(q => q.id === currentPageState.quoteId) || null
          : null;
        return <QuoteEditor
          quote={quoteToEdit}
          onClose={() => onPageChange('quotes')}
          onNavigateToCustomers={() => onPageChange('customers')}
          onNavigateToSettings={() => onPageChange('settings')}
        />;
      }
      case 'reporting':
        // Redirect to settings if reporting is not enabled
        if (!company.reportingEnabled) {
          onPageChange('settings');
          return <Settings />;
        }
        return <ReportingManagement />;
      case 'reminders':
        // Redirect to settings if reminders module is not enabled
        if (!company.remindersEnabled) {
          onPageChange('settings');
          return <Settings />;
        }
        return <ReminderManagement />;
      case 'settings':
        return <Settings initialTab={currentPageState.filter === 'general' ? 'general' : currentPageState.filter === 'invoices' ? 'invoices' : undefined} onNavigate={onPageChange} />;
      case 'templates':
        return <TemplatesManagement onNavigate={onPageChange} />;
      default:
        return <Dashboard onNavigate={onPageChange} />;
    }
  };

  return (
    <Layout currentPage={currentPageState.page} onPageChange={onPageChange}>
      <Suspense fallback={<PageLoading />}>
        {renderPage()}
      </Suspense>
    </Layout>
  );
}

function App() {
  const [currentPageState, setCurrentPageState] = useState<PageState>(() => {
    // Initialize from URL hash
    const hash = window.location.hash.slice(1); // Remove #
    if (hash) {
      const [page, filter, searchTerm] = hash.split('/');
      return { page: page || 'dashboard', filter, searchTerm, quoteId: filter };
    }
    return { page: 'dashboard' };
  });

  const handlePageChange = (page: string, filter?: string, searchTerm?: string) => {
    const newState = { page, filter, searchTerm, quoteId: page === 'quote-editor' ? filter : undefined };
    setCurrentPageState(newState);
    
    // Update URL hash
    let hash = page;
    if (filter) hash += `/${filter}`;
    if (searchTerm) hash += `/${searchTerm}`;
    window.location.hash = hash;
  };

  // Listen to browser back/forward buttons
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash) {
        const [page, filter, searchTerm] = hash.split('/');
        setCurrentPageState({ 
          page: page || 'dashboard', 
          filter, 
          searchTerm,
          quoteId: page === 'quote-editor' ? filter : undefined 
        });
      } else {
        setCurrentPageState({ page: 'dashboard' });
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <AppProvider>
      <AppContent currentPageState={currentPageState} onPageChange={handlePageChange} />
    </AppProvider>
  );
}

export default App;
