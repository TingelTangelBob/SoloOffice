import { lazy, Suspense, useCallback, useRef, useState, useEffect } from 'react';
import { AppProvider } from './context/AppContext';
import { useLoading } from './context/LoadingContext';
import { Layout } from './components/Layout';
import { useCompany } from './context/CompanyContext';
import { useQuotes } from './context/QuoteContext';
import { useAuth } from './context/AuthContext';
import { AuthProvider } from './context/AuthProvider';
import { MotionProvider } from './context/MotionProvider';
import { FeedbackProvider } from './context/FeedbackProvider';
import { AuthPage } from './components/AuthPage';
import { trackTelemetry } from './services/telemetry';
import { navigatePage, readPageState, type PageState } from './utils/hashRouter';
import { confirmNavigation, guardScopeForNavigation, isNavigationBlocked } from './utils/navigationGuard';
import { normalizeSettingsArea } from './utils/settingsNavigation';

const Dashboard = lazy(() => import('./components/Dashboard').then(({ Dashboard: page }) => ({ default: page })));
const CustomerManagement = lazy(() => import('./components/CustomerManagement').then(({ CustomerManagement: page }) => ({ default: page })));
const CustomerDetail = lazy(() => import('./components/CustomerDetail').then(({ CustomerDetail: page }) => ({ default: page })));
const InvoiceManagement = lazy(() => import('./components/InvoiceManagement').then(({ InvoiceManagement: page }) => ({ default: page })));
const QuoteManagement = lazy(() => import('./components/QuoteManagement').then(({ QuoteManagement: page }) => ({ default: page })));
const QuoteEditor = lazy(() => import('./components/QuoteEditor').then(({ QuoteEditor: page }) => ({ default: page })));
const Settings = lazy(() => import('./components/Settings').then(({ Settings: page }) => ({ default: page })));
const DataImportCenter = lazy(() => import('./components/DataImportCenter').then(({ DataImportCenter: page }) => ({ default: page })));
const SetupWizard = lazy(() => import('./components/SetupWizard').then(({ SetupWizard: page }) => ({ default: page })));
const TemplatesManagement = lazy(() => import('./components/TemplatesManagement').then(({ TemplatesManagement: page }) => ({ default: page })));
const PositionTemplatesManagement = lazy(() => import('./components/PositionTemplatesManagement').then(({ PositionTemplatesManagement: page }) => ({ default: page })));
const JobManagement = lazy(() => import('./components/JobManagement').then(({ JobManagement: page }) => ({ default: page })));
const Calendar = lazy(() => import('./components/Calendar').then(({ Calendar: page }) => ({ default: page })));
const ReportingManagement = lazy(() => import('./components/ReportingManagement').then(({ ReportingManagement: page }) => ({ default: page })));
const ReminderManagement = lazy(() => import('./components/ReminderManagement').then(({ ReminderManagement: page }) => ({ default: page })));
const RecurringInvoiceManagement = lazy(() => import('./components/RecurringInvoiceManagement').then(({ RecurringInvoiceManagement: page }) => ({ default: page })));
const CreditNoteManagement = lazy(() => import('./components/CreditNoteManagement').then(({ CreditNoteManagement: page }) => ({ default: page })));
const TaxOverview = lazy(() => import('./components/TaxOverview').then(({ TaxOverview: page }) => ({ default: page })));
const EuerManagement = lazy(() => import('./components/EuerManagement').then(({ EuerManagement: page }) => ({ default: page })));
const VatOverview = lazy(() => import('./components/VatOverview').then(({ VatOverview: page }) => ({ default: page })));
const RecurringExpensesManagement = lazy(() => import('./components/RecurringExpensesManagement').then(({ RecurringExpensesManagement: page }) => ({ default: page })));
const FixedAssetManagement = lazy(() => import('./components/FixedAssetManagement').then(({ FixedAssetManagement: page }) => ({ default: page })));
const DocumentsManagement = lazy(() => import('./components/DocumentsManagement').then(({ DocumentsManagement: page }) => ({ default: page })));
const ProfileManagement = lazy(() => import('./components/ProfileManagement').then(({ ProfileManagement: page }) => ({ default: page })));
const WorkspaceManagement = lazy(() => import('./components/WorkspaceManagement').then(({ WorkspaceManagement: page }) => ({ default: page })));
const SupportManagement = lazy(() => import('./components/SupportManagement').then(({ SupportManagement: page }) => ({ default: page })));

interface AppContentProps {
  currentPageState: PageState;
  onPageChange: (page: string, filter?: string, searchTerm?: string, invoiceId?: string, jobSeriesId?: string) => void;
}

function PageLoading({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div className={`flex items-center justify-center ${fullScreen ? 'h-screen' : 'h-64'}`}>
      <div className="text-center">
        {/* Inline statt Klasse: der Spinner läuft auch vor #app-shell, wo die Akzent-Regeln noch nicht greifen. */}
        <div
          className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2"
          style={{ borderBottomColor: 'var(--primary-color, #2563eb)' }}
        />
        <p className="mt-4 text-gray-600">Lade Ansicht...</p>
      </div>
    </div>
  );
}

/**
 * Seiten abgeschalteter Module dürfen nicht gerendert werden. Die Prüfung
 * liegt bewusst außerhalb des Renderns, damit die Umleitung als Effekt läuft
 * und nicht während des Renderns den Zustand der Elternkomponente ändert.
 */
function isModuleDisabled(page: string, company: ReturnType<typeof useCompany>['company']): boolean {
  if (page === 'jobs' || page === 'calendar') return !company.jobTrackingEnabled;
  if (page === 'quotes' || page === 'quote-editor') return !company.quotesEnabled;
  if (page === 'reporting') return !company.reportingEnabled;
  return false;
}

function AppContent({ currentPageState, onPageChange }: AppContentProps) {
  const { loading, error } = useLoading();
  const { company } = useCompany();
  const { quotes } = useQuotes();
  const moduleDisabled = !loading && isModuleDisabled(currentPageState.page, company);

  useEffect(() => {
    if (moduleDisabled) onPageChange('settings');
  }, [moduleDisabled, onPageChange]);

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

    // Die Umleitung eines abgeschalteten Moduls läuft im Effekt oben; bis sie
    // greift, wird nur der Ladezustand gezeigt.
    if (moduleDisabled) {
      return <PageLoading />;
    }

    switch (currentPageState.page) {
      case 'setup':
        return <SetupWizard onNavigate={onPageChange} />;
      case 'dashboard':
        return <Dashboard onNavigate={onPageChange} />;
      case 'customers':
        return <CustomerManagement
          initialFilter={currentPageState.filter}
          initialCustomerId={currentPageState.filter === 'edit' ? currentPageState.searchTerm : undefined}
          onNavigate={onPageChange}
        />;
      case 'customer':
        return <CustomerDetail customerId={currentPageState.filter} initialTab={currentPageState.searchTerm} onNavigate={onPageChange} />;
      case 'jobs':
        return <JobManagement onNavigate={onPageChange} initialFilter={currentPageState.filter} initialCustomerId={currentPageState.filter === 'new' ? currentPageState.searchTerm : undefined} initialRecurringGroupId={currentPageState.jobSeriesId} />;
      case 'calendar':
        return <Calendar onNavigate={onPageChange} />;
      case 'invoices':
        return <InvoiceManagement initialFilter={currentPageState.filter} initialSearchTerm={currentPageState.filter === 'new' ? undefined : currentPageState.searchTerm} initialCustomerId={currentPageState.filter === 'new' ? currentPageState.searchTerm : undefined} initialInvoiceId={currentPageState.invoiceId} onNavigate={onPageChange} />;
      case 'recurring-invoices':
        return <RecurringInvoiceManagement />;
      case 'credit-notes':
        return <CreditNoteManagement initialAction={currentPageState.filter} />;
      case 'taxes':
      case 'tax-overview':
        return <TaxOverview onNavigate={onPageChange} />;
      case 'euer':
        return <EuerManagement onNavigate={onPageChange} initialAction={currentPageState.filter} />;
      case 'vat':
        return <VatOverview onNavigate={onPageChange} />;
      case 'fixed-costs':
        return <RecurringExpensesManagement onNavigate={onPageChange} />;
      case 'fixed-assets':
        return <FixedAssetManagement />;
      case 'documents':
      case 'receipts':
      case 'incoming-e-invoices':
        return <DocumentsManagement initialTab={currentPageState.filter} onNavigate={onPageChange} />;
      case 'quotes':
        return <QuoteManagement onNavigate={onPageChange} />;
      case 'quote-editor': {
        const quoteToEdit = currentPageState.quoteId
          ? quotes.find(q => q.id === currentPageState.quoteId) || null
          : null;
        return <QuoteEditor
          quote={quoteToEdit}
          initialCustomerId={currentPageState.filter === 'new' ? currentPageState.searchTerm : undefined}
          onClose={() => {
            if (currentPageState.filter === 'new' && currentPageState.searchTerm) {
              onPageChange('customer', currentPageState.searchTerm);
              return;
            }
            onPageChange('quotes');
          }}
          onNavigateToCustomers={() => onPageChange('customers')}
          onNavigateToSettings={() => onPageChange('settings')}
        />;
      }
      case 'reporting':
        return <ReportingManagement onNavigate={onPageChange} />;
      case 'reminders':
        return <ReminderManagement />;
      case 'settings':
        return <Settings initialTab={normalizeSettingsArea(currentPageState.filter)} section={currentPageState.searchTerm} onNavigate={onPageChange} />;
      case 'profile':
        return <ProfileManagement />;
      case 'workspace':
        return <WorkspaceManagement />;
      case 'support':
        return <SupportManagement initialTicketId={currentPageState.filter} onNavigate={onPageChange} />;
      case 'templates':
        return <TemplatesManagement />;
      case 'positions':
        return <PositionTemplatesManagement />;
      case 'data-import':
        return <DataImportCenter onNavigate={onPageChange} />;
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

  useEffect(() => {
    if (loading || !isAuthenticated || !workspace || typeof sessionStorage === 'undefined') return;
    const heartbeatKey = `solooffice-telemetry-heartbeat-${new Date().toISOString().slice(0, 10)}`;
    if (sessionStorage.getItem(heartbeatKey)) return;
    sessionStorage.setItem(heartbeatKey, '1');
    trackTelemetry('heartbeat');
  }, [isAuthenticated, loading, workspace]);

  if (loading) return <PageLoading fullScreen />;
  if (!isAuthenticated || !workspace) return <AuthPage />;

  return (
    <AppProvider key={workspace.id}>
      <MotionProvider><AppContent currentPageState={currentPageState} onPageChange={onPageChange} /></MotionProvider>
    </AppProvider>
  );
}

function App() {
  const [currentPageState, setCurrentPageState] = useState<PageState>(() => readPageState(new URL(window.location.href)));
  // Zuletzt angezeigte Adresse; Ziel, wenn ein Verlassen abgebrochen wird.
  const lastHref = useRef(window.location.href);
  const guardPending = useRef(false);

  const handlePageChange = useCallback((page: string, filter?: string, searchTerm?: string, invoiceId?: string, jobSeriesId?: string) => {
    const navigate = () => {
      const nextState = navigatePage(window.history, window.location.href, page, filter, searchTerm, invoiceId, jobSeriesId);
      lastHref.current = window.location.href;
      setCurrentPageState(nextState);
    };
    const scope = guardScopeForNavigation(readPageState(new URL(window.location.href)), { page, filter });
    if (!scope || !isNavigationBlocked(scope)) {
      navigate();
      return;
    }
    if (guardPending.current) return;
    guardPending.current = true;
    void confirmNavigation(scope)
      .then(confirmed => { if (confirmed) navigate(); })
      .finally(() => { guardPending.current = false; });
  }, []);

  // URL ist die gemeinsame Quelle für Hauptseite und Einstellungs-Unterbereich.
  useEffect(() => {
    const applyLocation = () => {
      const url = new URL(window.location.href);
      const nextState = readPageState(url);
      if (nextState.page !== 'settings' && url.searchParams.has('settingsTab')) {
        url.searchParams.delete('settingsTab');
        window.history.replaceState(window.history.state, '', url);
      }
      lastHref.current = window.location.href;
      setCurrentPageState(previous => (
        previous.page === nextState.page
        && previous.filter === nextState.filter
        && previous.searchTerm === nextState.searchTerm
        && previous.invoiceId === nextState.invoiceId
        && previous.jobSeriesId === nextState.jobSeriesId
          ? previous
          : nextState
      ));
    };

    // Zurück/Vor oder geänderte Adresse: Bei ungespeicherten Änderungen bleibt
    // die Seite stehen, bis die Nachfrage beantwortet ist.
    const syncFromLocation = () => {
      const target = new URL(window.location.href);
      const previous = new URL(lastHref.current);
      const scope = guardScopeForNavigation(readPageState(previous), readPageState(target));
      if (!scope || !isNavigationBlocked(scope)) {
        applyLocation();
        return;
      }
      window.history.pushState(window.history.state, '', previous);
      if (guardPending.current) return;
      guardPending.current = true;
      void confirmNavigation(scope)
        .then(confirmed => {
          if (!confirmed) return;
          window.history.replaceState(window.history.state, '', target);
          applyLocation();
        })
        .finally(() => { guardPending.current = false; });
    };

    applyLocation();
    window.addEventListener('hashchange', syncFromLocation);
    window.addEventListener('popstate', syncFromLocation);
    return () => {
      window.removeEventListener('hashchange', syncFromLocation);
      window.removeEventListener('popstate', syncFromLocation);
    };
  }, []);

  return (
    <FeedbackProvider>
      <AuthProvider>
        <AuthenticatedShell currentPageState={currentPageState} onPageChange={handlePageChange} />
      </AuthProvider>
    </FeedbackProvider>
  );
}

export default App;
