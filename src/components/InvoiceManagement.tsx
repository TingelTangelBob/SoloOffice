import { useState, useEffect, useMemo } from 'react';
import logger from '../utils/logger';
import { Plus, Edit, Trash2, Search, Download, FileText, Send, Check, Eye, Receipt } from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useCompany } from '../context/CompanyContext';
import { Invoice } from '../types';
import { InvoiceEditor } from './InvoiceEditor';
import { ConfirmationModal } from './ConfirmationModal';
import { EmailSendModal } from './EmailSendModal';
import { DownloadModal } from './DownloadModal';
import { DocumentPreview } from './DocumentPreview';
import { createInvoiceAttachmentPreviewDocuments } from '../utils/previewDocuments';
import type { PreviewDocument } from '../utils/previewDocuments';
import { generateInvoicePDF, downloadBlob } from '../utils/pdfGenerator';
import { apiService } from '../services/api';
import { formatCurrency, formatDate } from '../utils/formatters';
import { blobToBase64 } from '../utils/blobUtils';
import { processAttachments } from '../utils/fileUtils';
import { PageHeader } from './PageHeader';
import { FilterSelect, ResponsiveFilterBar } from './ResponsiveFilterBar';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { BulkSelectionHeader } from './BulkSelectionHeader';
import { getTerminology } from '../utils/terminology';

interface InvoiceManagementProps {
  initialFilter?: string;
  initialSearchTerm?: string;
  onNavigate?: (page: string) => void;
}

export function InvoiceManagement({ initialFilter, initialSearchTerm, onNavigate }: InvoiceManagementProps = {}) {
  const { customers, addCustomer } = useCustomers();
  const { invoices, deleteInvoice, updateInvoice } = useInvoices();
  const { company } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);
  const invoiceRecords = useMemo(
    () => invoices.filter(invoice => invoice.documentType !== 'credit_note'),
    [invoices],
  );
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm || '');
  const [filterStatus, setFilterStatus] = useState(initialFilter || 'not-paid');
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState<string | null>(null);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [isBulkOperation, setIsBulkOperation] = useState(false);
  
  const [newCustomerData, setNewCustomerData] = useState({
    name: '',
    email: '',
    address: '',
    postalCode: '',
    city: '',
    country: 'Deutschland',
    taxId: '',
    phone: ''
  });
  
  // Get locale from company settings, default to 'de-DE'
  const locale = company?.locale || 'de-DE';
  
  // Email dialog state
  const [emailModal, setEmailModal] = useState<{
    isOpen: boolean;
    invoice: Invoice | null;
    customer: { email: string; additionalEmails?: { id: string; email: string; label?: string; isActive: boolean }[] } | null;
    isBulkMode?: boolean;
    bulkInvoices?: Invoice[];
  }>({
    isOpen: false,
    invoice: null,
    customer: null,
    isBulkMode: false,
    bulkInvoices: []
  });
  
  // Download modal state
  const [downloadModal, setDownloadModal] = useState<{
    isOpen: boolean;
    invoice: Invoice | null;
    isBulkMode?: boolean;
    bulkInvoices?: Invoice[];
  }>({
    isOpen: false,
    invoice: null,
    isBulkMode: false,
    bulkInvoices: []
  });
  
  // Document Preview state
  const [documentPreview, setDocumentPreview] = useState<{
    isOpen: boolean;
    documents: PreviewDocument[];
    initialIndex: number;
  }>({
    isOpen: false,
    documents: [],
    initialIndex: 0
  });
  
  // Modal states
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDestructive?: boolean;
    isGoBDWarning?: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Update filter and search when initialFilter/initialSearchTerm props change
  useEffect(() => {
    if (initialFilter) {
      setFilterStatus(initialFilter);
    }
    if (initialSearchTerm) {
      setSearchTerm(initialSearchTerm);
    }
  }, [initialFilter, initialSearchTerm]);

  // Check for overdue invoices automatically on every load
  useEffect(() => {
    const checkOverdueInvoices = async () => {
      if (invoiceRecords.length === 0) return;
      
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Set to start of day for accurate comparison
      
      const overdueUpdates = invoiceRecords
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
        logger.debug(`${overdueUpdates.length} Rechnungen wurden automatisch als überfällig markiert.`);
      }
    };

    // Run overdue check whenever invoices are loaded or updated
    if (invoiceRecords.length > 0) {
      checkOverdueInvoices();
    }
  }, [invoiceRecords, updateInvoice]);

  const filteredInvoices = invoiceRecords.filter(invoice => {
    const invoiceNumber = invoice.invoiceNumber || '';
    const customerName = invoice.customerName || '';
    const searchTermLower = searchTerm.toLowerCase();
    
    const matchesSearch = invoiceNumber.toLowerCase().includes(searchTermLower) ||
                         customerName.toLowerCase().includes(searchTermLower);
    
    let matchesStatus = false;
    if (filterStatus === 'all') {
      matchesStatus = true;
    } else if (filterStatus === 'not-paid') {
      matchesStatus = invoice.status !== 'paid';
    } else {
      matchesStatus = invoice.status === filterStatus;
    }
    
    return matchesSearch && matchesStatus;
  });

  const handleOpenEditor = (invoice?: Invoice) => {
    // Check if invoice is sent, reminded, or has any status other than draft and warn user
    if (invoice && invoice.status !== 'draft') {
      setConfirmModal({
        isOpen: true,
        title: 'Rechnung bearbeiten',
        message: 'Diese Rechnung wurde bereits versendet bzw. gemahnt. Änderungen an versendeten oder gemahnten Rechnungen sollten nur in Ausnahmefällen vorgenommen werden, da sie die GoBD-Konformität beeinträchtigen können. Möchten Sie trotzdem fortfahren?',
        onConfirm: () => {
          setEditingInvoice(invoice || null);
          setIsEditorOpen(true);
        },
        isGoBDWarning: true
      });
    } else {
      setEditingInvoice(invoice || null);
      setIsEditorOpen(true);
    }
  };

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setEditingInvoice(null);
  };

  const handleDelete = async (invoice: Invoice) => {
    if (invoice.status !== 'draft') {
      setConfirmModal({
        isOpen: true,
        title: 'Rechnung löschen',
        message: 'Diese Rechnung wurde bereits versendet bzw. gemahnt. Das Löschen versendeter oder gemahnter Rechnungen kann die GoBD-Konformität verletzen und ist rechtlich problematisch. Sind Sie sicher, dass Sie fortfahren möchten?',
        onConfirm: async () => {
          try {
            await deleteInvoice(invoice.id);
          } catch (error) {
            logger.error('Error deleting invoice:', error);
          }
        },
        isDestructive: true,
        isGoBDWarning: true
      });
    } else {
      setConfirmModal({
        isOpen: true,
        title: 'Rechnung löschen',
        message: `Möchten Sie die Rechnung ${invoice.invoiceNumber} wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
        onConfirm: async () => {
          try {
            await deleteInvoice(invoice.id);
          } catch (error) {
            logger.error('Error deleting invoice:', error);
          }
        },
        isDestructive: true
      });
    }
  };

  const handleStatusChange = async (id: string, newStatus: Invoice['status']) => {
    try {
      await updateInvoice(id, { status: newStatus });
    } catch (error) {
      logger.error('Error updating invoice status:', error);
      // You might want to show an error message to the user here
    }
  };

  const handleExport = (invoice: Invoice) => {
    // Open download modal
    setDownloadModal({
      isOpen: true,
      invoice
    });
  };

  const handlePreview = (invoice: Invoice) => {
    // Create preview documents for the invoice
    const documents = createInvoiceAttachmentPreviewDocuments(invoice);
    
    setDocumentPreview({
      isOpen: true,
      documents,
      initialIndex: 0
    });
  };

  const handleClosePreview = () => {
    setDocumentPreview({
      isOpen: false,
      documents: [],
      initialIndex: 0
    });
  };

  const handleDownloadConfirm = async (formats: ('zugferd' | 'xrechnung')[], markAsSent: boolean, selectedAttachmentIds: string[] = []) => {
    if (!downloadModal.invoice) return;
    
    // Handle bulk mode
    if (downloadModal.isBulkMode && downloadModal.bulkInvoices) {
      setIsBulkOperation(true);
      
      try {
        let successCount = 0;
        let errorCount = 0;
        
        for (const invoice of downloadModal.bulkInvoices) {
          try {
            const customer = customers.find(c => c.id === invoice.customerId);
            if (!customer) {
              logger.warn(`No customer found for invoice ${invoice.invoiceNumber}`);
              errorCount++;
              continue;
            }
            
            // Download each format with delay
            for (let i = 0; i < formats.length; i++) {
              const format = formats[i];
              
              // Add longer delay between downloads for bulk operations (except for the first one)
              if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 1500));
              }
              
              const pdfBlob = await generateInvoicePDF(invoice, {
                format,
                company,
                customer
              });
              
              let filename: string;
              if (format === 'xrechnung') {
                filename = `${invoice.invoiceNumber}_xrechnung.xml`;
              } else {
                const formatSuffix = format === 'zugferd' ? '' : `_${format}`;
                filename = `${invoice.invoiceNumber}${formatSuffix}.pdf`;
              }
              
              downloadBlob(pdfBlob, filename);
            }

            // Download invoice attachments if they exist
            if (invoice.attachments && invoice.attachments.length > 0) {
              for (let i = 0; i < invoice.attachments.length; i++) {
                const attachment = invoice.attachments[i];
                
                // Add delay between attachment downloads
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Convert base64 to blob and download
                try {
                  const base64Data = attachment.content.split(',')[1] || attachment.content;
                  const byteCharacters = atob(base64Data);
                  const byteNumbers = new Array(byteCharacters.length);
                  for (let j = 0; j < byteCharacters.length; j++) {
                    byteNumbers[j] = byteCharacters.charCodeAt(j);
                  }
                  const byteArray = new Uint8Array(byteNumbers);
                  const blob = new Blob([byteArray], { type: attachment.contentType });
                  
                  // Add invoice number prefix to attachment filename
                  const attachmentFilename = `${invoice.invoiceNumber}_${attachment.name}`;
                  downloadBlob(blob, attachmentFilename);
                } catch (error) {
                  logger.error(`Error downloading attachment ${attachment.name} for invoice ${invoice.invoiceNumber}:`, error);
                }
              }
            }
            
            // Mark as sent if requested
            if (markAsSent && (invoice.status === 'draft' || invoice.status === 'paid' || invoice.status === 'sent' || invoice.status === 'overdue')) {
              await updateInvoice(invoice.id, { status: 'sent' });
            }
            
            successCount++;
          } catch (error) {
            logger.error(`Error downloading invoice ${invoice.invoiceNumber}:`, error);
            errorCount++;
          }
        }
        
        alert(`${successCount} Rechnung(en) erfolgreich heruntergeladen!${errorCount > 0 ? ` - ${errorCount} Fehler` : ''}`);
        
        // Clear selection and close modal
        setSelectedInvoiceIds([]);
        setDownloadModal({ isOpen: false, invoice: null, isBulkMode: false, bulkInvoices: [] });
        
      } catch (error) {
        logger.error('Bulk download error:', error);
        alert('Fehler beim Bulk-Download: ' + (error as Error).message);
      } finally {
        setIsBulkOperation(false);
      }
      return;
    }
    
    // Single invoice mode (existing code)
    const invoice = downloadModal.invoice;
    setIsExporting(invoice.id);
    
    try {
      const customer = customers.find(c => c.id === invoice.customerId);
      if (!customer) {
        alert(`${terminology.entity.dataLabel} nicht gefunden.`);
        return;
      }      // Download each format with delay
      for (let i = 0; i < formats.length; i++) {
        const format = formats[i];
        
        // Add longer delay between downloads (except for the first one)
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      
        const pdfBlob = await generateInvoicePDF(invoice, {
          format,
          company,
          customer
        });
        
        let filename: string;
        if (format === 'xrechnung') {
          filename = `${invoice.invoiceNumber}_xrechnung.xml`;
        } else {
          const formatSuffix = format === 'zugferd' ? '' : `_${format}`;
          filename = `${invoice.invoiceNumber}${formatSuffix}.pdf`;
        }
        
        downloadBlob(pdfBlob, filename);
      }

      // Download invoice attachments if they exist and are selected
      if (invoice.attachments && invoice.attachments.length > 0 && selectedAttachmentIds.length > 0) {
        const selectedAttachments = invoice.attachments.filter(att => selectedAttachmentIds.includes(att.id));
        
        for (let i = 0; i < selectedAttachments.length; i++) {
          const attachment = selectedAttachments[i];
          
          // Add delay between attachment downloads
          if (i > 0 || formats.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          // Convert base64 to blob and download
          try {
            const base64Data = attachment.content.split(',')[1] || attachment.content;
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let j = 0; j < byteCharacters.length; j++) {
              byteNumbers[j] = byteCharacters.charCodeAt(j);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: attachment.contentType });
            
            // Add invoice number prefix to attachment filename
            const attachmentFilename = `${invoice.invoiceNumber}_${attachment.name}`;
            downloadBlob(blob, attachmentFilename);
          } catch (error) {
            logger.error(`Error downloading attachment ${attachment.name} for invoice ${invoice.invoiceNumber}:`, error);
          }
        }
      }// Mark as sent if requested
        if (markAsSent && (invoice.status === 'draft' || invoice.status === 'paid' || invoice.status === 'sent' || invoice.status === 'overdue')) {
          await updateInvoice(invoice.id, { status: 'sent' });
        }
      
    } catch (error) {
      logger.error('Fehler beim Generieren der Datei:', error);
      alert('Fehler beim Erstellen der Datei. Bitte versuchen Sie es erneut.');
    } finally {
      setIsExporting(null);
      setDownloadModal({ isOpen: false, invoice: null, isBulkMode: false, bulkInvoices: [] });
    }
  };

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
    
    // Handle bulk mode
    if (emailModal.isBulkMode && emailModal.bulkInvoices) {
      setIsBulkOperation(true);
      
      try {
        let successCount = 0;
        let errorCount = 0;
        
        for (const invoice of emailModal.bulkInvoices) {
          try {
            const customer = customers.find(c => c.id === invoice.customerId);
            if (!customer?.email) {
              logger.warn(`No email for customer of invoice ${invoice.invoiceNumber}`);
              errorCount++;
              continue;
            }

            // Process additional attachments
            let processedAttachments: { name: string; content: string; contentType: string }[] = [];
            if (attachments && attachments.length > 0) {
              try {
                processedAttachments = await processAttachments(attachments);
              } catch (error) {
                logger.error('Error processing attachments:', error);
                errorCount++;
                continue;
              }
            }

            // Add stored invoice attachments to the processed attachments
            if (invoice.attachments && invoice.attachments.length > 0) {
              for (const storedAttachment of invoice.attachments) {
                processedAttachments.push({
                  name: storedAttachment.name,
                  content: storedAttachment.content,
                  contentType: storedAttachment.contentType
                });
              }
            }

            // Generate PDFs for all selected formats
            const invoiceFormats = [];
            
            for (const format of formats) {
              const pdfBlob = await generateInvoicePDF(invoice, {
                format,
                company,
                customer
              });
              
              const base64PDF = await blobToBase64(pdfBlob);
              
              invoiceFormats.push({
                format,
                content: base64PDF
              });
            }
            
            // Send email
            const result = await apiService.sendInvoiceEmailMultiFormat(
              [customer.email],
              invoiceFormats,
              invoice, 
              customText,
              processedAttachments
            );
            
            if (!result.success) {
              throw new Error(`Email send failed: ${result.message}`);
            }
            
            // Mark as sent if it was draft
            if (invoice.status === 'draft') {
              await updateInvoice(invoice.id, { status: 'sent' });
            }
            
            successCount++;
          } catch (error) {
            logger.error(`Error sending invoice ${invoice.invoiceNumber}:`, error);
            errorCount++;
          }
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
        
        alert(`${successCount} Rechnung(en) erfolgreich versendet! (${formatLabels.join(', ')})${attachmentInfo}${errorCount > 0 ? ` - ${errorCount} Fehler` : ''}`);
        
        // Clear selection and close modal
        setSelectedInvoiceIds([]);
        setEmailModal({ isOpen: false, invoice: null, customer: null, isBulkMode: false, bulkInvoices: [] });
        
      } catch (error) {
        logger.error('Bulk email error:', error);
        alert('Fehler beim Bulk-E-Mail-Versand: ' + (error as Error).message);
      } finally {
        setIsBulkOperation(false);
      }
      return;
    }
    
    // Single invoice mode (existing code)
    setIsSendingEmail(emailModal.invoice.id);
    
    try {
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
        
        for (const storedAttachment of selectedInvoiceAttachments) {
          processedAttachments.push({
            name: storedAttachment.name,
            content: storedAttachment.content,
            contentType: storedAttachment.contentType
          });
        }
      }

      // Generate PDFs for all selected formats
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
      
      // Combine selected emails and manual emails
      const allEmails = [...(selectedEmails || []), ...(manualEmails?.filter(email => email.trim()) || [])];
      
      if (allEmails.length === 0) {
        alert('Bitte wählen Sie mindestens eine E-Mail-Adresse aus.');
        return;
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
      setEmailModal({ isOpen: false, invoice: null, customer: null, isBulkMode: false, bulkInvoices: [] });
    } catch (error) {
      logger.error('Fehler beim E-Mail-Versand:', error);
      alert('Fehler beim E-Mail-Versand: ' + (error as Error).message);
    } finally {
      setIsSendingEmail(null);
    }
  };

  const handleEmailModalClose = () => {
    setEmailModal({ isOpen: false, invoice: null, customer: null, isBulkMode: false, bulkInvoices: [] });
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid': return 'Bezahlt';
      case 'sent': return 'Versendet';
      case 'draft': return 'Entwurf';
      case 'overdue': return 'Überfällig';
      case 'reminded_1x': return '1x gemahnt';
      case 'reminded_2x': return '2x gemahnt';
      case 'reminded_3x': return '3x gemahnt';
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-green-100 text-green-800';
      case 'sent': return 'bg-primary-custom/10 text-primary-custom';
      case 'draft': return 'bg-gray-100 text-gray-800';
      case 'overdue': return 'bg-red-100 text-red-800';
      case 'reminded_1x': return 'bg-orange-100 text-orange-800';
      case 'reminded_2x': return 'bg-orange-200 text-orange-900';
      case 'reminded_3x': return 'bg-red-200 text-red-900';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Bulk operations functions
  const handleInvoiceSelection = (invoiceId: string, checked: boolean) => {
    if (checked) {
      setSelectedInvoiceIds(prev => [...prev, invoiceId]);
    } else {
      setSelectedInvoiceIds(prev => prev.filter(id => id !== invoiceId));
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedInvoiceIds(filteredInvoices.map(invoice => invoice.id));
    } else {
      setSelectedInvoiceIds([]);
    }
  };

  const handleBulkStatusChange = async (newStatus: Invoice['status']) => {
    if (selectedInvoiceIds.length === 0) return;
    
    setIsBulkOperation(true);
    try {
      for (const invoiceId of selectedInvoiceIds) {
        await updateInvoice(invoiceId, { status: newStatus });
      }
      setSelectedInvoiceIds([]);
      alert(`${selectedInvoiceIds.length} Rechnung(en) erfolgreich aktualisiert.`);
    } catch (error) {
      logger.error('Error updating invoice statuses:', error);
      alert('Fehler beim Aktualisieren der Rechnungen.');
    } finally {
      setIsBulkOperation(false);
    }
  };

  const handleBulkEmail = async () => {
    if (selectedInvoiceIds.length === 0) return;
    
    const selectedInvoices = invoiceRecords.filter(inv => selectedInvoiceIds.includes(inv.id));
    
    // Open email modal in bulk mode for all selected invoices
    setEmailModal({
      isOpen: true,
      invoice: selectedInvoices[0], // Use first invoice as template
      customer: null, // Will be handled per invoice
      isBulkMode: true,
      bulkInvoices: selectedInvoices
    });
  };

  const handleBulkDownload = async () => {
    if (selectedInvoiceIds.length === 0) return;
    
    const selectedInvoices = invoiceRecords.filter(inv => selectedInvoiceIds.includes(inv.id));
    
    // Open download modal in bulk mode
    setDownloadModal({
      isOpen: true,
      invoice: selectedInvoices[0], // Use first invoice as template
      isBulkMode: true,
      bulkInvoices: selectedInvoices
    });
  };

  if (isEditorOpen) {
    return (
      <InvoiceEditor
        invoice={editingInvoice}
        onClose={handleCloseEditor}
        onCreateCustomer={() => {
          logger.debug('onCreateCustomer called in InvoiceManagement');
          setShowCustomerForm(true);
        }}
        onNavigateToCustomers={() => onNavigate && onNavigate('customers')}
        onNavigateToSettings={() => onNavigate && onNavigate('settings')}
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <PageHeader icon={Receipt} title="Rechnungen" subtitle="Verwalten Sie Ihre Rechnungen">
        <button
          onClick={() => handleOpenEditor()}
          className="btn-primary text-white px-4 py-2 rounded-xl flex items-center justify-center space-x-2 hover:brightness-90 transition-all duration-300 hover:scale-105"
        >
          <Plus className="h-5 w-5" />
          <span className="hidden sm:inline">Neue Rechnung</span>
        </button>
        </PageHeader>
      </div>

      {/* Filters */}
      <ResponsiveFilterBar
        hasActiveFilters={filterStatus !== 'all'}
        search={(
          <div className="relative">
            <Search className="h-5 w-5 absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              placeholder="Rechnungen suchen..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}
        filters={(
          <FilterSelect
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Alle Status</option>
            <option value="not-paid">Alle außer bezahlt</option>
            <option value="draft">Entwurf</option>
            <option value="sent">Versendet</option>
            <option value="paid">Bezahlt</option>
            <option value="overdue">Überfällig</option>
          </FilterSelect>
        )}
      />

      {/* Invoice List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <BulkSelectionHeader
          itemLabel="Rechnung"
          itemLabelPlural="Rechnungen"
          visibleCount={filteredInvoices.length}
          selectedCount={selectedInvoiceIds.length}
          allSelected={filteredInvoices.length > 0 && filteredInvoices.every(invoice => selectedInvoiceIds.includes(invoice.id))}
          onSelectAll={handleSelectAll}
        >
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-gray-600 sm:inline">Status ändern:</span>
            <select
              onChange={(e) => {
                if (e.target.value) {
                  handleBulkStatusChange(e.target.value as Invoice['status']);
                  e.target.value = '';
                }
              }}
              disabled={isBulkOperation}
              className="h-6 rounded border border-blue-300 bg-white px-2 text-xs focus:ring-2 focus:ring-blue-500"
              defaultValue=""
              aria-label="Status ändern"
            >
              <option value="">Wählen...</option>
              <option value="draft">Entwurf</option>
              <option value="sent">Versendet</option>
              <option value="paid">Bezahlt</option>
              <option value="overdue">Überfällig</option>
            </select>
          </div>
          <button
            type="button"
            onClick={handleBulkEmail}
            disabled={isBulkOperation}
            className="action-icon-button bulk-action-icon-button action-icon-blue disabled:cursor-not-allowed disabled:opacity-50"
            title="Per E-Mail versenden"
            aria-label="Per E-Mail versenden"
          >
            <Send className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleBulkDownload}
            disabled={isBulkOperation}
            className="action-icon-button bulk-action-icon-button action-icon-green disabled:cursor-not-allowed disabled:opacity-50"
            title="Herunterladen"
            aria-label="Herunterladen"
          >
            <Download className="h-4 w-4" />
          </button>
        </BulkSelectionHeader>
        {/* Desktop/Tablet Table View */}
        <div className="hidden w-full min-w-0 max-w-full overflow-hidden lg:block">
            <table className="w-full table-fixed">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left w-16">
                  <span className="sr-only">Auswahl</span>
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                  Datum
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                  Rechnungsnr.
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {terminology.entity.singular}
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                  Fällig am
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                  Betrag
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                  Status
                </th>
                <th className="sticky right-0 z-20 w-14 bg-gray-50 px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider 2xl:w-56 2xl:px-3">
                  <span className="sr-only">Aktionen</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredInvoices.map((invoice) => (
                <tr key={invoice.id} className="group hover:bg-gray-50">
                  <td className="px-3 py-4 w-16">
                    <input
                      type="checkbox"
                      checked={selectedInvoiceIds.includes(invoice.id)}
                      onChange={(e) => handleInvoiceSelection(invoice.id, e.target.checked)}
                      className="custom-checkbox"
                      title="Rechnung auswählen"
                    />
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(invoice.issueDate, locale, company?.dateFormat)}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {invoice.invoiceNumber}
                  </td>
                  <td className="max-w-0 px-3 py-4 text-sm text-gray-900">
                    <span className="block truncate">{invoice.customerName}</span>
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(invoice.dueDate, locale, company?.dateFormat)}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(invoice.total, locale, company?.numberFormat, company?.currency)}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(invoice.status)}`}>
                      {getStatusLabel(invoice.status)}
                    </span>
                  </td>
                  <td className="sticky right-0 z-10 w-14 bg-white px-2 py-4 whitespace-nowrap text-sm font-medium transition-colors group-hover:bg-gray-50 2xl:w-56 2xl:px-3">
                    <div className="hidden 2xl:flex flex-wrap gap-1">
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
                      {(invoice.status === 'sent' || invoice.status === 'overdue' || invoice.status === 'reminded_1x' || invoice.status === 'reminded_2x' || invoice.status === 'reminded_3x') && (
                        <button
                          type="button"
                          className="action-icon-button action-icon-green"
                          title="Als bezahlt markieren"
                          onClick={() => handleStatusChange(invoice.id, 'paid')}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleOpenEditor(invoice)}
                        className="action-icon-button action-icon-indigo"
                        title="Bearbeiten"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePreview(invoice)}
                        className="action-icon-button action-icon-blue"
                        title="Vorschau anzeigen"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button 
                        type="button"
                        onClick={() => handleExport(invoice)}
                        disabled={isExporting === invoice.id}
                        className="action-icon-button action-icon-green"
                        title="Herunterladen"
                      >
                        {isExporting === invoice.id ? (
                          <div className="animate-spin h-3.5 w-3.5 border-2 border-green-600 border-t-transparent rounded-full"></div>
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(invoice)}
                        className="action-icon-button action-icon-red"
                        title="Löschen"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <ActionMenu containerClassName="hidden lg:block 2xl:hidden" triggerClassName="action-icon-button action-icon-blue">
                        {invoice.status === 'draft' && <ActionMenuItem icon={<Send className="h-4 w-4" />} tone="blue" onClick={() => handleSendEmail(invoice)}>Per E-Mail versenden</ActionMenuItem>}
                        {(invoice.status === 'sent' || invoice.status === 'overdue' || invoice.status === 'reminded_1x' || invoice.status === 'reminded_2x' || invoice.status === 'reminded_3x') && <ActionMenuItem icon={<Check className="h-4 w-4" />} tone="green" onClick={() => handleStatusChange(invoice.id, 'paid')}>Als bezahlt markieren</ActionMenuItem>}
                        <ActionMenuItem icon={<Edit className="h-4 w-4" />} tone="indigo" onClick={() => handleOpenEditor(invoice)}>Bearbeiten</ActionMenuItem>
                        <ActionMenuItem icon={<Eye className="h-4 w-4" />} tone="green" onClick={() => handlePreview(invoice)}>Vorschau anzeigen</ActionMenuItem>
                        <ActionMenuItem icon={<Download className="h-4 w-4" />} tone="blue" onClick={() => handleExport(invoice)} disabled={isExporting === invoice.id}>Herunterladen</ActionMenuItem>
                        <ActionMenuItem icon={<Trash2 className="h-4 w-4" />} tone="red" onClick={() => handleDelete(invoice)}>Löschen</ActionMenuItem>
                    </ActionMenu>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
        </div>

        {/* Mobile Card View */}
        <div className="lg:hidden">
          {filteredInvoices.map((invoice) => (
            <div key={invoice.id} className="p-4 border-b border-gray-200 last:border-b-0">
              <div className="grid grid-cols-[auto,minmax(0,1fr),auto,auto] items-start gap-x-3">
                <div className="pt-1">
                  <input
                    type="checkbox"
                    checked={selectedInvoiceIds.includes(invoice.id)}
                    onChange={(e) => handleInvoiceSelection(invoice.id, e.target.checked)}
                    className="custom-checkbox"
                    title="Rechnung auswählen"
                  />
                </div>
                
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 className="min-w-0 truncate text-sm font-medium text-gray-900">{invoice.invoiceNumber}</h3>
                    <span className={`inline-flex shrink-0 px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(invoice.status)}`}>
                      {getStatusLabel(invoice.status)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-gray-600">{invoice.customerName}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {formatDate(invoice.issueDate, locale, company?.dateFormat)} - Fällig: {formatDate(invoice.dueDate, locale, company?.dateFormat)}
                  </p>
                </div>
                <div className="self-center whitespace-nowrap text-right">
                  <p className="text-sm font-medium text-gray-900">{formatCurrency(invoice.total, locale, company?.numberFormat, company?.currency)}</p>
                </div>

                  {/* Action buttons for mobile */}
                  <ActionMenu containerClassName="self-center" triggerClassName="action-icon-button action-icon-blue">
                  <div className="flex flex-col gap-0.5">
                    {invoice.status === 'draft' && (
                      <ActionMenuItem icon={<Send className="h-4 w-4" />} tone="blue" onClick={() => handleSendEmail(invoice)}>Per E-Mail versenden</ActionMenuItem>
                    )}
                    {(invoice.status === 'sent' || invoice.status === 'overdue' || invoice.status === 'reminded_1x' || invoice.status === 'reminded_2x' || invoice.status === 'reminded_3x') && (
                      <ActionMenuItem icon={<Check className="h-4 w-4" />} tone="green" onClick={() => handleStatusChange(invoice.id, 'paid')}>Als bezahlt markieren</ActionMenuItem>
                    )}
                    
                    <>
                      <ActionMenuItem icon={<Edit className="h-4 w-4" />} tone="indigo" onClick={() => handleOpenEditor(invoice)}>Bearbeiten</ActionMenuItem>
                      
                      <ActionMenuItem icon={<Eye className="h-4 w-4" />} tone="green" onClick={() => handlePreview(invoice)}>Vorschau anzeigen</ActionMenuItem>
                      
                      <ActionMenuItem icon={<Download className="h-4 w-4" />} tone="blue" onClick={() => handleExport(invoice)} disabled={isExporting === invoice.id}>Herunterladen</ActionMenuItem>
                      <ActionMenuItem icon={<Trash2 className="h-4 w-4" />} tone="red" onClick={() => handleDelete(invoice)}>Löschen</ActionMenuItem>
                    </>
                  </div>
                  </ActionMenu>
              </div>
            </div>
          ))}
        </div>

        {filteredInvoices.length > 0 && (
          <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 text-right text-xs text-gray-500">
            {filteredInvoices.length} {filteredInvoices.length === 1 ? 'Rechnung' : 'Rechnungen'}
          </div>
        )}

        {filteredInvoices.length === 0 && (
          <div className="text-center py-8">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">Keine Rechnungen gefunden</p>
          </div>
        )}
      </div>
      
      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        isDestructive={confirmModal.isDestructive}
        isGoBDWarning={confirmModal.isGoBDWarning}
      />
      
      {/* Email Send Modal */}
      <EmailSendModal
        isOpen={emailModal.isOpen}
        onClose={handleEmailModalClose}
        onSend={handleEmailSend}
        document={emailModal.invoice!}
        documentType="invoice"
        customer={emailModal.customer!}
        isLoading={isSendingEmail === emailModal.invoice?.id || isBulkOperation}
        isBulkMode={emailModal.isBulkMode}
        bulkCount={emailModal.bulkInvoices?.length || 0}
      />
      
      {/* Download Modal */}
      <DownloadModal
        isOpen={downloadModal.isOpen}
        onClose={() => setDownloadModal({ isOpen: false, invoice: null, isBulkMode: false, bulkInvoices: [] })}
        onDownload={handleDownloadConfirm}
        invoice={downloadModal.invoice!}
        isLoading={isExporting === downloadModal.invoice?.id || isBulkOperation}
        isBulkMode={downloadModal.isBulkMode}
        bulkCount={downloadModal.bulkInvoices?.length || 0}
      />

      {/* Document Preview Modal */}
      <DocumentPreview
        isOpen={documentPreview.isOpen}
        onClose={handleClosePreview}
        documents={documentPreview.documents}
        initialIndex={documentPreview.initialIndex}
      />

      {/* Customer Creation Modal */}
      {showCustomerForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl p-4 lg:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {terminology.entity.newLabel}
            </h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              try {
                await addCustomer(newCustomerData);
                setNewCustomerData({
                  name: '',
                  email: '',
                  address: '',
                  postalCode: '',
                  city: '',
                  country: 'Deutschland',
                  taxId: '',
                  phone: ''
                });
                setShowCustomerForm(false);
              } catch (error) {
                logger.error('Error creating customer:', error);
              }
            }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  required
                  value={newCustomerData.name}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  E-Mail
                </label>
                <input
                  type="email"
                  value={newCustomerData.email}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  placeholder="optional"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Adresse *
                </label>
                <input
                  type="text"
                  required
                  value={newCustomerData.address}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, address: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    PLZ *
                  </label>
                  <input
                    type="text"
                    required
                    value={newCustomerData.postalCode}
                    onChange={(e) => setNewCustomerData({ ...newCustomerData, postalCode: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Stadt *
                  </label>
                  <input
                    type="text"
                    required
                    value={newCustomerData.city}
                    onChange={(e) => setNewCustomerData({ ...newCustomerData, city: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Land *
                </label>
                <input
                  type="text"
                  required
                  value={newCustomerData.country}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, country: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Telefon
                </label>
                <input
                  type="tel"
                  value={newCustomerData.phone}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-primary-custom text-white py-2 px-4 rounded-xl hover:bg-primary-custom/90 transition-all duration-300 hover:scale-105"
                >
                  {terminology.entity.createLabel}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCustomerForm(false)}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-xl hover:bg-gray-400 transition-all duration-300"
                >
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
