import { lazy, Suspense, useState, useEffect } from 'react';
import { AppProvider, useLoading } from './context/AppContext';
import { Layout } from './components/Layout';
import { useCompany } from './context/CompanyContext';
import { useQuotes } from './context/QuoteContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthPage } from './components/AuthPage';

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
const FixedAssetManagement = lazy(() => import('./components/FixedAssetManagement').then(({ FixedAssetManagement: page }) => ({ default: page })));
const DocumentsManagement = lazy(() => import('./components/DocumentsManagement').then(({ DocumentsManagement: page }) => ({ default: page })));
const ProfileManagement = lazy(() => import('./components/ProfileManagement').then(({ ProfileManagement: page }) => ({ default: page })));

interface PageState {
  page: string;
  filter?: string;
  searchTerm?: string;
  quoteId?: string;
  invoiceId?: string;
  jobSeriesId?: string;
}

interface AppContentProps {
  currentPageState: PageState;
  onPageChange: (page: string, filter?: string, searchTerm?: string, invoiceId?: string, jobSeriesId?: string) => void;
}

function normalizePageState(page: string, filter?: string, searchTerm?: string, invoiceId?: string, jobSeriesId?: string): PageState {
  if (page === 'receipts') return { page: 'documents', filter: filter || 'receipts', searchTerm };
  if (page === 'incoming-e-invoices') return { page: 'documents', filter: filter || 'incoming', searchTerm };
  return { page, filter, searchTerm, quoteId: page === 'quote-editor' ? filter : undefined, invoiceId, jobSeriesId };
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
  const { loading, error } = useLoading();
  const { company } = useCompany();
  const { quotes } = useQuotes();

  const renderPage = () => {
    // Show loading state while data is being fetched
    if (loading) {
      return <PageLoading fullScreen />;
    }
    if (error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
          <section className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold text-gray-900">Daten konnten nicht geladen werden</h1>
            <p className="mt-2 text-sm text-gray-600">{error}</p>
            <button type="button" onClick={() => window.location.reload()} className="btn-primary mt-5 rounded-lg px-4 py-2 text-sm font-semibold text-white">Erneut laden</button>
          </section>
        </div>
      );
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
        return <JobManagement onNavigate={onPageChange} initialRecurringGroupId={currentPageState.jobSeriesId} />;
      case 'calendar':
        // Redirect to settings if job tracking is not enabled
        if (!company.jobTrackingEnabled) {
          onPageChange('settings');
          return <Settings />;
        }
        return <Calendar onNavigate={onPageChange} />;
      case 'invoices':
        return <InvoiceManagement initialFilter={currentPageState.filter} initialSearchTerm={currentPageState.searchTerm} initialInvoiceId={currentPageState.invoiceId} onNavigate={onPageChange} />;
      case 'recurring-invoices':
        return <RecurringInvoiceManagement />;
      case 'credit-notes':
        return <CreditNoteManagement />;
      case 'taxes':
      case 'tax-overview':
        return <TaxOverview onNavigate={onPageChange} />;
      case 'euer':
        return <EuerManagement onNavigate={onPageChange} />;
      case 'fixed-assets':
        return <FixedAssetManagement />;
      case 'documents':
      case 'receipts':
      case 'incoming-e-invoices':
        return <DocumentsManagement initialTab={currentPageState.filter} onNavigate={onPageChange} />;
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
        return <ReportingManagement onNavigate={onPageChange} />;
      case 'reminders':
        // Redirect to settings if reminders module is not enabled
        if (!company.remindersEnabled) {
          onPageChange('settings');
          return <Settings />;
        }
        return <ReminderManagement />;
      case 'settings':
        return <Settings initialTab={currentPageState.filter === 'general' ? 'general' : currentPageState.filter === 'invoices' ? 'invoices' : currentPageState.filter === 'app' ? 'app' : undefined} onNavigate={onPageChange} />;
      case 'profile':
        return <ProfileManagement />;
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

function AuthenticatedShell({ currentPageState, onPageChange }: AppContentProps) {
  const { loading, isAuthenticated, workspace } = useAuth();

  if (loading) return <PageLoading fullScreen />;
  if (!isAuthenticated || !workspace) return <AuthPage />;

  return (
    <AppProvider key={workspace.id}>
      <AppContent currentPageState={currentPageState} onPageChange={onPageChange} />
    </AppProvider>
  );
}

function App() {
  const [currentPageState, setCurrentPageState] = useState<PageState>(() => {
    // Initialize from URL hash
    const hash = window.location.hash.slice(1); // Remove #
    if (hash) {
      const [page, filter, searchTerm, invoiceId, jobSeriesId] = hash.split('/');
      return normalizePageState(page || 'dashboard', filter, searchTerm, invoiceId, jobSeriesId);
    }
    return { page: 'dashboard' };
  });

  const handlePageChange = (page: string, filter?: string, searchTerm?: string, invoiceId?: string, jobSeriesId?: string) => {
    const newState = normalizePageState(page, filter, searchTerm, invoiceId, jobSeriesId);
    setCurrentPageState(newState);
    
    // Update URL hash
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
    window.location.hash = hash;
  };

  // Listen to browser back/forward buttons
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash) {
        const [page, filter, searchTerm, invoiceId, jobSeriesId] = hash.split('/');
        setCurrentPageState(normalizePageState(page || 'dashboard', filter, searchTerm, invoiceId, jobSeriesId));
      } else {
        setCurrentPageState({ page: 'dashboard' });
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <AuthProvider>
      <AuthenticatedShell currentPageState={currentPageState} onPageChange={handlePageChange} />
    </AuthProvider>
  );
}

export default App;
