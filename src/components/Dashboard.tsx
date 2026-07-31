import React, { useEffect, useState } from 'react';
import logger from '../utils/logger';
import { Clock, CheckCircle, Send, Check, Home, MoreVertical } from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useCompany } from '../context/CompanyContext';
import { useLoading } from '../context/AppContext';
import { formatCurrency } from '../utils/formatters';
import { blobToBase64 } from '../utils/blobUtils';
import { EmailSendModal } from './EmailSendModal';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { apiService } from '../services/api';
import { Invoice } from '../types';
import { PageHeader } from './PageHeader';

interface DashboardProps {
  onNavigate: (page: string, filter?: string, searchTerm?: string) => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const { customers } = useCustomers();
  const { invoices, updateInvoice } = useInvoices();
  const { company } = useCompany();
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

  const handleSendEmail = async (invoice) => {
    const customer = customers.find(c => c.id === invoice.customerId);
    if (!customer) {
      alert('Kundendaten nicht gefunden.');
      return;
    }

    if (!customer.email) {
      alert('Kunde hat keine E-Mail-Adresse hinterlegt.');
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
        alert('Kundendaten nicht gefunden.');
        return;
      }

      // Process additional attachments
      let processedAttachments: { name: string; content: string; contentType: string }[] = [];
      if (attachments && attachments.length > 0) {
        try {
          const { processAttachments } = await import('../utils/fileUtils');
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
    .sort((a, b) => b[0].localeCompare(a[0]));

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-green-100 text-green-800';
      case 'sent': return 'bg-primary-custom/10 text-primary-custom';
      case 'draft': return 'bg-gray-100 text-gray-800';
      case 'overdue': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid': return 'Bezahlt';
      case 'sent': return 'Versendet';
      case 'draft': return 'Entwurf';
      case 'overdue': return 'Überfällig';
      default: return status;
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <PageHeader icon={Home} title="Dashboard" subtitle="Übersicht über Ihre Rechnungen und Kunden" />

      {/* Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div 
          className="bg-gradient-to-r from-orange-50 to-orange-100 rounded-xl shadow-sm p-6 border border-orange-200 cursor-pointer hover:shadow-lg transition-all duration-300 hover:scale-105 group"
          onClick={() => onNavigate('invoices', 'draft')}
        >
          <div className="flex items-center mb-4">
            <div className="p-3 bg-orange-500 rounded-lg group-hover:bg-orange-600 transition-colors">
              <Clock className="h-6 w-6 text-white" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 ml-4">Entwürfe</h3>
          </div>
          <p className="text-3xl font-bold text-orange-600 mb-1">{stats.draftInvoices}</p>
          <p className="text-sm text-orange-700/70">Noch nicht versendet</p>
        </div>

        <div 
          className="bg-gradient-to-r from-green-50 to-green-100 rounded-xl shadow-sm p-6 border border-green-200 cursor-pointer hover:shadow-lg transition-all duration-300 hover:scale-105 group"
          onClick={() => onNavigate('invoices', 'paid')}
        >
          <div className="flex items-center mb-4">
            <div className="p-3 bg-green-500 rounded-lg group-hover:bg-green-600 transition-colors">
              <CheckCircle className="h-6 w-6 text-white" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 ml-4">Bezahlt</h3>
          </div>
          <p className="text-3xl font-bold text-green-600 mb-1">{stats.paidInvoices}</p>
          <p className="text-sm text-green-700/70">Erfolgreich abgeschlossen</p>
        </div>

        <div 
          className="bg-gradient-to-r from-red-50 to-red-100 rounded-xl shadow-sm p-6 border border-red-200 cursor-pointer hover:shadow-lg transition-all duration-300 hover:scale-105 group"
          onClick={() => onNavigate('invoices', 'overdue')}
        >
          <div className="flex items-center mb-4">
            <div className="p-3 bg-red-500 rounded-lg group-hover:bg-red-600 transition-colors">
              <Clock className="h-6 w-6 text-white" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 ml-4">Überfällig</h3>
          </div>
          <p className="text-3xl font-bold text-red-600 mb-1">{stats.overdueInvoices}</p>
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
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Rechnungsnummer
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Kunde
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Betrag
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Datum
                </th>
                <th className="w-14 px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider 2xl:w-44 2xl:px-3">
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
                  <td className="px-3 py-3 whitespace-nowrap text-sm font-medium text-primary-custom hover:text-primary-custom/80">
                    {invoice.invoiceNumber}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-900">
                    {invoice.customerName}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(invoice.total, locale)}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(invoice.status)}`}>
                      {getStatusLabel(invoice.status)}
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-900">
                    {new Date(invoice.issueDate).toLocaleDateString('de-DE')}
                  </td>
                  <td className="w-14 px-2 py-3 whitespace-nowrap 2xl:w-44 2xl:px-3">
                    <div
                      className="flex items-center gap-1"
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                      <details className="relative 2xl:hidden">
                        <summary className="action-icon-button action-icon-indigo list-none cursor-pointer" aria-label="Aktionen" title="Aktionen">
                          <MoreVertical className="h-4 w-4" />
                        </summary>
                        <div className="absolute right-0 top-9 z-20 min-w-44 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
                          {invoice.status === 'draft' && (
                            <button type="button" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={() => handleSendEmail(invoice)}>
                              Versenden
                            </button>
                          )}
                          {(invoice.status === 'sent' || invoice.status === 'overdue') && (
                            <button type="button" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={() => updateInvoice(invoice.id, { status: 'paid' })}>
                              Als bezahlt markieren
                            </button>
                          )}
                        </div>
                      </details>
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
                <div className="min-w-0">
                  <h4 className="text-sm font-medium text-primary-custom">{invoice.invoiceNumber}</h4>
                  <p className="text-sm text-gray-900 truncate">{invoice.customerName}</p>
                  <p className="text-sm font-medium text-gray-900">{formatCurrency(invoice.total, locale)}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(invoice.status)}`}>
                    {getStatusLabel(invoice.status)}
                  </span>
                  <p className="text-xs text-gray-500">
                    {new Date(invoice.issueDate).toLocaleDateString('de-DE')}
                  </p>
                  <div
                    className="mt-1"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  >
                    <details className="relative">
                      <summary className="action-icon-button action-icon-indigo list-none cursor-pointer" aria-label="Aktionen" title="Aktionen">
                        <MoreVertical className="h-4 w-4" />
                      </summary>
                      <div className="absolute right-0 top-9 z-20 min-w-44 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
                        {invoice.status === 'draft' && (
                          <button type="button" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={() => handleSendEmail(invoice)}>
                            Versenden
                          </button>
                        )}
                        {(invoice.status === 'sent' || invoice.status === 'overdue') && (
                          <button type="button" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={() => updateInvoice(invoice.id, { status: 'paid' })}>
                            Als bezahlt markieren
                          </button>
                        )}
                      </div>
                    </details>
                  </div>
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
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Monat
                </th>
                <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Umsatz
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {monthlyRevenueSorted.map(([month, revenue]) => (
                <tr key={month}>
                  <td className="px-4 lg:px-6 py-3 whitespace-nowrap text-sm text-gray-900">
                    {month}
                  </td>
                  <td className="px-4 lg:px-6 py-3 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(revenue, locale)}
                  </td>
                </tr>
              ))}
              {monthlyRevenueSorted.length === 0 && (
                <tr>
                  <td colSpan={2} className="text-center py-8 text-gray-500">
                    Keine Umsätze vorhanden
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
