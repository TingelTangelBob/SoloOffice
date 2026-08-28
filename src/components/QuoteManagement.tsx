import { useState, useEffect } from 'react';
import logger from '../utils/logger';
import { Plus, Edit, Trash2, Search, Download, FileText, Send, Check, Eye, FileCheck, X, CheckCircle, Upload } from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useCompany } from '../context/CompanyContext';
import { Quote } from '../types';
import { ConfirmationModal } from './ConfirmationModal';
import { EmailSendModal } from './EmailSendModal';
import { apiService } from '../services/api';
import { formatCurrency, formatDate } from '../utils/formatters';
import { generateQuotePDF, downloadBlob } from '../utils/pdfGenerator';
import { DocumentPreview } from './DocumentPreview';
import { createQuoteAttachmentPreviewDocuments } from '../utils/previewDocuments';
import type { PreviewDocument } from '../utils/previewDocuments';
import { processAttachments, AttachmentFile } from '../utils/fileUtils';
import { PageHeader } from './PageHeader';
import { FilterSelect, ResponsiveFilterBar } from './ResponsiveFilterBar';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { BulkSelectionHeader } from './BulkSelectionHeader';
import { getTerminology } from '../utils/terminology';
import { ImportWizard } from './ImportWizard';
import { useElementWidth } from '../hooks/useElementWidth';
import { ACTION_MENU_COLUMN_WIDTH, listTableLayout } from '../utils/tableLayout';
import { useFeedback } from '../context/FeedbackContext';

interface QuoteManagementProps {
  onNavigate?: (page: string, quoteId?: string) => void;
}

/**
 * Spaltenmaße der Angebotstabelle: Auswahl 64, Datum 96, Angebotsnummer 144,
 * Gültig bis 96 und Betrag 96 Pixel. Eine Zeile zeigt höchstens sechs
 * Icon-Aktionen (Versendet-Status: annehmen, ablehnen, bearbeiten, Vorschau,
 * herunterladen, löschen).
 */
const QUOTE_TABLE_LAYOUT = listTableLayout({
  baseColumnsWidth: 64 + 96 + 144 + 96 + 96,
  flexibleColumnMinWidth: 176,
  maxActions: 6,
  statusLabelWidth: 128,
  statusDotWidth: 32,
});

export function QuoteManagement({ onNavigate }: QuoteManagementProps = {}) {
  const { notify } = useFeedback();
  const { customers } = useCustomers();
  const { refreshInvoices } = useInvoices();
  const { company } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedQuoteIds, setSelectedQuoteIds] = useState<string[]>([]);
  const [isBulkOperation, setIsBulkOperation] = useState(false);
  const [emailModal, setEmailModal] = useState<{
    isOpen: boolean;
    quote: Quote | null;
    customer: { email: string; additionalEmails?: { id: string; email: string; label?: string; isActive: boolean }[] } | null;
    isBulkMode?: boolean;
    bulkQuotes?: Quote[];
  }>({
    isOpen: false,
    quote: null,
    customer: null,
    isBulkMode: false,
    bulkQuotes: []
  });
  const [isEmailSending, setIsEmailSending] = useState(false);
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [previewDocuments, setPreviewDocuments] = useState<PreviewDocument[]>([]);
  const { ref: tableRef, width: tableWidth } = useElementWidth<HTMLDivElement>();
  const showInlineActions = tableWidth >= QUOTE_TABLE_LAYOUT.inlineActionsMinWidth;
  const showStatusLabel = tableWidth >= QUOTE_TABLE_LAYOUT.statusLabelMinWidth;

  // Get locale from company settings, default to 'de-DE'
  const locale = company?.locale || 'de-DE';
  
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

  // Load quotes
  const loadQuotes = async () => {
    try {
      const loadedQuotes = await apiService.getQuotes();
      setQuotes(loadedQuotes);
    } catch (error) {
      logger.error('Error loading quotes:', error);
    }
  };

  useEffect(() => {
    loadQuotes();
  }, []);

  // Check for expired quotes automatically
  useEffect(() => {
    const checkExpiredQuotes = async () => {
      if (quotes.length === 0) return;
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const expiredUpdates = quotes
        .filter(quote => {
          if (quote.status !== 'sent') return false;
          
          const validUntil = new Date(quote.validUntil);
          validUntil.setHours(0, 0, 0, 0);
          
          return validUntil < today;
        })
        .map(quote => quote.id);
      
      for (const quoteId of expiredUpdates) {
        try {
          await apiService.updateQuote(quoteId, { status: 'expired' });
        } catch (error) {
          logger.error('Error updating quote to expired:', error);
        }
      }
      
      if (expiredUpdates.length > 0) {
        await loadQuotes();
      }
    };

    if (quotes.length > 0) {
      checkExpiredQuotes();
    }
  }, [quotes]);

  const filteredQuotes = quotes.filter(quote => {
    const quoteNumber = quote.quoteNumber || '';
    const customerName = quote.customerName || '';
    const searchTermLower = searchTerm.toLowerCase();
    
    const matchesSearch = quoteNumber.toLowerCase().includes(searchTermLower) ||
                         customerName.toLowerCase().includes(searchTermLower);
    
    const matchesStatus = filterStatus === 'all' || quote.status === filterStatus;
    
    return matchesSearch && matchesStatus;
  });

  const handleOpenEditor = (quote?: Quote) => {
    // Check if quote is accepted or billed and warn user
    if (quote && (quote.status === 'accepted' || quote.status === 'billed')) {
      const statusText = quote.status === 'billed' ? 'abgerechnet' : 'akzeptiert';
      setConfirmModal({
        isOpen: true,
        title: 'Angebot bearbeiten',
        message: `Dieses Angebot wurde bereits ${statusText}. Änderungen an ${statusText}en Angeboten sollten nur in Ausnahmefällen vorgenommen werden, da sie die GoBD-Konformität beeinträchtigen können. Möchten Sie trotzdem fortfahren?`,
        onConfirm: () => {
          if (onNavigate) {
            onNavigate('quote-editor', quote?.id);
          }
        },
        isGoBDWarning: true
      });
    } else {
      if (onNavigate) {
        onNavigate('quote-editor', quote?.id);
      }
    }
  };

  const handleDelete = async (quote: Quote) => {
    if (quote.status !== 'draft' || Boolean(quote.convertedToInvoiceId)) {
      setConfirmModal({
        isOpen: true,
        title: 'Angebot kann nicht gelöscht werden',
        message: 'Nur unabhängige Angebotsentwürfe können gelöscht werden. Versendete, angenommene oder bereits abgerechnete Angebote bleiben als Nachweis erhalten.',
        onConfirm: () => setConfirmModal(prev => ({ ...prev, isOpen: false })),
      });
      return;
    }
    setConfirmModal({
      isOpen: true,
      title: 'Angebot löschen',
      message: `Möchten Sie das Angebot ${quote.quoteNumber} wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
      onConfirm: async () => {
        try {
          await apiService.deleteQuote(quote.id);
          await loadQuotes();
        } catch (error) {
          logger.error('Error deleting quote:', error);
        }
      },
      isDestructive: true,
    });
  };

  const handleStatusChange = async (id: string, newStatus: Quote['status']) => {
    try {
      await apiService.updateQuote(id, { status: newStatus });
      await loadQuotes();
    } catch (error) {
      logger.error('Error updating quote status:', error);
    }
  };

  const handleConvertToInvoice = async (quote: Quote) => {
    if (quote.status !== 'accepted') {
      notify({ variant: 'warning', message: 'Nur akzeptierte Angebote können in Rechnungen umgewandelt werden.' });
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: 'Angebot in Rechnung umwandeln',
      message: `Möchten Sie das Angebot ${quote.quoteNumber} in eine Rechnung umwandeln?`,
      onConfirm: async () => {
        try {
          await apiService.convertQuoteToInvoice(quote.id);
          await loadQuotes();
          await refreshInvoices(); // Refresh invoices list
          notify({ variant: 'success', message: 'Angebot wurde erfolgreich in eine Rechnung umgewandelt!' });
          if (onNavigate) {
            onNavigate('invoices');
          }
        } catch (error) {
          logger.error('Error converting quote to invoice:', error);
          notify({ variant: 'error', message: 'Fehler beim Umwandeln des Angebots.' });
        }
      },
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedQuoteIds(filteredQuotes.map(quote => quote.id));
    } else {
      setSelectedQuoteIds([]);
    }
  };

  const handleQuoteSelection = (quoteId: string, checked: boolean) => {
    if (checked) {
      setSelectedQuoteIds(prev => [...prev, quoteId]);
    } else {
      setSelectedQuoteIds(prev => prev.filter(id => id !== quoteId));
    }
  };

  // Bulk operations functions
  const handleBulkStatusChange = async (newStatus: Quote['status']) => {
    if (selectedQuoteIds.length === 0) return;
    
    setIsBulkOperation(true);
    try {
      for (const quoteId of selectedQuoteIds) {
        await apiService.updateQuote(quoteId, { status: newStatus });
      }
      await loadQuotes();
      setSelectedQuoteIds([]);
      notify({ variant: 'success', message: `${selectedQuoteIds.length} Angebot(e) erfolgreich aktualisiert.` });
    } catch (error) {
      logger.error('Error updating quote statuses:', error);
      notify({ variant: 'error', message: 'Fehler beim Aktualisieren der Angebote.' });
    } finally {
      setIsBulkOperation(false);
    }
  };

  const handleBulkEmail = async () => {
    if (selectedQuoteIds.length === 0) return;
    
    const selectedQuotes = quotes.filter(quote => selectedQuoteIds.includes(quote.id));
    
    // Open email modal in bulk mode for all selected quotes
    setEmailModal({
      isOpen: true,
      quote: selectedQuotes[0], // Use first quote as template
      customer: null, // Will be handled per quote
      isBulkMode: true,
      bulkQuotes: selectedQuotes
    });
  };

  const handleBulkDownload = async () => {
    if (selectedQuoteIds.length === 0) return;
    
    setIsExporting('bulk');
    try {
      for (const quoteId of selectedQuoteIds) {
        const quote = quotes.find(q => q.id === quoteId);
        if (quote) {
          const customer = customers.find(c => c.id === quote.customerId);
          if (customer) {
            const pdfBlob = await generateQuotePDF(quote, { company, customer });
            downloadBlob(pdfBlob, `${quote.quoteNumber}.pdf`);
          }
        }
      }
      notify({ variant: 'success', message: `${selectedQuoteIds.length} Angebot(e) erfolgreich heruntergeladen.` });
    } catch (error) {
      logger.error('Error downloading quotes:', error);
      notify({ variant: 'error', message: 'Fehler beim Herunterladen der Angebote.' });
    } finally {
      setIsExporting(null);
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'accepted': return 'Akzeptiert';
      case 'billed': return 'Abgerechnet';
      case 'sent': return 'Versendet';
      case 'draft': return 'Entwurf';
      case 'rejected': return 'Abgelehnt';
      case 'expired': return 'Abgelaufen';
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'accepted': return 'bg-green-100 text-green-800';
      case 'billed': return 'bg-blue-100 text-blue-800';
      case 'sent': return 'bg-primary-light-custom text-primary-custom';
      case 'draft': return 'bg-gray-100 text-gray-800';
      case 'rejected': return 'bg-red-100 text-red-800';
      case 'expired': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusDotColor = (status: string) => {
    switch (status) {
      case 'accepted': return 'bg-green-500';
      case 'billed': return 'bg-blue-500';
      case 'sent': return 'bg-primary-custom';
      case 'draft': return 'bg-gray-400';
      case 'rejected': return 'bg-red-500';
      case 'expired': return 'bg-orange-500';
      default: return 'bg-gray-400';
    }
  };

  const handlePreview = (quote: Quote) => {
    // Create preview documents for the quote
    const documents = createQuoteAttachmentPreviewDocuments(quote);
    
    setPreviewDocuments(documents);
    setShowPreview(true);
  };

  const handleClosePreview = () => {
    setShowPreview(false);
    setPreviewDocuments([]);
  };

  const handlePreviewEdit = (document: PreviewDocument) => {
    if (!document.quote) return;
    handleClosePreview();
    handleOpenEditor(document.quote);
  };

  const handlePreviewReject = async (document: PreviewDocument) => {
    const quote = document.quote;
    if (!quote || quote.status !== 'sent') return;

    try {
      await apiService.updateQuote(quote.id, { status: 'rejected' });
      await loadQuotes();
      handleClosePreview();
      notify({ variant: 'success', message: 'Angebot wurde als abgelehnt markiert.' });
    } catch (error) {
      logger.error('Error rejecting quote from preview:', error);
      notify({ variant: 'error', message: 'Das Angebot konnte nicht als abgelehnt markiert werden.' });
      throw error;
    }
  };

  const handleDownloadPDF = async (quote: Quote) => {
    setIsExporting(quote.id);
    try {
      const customer = customers.find(c => c.id === quote.customerId);
      if (!customer) {
        notify({ variant: 'error', message: `${terminology.entity.singular} nicht gefunden.` });
        setIsExporting(null);
        return;
      }

      if (!company) {
        notify({ variant: 'error', message: `${terminology.organization.dataLabel} nicht geladen.` });
        setIsExporting(null);
        return;
      }

      const pdfBlob = await generateQuotePDF(quote, {
        company,
        customer,
      });

      const filename = `${quote.quoteNumber.replace(/\//g, '-')}_${customer.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      downloadBlob(pdfBlob, filename);
      
      logger.info('Quote PDF downloaded', { quoteId: quote.id, quoteNumber: quote.quoteNumber });
    } catch (error) {
      logger.error('Error generating quote PDF:', error);
      notify({ variant: 'error', message: 'Fehler beim Erstellen des PDFs. Bitte versuchen Sie es erneut.' });
    } finally {
      setIsExporting(null);
    }
  };

  const handleSendEmail = async (quote: Quote) => {
    const customer = customers.find(c => c.id === quote.customerId);
    if (!customer) {
      notify({ variant: 'error', message: `${terminology.entity.singular} nicht gefunden.` });
      return;
    }

    if (!customer.email && (!customer.additionalEmails || customer.additionalEmails.length === 0)) {
      notify({ variant: 'warning', message: terminology.entity.emailMissingMessage });
      return;
    }

    setEmailModal({
      isOpen: true,
      quote,
      customer: {
        email: customer.email,
        additionalEmails: customer.additionalEmails
      }
    });
  };

  const handleEmailSend = async (
    _formats: ('zugferd' | 'xrechnung')[],
    customText?: string, 
    attachments?: AttachmentFile[], 
    selectedQuoteAttachmentIds?: string[], 
    selectedEmails?: string[], 
    manualEmails?: string[]
  ) => {
    const activeQuote = emailModal.quote;
    if (!activeQuote) return;

    setIsEmailSending(true);
    
    // Handle bulk mode
    if (emailModal.isBulkMode && emailModal.bulkQuotes) {
      setIsBulkOperation(true);
      
      try {
        let successCount = 0;
        let errorCount = 0;
        
        for (const quote of emailModal.bulkQuotes) {
          try {
            const customer = customers.find(c => c.id === quote.customerId);
            if (!customer?.email && (!customer?.additionalEmails || customer.additionalEmails.length === 0)) {
              logger.warn(`No email for customer of quote ${quote.quoteNumber}`);
              errorCount++;
              continue;
            }

            // Process attachments for this quote
            const processedAttachments = attachments && attachments.length > 0 
              ? await processAttachments(attachments)
              : [];

            // Generate PDF for this quote
            const pdfBlob = await generateQuotePDF(quote, {
              company,
              customer: customer!,
            });

            const arrayBuffer = await pdfBlob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            const binaryString = Array.from(uint8Array, byte => String.fromCharCode(byte)).join('');
            const pdfBase64 = btoa(binaryString);

            // Send email for this quote
            const emailAddresses = [customer!.email, ...(customer!.additionalEmails?.filter(e => e.isActive).map(e => e.email) || [])].filter(Boolean);
            
            await apiService.sendQuoteEmail(
              quote.id,
              emailAddresses,
              customText,
              processedAttachments,
              pdfBase64
            );

            // Update quote status if it's draft
            if (quote.status === 'draft') {
              await apiService.updateQuote(quote.id, { status: 'sent' });
            }

            successCount++;
          } catch (error) {
            logger.error(`Error sending email for quote ${quote.quoteNumber}:`, error);
            errorCount++;
          }
        }

        await loadQuotes();
        setSelectedQuoteIds([]);
        
        if (errorCount === 0) {
          notify({ variant: 'success', message: `Alle ${successCount} Angebote erfolgreich per E-Mail versendet!` });
        } else {
          notify({ variant: 'warning', message: `${successCount} Angebote versendet, bei ${errorCount} trat ein Fehler auf.` });
        }
        
        setEmailModal({ isOpen: false, quote: null, customer: null, isBulkMode: false, bulkQuotes: [] });
        return;
      } catch (error) {
        logger.error('Bulk email error:', error);
        notify({ variant: 'error', message: 'Fehler beim Bulk-E-Mail-Versand: ' + (error as Error).message });
        return;
      } finally {
        setIsBulkOperation(false);
      }
    }

    // Single quote mode (existing logic)
    if (!emailModal.customer) return;
    
    try {
      // Collect all email addresses
      const allEmails: string[] = [];
      
      // Add selected emails
      if (selectedEmails && selectedEmails.length > 0) {
        allEmails.push(...selectedEmails);
      }
      
      // Add manual emails
      if (manualEmails && manualEmails.length > 0) {
        allEmails.push(...manualEmails.filter(email => email.trim() !== ''));
      }

      // Process additional attachments (uploaded in modal)
      const processedAttachments = attachments && attachments.length > 0
        ? await processAttachments(attachments)
        : [];

      // Add selected quote attachments to the processed attachments
      if (selectedQuoteAttachmentIds && selectedQuoteAttachmentIds.length > 0 && activeQuote.attachments) {
        const selectedQuoteAttachments = activeQuote.attachments.filter(att =>
          selectedQuoteAttachmentIds.includes(att.id)
        );
        
        for (const storedAttachment of selectedQuoteAttachments) {
          processedAttachments.push({
            name: storedAttachment.name,
            content: storedAttachment.content,
            contentType: storedAttachment.contentType
          });
        }
      }

      // Generate PDF using the same function as preview/download
      const customer = customers.find(c => c.id === activeQuote.customerId);
      if (!customer) {
        throw new Error(`${terminology.entity.singular} nicht gefunden`);
      }

      const pdfBlob = await generateQuotePDF(activeQuote, {
        company,
        customer,
      });

      // Convert blob to base64 for backend
      const arrayBuffer = await pdfBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      const binaryString = Array.from(uint8Array, byte => String.fromCharCode(byte)).join('');
      const pdfBase64 = btoa(binaryString);

      await apiService.sendQuoteEmail(
        activeQuote.id,
        allEmails,
        customText,
        processedAttachments,
        pdfBase64
      );

      // Update quote status to 'sent' if it's currently 'draft'
      if (activeQuote.status === 'draft') {
        await apiService.updateQuote(activeQuote.id, { status: 'sent' });
        await loadQuotes();
      }

      const totalAttachments = processedAttachments.length;
      const attachmentInfo = totalAttachments > 0 
        ? ` mit ${totalAttachments} Anhang${totalAttachments > 1 ? 'en' : ''}`
        : '';
      
      notify({ variant: 'success', message: `Angebot erfolgreich per E-Mail versendet!${attachmentInfo}` });
      setEmailModal({ isOpen: false, quote: null, customer: null });
    } catch (error) {
      logger.error('Error sending quote email:', error);
      notify({ variant: 'error', message: 'Fehler beim E-Mail-Versand: ' + (error as Error).message });
    } finally {
      setIsEmailSending(false);
    }
  };

  const handleEmailModalClose = () => {
    setEmailModal({ isOpen: false, quote: null, customer: null, isBulkMode: false, bulkQuotes: [] });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <PageHeader icon={FileCheck} title="Angebote" subtitle="Verwalten Sie Ihre Angebote">
        <button
          type="button"
          onClick={() => setShowImport(true)}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-primary-custom px-3 text-primary-custom transition hover:bg-primary-light-custom sm:min-w-0 sm:px-4"
          aria-label="Importieren"
          title="Importieren"
        >
          <Upload className="h-4 w-4" />
          <span className="hidden sm:inline">Importieren</span>
        </button>
        <button
          onClick={() => handleOpenEditor()}
          className="btn-primary inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-white transition-all duration-300 hover:scale-105 hover:brightness-90 sm:min-w-0 sm:px-4"
          aria-label="Neues Angebot erstellen"
          title="Neues Angebot erstellen"
        >
          <Plus className="h-5 w-5" />
          <span className="hidden sm:inline">Neues Angebot</span>
        </button>
        </PageHeader>
      </div>

      <ImportWizard
        resource="quotes"
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        onImported={loadQuotes}
      />

      {/* Filters */}
      <ResponsiveFilterBar
        hasActiveFilters={filterStatus !== 'all'}
        search={(
          <div className="relative">
            <Search className="h-5 w-5 absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              placeholder="Angebote suchen..."
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
            <option value="draft">Entwurf</option>
            <option value="sent">Versendet</option>
            <option value="accepted">Akzeptiert</option>
            <option value="rejected">Abgelehnt</option>
            <option value="expired">Abgelaufen</option>
          </FilterSelect>
        )}
      />

      {/* Quote List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <BulkSelectionHeader
          itemLabel="Angebot"
          itemLabelPlural="Angebote"
          visibleCount={filteredQuotes.length}
          selectedCount={selectedQuoteIds.length}
          allSelected={filteredQuotes.length > 0 && filteredQuotes.every(quote => selectedQuoteIds.includes(quote.id))}
          onSelectAll={handleSelectAll}
        >
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-gray-600 sm:inline">Status ändern:</span>
            <select
              onChange={(e) => {
                if (e.target.value) {
                  handleBulkStatusChange(e.target.value as Quote['status']);
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
              <option value="accepted">Akzeptiert</option>
              <option value="rejected">Abgelehnt</option>
              <option value="expired">Abgelaufen</option>
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
            disabled={isBulkOperation || isExporting === 'bulk'}
            className="action-icon-button bulk-action-icon-button action-icon-green disabled:cursor-not-allowed disabled:opacity-50"
            title={isExporting === 'bulk' ? 'Wird heruntergeladen' : 'Herunterladen'}
            aria-label="Herunterladen"
          >
            {isExporting === 'bulk' ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
            ) : (
              <Download className="h-4 w-4" />
            )}
          </button>
        </BulkSelectionHeader>
        {/* Desktop/Tablet Table View */}
        <div ref={tableRef} className="hidden w-full min-w-0 max-w-full overflow-hidden tablet:block">
            <table className="w-full table-fixed">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left w-16">
                  <span className="sr-only">Auswahl</span>
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                  Datum
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-36">
                  Angebotsnummer
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {terminology.entity.singular}
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                  Gültig bis
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                  Betrag
                </th>
                <th
                  className={`py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${showStatusLabel ? 'w-32 px-3' : 'w-8 px-2'}`}
                >
                  <span className={showStatusLabel ? undefined : 'sr-only'}>Status</span>
                </th>
                <th
                  style={{ width: showInlineActions ? QUOTE_TABLE_LAYOUT.actionsColumnWidth : ACTION_MENU_COLUMN_WIDTH }}
                  className={`sticky right-0 z-20 bg-gray-50 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${showInlineActions ? 'px-3' : 'px-2'}`}
                >
                  <span className="sr-only">Aktionen</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredQuotes.map((quote) => (
                <tr
                  key={quote.id}
                  onClick={event => {
                    if ((event.target as HTMLElement).closest('button, a, input, select, label')) return;
                    handlePreview(quote);
                  }}
                  className="group cursor-pointer hover:bg-gray-50"
                  title="Zeile anklicken für die Vorschau"
                >
                  <td className="px-3 py-4 w-16">
                    <input
                      type="checkbox"
                      checked={selectedQuoteIds.includes(quote.id)}
                      onChange={(e) => handleQuoteSelection(quote.id, e.target.checked)}
                      className="custom-checkbox"
                      title="Angebot auswählen"
                    />
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(quote.issueDate, locale, company?.dateFormat)}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {quote.quoteNumber}
                    {/* Gegenrichtung zur Herkunftsangabe an der Rechnung: Hier ist
                        sichtbar, dass aus dem Angebot bereits eine Rechnung wurde. */}
                    {quote.convertedToInvoiceId && (
                      <span className="mt-0.5 block text-xs font-normal text-gray-500">
                        abgerechnet
                      </span>
                    )}
                  </td>
                  <td className="max-w-0 px-3 py-4 text-sm text-gray-900">
                    <span className="block truncate">{quote.customerName}</span>
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(quote.validUntil, locale, company?.dateFormat)}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(quote.total, locale, company?.numberFormat, company?.currency)}
                  </td>
                  <td className={`py-4 whitespace-nowrap ${showStatusLabel ? 'w-32 px-3' : 'w-8 px-2'}`}>
                    {showStatusLabel ? (
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(quote.status)}`}>
                        {getStatusLabel(quote.status)}
                      </span>
                    ) : (
                      <span
                        className={`inline-flex h-2.5 w-2.5 rounded-full ${getStatusDotColor(quote.status)}`}
                        title={getStatusLabel(quote.status)}
                      >
                        <span className="sr-only">{getStatusLabel(quote.status)}</span>
                      </span>
                    )}
                  </td>
                  <td
                    style={{ width: showInlineActions ? QUOTE_TABLE_LAYOUT.actionsColumnWidth : ACTION_MENU_COLUMN_WIDTH }}
                    className={`sticky right-0 z-10 bg-white py-4 whitespace-nowrap text-sm font-medium transition-colors group-hover:bg-gray-50 ${showInlineActions ? 'px-3' : 'px-2'}`}
                  >
                    {showInlineActions ? (
                    <div className="flex flex-nowrap items-center gap-1">
                      {quote.status === 'draft' && (
                        <button
                          type="button"
                          className="action-icon-button action-icon-blue"
                          title="Per E-Mail versenden"
                          onClick={() => handleSendEmail(quote)}
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      )}
                      {quote.status === 'sent' && (
                        <>
                          <button
                            type="button"
                            className="action-icon-button action-icon-green"
                            title="Als akzeptiert markieren"
                            onClick={() => handleStatusChange(quote.id, 'accepted')}
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="action-icon-button action-icon-red"
                            title="Als abgelehnt markieren"
                            onClick={() => handleStatusChange(quote.id, 'rejected')}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </>
                      )}
                      {quote.status === 'accepted' && !quote.convertedToInvoiceId && (
                        <button
                          type="button"
                          className="action-icon-button action-icon-blue"
                          title="In Rechnung umwandeln"
                          onClick={() => handleConvertToInvoice(quote)}
                        >
                          <FileCheck className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleOpenEditor(quote)}
                        className="action-icon-button action-icon-indigo"
                        title="Bearbeiten"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePreview(quote)}
                        className="action-icon-button action-icon-blue"
                        title="Vorschau anzeigen"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button 
                        type="button"
                        onClick={() => handleDownloadPDF(quote)}
                        disabled={isExporting === quote.id}
                        className="action-icon-button action-icon-green"
                        title="Herunterladen"
                      >
                        {isExporting === quote.id ? (
                          <div className="animate-spin h-4 w-4 border-2 border-green-600 border-t-transparent rounded-full"></div>
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(quote)}
                        className="action-icon-button action-icon-red"
                        title="Löschen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    ) : (
                    <ActionMenu triggerClassName="action-icon-button action-icon-blue">
                        {quote.status === 'draft' && <ActionMenuItem icon={<Send className="h-4 w-4" />} tone="blue" onClick={() => handleSendEmail(quote)}>Per E-Mail versenden</ActionMenuItem>}
                        {quote.status === 'sent' && <>
                          <ActionMenuItem icon={<CheckCircle className="h-4 w-4" />} tone="green" onClick={() => handleStatusChange(quote.id, 'accepted')}>Als akzeptiert markieren</ActionMenuItem>
                          <ActionMenuItem icon={<X className="h-4 w-4" />} tone="orange" onClick={() => handleStatusChange(quote.id, 'rejected')}>Als abgelehnt markieren</ActionMenuItem>
                        </>}
                        {quote.status === 'accepted' && !quote.convertedToInvoiceId && <ActionMenuItem icon={<FileCheck className="h-4 w-4" />} tone="blue" onClick={() => handleConvertToInvoice(quote)}>In Rechnung umwandeln</ActionMenuItem>}
                        <ActionMenuItem icon={<Edit className="h-4 w-4" />} tone="indigo" onClick={() => handleOpenEditor(quote)}>Bearbeiten</ActionMenuItem>
                        <ActionMenuItem icon={<Eye className="h-4 w-4" />} tone="green" onClick={() => handlePreview(quote)}>Vorschau anzeigen</ActionMenuItem>
                        <ActionMenuItem icon={<Download className="h-4 w-4" />} tone="blue" onClick={() => handleDownloadPDF(quote)} disabled={isExporting === quote.id}>Herunterladen</ActionMenuItem>
                        <ActionMenuItem icon={<Trash2 className="h-4 w-4" />} tone="red" onClick={() => handleDelete(quote)}>Löschen</ActionMenuItem>
                    </ActionMenu>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
        </div>

        {/* Mobile Card View */}
        <div className="tablet:hidden">
          {filteredQuotes.map((quote) => (
            <div key={quote.id} className="p-4 border-b border-gray-200 last:border-b-0">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedQuoteIds.includes(quote.id)}
                  onChange={(e) => handleQuoteSelection(quote.id, e.target.checked)}
                  className="custom-checkbox mt-1 shrink-0"
                  title="Angebot auswählen"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 truncate text-sm font-medium text-gray-900">{quote.quoteNumber}</h3>
                    <p className="shrink-0 whitespace-nowrap text-sm font-medium text-gray-900">
                      {formatCurrency(quote.total, locale, company?.numberFormat, company?.currency)}
                    </p>
                  </div>
                  <p className="mt-1 truncate text-sm text-gray-600">{quote.customerName}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                    <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${getStatusColor(quote.status)}`}>
                      {getStatusLabel(quote.status)}
                    </span>
                    <span>{formatDate(quote.issueDate, locale, company?.dateFormat)}</span>
                    <span>Gültig bis: {formatDate(quote.validUntil, locale, company?.dateFormat)}</span>
                  </div>
                </div>

                <ActionMenu containerClassName="shrink-0" triggerClassName="action-icon-button action-icon-blue">
                  <div className="flex flex-col gap-0.5">
                    {quote.status === 'draft' && (
                      <ActionMenuItem icon={<Send className="h-4 w-4" />} tone="blue" onClick={() => handleSendEmail(quote)}>Per E-Mail versenden</ActionMenuItem>
                    )}
                    {quote.status === 'sent' && (
                      <>
                        <ActionMenuItem icon={<CheckCircle className="h-4 w-4" />} tone="green" onClick={() => handleStatusChange(quote.id, 'accepted')}>Als akzeptiert markieren</ActionMenuItem>
                        <ActionMenuItem icon={<X className="h-4 w-4" />} tone="orange" onClick={() => handleStatusChange(quote.id, 'rejected')}>Als abgelehnt markieren</ActionMenuItem>
                      </>
                    )}
                    {quote.status === 'accepted' && !quote.convertedToInvoiceId && (
                      <ActionMenuItem icon={<FileCheck className="h-4 w-4" />} tone="blue" onClick={() => handleConvertToInvoice(quote)}>In Rechnung umwandeln</ActionMenuItem>
                    )}

                    <>
                      <ActionMenuItem icon={<Edit className="h-4 w-4" />} tone="indigo" onClick={() => handleOpenEditor(quote)}>Bearbeiten</ActionMenuItem>
                      <ActionMenuItem icon={<Eye className="h-4 w-4" />} tone="green" onClick={() => handlePreview(quote)}>Vorschau anzeigen</ActionMenuItem>
                      <ActionMenuItem icon={<Download className="h-4 w-4" />} tone="blue" onClick={() => handleDownloadPDF(quote)} disabled={isExporting === quote.id}>Herunterladen</ActionMenuItem>
                      <ActionMenuItem icon={<Trash2 className="h-4 w-4" />} tone="red" onClick={() => handleDelete(quote)}>Löschen</ActionMenuItem>
                    </>
                  </div>
                </ActionMenu>
              </div>
            </div>
          ))}
        </div>

        {filteredQuotes.length > 0 && (
          <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 text-right text-xs text-gray-500">
            {filteredQuotes.length} {filteredQuotes.length === 1 ? 'Angebot' : 'Angebote'}
          </div>
        )}

        {filteredQuotes.length === 0 && (
          <div className="text-center py-8">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">Keine Angebote gefunden</p>
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

      {/* Email Modal */}
      {emailModal.isOpen && emailModal.quote && (emailModal.customer || emailModal.isBulkMode) && (
        <EmailSendModal
          isOpen={emailModal.isOpen}
          onClose={handleEmailModalClose}
          onSend={handleEmailSend}
          document={emailModal.quote}
          documentType="quote"
          customer={emailModal.customer || { email: '', additionalEmails: [] }}
          isLoading={isEmailSending}
          isBulkMode={emailModal.isBulkMode}
          bulkCount={emailModal.bulkQuotes?.length || 0}
        />
      )}

      {/* Document Preview Modal */}
      {showPreview && (
        <DocumentPreview
          isOpen={showPreview}
          onClose={handleClosePreview}
          documents={previewDocuments}
          initialIndex={0}
          onEdit={handlePreviewEdit}
          onReject={handlePreviewReject}
        />
      )}
    </div>
  );
}
