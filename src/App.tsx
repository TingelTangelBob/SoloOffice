import { useState, useEffect } from 'react';
import { AppProvider, useLoading } from './context/AppContext';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { CustomerManagement } from './components/CustomerManagement';
import { InvoiceManagement } from './components/InvoiceManagement';
import { QuoteManagement } from './components/QuoteManagement';
import { QuoteEditor } from './components/QuoteEditor';
import { Settings } from './components/Settings';
import { JobManagement } from './components/JobManagement';
import { Calendar } from './components/Calendar';
import { ReportingManagement } from './components/ReportingManagement';
import { ReminderManagement } from './components/ReminderManagement';
import { useCompany } from './context/CompanyContext';
import { useQuotes } from './context/QuoteContext';

interface PageState {
  page: string;
  filter?: string;
  searchTerm?: string;
  quoteId?: string;
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

  const AppContent = () => {
    const { loading } = useLoading();
    const { company } = useCompany();
    const { quotes } = useQuotes();
    
    const renderPage = () => {
      // Show loading state while data is being fetched
      if (loading) {
        return (
          <div className="flex items-center justify-center h-screen">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Lade Daten...</p>
            </div>
          </div>
        );
      }
      
      switch (currentPageState.page) {
        case 'dashboard':
          return <Dashboard onNavigate={handlePageChange} />;
        case 'customers':
          return <CustomerManagement />;
        case 'jobs':
          // Redirect to settings if job tracking is not enabled
          if (!company.jobTrackingEnabled) {
            handlePageChange('settings');
            return <Settings />;
          }
          return <JobManagement onNavigate={handlePageChange} />;
        case 'calendar':
          // Redirect to settings if job tracking is not enabled
          if (!company.jobTrackingEnabled) {
            handlePageChange('settings');
            return <Settings />;
          }
          return <Calendar onNavigate={handlePageChange} />;
        case 'invoices':
          return <InvoiceManagement initialFilter={currentPageState.filter} initialSearchTerm={currentPageState.searchTerm} onNavigate={handlePageChange} />;
        case 'quotes':
          // Redirect to settings if quotes module is not enabled
          if (!company.quotesEnabled) {
            handlePageChange('settings');
            return <Settings />;
          }
          return <QuoteManagement onNavigate={handlePageChange} />;
        case 'quote-editor':
          // Redirect to settings if quotes module is not enabled
          if (!company.quotesEnabled) {
            handlePageChange('settings');
            return <Settings />;
          }
          const quoteToEdit = currentPageState.quoteId 
            ? quotes.find(q => q.id === currentPageState.quoteId) || null
            : null;
          return <QuoteEditor 
            quote={quoteToEdit} 
            onClose={() => handlePageChange('quotes')} 
            onNavigateToCustomers={() => handlePageChange('customers')}
            onNavigateToSettings={() => handlePageChange('settings')}
          />;
        case 'reporting':
          // Redirect to settings if reporting is not enabled
          if (!company.reportingEnabled) {
            handlePageChange('settings');
            return <Settings />;
          }
          return <ReportingManagement />;
        case 'reminders':
          // Redirect to settings if reminders module is not enabled
          if (!company.remindersEnabled) {
            handlePageChange('settings');
            return <Settings />;
          }
          return <ReminderManagement />;
        case 'settings':
          return <Settings />;
        default:
          return <Dashboard onNavigate={handlePageChange} />;
      }
    };

    return (
      <Layout currentPage={currentPageState.page} onPageChange={(page) => handlePageChange(page)}>
        {renderPage()}
      </Layout>
    );
  };

  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;
