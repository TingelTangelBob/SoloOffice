import React, { useEffect, useState } from 'react';
import logger from '../utils/logger';
import { Clock, CheckCircle, Send, Check, Home } from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useCompany } from '../context/CompanyContext';
import { useLoading } from '../context/AppContext';
import { formatCurrency, formatDate } from '../utils/formatters';
import { blobToBase64 } from '../utils/blobUtils';
import { EmailSendModal } from './EmailSendModal';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { processAttachments } from '../utils/fileUtils';
import { apiService } from '../services/api';
import { Invoice } from '../types';
import { PageHeader } from './PageHeader';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { getTerminology } from '../utils/terminology';

interface DashboardProps {
  onNavigate: (page: string, filter?: string, searchTerm?: string) => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const { customers } = useCustomers();
  const { invoices, updateInvoice } = useInvoices();
  const { company } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);
  const { loading } = useLoading();

  // Email modal state
  const [emailModal, setEmailModal] = useState<{
    isOpen: boolean;
    invoice: Invoice | null;
    customer: { email: string; additionalEmails?: { id: string; email: string; label?: string; isActive: boolean }[] } | null;
  }>({
    isOpen: false,
    invoice: null,
    customer: null
  });
  const [isSendingEmail, setIsSendingEmail] = useState<string | null>(null);

  // Get locale from company settings, default to 'de-DE'
  const locale = company?.locale || 'de-DE';

  const handleSendEmail = async (invoice: Invoice) => {
    const customer = customers.find(c => c.id === invoice.customerId);
    if (!customer) {
      alert(`${terminology.entity.dataLabel} nicht gefunden.`);
      return;
    }

    if (!customer.email) {
      alert(terminology.entity.emailMissingMessage);
      return;
    }

    // Open email dialog with customer data
    setEmailModal({
      isOpen: true,
      invoice,
      customer: {
        email: customer.email,
        additionalEmails: customer.additionalEmails
      }
    });
  };

  const handleEmailSend = async (formats: ('zugferd' | 'xrechnung')[], customText?: string, attachments?: { id: string; file: File; name: string; size: number }[], selectedInvoiceAttachmentIds?: string[], selectedEmails?: string[], manualEmails?: string[]) => {
    if (!emailModal.invoice) return;
    
    setIsSendingEmail(emailModal.invoice.id);
    
    try {
      // Combine selected emails and manual emails
      const allEmails = [...(selectedEmails || []), ...(manualEmails?.filter(email => email.trim()) || [])];
      
      if (allEmails.length === 0) {
        alert('Bitte wählen Sie mindestens eine E-Mail-Adresse aus.');
        return;
      }

      // Generate PDFs for each format and send emails
      const customer = customers.find(c => c.id === emailModal.invoice!.customerId);
      if (!customer) {
      alert(`${terminology.entity.dataLabel} nicht gefunden.`);
        return;
      }

      // Process additional attachments
      let processedAttachments: { name: string; content: string; contentType: string }[] = [];
      if (attachments && attachments.length > 0) {
        try {
          processedAttachments = await processAttachments(attachments);
        } catch (error) {
          logger.error('Fehler beim Verarbeiten der Anhänge:', error);
          alert('Fehler beim Verarbeiten der Anhänge');
          return;
        }
      }

      // Add selected invoice attachments to the processed attachments
      if (selectedInvoiceAttachmentIds && selectedInvoiceAttachmentIds.length > 0 && emailModal.invoice.attachments) {
        const selectedInvoiceAttachments = emailModal.invoice.attachments.filter(att => 
          selectedInvoiceAttachmentIds.includes(att.id)
        );
        
        for (const attachment of selectedInvoiceAttachments) {
          processedAttachments.push({
            name: attachment.name,
            content: attachment.content,
            contentType: attachment.contentType
          });
        }
      }

      // Send email for each selected format
      const invoiceFormats = [];
      
      for (const format of formats) {
        const pdfBlob = await generateInvoicePDF(emailModal.invoice, {
          format,
          company,
          customer
        });
        
        // Convert blob to base64 - use safe method for large files
        const base64PDF = await blobToBase64(pdfBlob);
        
        invoiceFormats.push({
          format,
          content: base64PDF
        });
      }
      
      // Send email to all recipients
      const result = await apiService.sendInvoiceEmailMultiFormat(
        allEmails, 
        invoiceFormats,
        emailModal.invoice, 
        customText,
        processedAttachments
      );
      
      if (!result.success) {
        throw new Error(`Fehler beim E-Mail-Versand: ${result.message}`);
      }
      
      const formatLabels = formats.map(f => {
        switch(f) {
          case 'zugferd': return 'PDF';
          case 'xrechnung': return 'XRechnung';
          default: return f;
        }
      });
      
      const attachmentInfo = attachments && attachments.length > 0 
        ? ` mit ${attachments.length} zusätzlichen Anhang${attachments.length > 1 ? 'en' : ''}`
        : '';
      
      alert(`Rechnung erfolgreich per E-Mail versendet! (${formatLabels.join(', ')})${attachmentInfo}`);
      
      // Automatically mark as sent if it was draft
      if (emailModal.invoice.status === 'draft') {
        await updateInvoice(emailModal.invoice.id, { status: 'sent' });
      }
      
      // Close email dialog
      setEmailModal({ isOpen: false, invoice: null, customer: null });
    } catch (error) {
      logger.error('Fehler beim E-Mail-Versand:', error);
      alert('Fehler beim E-Mail-Versand: ' + (error as Error).message);
    } finally {
      setIsSendingEmail(null);
    }
  };

  const handleEmailModalClose = () => {
    setEmailModal({ isOpen: false, invoice: null, customer: null });
  };

  // Check for overdue invoices automatically on every load
  useEffect(() => {
    const checkOverdueInvoices = async () => {
      if (loading || invoices.length === 0) return;
      
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Set to start of day for accurate comparison
      
      const overdueUpdates = invoices
        .filter(invoice => {
          // Only check sent invoices that are not already overdue or paid
          if (invoice.status !== 'sent') return false;
          
          const dueDate = new Date(invoice.dueDate);
          dueDate.setHours(0, 0, 0, 0);
          
          return dueDate < today;
        })
        .map(invoice => invoice.id);
      
      // Update overdue invoices
      for (const invoiceId of overdueUpdates) {
        try {
          await updateInvoice(invoiceId, { status: 'overdue' });
        } catch (error) {
          logger.error('Error updating invoice to overdue:', error);
        }
      }
      
      if (overdueUpdates.length > 0) {
        logger.info(`${overdueUpdates.length} invoices automatically marked as overdue`, { count: overdueUpdates.length });
      }
    };

    // Run overdue check whenever data is loaded
    if (!loading && invoices.length > 0) {
      checkOverdueInvoices();
    }
  }, [loading, invoices, updateInvoice]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-custom mx-auto"></div>
          <p className="mt-4 text-gray-600">Lade Daten...</p>
        </div>
      </div>
    );
  }

  // Umsatz pro Monat berechnen
  const monthlyRevenue: { [month: string]: number } = {};
  invoices.forEach(invoice => {
    const date = new Date(invoice.issueDate);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    monthlyRevenue[monthKey] = (monthlyRevenue[monthKey] || 0) + invoice.total;
  });
  const monthlyRevenueSorted = Object.entries(monthlyRevenue)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const maxMonthlyRevenue = monthlyRevenueSorted.reduce(
    (maxRevenue, [, revenue]) => Math.max(maxRevenue, revenue),
    0,
  );
  const formatMonthLabel = (monthKey: string) => {
    const [year, month] = monthKey.split('-').map(Number);
    return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).format(new Date(year, month - 1, 1));
  };

  const stats = {
    totalInvoices: invoices.length,
    totalCustomers: customers.length,
    totalRevenue: invoices.reduce((sum, invoice) => sum + invoice.total, 0),
    paidInvoices: invoices.filter(invoice => invoice.status === 'paid').length,
    draftInvoices: invoices.filter(invoice => invoice.status === 'draft').length,
    overdueInvoices: invoices.filter(invoice => invoice.status === 'overdue').length,
  };

  const recentInvoices = invoices
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid': return 'Bezahlt';
      case 'sent': return 'Versendet';
      case 'draft': return 'Entwurf';
      case 'overdue': return 'Überfällig';
      default: return status;
    }
  };

  const getStatusDotColor = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-green-500';
      case 'sent': return 'bg-blue-500';
      case 'draft': return 'bg-gray-400';
      case 'overdue': return 'bg-red-500';
      default: return 'bg-gray-400';
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <PageHeader icon={Home} title="Dashboard" subtitle={`Übersicht über Ihre Rechnungen und ${terminology.entity.plural}`} />

      {/* Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div 
          className="bg-gradient-to-r from-orange-50 to-orange-100 rounded-xl shadow-sm p-4 sm:p-3 border border-orange-200 cursor-pointer hover:shadow-lg transition-all duration-300 hover:scale-105 group"
          onClick={() => onNavigate('invoices', 'draft')}
        >
          <div className="flex items-center mb-3 sm:mb-2">
            <div className="p-2 bg-orange-500 rounded-lg group-hover:bg-orange-600 transition-colors">
              <Clock className="h-5 w-5 text-white" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 ml-4">Entwürfe</h3>
          </div>
          <p className="text-2xl sm:text-xl font-bold text-orange-600 mb-1">{stats.draftInvoices}</p>
          <p className="text-xs sm:text-[11px] text-orange-700/70 truncate">Noch nicht versendet</p>
        </div>

        <div 
          className="bg-gradient-to-r from-green-50 to-green-100 rounded-xl shadow-sm p-4 sm:p-3 border border-green-200 cursor-pointer hover:shadow-lg transition-all duration-300 hover:scale-105 group"
          onClick={() => onNavigate('invoices', 'paid')}
        >
          <div className="flex items-center mb-3 sm:mb-2">
            <div className="p-2 bg-green-500 rounded-lg group-hover:bg-green-600 transition-colors">
              <CheckCircle className="h-5 w-5 text-white" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 ml-4">Bezahlt</h3>
          </div>
          <p className="text-2xl sm:text-xl font-bold text-green-600 mb-1">{stats.paidInvoices}</p>
          <p className="text-xs sm:text-[11px] text-green-700/70 truncate">Erfolgreich abgeschlossen</p>
        </div>

        <div 
          className="bg-gradient-to-r from-red-50 to-red-100 rounded-xl shadow-sm p-4 sm:p-3 border border-red-200 cursor-pointer hover:shadow-lg transition-all duration-300 hover:scale-105 group"
          onClick={() => onNavigate('invoices', 'overdue')}
        >
          <div className="flex items-center mb-3 sm:mb-2">
            <div className="p-2 bg-red-500 rounded-lg group-hover:bg-red-600 transition-colors">
              <Clock className="h-5 w-5 text-white" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 ml-4">Überfällig</h3>
          </div>
          <p className="text-2xl sm:text-xl font-bold text-red-600 mb-1">{stats.overdueInvoices}</p>
          <p className="text-sm text-red-700/70">Benötigt Aufmerksamkeit</p>
        </div>
      </div>

      {/* Recent Invoices */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-4 lg:px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
          <h3 className="text-base lg:text-lg font-semibold text-gray-900">Aktuelle Rechnungen</h3>
          <button
            onClick={() => onNavigate('invoices')}
            className="text-sm text-primary-custom hover:text-primary-custom/80 font-medium transition-colors self-start sm:self-auto"
          >
            Alle anzeigen →
          </button>
        </div>
        
        {/* Desktop Table View */}
        <div className="hidden lg:block w-full max-w-full overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Datum
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Rechnungsnummer
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{terminology.entity.singular}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Betrag</th>
                <th className="sticky right-0 z-20 w-14 bg-gray-50 px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider 2xl:w-44 2xl:px-3">
                  <span className="sr-only">Aktionen</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {recentInvoices.map((invoice) => (
                <tr 
                  key={invoice.id} 
                  className="hover:bg-gray-50 cursor-pointer transition-colors duration-200"
                  onClick={() => onNavigate('invoices', undefined, invoice.invoiceNumber)}
                  title={`Zur Rechnung ${invoice.invoiceNumber}`}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(invoice.issueDate, locale, company?.dateFormat)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-primary-custom hover:text-primary-custom/80">
                    <span className="inline-flex items-center gap-2">
                      {invoice.invoiceNumber}
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${getStatusDotColor(invoice.status)}`}
                        title={getStatusLabel(invoice.status)}
                        aria-label={getStatusLabel(invoice.status)}
                      />
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                    {invoice.customerName}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right text-sm text-gray-900">
                    {formatCurrency(invoice.total, locale, company?.numberFormat, company?.currency)}
                  </td>
                  <td className="sticky right-0 z-10 w-14 bg-white px-2 py-2 whitespace-nowrap 2xl:w-44 2xl:px-3">
                    <div
                      className="flex items-center gap-1"
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                      <ActionMenu containerClassName="2xl:hidden" triggerClassName="action-icon-button action-icon-indigo">
                          {invoice.status === 'draft' && (
                            <ActionMenuItem icon={<Send className="h-4 w-4" />} tone="blue" onClick={() => handleSendEmail(invoice)}>
                              Versenden
                            </ActionMenuItem>
                          )}
                          {(invoice.status === 'sent' || invoice.status === 'overdue') && (
                            <ActionMenuItem icon={<Check className="h-4 w-4" />} tone="green" onClick={() => updateInvoice(invoice.id, { status: 'paid' })}>
                              Als bezahlt markieren
                            </ActionMenuItem>
                          )}
                      </ActionMenu>
                      <div className="hidden 2xl:flex space-x-1">
                      {invoice.status === 'draft' && (
                        <button
                          type="button"
                          className="action-icon-button action-icon-blue"
                          title="Per E-Mail versenden"
                          onClick={() => handleSendEmail(invoice)}
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      )}
                      {(invoice.status === 'sent' || invoice.status === 'overdue') && (
                        <button
                          type="button"
                          className="action-icon-button action-icon-green"
                          title="Als bezahlt markieren"
                          onClick={() => updateInvoice(invoice.id, { status: 'paid' })}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="lg:hidden">
          {recentInvoices.map((invoice) => (
            <div 
              key={invoice.id} 
              className="p-3 sm:p-4 border-b border-gray-200 last:border-b-0 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => onNavigate('invoices', undefined, invoice.invoiceNumber)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <h4 className="truncate text-sm font-medium text-primary-custom">{invoice.invoiceNumber}</h4>
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${getStatusDotColor(invoice.status)}`}
                      title={getStatusLabel(invoice.status)}
                      aria-label={getStatusLabel(invoice.status)}
                    />
                  </div>
                  <p className="truncate text-sm text-gray-900">{invoice.customerName}</p>
                  <p className="mt-1 text-xs text-gray-500">{formatDate(invoice.issueDate, locale, company?.dateFormat)}</p>
                </div>
                <div
                  className="grid min-w-[9.5rem] grid-cols-[minmax(0,1fr)_2rem] items-center gap-2"
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                  <span className="min-w-0 text-right text-sm font-medium text-gray-900">
                    {formatCurrency(invoice.total, locale, company?.numberFormat, company?.currency)}
                  </span>
                  <ActionMenu containerClassName="relative justify-self-end" triggerClassName="action-icon-button action-icon-indigo h-7 w-7">
                        {invoice.status === 'draft' && (
                          <ActionMenuItem icon={<Send className="h-4 w-4" />} tone="blue" onClick={() => handleSendEmail(invoice)}>
                            Versenden
                          </ActionMenuItem>
                        )}
                        {(invoice.status === 'sent' || invoice.status === 'overdue') && (
                          <ActionMenuItem icon={<Check className="h-4 w-4" />} tone="green" onClick={() => updateInvoice(invoice.id, { status: 'paid' })}>
                            Als bezahlt markieren
                          </ActionMenuItem>
                        )}
                    </ActionMenu>
                </div>
              </div>
            </div>
          ))}
        </div>

        {recentInvoices.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500">Noch keine Rechnungen vorhanden</p>
          </div>
        )}
      </div>

      {/* Umsatz pro Monat */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-4 lg:px-6 py-4 border-b border-gray-200">
          <h3 className="text-base lg:text-lg font-semibold text-gray-900">Gesamtumsatz pro Monat</h3>
        </div>
        {monthlyRevenueSorted.length > 0 ? (
          <div className="space-y-3 p-4 lg:p-6">
            {monthlyRevenueSorted.map(([month, revenue]) => {
              const percentage = maxMonthlyRevenue > 0 ? (revenue / maxMonthlyRevenue) * 100 : 0;

              return (
                <div key={month} className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-3">
                  <span className="text-xs text-gray-600 sm:text-sm">{formatMonthLabel(month)}</span>
                  <div
                    className="h-6 min-w-0 overflow-hidden rounded-full bg-gray-100"
                    role="progressbar"
                    aria-label={`${formatMonthLabel(month)}: ${formatCurrency(revenue, locale, company?.numberFormat, company?.currency)}`}
                    aria-valuemin={0}
                    aria-valuemax={maxMonthlyRevenue}
                    aria-valuenow={revenue}
                  >
                    <div
                      className="h-full rounded-full bg-primary-custom transition-all duration-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="whitespace-nowrap text-right text-xs font-medium text-gray-900 sm:text-sm">
                    {formatCurrency(revenue, locale, company?.numberFormat, company?.currency)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-8 text-center text-gray-500">
            Keine Umsätze vorhanden
          </div>
        )}
      </div>

      {/* Email Send Modal */}
      <EmailSendModal
        isOpen={emailModal.isOpen}
        onClose={handleEmailModalClose}
        onSend={handleEmailSend}
        document={emailModal.invoice!}
        documentType="invoice"
        customer={emailModal.customer!}
        isLoading={isSendingEmail === emailModal.invoice?.id}
      />
    </div>
  );
}
