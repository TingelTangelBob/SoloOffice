import { useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Company, HourlyRate, MaterialTemplate, InvoiceTemplate, DocumentTemplate } from '../types';
import { apiService } from '../services/api';
import { generateUUID } from '../utils/uuid';
import { updateFavicon, updatePageTitle } from '../utils/faviconUtils';
import logger from '../utils/logger';
import { DEFAULT_TIME_ZONE } from '../utils/timeZones';
import { CompanyContext, type CompanyContextType } from './CompanyContext';
import { defaultDocumentTextTemplates } from '../utils/documentTextTemplates';
import { trackTelemetry } from '../services/telemetry';

// ============================================================================
// Default Values
// ============================================================================

/**
 * Eine Standardvorlage je Dokumentart. Das Design (Layout, Farbe, Schrift,
 * Optionen) ist für alle Dokumentarten gleich und wird auf der Vorlagenseite
 * gemeinsam geändert; Texte bleiben je Dokumentart getrennt.
 */
export const defaultDocumentTemplates: DocumentTemplate[] = [
  {
    id: 'invoice-standard',
    documentType: 'invoice',
    name: 'Klar & klassisch',
    description: 'Vertrautes Layout für laufende Rechnungen mit klarer Adress- und Zahlungsstruktur.',
    subject: 'Rechnung {invoiceNumber}',
    introText: 'Für die von uns erbrachten Leistungen und Lieferungen berechnen wir Ihnen:',
    closingText: 'Vielen Dank für Ihr Vertrauen. Für Rückfragen zu dieser Rechnung sind wir gerne für Sie da.',
    paymentTerms: 'Bitte überweisen Sie den Rechnungsbetrag bis zum Fälligkeitsdatum unter Angabe der Rechnungsnummer.',
    textMode: 'global',
    layout: 'classic',
    accentColor: '#2563eb',
    fontFamily: 'helvetica',
    logoMode: 'company',
    showPaymentInformation: true,
    showFooter: true,
    isDefault: true,
  },
  {
    id: 'quote-standard',
    documentType: 'quote',
    name: 'Standardangebot',
    description: 'Übersichtliches Angebot für typische Anfragen.',
    subject: 'Ihr Angebot {quoteNumber}',
    introText: 'Vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:',
    closingText: 'Wir freuen uns auf Ihre Rückmeldung.',
    paymentTerms: 'Dieses Angebot ist 30 Tage gültig.',
    textMode: 'global',
    layout: 'classic',
    accentColor: '#2563eb',
    fontFamily: 'helvetica',
    logoMode: 'company',
    showPaymentInformation: true,
    showFooter: true,
    isDefault: true,
  },
  {
    id: 'order-confirmation-standard',
    documentType: 'orderConfirmation',
    name: 'Standard-Bestätigung',
    description: 'Klassische Bestätigung mit Positionen und Status.',
    layout: 'classic',
    accentColor: '#2563eb',
    fontFamily: 'helvetica',
    logoMode: 'company',
    showPaymentInformation: true,
    showFooter: true,
    textMode: 'global',
    isDefault: true,
  },
  {
    id: 'reminder-friendly',
    documentType: 'reminder',
    name: 'Mahnung Klassisch',
    description: 'Klassisches Mahnungs-Layout für die Stufen 1–3.',
    subject: 'Mahnung zu Rechnung {invoiceNumber}',
    introText: 'Vielleicht ist die Zahlung der unten aufgeführten Rechnung im Alltag untergegangen. Wir bitten Sie, den offenen Betrag zu prüfen und bei Gelegenheit zu begleichen.',
    layout: 'classic',
    accentColor: '#2563eb',
    fontFamily: 'helvetica',
    logoMode: 'company',
    showPaymentInformation: true,
    showFooter: true,
    reminderTexts: {
      stage1: 'Vielleicht ist die Zahlung der unten aufgeführten Rechnung im Alltag untergegangen. Wir bitten Sie, den offenen Betrag zu prüfen und bei Gelegenheit zu begleichen.',
      stage2: 'Leider konnten wir trotz unserer Zahlungserinnerung noch keinen Zahlungseingang feststellen. Bitte begleichen Sie den offenen Betrag umgehend.',
      stage3: 'Dies ist unsere letzte Mahnung. Sollte der offene Rechnungsbetrag nicht umgehend eingehen, behalten wir uns weitere Schritte vor.',
    },
    textMode: 'global',
    isDefault: true,
  },
];

export const defaultCompany: Company = {
  name: '',
  address: '',
  city: '',
  postalCode: '',
  country: 'Deutschland',
  phone: '',
  email: '',
  website: '',
  taxId: '',
  taxIdentificationNumber: '',
  taxBusinessType: undefined,
  legalForm: undefined,
  logo: null,
  icon: null,
  terminologyProfile: 'customers',
  terminologyColorSource: 'profile',
  receiptLabel: 'Belege',
  bankAccount: '',
  paymentInformation: {
    accountHolder: '',
    bankAccount: '',
    bic: '',
    bankName: '',
    paymentTerms: '',
    paymentMethods: [],
  },
  paymentInformationMode: 'separate',
  primaryColor: '#2563eb',
  secondaryColor: '#64748b',
  locale: 'de-DE',
  numberFormat: 'european',
  currency: 'EUR',
  dateFormat: 'DD.MM.YYYY',
  timeFormat: '24h',
  timeZone: DEFAULT_TIME_ZONE,
  themeMode: 'system',
  jobTrackingEnabled: true,
  reportingEnabled: true,
  defaultPaymentDays: 30,
  immediatePaymentClause: 'Rechnung ist per sofort fällig, ohne Abzug',
  invoiceStartNumber: 1,
  invoiceNumberPattern: 'RE-{YYYY}-{NNN}',
  creditNoteNumberPattern: 'GS-{YYYY}-{NNN}',
  showCombinedDropdowns: false,
  isSmallBusiness: false,
  companyHeaderTwoLine: false,
  companyHeaderLine1: '',
  companyHeaderLine2: '',
  quotesEnabled: false,
  discountsEnabled: true,
  remindersEnabled: false,
  reminderDaysAfterDue: 7,
  reminderDaysBetween: 7,
  reminderFeeStage1: 0,
  reminderFeeStage2: 0,
  reminderFeeStage3: 0,
  documentTemplates: defaultDocumentTemplates,
  documentTextTemplates: defaultDocumentTextTemplates,
};

// ============================================================================
// Provider
// ============================================================================

interface CompanyProviderProps {
  children: ReactNode;
  initialCompany?: Company;
  initialHourlyRates?: HourlyRate[];
  initialMaterialTemplates?: MaterialTemplate[];
  loading?: boolean;
}

export function CompanyProvider({
  children,
  initialCompany = defaultCompany,
  initialHourlyRates = [],
  initialMaterialTemplates = [],
  loading = false,
}: CompanyProviderProps) {
  const [company, setCompany] = useState<Company>(initialCompany);
  const [hourlyRates, setHourlyRates] = useState<HourlyRate[]>(initialHourlyRates);
  const [materialTemplates, setMaterialTemplates] = useState<MaterialTemplate[]>(initialMaterialTemplates);

  // Update favicon and page title when company data changes
  useEffect(() => {
    if (!loading) {
      updateFavicon(company.icon || null);
      updatePageTitle(company.name);
    }
  }, [company.icon, company.name, loading]);

  // --------------------------------------------------------------------------
  // Company Methods
  // --------------------------------------------------------------------------

  const updateCompanyData = useCallback(async (companyData: Partial<Company>): Promise<void> => {
    try {
      const updatedCompany = await apiService.updateCompany(companyData);
      setCompany(previousCompany => ({
        ...updatedCompany,
        themeMode: updatedCompany.themeMode || previousCompany.themeMode || 'system',
        terminologyProfile: updatedCompany.terminologyProfile || previousCompany.terminologyProfile || 'customers',
        receiptLabel: updatedCompany.receiptLabel || previousCompany.receiptLabel || 'Belege',
        taxBusinessType: updatedCompany.taxBusinessType ?? previousCompany.taxBusinessType,
        legalForm: updatedCompany.legalForm ?? previousCompany.legalForm,
        paymentInformationMode: updatedCompany.paymentInformationMode || previousCompany.paymentInformationMode || 'separate',
        documentTemplates: updatedCompany.documentTemplates?.length
          ? updatedCompany.documentTemplates
          : previousCompany.documentTemplates || defaultDocumentTemplates.map(template => ({ ...template })),
        documentTextTemplates: updatedCompany.documentTextTemplates?.length
          ? updatedCompany.documentTextTemplates
          : previousCompany.documentTextTemplates || defaultDocumentTextTemplates.map(template => ({
              ...template,
              reminderTexts: template.reminderTexts ? { ...template.reminderTexts } : undefined,
            })),
      }));
    } catch (error) {
      logger.error('Error updating company:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, []);

  // --------------------------------------------------------------------------
  // Hourly Rate Methods
  // --------------------------------------------------------------------------

  const addHourlyRate = useCallback(async (hourlyRateData: Omit<HourlyRate, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> => {
    try {
      const newRate = await apiService.createHourlyRate(hourlyRateData);
      setHourlyRates(prev => [...prev, newRate]);
    } catch (error) {
      logger.error('Error adding hourly rate:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, []);

  const updateHourlyRateData = useCallback(async (id: string, hourlyRateData: Partial<HourlyRate>): Promise<void> => {
    try {
      const updatedRate = await apiService.updateHourlyRate(id, hourlyRateData);
      setHourlyRates(prev => prev.map(rate =>
        rate.id === id ? updatedRate : rate
      ));
    } catch (error) {
      logger.error('Error updating hourly rate:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, []);

  const deleteHourlyRateData = useCallback(async (id: string): Promise<void> => {
    try {
      await apiService.deleteHourlyRate(id);
      setHourlyRates(prev => prev.filter(rate => rate.id !== id));
    } catch (error) {
      logger.error('Error deleting hourly rate:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, []);

  // --------------------------------------------------------------------------
  // Material Template Methods
  // --------------------------------------------------------------------------

  const addMaterialTemplate = useCallback(async (templateData: Omit<MaterialTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> => {
    try {
      const newTemplate = await apiService.createMaterialTemplate(templateData);
      setMaterialTemplates(prev => [...prev, newTemplate]);
      trackTelemetry('template_created');
    } catch (error) {
      logger.error('Error adding material template:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, []);

  const updateMaterialTemplateData = useCallback(async (id: string, templateData: Partial<MaterialTemplate>): Promise<void> => {
    try {
      const updatedTemplate = await apiService.updateMaterialTemplate(id, templateData);
      setMaterialTemplates(prev => prev.map(template =>
        template.id === id ? updatedTemplate : template
      ));
    } catch (error) {
      logger.error('Error updating material template:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, []);

  const deleteMaterialTemplateData = useCallback(async (id: string): Promise<void> => {
    try {
      await apiService.deleteMaterialTemplate(id);
      setMaterialTemplates(prev => prev.filter(template => template.id !== id));
    } catch (error) {
      logger.error('Error deleting material template:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, []);

  // --------------------------------------------------------------------------
  // Invoice Template Methods
  // --------------------------------------------------------------------------

  const addInvoiceTemplate = useCallback(async (templateData: Omit<InvoiceTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> => {
    const newTemplate: InvoiceTemplate = {
      id: generateUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...templateData,
    };

    const updatedInvoiceTemplates = [...(company.invoiceTemplates || []), newTemplate];

    try {
      await updateCompanyData({ invoiceTemplates: updatedInvoiceTemplates });
      trackTelemetry('template_created');
    } catch (error) {
      logger.error('Error adding invoice template:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, [company.invoiceTemplates, updateCompanyData]);

  const updateInvoiceTemplateData = useCallback(async (id: string, templateData: Partial<InvoiceTemplate>): Promise<void> => {
    const updatedInvoiceTemplates = (company.invoiceTemplates || []).map(template =>
      template.id === id
        ? { ...template, ...templateData, updatedAt: new Date() }
        : template
    );

    try {
      await updateCompanyData({ invoiceTemplates: updatedInvoiceTemplates });
    } catch (error) {
      logger.error('Error updating invoice template:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, [company.invoiceTemplates, updateCompanyData]);

  const deleteInvoiceTemplateData = useCallback(async (id: string): Promise<void> => {
    const updatedInvoiceTemplates = (company.invoiceTemplates || []).filter(template => template.id !== id);

    try {
      await updateCompanyData({ invoiceTemplates: updatedInvoiceTemplates });
    } catch (error) {
      logger.error('Error deleting invoice template:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, [company.invoiceTemplates, updateCompanyData]);

  const getInvoiceTemplates = useCallback((): InvoiceTemplate[] => {
    return company.invoiceTemplates || [];
  }, [company.invoiceTemplates]);

  // --------------------------------------------------------------------------
  // Document Template Methods
  // --------------------------------------------------------------------------

  const documentTemplates = company.documentTemplates || [];

  const addDocumentTemplate = useCallback(async (templateData: Omit<DocumentTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> => {
    const now = new Date();
    const newTemplate: DocumentTemplate = {
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
      ...templateData,
    };
    const currentTemplates = company.documentTemplates || [];
    const updatedTemplates = [
      ...currentTemplates.map(template => templateData.isDefault && template.documentType === templateData.documentType
        ? { ...template, isDefault: false }
        : template),
      newTemplate,
    ];

    await updateCompanyData({ documentTemplates: updatedTemplates });
    trackTelemetry('template_created');
  }, [company.documentTemplates, updateCompanyData]);

  const updateDocumentTemplateData = useCallback(async (id: string, templateData: Partial<DocumentTemplate>): Promise<void> => {
    const currentTemplates = company.documentTemplates || [];
    const existing = currentTemplates.find(template => template.id === id);
    if (!existing) return;
    const documentType = templateData.documentType || existing.documentType;
    const updatedTemplates = currentTemplates.map(template => {
      if (template.id === id) {
        return { ...template, ...templateData, updatedAt: new Date() };
      }
      if (templateData.isDefault && template.documentType === documentType) {
        return { ...template, isDefault: false };
      }
      return template;
    });

    await updateCompanyData({ documentTemplates: updatedTemplates });
  }, [company.documentTemplates, updateCompanyData]);

  const deleteDocumentTemplateData = useCallback(async (id: string): Promise<void> => {
    const currentTemplates = company.documentTemplates || [];
    const deleted = currentTemplates.find(template => template.id === id);
    const remaining = currentTemplates.filter(template => template.id !== id);
    if (deleted?.isDefault) {
      const replacement = remaining.find(template => template.documentType === deleted.documentType);
      if (replacement) {
        replacement.isDefault = true;
      }
    }
    await updateCompanyData({ documentTemplates: remaining });
  }, [company.documentTemplates, updateCompanyData]);

  const value: CompanyContextType = {
    company,
    setCompany,
    updateCompany: updateCompanyData,
    hourlyRates,
    setHourlyRates,
    addHourlyRate,
    updateHourlyRate: updateHourlyRateData,
    deleteHourlyRate: deleteHourlyRateData,
    materialTemplates,
    setMaterialTemplates,
    addMaterialTemplate,
    updateMaterialTemplate: updateMaterialTemplateData,
    deleteMaterialTemplate: deleteMaterialTemplateData,
    addInvoiceTemplate,
    updateInvoiceTemplate: updateInvoiceTemplateData,
    deleteInvoiceTemplate: deleteInvoiceTemplateData,
    getInvoiceTemplates,
    documentTemplates,
    addDocumentTemplate,
    updateDocumentTemplate: updateDocumentTemplateData,
    deleteDocumentTemplate: deleteDocumentTemplateData,
  };

  return (
    <CompanyContext.Provider value={value}>
      {children}
    </CompanyContext.Provider>
  );
}
