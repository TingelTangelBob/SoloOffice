import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiService } from '../services/api';
import { setupMetaTags } from '../utils/faviconUtils';
import logger from '../utils/logger';

// Import individual contexts
import { CustomerProvider, useCustomers } from './CustomerContext';
import { InvoiceProvider, useInvoices } from './InvoiceContext';
import { QuoteProvider, useQuotes } from './QuoteContext';
import { JobProvider, useJobs } from './JobContext';
import { CompanyProvider, useCompany, defaultCompany, defaultDocumentTemplates } from './CompanyContext';

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
        const storedDocumentTemplates = companyData.documentTemplates || [];
        const storedDocumentTypes = new Set(storedDocumentTemplates.map(template => template.documentType));
        const normalisedStoredTemplates = storedDocumentTemplates.map(template => {
          const defaults = defaultDocumentTemplates.find(defaultTemplate => defaultTemplate.documentType === template.documentType);
          return defaults ? {
            ...defaults,
            ...template,
            layout: template.layout || defaults.layout,
            accentColor: template.accentColor || defaults.accentColor,
            logoMode: template.logoMode || defaults.logoMode,
            headerAlignment: template.headerAlignment || defaults.headerAlignment,
            tableStyle: template.tableStyle || defaults.tableStyle,
            showPaymentInformation: template.showPaymentInformation ?? defaults.showPaymentInformation,
            showFooter: template.showFooter ?? defaults.showFooter,
            reminderTexts: template.reminderTexts || defaults.reminderTexts,
          } : template;
        });
        const documentTemplates = storedDocumentTemplates.length > 0
          ? [
              ...normalisedStoredTemplates,
              ...defaultDocumentTemplates
                .filter(template => !storedDocumentTypes.has(template.documentType))
                .map(template => ({ ...template })),
            ]
          : defaultDocumentTemplates.map(template => ({ ...template }));

        companyContext.setCompany({
          ...companyData,
          themeMode: companyData.themeMode || defaultCompany.themeMode,
          terminologyProfile: companyData.terminologyProfile || defaultCompany.terminologyProfile,
          paymentInformationMode: companyData.paymentInformationMode || defaultCompany.paymentInformationMode,
          documentTemplates,
        });
        companyContext.setMaterialTemplates(materialTemplatesData);
        companyContext.setHourlyRates(hourlyRatesData);
      } catch (error) {
        logger.error('Error loading data:', { error: error instanceof Error ? error.message : String(error) });
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

