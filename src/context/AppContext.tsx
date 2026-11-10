import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { apiService } from '../services/api';
import { setupMetaTags } from '../utils/faviconUtils';
import logger from '../utils/logger';

// Import individual contexts
import { CustomerProvider } from './CustomerProvider';
import { useCustomers } from './CustomerContext';
import { InvoiceProvider } from './InvoiceProvider';
import { useInvoices } from './InvoiceContext';
import { QuoteProvider } from './QuoteProvider';
import { useQuotes } from './QuoteContext';
import { JobProvider } from './JobProvider';
import { useJobs } from './JobContext';
import { CompanyProvider, defaultCompany, defaultDocumentTemplates } from './CompanyProvider';
import { useCompany } from './CompanyContext';
import { LoadingContext, useLoading } from './LoadingContext';

// ============================================================================
// Data Loader Component
// ============================================================================

interface DataLoaderProps {
  children: ReactNode;
}

function DataLoader({ children }: DataLoaderProps) {
  const { setLoading, setShellReady } = useLoading();
  const customerContext = useCustomers();
  const invoiceContext = useInvoices();
  const quoteContext = useQuotes();
  const jobContext = useJobs();
  const companyContext = useCompany();
  const { setError } = useLoading();

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Alle Abfragen starten gleichzeitig. Die Firmendaten kommen als erste
        // zur Anzeige: Sie bestimmen Navigation, Module und Farben, sodass die
        // Hülle erscheint, während Kunden, Rechnungen und Aufträge noch laden.
        const companyRequest = apiService.getCompany();
        const dataRequest = Promise.all([
          apiService.getCustomers(),
          apiService.getInvoices(),
          apiService.getQuotes(),
          apiService.getJobEntries(),
          apiService.getMaterialTemplates(),
          apiService.getHourlyRates(),
        ]);
        // Schlägt eine der übrigen Abfragen fehl, während auf die Firma gewartet
        // wird, darf das keine unbehandelte Ablehnung erzeugen; der Fehler wird
        // unten über `await dataRequest` gemeldet.
        dataRequest.catch(() => {});

        const companyData = await companyRequest;
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
            // A missing mode is intentional for older non-default layouts:
            // the resolver can then detect whether their old texts were custom.
            textMode: template.textMode || (template.isDefault ? 'global' : undefined),
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
        // Keep an empty value empty so the text resolver can still migrate
        // older reminder fields and layout texts on first use.
        const documentTextTemplates = companyData.documentTextTemplates || [];

        companyContext.setCompany({
          ...companyData,
          themeMode: companyData.themeMode || defaultCompany.themeMode,
          terminologyProfile: companyData.terminologyProfile || defaultCompany.terminologyProfile,
          paymentInformationMode: companyData.paymentInformationMode || defaultCompany.paymentInformationMode,
          documentTemplates,
          documentTextTemplates,
        });
        setShellReady(true);

        const [customersData, invoicesData, quotesData, jobEntriesData, materialTemplatesData, hourlyRatesData] = await dataRequest;
        customerContext.setCustomers(customersData);
        invoiceContext.setInvoices(invoicesData);
        quoteContext.setQuotes(quotesData);
        jobContext.setJobEntries(jobEntriesData);
        companyContext.setMaterialTemplates(materialTemplatesData);
        companyContext.setHourlyRates(hourlyRatesData);
      } catch (error) {
        logger.error('Error loading data:', { error: error instanceof Error ? error.message : String(error) });
        setError(error instanceof Error ? error.message : 'Die Daten konnten nicht geladen werden.');
      } finally {
        setShellReady(true);
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
  const [shellReady, setShellReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <LoadingContext.Provider value={{ loading, shellReady, error, setLoading, setShellReady, setError }}>
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
