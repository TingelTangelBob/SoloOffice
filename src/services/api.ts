import { Customer, Invoice, Quote, Company, JobEntry, MaterialTemplate, HourlyRate, YearlyInvoiceStartNumber, InvoiceJournalResponse, ReportingStatistics, ReminderEligibility } from '../types';
import logger from '../utils/logger';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// ============================================================================
// Helper Types
// ============================================================================

interface ApiRequestOptions extends RequestInit {
  skipErrorLogging?: boolean;
}

interface EmailAttachment {
  name: string;
  content: string;
  contentType: string;
}

interface BackupInfo {
  filename: string;
  timestamp: string;
  size: number;
  tableCount: number;
  totalRecords: number;
  created: string;
}

// ============================================================================
// API Service Class
// ============================================================================

class ApiService {
  private readonly baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  // --------------------------------------------------------------------------
  // Core Request Method
  // --------------------------------------------------------------------------

  private async request<T>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const method = options.method || 'GET';
    const { skipErrorLogging, ...fetchOptions } = options;
    
    const config: RequestInit = {
      ...fetchOptions,
      headers: {
        'Content-Type': 'application/json',
        ...fetchOptions.headers,
      },
    };

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Network error' }));
        throw new Error(errorData.error || errorData.message || `HTTP error! status: ${response.status}`);
      }

      return response.json();
    } catch (error) {
      if (!skipErrorLogging) {
        logger.api(method, url, undefined, undefined, error as Error);
      }
      throw error;
    }
  }

  // Helper for file downloads
  private async downloadFile(url: string, filename: string): Promise<void> {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Fehler beim Download: ${filename}`);
    }
    
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  }

  // --------------------------------------------------------------------------
  // Customer API
  // --------------------------------------------------------------------------

  async getCustomers(): Promise<Customer[]> {
    return this.request<Customer[]>('/customers');
  }

  async getCustomer(id: string): Promise<Customer> {
    return this.request<Customer>(`/customers/${id}`);
  }

  async createCustomer(customer: Omit<Customer, 'id' | 'customerNumber' | 'createdAt'>): Promise<Customer> {
    return this.request<Customer>('/customers', {
      method: 'POST',
      body: JSON.stringify(customer),
    });
  }

  async updateCustomer(id: string, customer: Partial<Customer>): Promise<Customer> {
    return this.request<Customer>(`/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(customer),
    });
  }

  async deleteCustomer(id: string): Promise<void> {
    await this.request(`/customers/${id}`, { method: 'DELETE' });
  }

  // Customer Email Methods
  async addCustomerEmail(customerId: string, email: string, label?: string): Promise<{ id: string; email: string; label?: string; isActive: boolean }> {
    return this.request(`/customers/${customerId}/emails`, {
      method: 'POST',
      body: JSON.stringify({ email, label }),
    });
  }

  async updateCustomerEmail(customerId: string, emailId: string, email: string, label?: string): Promise<{ id: string; email: string; label?: string; isActive: boolean }> {
    return this.request(`/customers/${customerId}/emails/${emailId}`, {
      method: 'PUT',
      body: JSON.stringify({ email, label }),
    });
  }

  async deleteCustomerEmail(customerId: string, emailId: string): Promise<void> {
    await this.request(`/customers/${customerId}/emails/${emailId}`, { method: 'DELETE' });
  }

  // Customer Hourly Rates
  async getCustomerHourlyRates(customerId: string): Promise<HourlyRate[]> {
    return this.request<HourlyRate[]>(`/customers/${customerId}/hourly-rates`);
  }

  async createCustomerHourlyRate(customerId: string, rateData: Omit<HourlyRate, 'id' | 'createdAt' | 'updatedAt'>): Promise<HourlyRate> {
    return this.request<HourlyRate>(`/customers/${customerId}/hourly-rates`, {
      method: 'POST',
      body: JSON.stringify(rateData),
    });
  }

  async updateCustomerHourlyRate(customerId: string, rateId: string, rateData: Partial<HourlyRate>): Promise<HourlyRate> {
    return this.request<HourlyRate>(`/customers/${customerId}/hourly-rates/${rateId}`, {
      method: 'PUT',
      body: JSON.stringify(rateData),
    });
  }

  async deleteCustomerHourlyRate(customerId: string, rateId: string): Promise<void> {
    await this.request(`/customers/${customerId}/hourly-rates/${rateId}`, { method: 'DELETE' });
  }

  // Customer Materials
  async getCustomerMaterials(customerId: string): Promise<MaterialTemplate[]> {
    return this.request<MaterialTemplate[]>(`/customers/${customerId}/materials`);
  }

  async createCustomerMaterial(customerId: string, materialData: Omit<MaterialTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<MaterialTemplate> {
    return this.request<MaterialTemplate>(`/customers/${customerId}/materials`, {
      method: 'POST',
      body: JSON.stringify(materialData),
    });
  }

  async updateCustomerMaterial(customerId: string, materialId: string, materialData: Partial<MaterialTemplate>): Promise<MaterialTemplate> {
    return this.request<MaterialTemplate>(`/customers/${customerId}/materials/${materialId}`, {
      method: 'PUT',
      body: JSON.stringify(materialData),
    });
  }

  async deleteCustomerMaterial(customerId: string, materialId: string): Promise<void> {
    await this.request(`/customers/${customerId}/materials/${materialId}`, { method: 'DELETE' });
  }

  // --------------------------------------------------------------------------
  // Invoice API
  // --------------------------------------------------------------------------

  async getInvoices(): Promise<Invoice[]> {
    return this.request<Invoice[]>('/invoices');
  }

  async getInvoice(id: string): Promise<Invoice> {
    return this.request<Invoice>(`/invoices/${id}`);
  }

  async createInvoice(invoice: Omit<Invoice, 'id' | 'createdAt'>): Promise<Invoice> {
    return this.request<Invoice>('/invoices', {
      method: 'POST',
      body: JSON.stringify(invoice),
    });
  }

  async updateInvoice(id: string, invoice: Partial<Invoice>): Promise<Invoice> {
    return this.request<Invoice>(`/invoices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(invoice),
    });
  }

  async deleteInvoice(id: string): Promise<void> {
    await this.request(`/invoices/${id}`, { method: 'DELETE' });
  }

  // --------------------------------------------------------------------------
  // Quote API
  // --------------------------------------------------------------------------

  async getQuotes(): Promise<Quote[]> {
    return this.request<Quote[]>('/quotes');
  }

  async getQuote(id: string): Promise<Quote> {
    return this.request<Quote>(`/quotes/${id}`);
  }

  async createQuote(quote: Omit<Quote, 'id' | 'createdAt'>): Promise<Quote> {
    return this.request<Quote>('/quotes', {
      method: 'POST',
      body: JSON.stringify(quote),
    });
  }

  async updateQuote(id: string, quote: Partial<Quote>): Promise<Quote> {
    return this.request<Quote>(`/quotes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(quote),
    });
  }

  async deleteQuote(id: string): Promise<void> {
    await this.request(`/quotes/${id}`, { method: 'DELETE' });
  }

  async convertQuoteToInvoice(id: string): Promise<Invoice> {
    return this.request<Invoice>(`/quotes/${id}/convert-to-invoice`, { method: 'POST' });
  }

  async sendQuoteEmail(
    quoteId: string,
    customerEmails: string[],
    customText?: string,
    attachments?: EmailAttachment[],
    pdfBuffer?: string
  ): Promise<{ success: boolean; message: string; messageId?: string }> {
    return this.request(`/quotes/${quoteId}/send-email`, {
      method: 'POST',
      body: JSON.stringify({
        customerEmails,
        customText,
        attachments: attachments || [],
        pdfBuffer,
      }),
    });
  }

  // --------------------------------------------------------------------------
  // Company API
  // --------------------------------------------------------------------------

  async getCompany(): Promise<Company> {
    return this.request<Company>('/company');
  }

  async updateCompany(company: Partial<Company>): Promise<Company> {
    return this.request<Company>('/company', {
      method: 'PUT',
      body: JSON.stringify(company),
    });
  }

  // --------------------------------------------------------------------------
  // Material Templates API
  // --------------------------------------------------------------------------

  async getMaterialTemplates(): Promise<MaterialTemplate[]> {
    return this.request<MaterialTemplate[]>('/material-templates');
  }

  async createMaterialTemplate(template: Omit<MaterialTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<MaterialTemplate> {
    return this.request<MaterialTemplate>('/material-templates', {
      method: 'POST',
      body: JSON.stringify(template),
    });
  }

  async updateMaterialTemplate(id: string, template: Partial<MaterialTemplate>): Promise<MaterialTemplate> {
    return this.request<MaterialTemplate>(`/material-templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(template),
    });
  }

  async deleteMaterialTemplate(id: string): Promise<void> {
    await this.request(`/material-templates/${id}`, { method: 'DELETE' });
  }

  // --------------------------------------------------------------------------
  // Hourly Rates API
  // --------------------------------------------------------------------------

  async getHourlyRates(): Promise<HourlyRate[]> {
    return this.request<HourlyRate[]>('/hourly-rates');
  }

  async createHourlyRate(rate: Omit<HourlyRate, 'id' | 'createdAt' | 'updatedAt'>): Promise<HourlyRate> {
    return this.request<HourlyRate>('/hourly-rates', {
      method: 'POST',
      body: JSON.stringify(rate),
    });
  }

  async updateHourlyRate(id: string, rate: Partial<HourlyRate>): Promise<HourlyRate> {
    return this.request<HourlyRate>(`/hourly-rates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(rate),
    });
  }

  async deleteHourlyRate(id: string): Promise<void> {
    await this.request(`/hourly-rates/${id}`, { method: 'DELETE' });
  }

  // --------------------------------------------------------------------------
  // Job Entry API
  // --------------------------------------------------------------------------

  async getJobEntries(): Promise<JobEntry[]> {
    return this.request<JobEntry[]>('/jobs');
  }

  async getJobEntry(id: string): Promise<JobEntry> {
    return this.request<JobEntry>(`/jobs/${id}`);
  }

  async createJobEntry(job: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<JobEntry> {
    return this.request<JobEntry>('/jobs', {
      method: 'POST',
      body: JSON.stringify(job),
    });
  }

  async updateJobEntry(id: string, job: Partial<JobEntry>): Promise<JobEntry> {
    return this.request<JobEntry>(`/jobs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(job),
    });
  }

  async deleteJobEntry(id: string): Promise<void> {
    await this.request(`/jobs/${id}`, { method: 'DELETE' });
  }

  async deleteJobEntries(ids: string[]): Promise<void> {
    await this.request('/jobs', {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    });
  }

  async addJobSignature(id: string, signatureData: string, customerName: string): Promise<{ message: string; job: JobEntry }> {
    return this.request<{ message: string; job: JobEntry }>(`/jobs/${id}/signature`, {
      method: 'POST',
      body: JSON.stringify({ signatureData, customerName }),
    });
  }

  // --------------------------------------------------------------------------
  // Email API
  // --------------------------------------------------------------------------

  async testEmailConnection(): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>('/email/test');
  }

  async sendInvoiceEmail(
    customerEmail: string,
    invoicePDF: string,
    invoiceData: Invoice,
    format: 'zugferd' | 'xrechnung' = 'zugferd',
    customText?: string,
    attachments?: EmailAttachment[]
  ): Promise<{ success: boolean; message: string; messageId?: string }> {
    return this.request('/email/send-invoice', {
      method: 'POST',
      body: JSON.stringify({
        customerEmail,
        invoicePDF,
        invoiceData,
        format,
        customText,
        attachments,
      }),
    });
  }

  async sendInvoiceEmailMultiFormat(
    customerEmails: string[],
    invoiceFormats: { format: 'zugferd' | 'xrechnung'; content: string }[],
    invoiceData: Invoice,
    customText?: string,
    attachments?: EmailAttachment[]
  ): Promise<{ success: boolean; message: string; messageId?: string }> {
    return this.request('/email/send-invoice-multi', {
      method: 'POST',
      body: JSON.stringify({
        customerEmails,
        invoiceFormats,
        invoiceData,
        customText,
        attachments,
      }),
    });
  }

  async sendReminderEmail(
    invoiceId: string,
    stage: number,
    customerEmails: string[],
    reminderPDF: string,
    invoiceData: Invoice,
    fee: number,
    customText?: string,
    additionalAttachments?: EmailAttachment[]
  ): Promise<{ success: boolean; message: string; messageId?: string }> {
    return this.request('/email/send-reminder', {
      method: 'POST',
      body: JSON.stringify({
        invoiceId,
        stage,
        customerEmails,
        reminderPDF,
        invoiceData,
        fee,
        customText,
        additionalAttachments,
      }),
    });
  }

  // --------------------------------------------------------------------------
  // Email Management API
  // --------------------------------------------------------------------------

  async getEmailHistory<T = unknown>(params: { page?: number; limit?: number; filter?: string; search?: string } = {}): Promise<{
    success: boolean;
    emails: T[];
    pagination: {
      currentPage: number;
      totalPages: number;
      totalRecords: number;
      hasMore: boolean;
    };
    message?: string;
  }> {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page.toString());
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.filter) queryParams.append('filter', params.filter);
    if (params.search) queryParams.append('search', params.search);

    return this.request(`/email-management/history?${queryParams}`);
  }

  async getEmailDetails<T = unknown>(id: string): Promise<{ success: boolean; email: T; message?: string }> {
    return this.request(`/email-management/history/${id}`);
  }

  async getEmailStatistics<T = unknown>(): Promise<{ success: boolean; statistics: T; message?: string }> {
    return this.request('/email-management/statistics');
  }

  async getSmtpSettings<T = unknown>(): Promise<{ success: boolean; settings: T; message?: string }> {
    return this.request('/email-management/smtp-settings');
  }

  async saveSmtpSettings(settings: Record<string, unknown>): Promise<{ success: boolean; message?: string }> {
    return this.request('/email-management/smtp-settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
  }

  async testSmtpConnection(
    useDatabaseSettings = true,
    settings: Record<string, unknown> | null = null
  ): Promise<{ success: boolean; message: string }> {
    return this.request('/email-management/test-smtp', {
      method: 'POST',
      body: JSON.stringify({
        use_database_settings: useDatabaseSettings,
        settings,
      }),
    });
  }

  async sendTestEmail(recipient: string, subject?: string, message?: string): Promise<{ success: boolean; message: string }> {
    return this.request('/email-management/send-test-email', {
      method: 'POST',
      body: JSON.stringify({
        recipient_email: recipient,
        custom_subject: subject,
        custom_message: message,
      }),
    });
  }

  // --------------------------------------------------------------------------
  // Yearly Invoice Start Numbers API
  // --------------------------------------------------------------------------

  async getYearlyInvoiceStartNumbers(): Promise<YearlyInvoiceStartNumber[]> {
    return this.request<YearlyInvoiceStartNumber[]>('/yearly-invoice-start-numbers');
  }

  async createOrUpdateYearlyInvoiceStartNumber(year: number, startNumber: number): Promise<YearlyInvoiceStartNumber> {
    return this.request<YearlyInvoiceStartNumber>('/yearly-invoice-start-numbers', {
      method: 'POST',
      body: JSON.stringify({ year, startNumber }),
    });
  }

  async deleteYearlyInvoiceStartNumber(year: number): Promise<void> {
    await this.request(`/yearly-invoice-start-numbers/${year}`, { method: 'DELETE' });
  }

  // --------------------------------------------------------------------------
  // Backup API
  // --------------------------------------------------------------------------

  async createBackup(): Promise<{
    success: boolean;
    message: string;
    filename: string;
    timestamp: string;
    tableCount: number;
    totalRecords: number;
  }> {
    return this.request('/backup/create', { method: 'POST' });
  }

  async listBackups(): Promise<{ success: boolean; backups: BackupInfo[] }> {
    return this.request('/backup/list');
  }

  async downloadBackup(filename: string): Promise<void> {
    await this.downloadFile(`${this.baseUrl}/backup/download/${filename}`, filename);
  }

  async restoreBackup(backupData: unknown): Promise<{
    success: boolean;
    message: string;
    restoredTables: number;
    restoredRecords: number;
    timestamp: string;
  }> {
    return this.request('/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ backupData }),
    });
  }

  async deleteBackup(filename: string): Promise<{ success: boolean; message: string }> {
    return this.request(`/backup/delete/${filename}`, { method: 'DELETE' });
  }

  // ZIP Backup Methods
  async createZipBackup(): Promise<{
    success: boolean;
    message: string;
    filename: string;
    timestamp: string;
    size: number;
    tableCount: number;
    totalRecords: number;
  }> {
    return this.request('/backup/create-zip', { method: 'POST' });
  }

  async downloadZipBackup(filename: string): Promise<void> {
    await this.downloadFile(`${this.baseUrl}/backup/download-zip/${filename}`, filename);
  }

  async restoreZipBackup(file: File): Promise<{
    success: boolean;
    message: string;
    restoredTables: number;
    restoredRecords: number;
    timestamp: string;
  }> {
    const formData = new FormData();
    formData.append('backupFile', file);

    const response = await fetch(`${this.baseUrl}/backup/restore-zip`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Network error' }));
      throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async listAllBackups(): Promise<{
    success: boolean;
    backups: (BackupInfo & { type: 'json' })[];
    zipBackups: (BackupInfo & { type: 'zip' })[];
  }> {
    return this.request('/backup/list-all');
  }

  // --------------------------------------------------------------------------
  // Reporting API
  // --------------------------------------------------------------------------

  async getInvoiceJournal(params: { startDate?: string; endDate?: string; customerId?: string } = {}): Promise<InvoiceJournalResponse> {
    const queryParams = new URLSearchParams();
    if (params.startDate) queryParams.append('startDate', params.startDate);
    if (params.endDate) queryParams.append('endDate', params.endDate);
    if (params.customerId) queryParams.append('customerId', params.customerId);

    return this.request<InvoiceJournalResponse>(`/reporting/invoice-journal?${queryParams}`);
  }

  async generateInvoiceJournalPDF(params: {
    startDate?: string;
    endDate?: string;
    customerId?: string;
    title?: string;
  } = {}): Promise<void> {
    const response = await fetch(`${this.baseUrl}/reporting/invoice-journal/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error('Fehler beim Generieren des Rechnungsjournal-PDFs');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;

    // Generate filename with date range if provided
    let filename = 'rechnungsjournal';
    if (params.startDate && params.endDate) {
      filename += `_${params.startDate}_bis_${params.endDate}`;
    } else if (params.startDate) {
      filename += `_ab_${params.startDate}`;
    } else if (params.endDate) {
      filename += `_bis_${params.endDate}`;
    }
    filename += `_${new Date().toISOString().split('T')[0]}.pdf`;

    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  }

  async getReportingStatistics(year?: number): Promise<ReportingStatistics> {
    const queryParams = new URLSearchParams();
    if (year) queryParams.append('year', year.toString());

    return this.request<ReportingStatistics>(`/reporting/statistics?${queryParams}`);
  }

  // --------------------------------------------------------------------------
  // Reminder API
  // --------------------------------------------------------------------------

  async getEligibleReminders(): Promise<ReminderEligibility[]> {
    return this.request<ReminderEligibility[]>('/reminders/eligible');
  }

  async sendReminder(invoiceId: string, stage: number, updateStatus = true): Promise<{ success: boolean; message: string; invoiceId: string }> {
    return this.request(`/reminders/send/${invoiceId}`, {
      method: 'POST',
      body: JSON.stringify({ stage, updateStatus }),
    });
  }

  async getReminderHistory(): Promise<Invoice[]> {
    return this.request<Invoice[]>('/reminders/history');
  }
}

export const apiService = new ApiService();
