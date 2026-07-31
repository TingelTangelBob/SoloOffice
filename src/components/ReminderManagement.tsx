import React, { useState, useEffect } from 'react';
import { Bell, Send, Clock, AlertCircle, Download, Eye, MoreVertical } from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useCompany } from '../context/CompanyContext';
import { apiService } from '../services/api';
import { ReminderEligibility, Invoice, Customer } from '../types';
import logger from '../utils/logger';
import { formatCurrency } from '../utils/formatters';
import { generateReminderPDF } from '../utils/pdfGenerator';
import { ReminderSendModal } from './ReminderSendModal';
import { blobToBase64 } from '../utils/blobUtils';
import { DocumentPreview, PreviewDocument } from './DocumentPreview';
import { PageHeader } from './PageHeader';

export function ReminderManagement() {
  const { customers } = useCustomers();
  const { invoices, refreshInvoices } = useInvoices();
  const { company } = useCompany();
  const [activeTab, setActiveTab] = useState<'eligible' | 'history' | 'hardship'>('eligible');
  const [eligibleReminders, setEligibleReminders] = useState<ReminderEligibility[]>([]);
  const [reminderHistory, setReminderHistory] = useState<Invoice[]>([]);
  const [hardshipCases, setHardshipCases] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [reminderModal, setReminderModal] = useState<{
    isOpen: boolean;
    invoice: Invoice | null;
    stage: 1 | 2 | 3;
    isBulk: boolean;
    bulkInvoices: Invoice[];
  }>({
    isOpen: false,
    invoice: null,
    stage: 1,
    isBulk: false,
    bulkInvoices: []
  });
  const [previewModal, setPreviewModal] = useState<{
    isOpen: boolean;
    documents: PreviewDocument[];
  }>({
    isOpen: false,
    documents: []
  });

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      if (activeTab === 'eligible') {
        const data = await apiService.getEligibleReminders();
        setEligibleReminders(data);
      } else if (activeTab === 'history') {
        const data = await apiService.getReminderHistory();
        setReminderHistory(data);
      } else if (activeTab === 'hardship') {
        // Load invoices with status 'reminded_3x' that are still unpaid
        const data = await apiService.getReminderHistory();
        const hardship = data.filter(inv => inv.status === 'reminded_3x');
        setHardshipCases(hardship);
      }
    } catch (error) {
      logger.error('Error loading reminder data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendReminder = async (invoiceId: string, stage: number) => {
    try {
      const invoice = invoices.find(inv => inv.id === invoiceId);
      if (!invoice) {
        logger.error('Invoice not found:', invoiceId);
        return;
      }

      setReminderModal({
        isOpen: true,
        invoice,
        stage: stage as 1 | 2 | 3,
        isBulk: false,
        bulkInvoices: []
      });
    } catch (error) {
      logger.error('Error opening reminder modal:', error);
    }
  };

  const handleReminderModalClose = () => {
    setReminderModal({
      isOpen: false,
      invoice: null,
      stage: 1,
      isBulk: false,
      bulkInvoices: []
    });
  };

  const handleReminderSuccess = async () => {
    await refreshInvoices();
    await loadData();
  };

  const getReminderStageFromStatus = (status: Invoice['status']): 1 | 2 | 3 | null => {
    if (status === 'reminded_1x') return 1;
    if (status === 'reminded_2x') return 2;
    if (status === 'reminded_3x') return 3;
    return null;
  };

  const handleDownloadReminder = async (invoice: Invoice, stage: 1 | 2 | 3) => {
    try {
      const customer = customers.find(c => c.id === invoice.customerId);
      if (!customer) {
        logger.error('Customer not found for invoice:', invoice.customerId);
        return;
      }

      // Get reminder text and fee from company settings for the specific stage
      const reminderText = stage === 1 ? company.reminderTextStage1 :
                          stage === 2 ? company.reminderTextStage2 :
                          company.reminderTextStage3;
      const fee = stage === 1 ? company.reminderFeeStage1 :
                  stage === 2 ? company.reminderFeeStage2 :
                  company.reminderFeeStage3;

      // Generate PDF
      const pdfBlob = await generateReminderPDF(
        invoice,
        stage,
        reminderText || '',
        fee || 0,
        { format: 'zugferd', company, customer }
      );

      // Download
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Mahnung-${stage}-${invoice.invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      logger.error('Error downloading reminder:', error);
    }
  };

  const handlePreviewReminder = async (invoice: Invoice, stage: 1 | 2 | 3) => {
    try {
      const customer = customers.find(c => c.id === invoice.customerId);
      if (!customer) {
        logger.error('Customer not found for invoice:', invoice.customerId);
        return;
      }

      // Get reminder text and fee from company settings for the specific stage
      const reminderText = stage === 1 ? company.reminderTextStage1 :
                          stage === 2 ? company.reminderTextStage2 :
                          company.reminderTextStage3;
      const fee = stage === 1 ? company.reminderFeeStage1 :
                  stage === 2 ? company.reminderFeeStage2 :
                  company.reminderFeeStage3;

      // Generate PDF
      const pdfBlob = await generateReminderPDF(
        invoice,
        stage,
        reminderText || '',
        fee || 0,
        { format: 'zugferd', company, customer }
      );

      // Convert to base64 for preview
      const base64 = await blobToBase64(pdfBlob);

      const previewDoc: PreviewDocument = {
        id: `reminder-${invoice.id}-${stage}`,
        name: `${stage}. Mahnung - ${invoice.invoiceNumber}.pdf`,
        type: 'attachment',
        content: base64,
        contentType: 'application/pdf',
        size: pdfBlob.size
      };

      setPreviewModal({
        isOpen: true,
        documents: [previewDoc]
      });
    } catch (error) {
      logger.error('Error previewing reminder:', error);
    }
  };

  const handleClosePreview = () => {
    setPreviewModal({
      isOpen: false,
      documents: []
    });
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('de-DE');
  };

  const getStatusBadge = (status: Invoice['status']) => {
    const statusConfig: Record<Invoice['status'], { label: string; color: string }> = {
      draft: { label: 'Entwurf', color: 'bg-gray-100 text-gray-800' },
      sent: { label: 'Versendet', color: 'bg-blue-100 text-blue-800' },
      paid: { label: 'Bezahlt', color: 'bg-green-100 text-green-800' },
      overdue: { label: 'Überfällig', color: 'bg-red-100 text-red-800' },
      reminded_1x: { label: '1x gemahnt', color: 'bg-orange-100 text-orange-800' },
      reminded_2x: { label: '2x gemahnt', color: 'bg-orange-200 text-orange-900' },
      reminded_3x: { label: '3x gemahnt', color: 'bg-red-200 text-red-900' }
    };

    const config = statusConfig[status] || statusConfig.draft;
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
        {config.label}
      </span>
    );
  };

  const getStageBadge = (stage: number) => {
    const colors = ['bg-yellow-100 text-yellow-800', 'bg-orange-100 text-orange-800', 'bg-red-100 text-red-800'];
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[stage - 1] || colors[0]}`}>
        {stage}. Mahnung
      </span>
    );
  };

  const handleSelectInvoice = (invoiceId: string) => {
    setSelectedInvoiceIds(prev =>
      prev.includes(invoiceId)
        ? prev.filter(id => id !== invoiceId)
        : [...prev, invoiceId]
    );
  };

  const handleSelectAll = () => {
    if (selectedInvoiceIds.length === eligibleReminders.filter(r => r.isEligible).length) {
      setSelectedInvoiceIds([]);
    } else {
      setSelectedInvoiceIds(eligibleReminders.filter(r => r.isEligible).map(r => r.invoiceId));
    }
  };

  const handleBulkSendReminders = async () => {
    if (selectedInvoiceIds.length === 0) return;

    try {
      // Get all selected invoices
      const bulkInvoices = invoices.filter(inv => selectedInvoiceIds.includes(inv.id));
      
      if (bulkInvoices.length === 0) {
        logger.error('No valid invoices found for bulk reminder');
        return;
      }

      // For bulk, we use the first invoice as the "primary" for the modal
      // but pass all invoices in bulkInvoices
      const firstInvoice = bulkInvoices[0];
      const firstReminder = eligibleReminders.find(r => r.invoiceId === firstInvoice.id);
      
      if (!firstReminder) {
        logger.error('Reminder eligibility not found for first invoice');
        return;
      }

      setReminderModal({
        isOpen: true,
        invoice: firstInvoice,
        stage: firstReminder.nextStage,
        isBulk: true,
        bulkInvoices: bulkInvoices
      });
    } catch (error) {
      logger.error('Error opening bulk reminder modal:', error);
    }
  };

  const customer = reminderModal.invoice 
    ? customers.find(c => c.id === reminderModal.invoice!.customerId)
    : null;

  return (
    <div className="space-y-8">
      {/* Reminder Send Modal */}
      {reminderModal.isOpen && reminderModal.invoice && customer && (
        <ReminderSendModal
          isOpen={reminderModal.isOpen}
          onClose={handleReminderModalClose}
          invoice={reminderModal.invoice}
          customer={customer}
          stage={reminderModal.stage}
          onSuccess={handleReminderSuccess}
          isBulkMode={reminderModal.isBulk}
          bulkInvoices={reminderModal.bulkInvoices}
        />
      )}

      {/* Preview Modal */}
      <DocumentPreview
        isOpen={previewModal.isOpen}
        onClose={handleClosePreview}
        documents={previewModal.documents}
        initialIndex={0}
      />

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          icon={Bell}
          title="Mahnungen"
          subtitle="Verwalten Sie Ihre Zahlungserinnerungen und Mahnungen"
        />
      </div>

      {/* Configuration Warning */}
      {!company.remindersEnabled && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <div className="flex items-start">
            <AlertCircle className="h-5 w-5 text-yellow-600 mr-3 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-yellow-800">Mahnwesen nicht aktiviert</h3>
              <p className="text-sm text-yellow-700 mt-1">
                Das Mahnwesen ist derzeit nicht aktiviert. Bitte aktivieren Sie es in den Einstellungen.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6">
        <div className="border-b border-gray-200">
          <div className="flex space-x-4 px-4 lg:px-6 overflow-x-auto">
            <button
              onClick={() => setActiveTab('eligible')}
              className={`py-4 px-2 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${
                activeTab === 'eligible'
                  ? 'border-primary-custom text-primary-custom'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Zu mahnende Rechnungen
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`py-4 px-2 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${
                activeTab === 'history'
                  ? 'border-primary-custom text-primary-custom'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Mahnhistorie
            </button>
            <button
              onClick={() => setActiveTab('hardship')}
              className={`py-4 px-2 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${
                activeTab === 'hardship'
                  ? 'border-primary-custom text-primary-custom'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span className="flex items-center">
                Härtefälle
                {hardshipCases.length > 0 && (
                  <span className="ml-2 bg-red-100 text-red-800 text-xs font-semibold px-2 py-0.5 rounded-full">
                    {hardshipCases.length}
                  </span>
                )}
              </span>
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-4 lg:p-6">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-custom mx-auto"></div>
              <p className="text-gray-600 mt-4">Lade Daten...</p>
            </div>
          ) : activeTab === 'eligible' ? (
            <EligibleRemindersTab
              reminders={eligibleReminders}
              selectedIds={selectedInvoiceIds}
              onSelect={handleSelectInvoice}
              onSelectAll={handleSelectAll}
              onSendReminder={handleSendReminder}
              onSendBulk={handleBulkSendReminders}
              onRefresh={loadData}
            />
          ) : activeTab === 'history' ? (
            <ReminderHistoryTab
              invoices={reminderHistory}
              formatDate={formatDate}
              getStatusBadge={getStatusBadge}
              onDownloadReminder={handleDownloadReminder}
              onPreviewReminder={handlePreviewReminder}
            />
          ) : (
            <HardshipCasesTab
              invoices={hardshipCases}
              formatDate={formatDate}
              getStatusBadge={getStatusBadge}
              onDownloadReminder={handleDownloadReminder}
              onPreviewReminder={handlePreviewReminder}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Eligible Reminders Tab Component
interface EligibleRemindersTabProps {
  reminders: ReminderEligibility[];
  selectedIds: string[];
  onSelect: (id: string) => void;
  onSelectAll: () => void;
  onSendReminder: (invoiceId: string, stage: number) => void;
  onSendBulk: () => void;
  onRefresh: () => void;
}

function EligibleRemindersTab({
  reminders,
  selectedIds,
  onSelect,
  onSelectAll,
  onSendReminder,
  onSendBulk,
  onRefresh
}: EligibleRemindersTabProps) {
  if (reminders.length === 0) {
    return (
      <div className="text-center py-12">
        <Bell className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-600">Keine Rechnungen zur Mahnung verfügbar</p>
      </div>
    );
  }

  const eligibleCount = reminders.filter(r => r.isEligible).length;

  return (
    <div>
      {/* Bulk Actions */}
      {eligibleCount > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={selectedIds.length === eligibleCount && eligibleCount > 0}
                onChange={onSelectAll}
                className="custom-checkbox"
              />
              <span className="ml-2 text-sm text-gray-700">
                Alle auswählen ({eligibleCount})
              </span>
            </label>
            {selectedIds.length > 0 && (
              <span className="text-sm text-gray-600">
                {selectedIds.length} ausgewählt
              </span>
            )}
          </div>
          {selectedIds.length > 0 && (
            <button
              onClick={onSendBulk}
              className="px-4 py-2 bg-primary-custom text-white rounded-lg hover:bg-primary-dark transition-colors flex items-center"
            >
              <Send className="h-4 w-4 mr-2" />
              Ausgewählte mahnen ({selectedIds.length})
            </button>
          )}
        </div>
      )}

      {/* Reminders Table */}
      <div className="w-full max-w-full overflow-x-auto">
        <table className="w-full min-w-[820px] divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Auswahl
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Rechnungsnr.
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Kunde
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Fälligkeitsdatum
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Tage überfällig
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Betrag
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Nächste Mahnung
              </th>
              <th className="w-14 px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider 2xl:w-20 2xl:px-3">
                <span className="sr-only">Aktionen</span>
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {reminders.map((reminder) => (
              <tr key={reminder.invoiceId} className={!reminder.isEligible ? 'bg-gray-50' : ''}>
                <td className="px-2 py-3 whitespace-nowrap">
                  {reminder.isEligible && (
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(reminder.invoiceId)}
                      onChange={() => onSelect(reminder.invoiceId)}
                      className="custom-checkbox"
                    />
                  )}
                </td>
                <td className="px-2 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                  {reminder.invoiceNumber}
                </td>
                <td className="px-2 py-3 whitespace-nowrap text-sm text-gray-900">
                  {reminder.customerName}
                </td>
                <td className="px-2 py-3 whitespace-nowrap text-sm text-gray-500">
                  {new Date(reminder.dueDate).toLocaleDateString('de-DE')}
                </td>
                <td className="px-2 py-3 whitespace-nowrap text-sm text-gray-900">
                  {reminder.daysSinceDue} Tage
                </td>
                <td className="px-2 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                  {formatCurrency(reminder.total)}
                </td>
                <td className="px-2 py-3 whitespace-nowrap">
                  {getStatusBadgeForReminder(reminder.currentStatus)}
                </td>
                <td className="px-2 py-3 whitespace-nowrap">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    reminder.nextStage === 1 ? 'bg-yellow-100 text-yellow-800' :
                    reminder.nextStage === 2 ? 'bg-orange-100 text-orange-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {reminder.nextStage}. Mahnung
                  </span>
                  {!reminder.isEligible && reminder.nextEligibleDate && (
                    <div className="text-xs text-gray-500 mt-1">
                      ab {new Date(reminder.nextEligibleDate).toLocaleDateString('de-DE')}
                    </div>
                  )}
                </td>
                <td className="w-14 px-2 py-3 whitespace-nowrap text-sm 2xl:w-20 2xl:px-3">
                  <details className="relative 2xl:hidden">
                    <summary className="action-icon-button action-icon-indigo list-none cursor-pointer" aria-label="Aktionen" title="Aktionen">
                      <MoreVertical className="h-4 w-4" />
                    </summary>
                    <div className="absolute right-0 top-9 z-20 min-w-40 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
                      <button
                        type="button"
                        onClick={() => onSendReminder(reminder.invoiceId, reminder.nextStage)}
                        disabled={!reminder.isEligible}
                        className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                      >
                        Mahnung senden
                      </button>
                    </div>
                  </details>
                  <button
                    type="button"
                    onClick={() => onSendReminder(reminder.invoiceId, reminder.nextStage)}
                    disabled={!reminder.isEligible}
                    title="Mahnung senden"
                    className={`hidden 2xl:inline-flex action-icon-button ${
                      reminder.isEligible
                        ? 'action-icon-blue'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Reminder History Tab Component
interface ReminderHistoryTabProps {
  invoices: Invoice[];
  formatDate: (date: Date | string) => string;
  getStatusBadge: (status: Invoice['status']) => React.ReactNode;
  onDownloadReminder: (invoice: Invoice, stage: 1 | 2 | 3) => void;
  onPreviewReminder: (invoice: Invoice, stage: 1 | 2 | 3) => void;
}

function ReminderHistoryTab({ invoices, formatDate, getStatusBadge, onDownloadReminder, onPreviewReminder }: ReminderHistoryTabProps) {
  if (invoices.length === 0) {
    return (
      <div className="text-center py-12">
        <Clock className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-600">Keine Mahnhistorie vorhanden</p>
      </div>
    );
  }

  const getMaxReminderStage = (invoice: Invoice): 1 | 2 | 3 | null => {
    // Use maxReminderStage field which persists even after payment
    const maxStage = invoice.maxReminderStage || 0;
    if (maxStage >= 1 && maxStage <= 3) {
      return maxStage as 1 | 2 | 3;
    }
    
    // Fallback to status-based detection (for backward compatibility)
    if (invoice.status === 'reminded_1x') return 1;
    if (invoice.status === 'reminded_2x') return 2;
    if (invoice.status === 'reminded_3x') return 3;
    return null;
  };

  const getAllReminderStages = (invoice: Invoice): (1 | 2 | 3)[] => {
    const maxStage = getMaxReminderStage(invoice);
    if (!maxStage) return [];
    
    // Return all stages up to the maximum stage reached
    const stages: (1 | 2 | 3)[] = [];
    for (let i = 1; i <= maxStage; i++) {
      stages.push(i as 1 | 2 | 3);
    }
    return stages;
  };

  return (
    <div className="space-y-6">
      {invoices.map((invoice) => {
        const maxStage = getMaxReminderStage(invoice);
        const allStages = getAllReminderStages(invoice);
        
        return (
          <div key={invoice.id} className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{invoice.invoiceNumber}</h3>
                <p className="text-sm text-gray-600">{invoice.customerName}</p>
              </div>
              <div className="text-right">
                {getStatusBadge(invoice.status)}
                <p className="text-sm text-gray-600 mt-1">{formatCurrency(invoice.total)}</p>
              </div>
            </div>

            {/* Timeline */}
            <div className="space-y-3 mb-4">
              <div className="flex items-center">
                <div className="flex-shrink-0 w-24 text-sm text-gray-500">
                  Fällig am:
                </div>
                <div className="flex items-center">
                  <div className="h-2 w-2 bg-gray-300 rounded-full mr-2"></div>
                  <span className="text-sm text-gray-700">{formatDate(invoice.dueDate)}</span>
                </div>
              </div>

              {invoice.lastReminderDate && (
                <div className="flex items-center">
                  <div className="flex-shrink-0 w-24 text-sm text-gray-500">
                    Letzte Mahnung:
                  </div>
                  <div className="flex items-center">
                    <div className={`h-2 w-2 rounded-full mr-2 ${
                      invoice.status === 'reminded_1x' ? 'bg-yellow-500' :
                      invoice.status === 'reminded_2x' ? 'bg-orange-500' :
                      'bg-red-500'
                    }`}></div>
                    <span className="text-sm text-gray-700">{formatDate(invoice.lastReminderDate)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons - Show all reminder stages */}
            {allStages.length > 0 && (
              <div className="pt-3 border-t border-gray-200">
                <p className="text-xs text-gray-500 mb-2">Mahnung erneut anzeigen/herunterladen:</p>
                <div className="flex flex-wrap gap-2">
                  {allStages.map((stage) => (
                    <div key={stage} className="flex items-center space-x-1">
                      <button
                        type="button"
                        onClick={() => onPreviewReminder(invoice, stage)}
                        className="action-icon-button action-icon-blue"
                        title={`${stage}. Mahnung anzeigen`}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        {stage}. Mahnung
                      </button>
                      <button
                        type="button"
                        onClick={() => onDownloadReminder(invoice, stage)}
                        className="action-icon-button action-icon-green"
                        title={`${stage}. Mahnung herunterladen`}
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Hardship Cases Tab Component
interface HardshipCasesTabProps {
  invoices: Invoice[];
  formatDate: (date: Date | string) => string;
  getStatusBadge: (status: Invoice['status']) => React.ReactNode;
  onDownloadReminder: (invoice: Invoice, stage: 1 | 2 | 3) => void;
  onPreviewReminder: (invoice: Invoice, stage: 1 | 2 | 3) => void;
}

function HardshipCasesTab({ invoices, formatDate, getStatusBadge, onDownloadReminder, onPreviewReminder }: HardshipCasesTabProps) {
  const { company } = useCompany();
  
  // Calculate total amount including all reminder fees
  const calculateTotalWithReminderFees = (invoice: Invoice): number => {
    let totalAmount = invoice.total;
    
    // Get the maximum reminder stage reached
    const maxStage = invoice.maxReminderStage || 0;
    
    // Add cumulative reminder fees
    if (maxStage >= 1 && company.reminderFeeStage1) {
      totalAmount += company.reminderFeeStage1;
    }
    if (maxStage >= 2 && company.reminderFeeStage2) {
      totalAmount += company.reminderFeeStage2;
    }
    if (maxStage >= 3 && company.reminderFeeStage3) {
      totalAmount += company.reminderFeeStage3;
    }
    
    return totalAmount;
  };
  
  if (invoices.length === 0) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="h-16 w-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Keine Härtefälle</h3>
        <p className="text-gray-600">
          Es gibt derzeit keine Rechnungen, die als Härtefälle eingestuft sind.
        </p>
        <p className="text-sm text-gray-500 mt-2">
          (Rechnungen mit 3x Mahnung und noch nicht bezahlt)
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Warning Header */}
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-start">
          <AlertCircle className="h-5 w-5 text-red-600 mr-3 mt-0.5" />
          <div>
            <h3 className="text-sm font-medium text-red-800">Härtefälle - Weitere Schritte erforderlich</h3>
            <p className="text-sm text-red-700 mt-1">
              Diese Rechnungen wurden bereits 3x gemahnt und sind noch immer unbezahlt. Bitte erwägen Sie weitere rechtliche Schritte oder ein persönliches Gespräch mit dem Kunden.
            </p>
          </div>
        </div>
      </div>

      {/* Hardship Cases List */}
      {invoices.map((invoice) => {
        const daysSinceDue = Math.floor((new Date().getTime() - new Date(invoice.dueDate).getTime()) / (1000 * 3600 * 24));
        const daysSinceLastReminder = invoice.lastReminderDate 
          ? Math.floor((new Date().getTime() - new Date(invoice.lastReminderDate).getTime()) / (1000 * 3600 * 24))
          : null;
        const totalWithFees = calculateTotalWithReminderFees(invoice);
        
        return (
          <div key={invoice.id} className="bg-white border-2 border-red-200 rounded-lg p-4 hover:shadow-lg transition-shadow">
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="flex items-center space-x-3 mb-2">
                  <h3 className="text-lg font-semibold text-gray-900">{invoice.invoiceNumber}</h3>
                  {getStatusBadge(invoice.status)}
                </div>
                <p className="text-sm text-gray-600">{invoice.customerName}</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold text-red-600">{formatCurrency(totalWithFees)}</p>
                <p className="text-xs text-gray-500 mt-1">Offener Betrag (inkl. Mahngebühren)</p>
                {totalWithFees !== invoice.total && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Rechnung: {formatCurrency(invoice.total)} + Gebühren: {formatCurrency(totalWithFees - invoice.total)}
                  </p>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-gray-50 rounded-lg mb-3">
              <div>
                <p className="text-xs text-gray-500">Fälligkeitsdatum</p>
                <p className="text-sm font-medium text-gray-900">{formatDate(invoice.dueDate)}</p>
                <p className="text-xs text-red-600 font-medium mt-0.5">vor {daysSinceDue} Tagen</p>
              </div>
              {invoice.lastReminderDate && (
                <div>
                  <p className="text-xs text-gray-500">Letzte Mahnung</p>
                  <p className="text-sm font-medium text-gray-900">{formatDate(invoice.lastReminderDate)}</p>
                  {daysSinceLastReminder !== null && (
                    <p className="text-xs text-gray-600 mt-0.5">vor {daysSinceLastReminder} Tagen</p>
                  )}
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500">Ausstellungsdatum</p>
                <p className="text-sm font-medium text-gray-900">{formatDate(invoice.issueDate)}</p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-3 border-t border-gray-200">
              <p className="text-xs text-gray-500 mb-2">Alle Mahnungen anzeigen/herunterladen:</p>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3].map((stage) => (
                  <div key={stage} className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => onPreviewReminder(invoice, stage as 1 | 2 | 3)}
                      className="action-icon-button action-icon-blue"
                      title={`${stage}. Mahnung anzeigen`}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      {stage}. Mahnung
                    </button>
                    <button
                      type="button"
                      onClick={() => onDownloadReminder(invoice, stage as 1 | 2 | 3)}
                      className="action-icon-button action-icon-green"
                      title={`${stage}. Mahnung herunterladen`}
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Recommendation */}
            <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-xs font-medium text-yellow-800">Empfohlene nächste Schritte:</p>
              <ul className="text-xs text-yellow-700 mt-1 list-disc list-inside space-y-1">
                <li>Persönlicher Kontakt mit dem Kunden aufnehmen</li>
                <li>Ratenzahlungsvereinbarung anbieten</li>
                <li>Inkassobüro oder Rechtsanwalt einschalten</li>
                <li>Gerichtliches Mahnverfahren einleiten</li>
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Helper function for status badge
function getStatusBadgeForReminder(status: Invoice['status']) {
  const statusConfig: Record<Invoice['status'], { label: string; color: string }> = {
    draft: { label: 'Entwurf', color: 'bg-gray-100 text-gray-800' },
    sent: { label: 'Versendet', color: 'bg-blue-100 text-blue-800' },
    paid: { label: 'Bezahlt', color: 'bg-green-100 text-green-800' },
    overdue: { label: 'Überfällig', color: 'bg-red-100 text-red-800' },
    reminded_1x: { label: '1x gemahnt', color: 'bg-orange-100 text-orange-800' },
    reminded_2x: { label: '2x gemahnt', color: 'bg-orange-200 text-orange-900' },
    reminded_3x: { label: '3x gemahnt', color: 'bg-red-200 text-red-900' }
  };

  const config = statusConfig[status] || statusConfig.draft;
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
      {config.label}
    </span>
  );
}

