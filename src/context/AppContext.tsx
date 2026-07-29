import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiService } from '../services/api';
import { setupMetaTags } from '../utils/faviconUtils';
import logger from '../utils/logger';

// Import individual contexts
import { CustomerProvider, useCustomers } from './CustomerContext';
import { InvoiceProvider, useInvoices } from './InvoiceContext';
import { QuoteProvider, useQuotes } from './QuoteContext';
import { JobProvider, useJobs } from './JobContext';
import { CompanyProvider, useCompany, defaultCompany } from './CompanyContext';

// ============================================================================
// Loading Context
// ============================================================================

interface LoadingContextType {
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

export function useLoading(): LoadingContextType {
  const context = useContext(LoadingContext);
  if (context === undefined) {
    throw new Error('useLoading must be used within LoadingProvider');
  }
  return context;
}

// ============================================================================
// Data Loader Component
// ============================================================================

interface DataLoaderProps {
  children: ReactNode;
}

function DataLoader({ children }: DataLoaderProps) {
  const { setLoading } = useLoading();
  const customerContext = useCustomers();
  const invoiceContext = useInvoices();
  const quoteContext = useQuotes();
  const jobContext = useJobs();
  const companyContext = useCompany();

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);

        // Load all data in parallel
        const [customersData, invoicesData, quotesData, jobEntriesData, companyData, materialTemplatesData, hourlyRatesData] = await Promise.all([
          apiService.getCustomers().catch(() => []),
          apiService.getInvoices().catch(() => []),
          apiService.getQuotes().catch(() => []),
          apiService.getJobEntries().catch(() => []),
          apiService.getCompany().catch(() => defaultCompany),
          apiService.getMaterialTemplates().catch(() => []),
          apiService.getHourlyRates().catch(() => []),
        ]);

        customerContext.setCustomers(customersData);
        invoiceContext.setInvoices(invoicesData);
        quoteContext.setQuotes(quotesData);
        jobContext.setJobEntries(jobEntriesData);
        companyContext.setCompany(companyData);
        companyContext.setMaterialTemplates(materialTemplatesData);
        companyContext.setHourlyRates(hourlyRatesData);
      } catch (error) {
        logger.error('Error loading data:', error);
      } finally {
        setLoading(false);
      }
    };

    // Setup meta tags on mount
    setupMetaTags();

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}

// ============================================================================
// Main App Provider
// ============================================================================

export function AppProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);

  return (
    <LoadingContext.Provider value={{ loading, setLoading }}>
      <CustomerProvider>
        <InvoiceProvider>
          <QuoteProvider>
            <JobProvider>
              <CompanyProvider loading={loading}>
                <DataLoader>
                  {children}
                </DataLoader>
              </CompanyProvider>
            </JobProvider>
          </QuoteProvider>
        </InvoiceProvider>
      </CustomerProvider>
    </LoadingContext.Provider>
  );
}

