import { useState, useEffect } from 'react';
import { X, Download, Mail, Eye } from 'lucide-react';
import { Invoice, Customer } from '../types';
import { useCustomers } from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
import { formatCurrency } from '../utils/formatters';
import { generateInvoicePDF, generateReminderPDF } from '../utils/pdfGenerator';
import { blobToBase64 } from '../utils/blobUtils';
import { apiService } from '../services/api';
import logger from '../utils/logger';
import { DocumentPreview } from './DocumentPreview';
import type { PreviewDocument } from '../utils/previewDocuments';
import { getTerminology } from '../utils/terminology';
import { useFeedback } from '../context/FeedbackContext';

interface ReminderSendModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice;
  customer: Customer;
  stage: 1 | 2 | 3;
  onSuccess: () => void;
  isBulkMode?: boolean;
  bulkInvoices?: Invoice[];
}

export function ReminderSendModal({
  isOpen,
  onClose,
  invoice,
  customer,
  stage,
  onSuccess,
  isBulkMode = false,
  bulkInvoices = []
}: ReminderSendModalProps) {
  const { notify } = useFeedback();
  const { company } = useCompany();
  const terminology = getTerminology(company?.terminologyProfile);
  const { customers } = useCustomers();
  const [isLoading, setIsLoading] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(true);
  const [customText, setCustomText] = useState('');
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [customerManualEmails, setCustomerManualEmails] = useState<Record<string, string[]>>({});
  const [currentCustomerId, setCurrentCustomerId] = useState<string>('');
  const [manualEmailInput, setManualEmailInput] = useState('');
  const [showEmailSection, setShowEmailSection] = useState(false);
  const [includeOriginalInvoice, setIncludeOriginalInvoice] = useState(false);
  const [previewModal, setPreviewModal] = useState<{
    isOpen: boolean;
    documents: PreviewDocument[];
  }>({
    isOpen: false,
    documents: []
  });

  // Get reminder configuration
  const reminderText = stage === 1 ? company.reminderTextStage1 :
                       stage === 2 ? company.reminderTextStage2 :
                       company.reminderTextStage3;
  
  // Calculate cumulative fees (sum of all stages up to current)
  const cumulativeFee = (() => {
    let totalFees = 0;
    const feeStage1 = company.reminderFeeStage1 || 0;
    const feeStage2 = company.reminderFeeStage2 || 0;
    const feeStage3 = company.reminderFeeStage3 || 0;
    
    if (stage >= 1) totalFees += feeStage1;
    if (stage >= 2) totalFees += feeStage2;
    if (stage >= 3) totalFees += feeStage3;
    
    return totalFees;
  })();

  const outstandingAmountOf = (item: Invoice) => Math.max(0, Number(item.outstandingAmount ?? (
    item.status === 'paid' ? 0 : item.total - Number(item.paidAmount || 0)
  )));
  const outstandingAmount = outstandingAmountOf(invoice);
  const totalWithFee = outstandingAmount + cumulativeFee;
  const nextStatus = `reminded_${stage}x` as Invoice['status'];

  useEffect(() => {
    if (isOpen) {
      // Pre-select all active customer emails
      let activeEmails: string[] = [];
      
      if (isBulkMode && bulkInvoices.length > 0) {
        // Collect all unique customer emails from all bulk invoices
        const uniqueEmails = new Set<string>();
        
        bulkInvoices.forEach(inv => {
          const invCustomer = customers.find(c => c.id === inv.customerId);
          if (invCustomer) {
            if (invCustomer.email) {
              uniqueEmails.add(invCustomer.email);
            }
            invCustomer.additionalEmails?.filter(e => e.isActive).forEach(e => {
              uniqueEmails.add(e.email);
            });
          }
        });
        
        activeEmails = Array.from(uniqueEmails);
      } else {
        // Single invoice mode - just use the provided customer
        activeEmails = [
          customer.email,
          ...(customer.additionalEmails?.filter(e => e.isActive).map(e => e.email) || [])
        ].filter(Boolean);
      }
      
      setSelectedEmails(activeEmails);
      setCustomText(reminderText || '');
      setShowEmailSection(false);
      setCustomerManualEmails({});
      setCurrentCustomerId('');
      setManualEmailInput('');
    }
  }, [isOpen, customer, reminderText, isBulkMode, bulkInvoices, customers]);

  if (!isOpen) return null;

  const handlePreview = async () => {
    try {
      const pdfBlob = await generateReminderPDF(
        invoice,
        stage,
        customText || reminderText || '',
        cumulativeFee,
        {
          format: 'zugferd',
          company,
          customer
        }
      );

      const pdfBase64 = await blobToBase64(pdfBlob);
      
      setPreviewModal({
        isOpen: true,
        documents: [{
          id: `reminder-${stage}`,
          name: `${stage}. Mahnung - ${invoice.invoiceNumber}.pdf`,
          type: 'attachment',
          content: pdfBase64,
          contentType: 'application/pdf',
          size: pdfBlob.size
        }]
      });
    } catch (error) {
      logger.error('Error generating reminder preview:', error);
      notify({ variant: 'error', message: 'Fehler beim Erstellen der Vorschau' });
    }
  };

  const handleClosePreview = () => {
    setPreviewModal({ isOpen: false, documents: [] });
  };

  const handleDownload = async () => {
    setIsLoading(true);
    try {
      const invoicesToProcess = isBulkMode ? bulkInvoices : [invoice];
      
      for (const inv of invoicesToProcess) {
        const invCustomer = customers.find(entry => entry.id === inv.customerId);
        if (!invCustomer) {
          throw new Error(`${terminology.entity.singular} für ${inv.invoiceNumber} nicht gefunden.`);
        }
        const pdfBlob = await generateReminderPDF(
          inv,
          stage,
          customText || reminderText || '',
          cumulativeFee,
          {
            format: 'zugferd',
            company,
            customer: invCustomer,
          }
        );

        // Create download link
        const url = URL.createObjectURL(pdfBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Mahnung_${stage}_${inv.invoiceNumber}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        // Update status if requested
        if (updateStatus) {
          await apiService.sendReminder(inv.id, stage, true);
        }

        logger.info('Reminder PDF downloaded', { invoiceId: inv.id, stage });
      }

      onSuccess();
      onClose();
    } catch (error) {
      logger.error('Error downloading reminder PDF:', error);
      notify({ variant: 'error', message: 'Fehler beim Herunterladen der Mahnung' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendEmail = async () => {
    setIsLoading(true);
    try {
      const invoicesToProcess = isBulkMode ? bulkInvoices : [invoice];
      let successCount = 0;

      for (const inv of invoicesToProcess) {
        try {
          // Get customer for this specific invoice
          const invCustomer = customers.find(c => c.id === inv.customerId);
          if (!invCustomer) {
            logger.error(`Customer not found for invoice ${inv.id}`);
            continue;
          }

          // Build email list for this specific customer
          const customerEmailsList = [
            invCustomer.email,
            ...(invCustomer.additionalEmails?.filter(e => e.isActive).map(e => e.email) || [])
          ].filter(Boolean);
          
          // Include selected emails that belong to this customer
          const selectedCustomerEmails = selectedEmails.filter(email => customerEmailsList.includes(email));
          
          // Include manual emails for this specific customer
          const manualEmailsForCustomer = customerManualEmails[inv.customerId] || [];
          
          // Combine all emails for this customer
          const customerEmails = [...selectedCustomerEmails, ...manualEmailsForCustomer];
          
          // If no emails at all, skip this invoice
          if (customerEmails.length === 0) {
            logger.warn(`No emails selected for customer ${invCustomer.name}, skipping invoice ${inv.invoiceNumber}`);
            continue;
          }

          // Generate reminder PDF
          const reminderPdfBlob = await generateReminderPDF(
            inv,
            stage,
            customText || reminderText || '',
            cumulativeFee,
            {
              format: 'zugferd',
              company,
              customer: invCustomer
            }
          );

          // Convert reminder PDF to base64
          const reminderPdfBase64 = await blobToBase64(reminderPdfBlob);

          // Prepare additional attachments (original invoice + its attachments)
          const additionalAttachments: { name: string; content: string; contentType: string }[] = [];
          
          if (includeOriginalInvoice) {
            try {
              // Import generateInvoicePDF dynamically
              // Generate original invoice PDF
              const originalInvoicePdfBlob = await generateInvoicePDF(
                inv,
                {
                  format: 'zugferd',
                  company,
                  customer: invCustomer
                }
              );
              
              // Convert original invoice to base64
              const originalInvoicePdfBase64 = await blobToBase64(originalInvoicePdfBlob);
              
              // Add original invoice to attachments
              additionalAttachments.push({
                name: `Rechnung_${inv.invoiceNumber}.pdf`,
                content: originalInvoicePdfBase64,
                contentType: 'application/pdf'
              });
              
              // Add invoice attachments if any
              if (inv.attachments && inv.attachments.length > 0) {
                inv.attachments.forEach(attachment => {
                  additionalAttachments.push({
                    name: attachment.name,
                    content: attachment.content,
                    contentType: attachment.contentType
                  });
                });
              }
            } catch (error) {
              logger.error('Error generating original invoice attachments:', error);
            }
          }

          // Send email via backend - this will log to email_history
          await apiService.sendReminderEmail(
            inv.id,
            stage,
            customerEmails,
            reminderPdfBase64,
            inv,
            cumulativeFee,
            customText || reminderText,
            additionalAttachments
          );

          // Update status if requested
          if (updateStatus) {
            await apiService.sendReminder(inv.id, stage, true);
          }

          successCount++;
          logger.info('Reminder email sent successfully', { invoiceId: inv.id, stage, emailCount: customerEmails.length });
        } catch (error) {
          logger.error(`Error sending reminder email for invoice ${inv.id}:`, error);
        }
      }

      if (successCount > 0) {
        notify({ variant: 'success', message: `${successCount} Mahnung(en) erfolgreich versendet!` });
        onSuccess();
        onClose();
      } else {
        notify({ variant: 'error', message: 'Fehler beim Versenden der Mahnungen' });
      }
    } catch (error) {
      logger.error('Error sending reminder emails:', error);
      notify({ variant: 'error', message: 'Fehler beim Versenden der Mahnung per E-Mail' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddManualEmail = (customerId: string) => {
    const email = manualEmailInput.trim();
    
    // Check if email already exists for this customer
    const existingEmails = customerManualEmails[customerId] || [];
    if (email && !existingEmails.includes(email) && !selectedEmails.includes(email)) {
      // Simple email validation
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        notify({ variant: 'warning', message: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.' });
        return;
      }
      
      setCustomerManualEmails({
        ...customerManualEmails,
        [customerId]: [...existingEmails, email]
      });
      setManualEmailInput('');
    }
  };

  const handleRemoveManualEmail = (customerId: string, email: string) => {
    const existingEmails = customerManualEmails[customerId] || [];
    setCustomerManualEmails({
      ...customerManualEmails,
      [customerId]: existingEmails.filter(e => e !== email)
    });
  };

  const handleEmailToggle = (email: string) => {
    setSelectedEmails(prev =>
      prev.includes(email)
        ? prev.filter(e => e !== email)
        : [...prev, email]
    );
  };

  return (
    <>
      {/* Main Modal */}
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">
              {stage}. Mahnung versenden
              {isBulkMode && <span className="ml-2 text-sm font-normal text-gray-600">({bulkInvoices.length} Rechnungen)</span>}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              disabled={isLoading}
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Invoice Info */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">
                {isBulkMode ? 'Rechnungsübersicht' : 'Rechnungsinformationen'}
              </h3>
              {isBulkMode ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Anzahl Rechnungen</p>
                      <p className="font-medium">{bulkInvoices.length}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Gesamtbetrag (exkl. Gebühren)</p>
                      <p className="font-medium">{formatCurrency(bulkInvoices.reduce((sum, inv) => sum + outstandingAmountOf(inv), 0), company?.locale || 'de-DE', company?.numberFormat, company?.currency)}</p>
                    </div>
                  </div>
                  <div className="max-h-32 overflow-y-auto border-t border-gray-200 pt-2 mt-2">
                    <p className="text-xs text-gray-500 mb-1">Rechnungen:</p>
                    {bulkInvoices.map(inv => (
                      <div key={inv.id} className="text-xs text-gray-700 flex justify-between py-1">
                        <span>{inv.invoiceNumber}</span>
                        <span className="text-gray-500">{formatCurrency(outstandingAmountOf(inv), company?.locale || 'de-DE', company?.numberFormat, company?.currency)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Rechnungsnummer</p>
                    <p className="font-medium">{invoice.invoiceNumber}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">{terminology.entity.singular}</p>
                    <p className="font-medium">{customer.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Offener Rechnungsbetrag</p>
                    <p className="font-medium">{formatCurrency(outstandingAmount, company?.locale || 'de-DE', company?.numberFormat, company?.currency)}</p>
                  </div>
                  {cumulativeFee > 0 && (
                    <div>
                      <p className="text-sm text-gray-600">Mahngebühren (gesamt)</p>
                      <p className="font-medium text-red-600">{formatCurrency(cumulativeFee, company?.locale || 'de-DE', company?.numberFormat, company?.currency)}</p>
                    </div>
                  )}
                  <div className="col-span-2 pt-2 border-t border-gray-200">
                    <p className="text-sm text-gray-600">Gesamtbetrag</p>
                    <p className="text-lg font-bold text-primary-custom">{formatCurrency(totalWithFee, company?.locale || 'de-DE', company?.numberFormat, company?.currency)}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Reminder Text Preview */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Mahntext (optional anpassen)
              </label>
              <textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                rows={5}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent text-sm"
                placeholder="Mahntext..."
              />
            </div>

            {/* Status Update Checkbox */}
            <div className="flex items-start bg-blue-50 rounded-lg p-3">
              <input
                type="checkbox"
                id="updateStatus"
                checked={updateStatus}
                onChange={(e) => setUpdateStatus(e.target.checked)}
                className="custom-checkbox mt-1"
              />
              <label htmlFor="updateStatus" className="ml-2 text-sm">
                <span className="font-medium text-gray-900">Status automatisch aktualisieren</span>
                <p className="text-gray-600 text-xs mt-0.5">
                  Rechnungsstatus wird auf "{getStatusLabel(nextStatus)}" geändert
                </p>
              </label>
            </div>

            {/* Include Original Invoice Checkbox */}
            <div className="flex items-start bg-green-50 rounded-lg p-3">
              <input
                type="checkbox"
                id="includeOriginalInvoice"
                checked={includeOriginalInvoice}
                onChange={(e) => setIncludeOriginalInvoice(e.target.checked)}
                className="custom-checkbox mt-1"
              />
              <label htmlFor="includeOriginalInvoice" className="ml-2 text-sm">
                <span className="font-medium text-gray-900">Ursprüngliche Rechnung anhängen</span>
                <p className="text-gray-600 text-xs mt-0.5">
                  Die ursprüngliche Rechnung samt aller Anhänge wird zusätzlich zur Mahnung per E-Mail versendet
                </p>
              </label>
            </div>

            {/* Email Section - Collapsible */}
            {showEmailSection && (
              <div className="space-y-4 bg-blue-50 rounded-lg p-4 border border-blue-200">
                <h3 className="text-sm font-medium text-gray-900">E-Mail-Empfänger</h3>
                
                {/* Customer Emails */}
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {isBulkMode && bulkInvoices.length > 0 ? (
                    // Bulk mode: Group emails by customer with individual manual email inputs
                    <>
                      {Array.from(new Set(bulkInvoices.map(inv => inv.customerId))).map(customerId => {
                        const invCustomer = customers.find(c => c.id === customerId);
                        if (!invCustomer) return null;
                        
                        const manualEmailsForCustomer = customerManualEmails[customerId] || [];
                        
                        return (
                          <div key={customerId} className="mb-4 pb-4 border-b border-gray-300 last:border-0 bg-gray-50 p-3 rounded-lg">
                            <p className="text-sm font-semibold text-gray-800 mb-2">{invCustomer.name}</p>
                            
                            {/* Standard emails for this customer */}
                            <div className="space-y-1 mb-2">
                              {invCustomer.email && (
                                <label className="flex items-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={selectedEmails.includes(invCustomer.email)}
                                    onChange={() => handleEmailToggle(invCustomer.email)}
                                    className="custom-checkbox"
                                  />
                                  <span className="ml-2 text-sm">{invCustomer.email}</span>
                                  <span className="ml-2 text-xs text-gray-500">(Haupt-E-Mail)</span>
                                </label>
                              )}
                              {invCustomer.additionalEmails?.filter(e => e.isActive).map((emailObj) => (
                                <label key={emailObj.id} className="flex items-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={selectedEmails.includes(emailObj.email)}
                                    onChange={() => handleEmailToggle(emailObj.email)}
                                    className="custom-checkbox"
                                  />
                                  <span className="ml-2 text-sm">{emailObj.email}</span>
                                  {emailObj.label && (
                                    <span className="ml-2 text-xs text-gray-500">({emailObj.label})</span>
                                  )}
                                </label>
                              ))}
                            </div>
                            
                            {/* Manual email input for this customer */}
                            <div className="mt-2">
                              <div className="flex gap-1">
                                <input
                                  type="email"
                                  value={currentCustomerId === customerId ? manualEmailInput : ''}
                                  onFocus={() => setCurrentCustomerId(customerId)}
                                  onChange={(e) => setManualEmailInput(e.target.value)}
                                  onKeyPress={(e) => e.key === 'Enter' && handleAddManualEmail(customerId)}
                                  placeholder="weitere@email.de"
                                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-primary-custom focus:border-transparent"
                                />
                                <button
                                  onClick={() => handleAddManualEmail(customerId)}
                                  className="px-2 py-1 bg-primary-custom text-white rounded hover:bg-primary-dark transition-colors text-xs"
                                >
                                  +
                                </button>
                              </div>
                              
                              {/* Show manual emails for this customer */}
                              {manualEmailsForCustomer.length > 0 && (
                                <div className="mt-1 space-y-1">
                                  {manualEmailsForCustomer.map((email) => (
                                    <div key={email} className="flex items-center justify-between bg-white px-2 py-1 rounded text-xs border border-green-200">
                                      <span>{email}</span>
                                      <button
                                        onClick={() => handleRemoveManualEmail(customerId, email)}
                                        className="text-red-600 hover:text-red-800"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  ) : (
                    // Single mode: Show customer emails with manual email input
                    <>
                      <div className="space-y-1 mb-3">
                        {customer.email && (
                          <label className="flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedEmails.includes(customer.email)}
                              onChange={() => handleEmailToggle(customer.email)}
                              className="custom-checkbox"
                            />
                            <span className="ml-2 text-sm">{customer.email}</span>
                            <span className="ml-2 text-xs text-gray-500">(Haupt-E-Mail)</span>
                          </label>
                        )}

                        {customer.additionalEmails?.filter(e => e.isActive).map((emailObj) => (
                          <label key={emailObj.id} className="flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedEmails.includes(emailObj.email)}
                              onChange={() => handleEmailToggle(emailObj.email)}
                              className="custom-checkbox"
                            />
                            <span className="ml-2 text-sm">{emailObj.email}</span>
                            {emailObj.label && (
                              <span className="ml-2 text-xs text-gray-500">({emailObj.label})</span>
                            )}
                          </label>
                        ))}
                      </div>
                      
                      {/* Manual Email Input for Single Mode */}
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Zusätzliche E-Mail-Adresse
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="email"
                            value={manualEmailInput}
                            onChange={(e) => setManualEmailInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleAddManualEmail(invoice.customerId)}
                            placeholder="weitere@email.de"
                            className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-primary-custom focus:border-transparent"
                          />
                          <button
                            onClick={() => handleAddManualEmail(invoice.customerId)}
                            className="px-3 py-1 bg-primary-custom text-white rounded hover:bg-primary-dark transition-colors text-sm"
                          >
                            +
                          </button>
                        </div>
                        
                        {/* Show manual emails for single mode */}
                        {(customerManualEmails[invoice.customerId] || []).length > 0 && (
                          <div className="mt-2 space-y-1">
                            {(customerManualEmails[invoice.customerId] || []).map((email) => (
                              <div key={email} className="flex items-center justify-between bg-white px-2 py-1 rounded text-sm border border-green-200">
                                <span>{email}</span>
                                <button
                                  onClick={() => handleRemoveManualEmail(invoice.customerId, email)}
                                  className="text-red-600 hover:text-red-800"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <p className="text-xs text-gray-600 mt-2">
                  {(() => {
                    let totalEmails = selectedEmails.length;
                    Object.values(customerManualEmails).forEach(emails => {
                      totalEmails += emails.length;
                    });
                    return `${totalEmails} Empfänger ausgewählt`;
                  })()}
                </p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-3 p-6 bg-gray-50 border-t border-gray-200">
            <button
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
            >
              Abbrechen
            </button>
            
            <div className="flex items-center gap-3">
              {/* Preview Button */}
              <button
                onClick={handlePreview}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                <Eye className="h-5 w-5" />
                Vorschau
              </button>

              {/* Download Button */}
              <button
                onClick={handleDownload}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 bg-primary-custom text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
              >
                <Download className="h-5 w-5" />
                {isLoading ? 'Wird heruntergeladen...' : 'Download'}
              </button>

              {/* Email Button */}
              <button
                onClick={() => {
                  if (!showEmailSection) {
                    setShowEmailSection(true);
                  } else {
                    handleSendEmail();
                  }
                }}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                <Mail className="h-5 w-5" />
                {showEmailSection ? (isLoading ? 'Wird versendet...' : 'Jetzt versenden') : 'Per E-Mail'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Preview Modal - Higher z-index to appear on top */}
      <DocumentPreview
        isOpen={previewModal.isOpen}
        onClose={handleClosePreview}
        documents={previewModal.documents}
        initialIndex={0}
      />
    </>
  );
}

function getStatusLabel(status: Invoice['status']): string {
  const labels: Record<Invoice['status'], string> = {
    draft: 'Entwurf',
    sent: 'Versendet',
    paid: 'Bezahlt',
    overdue: 'Überfällig',
    reminded_1x: '1x gemahnt',
    reminded_2x: '2x gemahnt',
    reminded_3x: '3x gemahnt'
  };
  return labels[status] || status;
}
