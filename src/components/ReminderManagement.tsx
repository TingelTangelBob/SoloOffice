import { SwitchTrack } from './ToggleSwitch';
import React, { useState, useEffect, useCallback } from 'react';
import { Bell, Send, Clock, AlertCircle, Download, Eye, History, Info, ShieldAlert, Save, Settings as SettingsIcon } from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useCompany } from '../context/CompanyContext';
import { apiService } from '../services/api';
import { ReminderEligibility, Invoice, Company } from '../types';
import logger from '../utils/logger';
import { formatCurrency, formatDate as formatDateValue, getCurrencySymbol } from '../utils/formatters';
import { generateReminderPDF } from '../utils/pdfLazy';
import { ReminderSendModal } from './ReminderSendModal';
import { blobToBase64 } from '../utils/blobUtils';
import { DocumentPreview } from './DocumentPreview';
import type { PreviewDocument } from '../utils/previewDocuments';
import { PageHeader } from './PageHeader';
import { BulkSelectionHeader } from './BulkSelectionHeader';
import { getTerminology } from '../utils/terminology';
import { ThemeTabBar } from './ThemeTabBar';
import { LocalizedNumberInput } from './LocalizedNumberInput';
import { useFeedback } from '../context/FeedbackContext';
import { actionErrorMessage } from '../utils/actionError';
import { useAuth } from '../context/AuthContext';
import { SortableTableHeader } from './SortableTableHeader';
import { compareTableValues, sortByTableState, type SortState } from '../utils/tableSort';
import { TableSkeleton } from './TableSkeleton';
import { statusBadgeClass, statusLabel } from '../utils/statusDisplay';
import { DEFAULT_BASE_INTEREST_RATE } from '../../backend/shared/reminderClaim.js';
import { reminderClaimFor } from '../utils/reminderClaimView';
import { describeInterest } from '../../backend/shared/reminderClaim.js';

export function ReminderManagement({ initialTab }: { initialTab?: 'eligible' | 'history' | 'hardship' | 'settings' } = {}) {
  const { customers } = useCustomers();
  const { invoices, refreshInvoices } = useInvoices();
  const { company, updateCompany } = useCompany();
  const { notify } = useFeedback();
  const [activeTab, setActiveTab] = useState<'eligible' | 'history' | 'hardship' | 'settings'>(initialTab ?? 'eligible');
  const [settingsForm, setSettingsForm] = useState({
    remindersEnabled: company.remindersEnabled || false,
    reminderDaysAfterDue: company.reminderDaysAfterDue ?? 7,
    reminderDaysBetween: company.reminderDaysBetween ?? 7,
    reminderFeeStage1: company.reminderFeeStage1 ?? 0,
    reminderFeeStage2: company.reminderFeeStage2 ?? 0,
    reminderFeeStage3: company.reminderFeeStage3 ?? 0,
    reminderInterestEnabled: company.reminderInterestEnabled === true,
    reminderBaseInterestRate: company.reminderBaseInterestRate ?? DEFAULT_BASE_INTEREST_RATE,
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [eligibleReminders, setEligibleReminders] = useState<ReminderEligibility[]>([]);
  const [reminderHistory, setReminderHistory] = useState<Invoice[]>([]);
  const [hardshipCases, setHardshipCases] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
    setSettingsForm({
      remindersEnabled: company.remindersEnabled || false,
      reminderDaysAfterDue: company.reminderDaysAfterDue ?? 7,
      reminderDaysBetween: company.reminderDaysBetween ?? 7,
      reminderFeeStage1: company.reminderFeeStage1 ?? 0,
      reminderFeeStage2: company.reminderFeeStage2 ?? 0,
      reminderFeeStage3: company.reminderFeeStage3 ?? 0,
      reminderInterestEnabled: company.reminderInterestEnabled === true,
      reminderBaseInterestRate: company.reminderBaseInterestRate ?? DEFAULT_BASE_INTEREST_RATE,
    });
  }, [company]);

  const saveReminderSettings = async () => {
    setIsSavingSettings(true);
    try {
      await updateCompany(settingsForm);
      notify({ variant: 'success', message: 'Mahnkonfiguration wurde gespeichert.' });
    } catch (error) {
      notify({ variant: 'error', message: error instanceof Error ? error.message : 'Die Mahnkonfiguration konnte nicht gespeichert werden.' });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
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
      // Ein Ladefehler darf nicht wie eine leere Liste aussehen.
      logger.error('Error loading reminder data:', error);
      const message = actionErrorMessage('Die Mahnungen konnten nicht geladen werden.', error);
      setLoadError(message);
      notify({ variant: 'error', message });
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, notify]);

  const handleSendReminder = async (invoiceId: string, stage: number) => {
    try {
      const invoice = invoices.find(inv => inv.id === invoiceId);
      if (!invoice) {
        logger.error('Invoice not found:', invoiceId);
        notify({ variant: 'error', message: 'Die Rechnung für diese Mahnung wurde nicht gefunden. Bitte die Liste neu laden.' });
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
      notify({ variant: 'error', message: actionErrorMessage('Die Mahnung konnte nicht geöffnet werden.', error) });
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

  const handleDownloadReminder = async (invoice: Invoice, stage: 1 | 2 | 3) => {
    try {
      const customer = customers.find(c => c.id === invoice.customerId);
      if (!customer) {
        logger.error('Customer not found for invoice:', invoice.customerId);
        notify({ variant: 'error', message: `Die Mahnung ${invoice.invoiceNumber} konnte nicht erstellt werden: Kunde nicht gefunden.` });
        return;
      }

      const fee = stage === 1 ? company.reminderFeeStage1 :
                  stage === 2 ? company.reminderFeeStage2 :
                  company.reminderFeeStage3;

      // Generate PDF
      const pdfBlob = await generateReminderPDF(
        invoice,
        stage,
        '',
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
      notify({ variant: 'error', message: actionErrorMessage(`Die Mahnung ${invoice.invoiceNumber} konnte nicht heruntergeladen werden.`, error) });
    }
  };

  const handlePreviewReminder = async (invoice: Invoice, stage: 1 | 2 | 3) => {
    try {
      const customer = customers.find(c => c.id === invoice.customerId);
      if (!customer) {
        logger.error('Customer not found for invoice:', invoice.customerId);
        notify({ variant: 'error', message: `Die Vorschau der Mahnung ${invoice.invoiceNumber} ist nicht möglich: Kunde nicht gefunden.` });
        return;
      }

      const fee = stage === 1 ? company.reminderFeeStage1 :
                  stage === 2 ? company.reminderFeeStage2 :
                  company.reminderFeeStage3;

      // Generate PDF
      const pdfBlob = await generateReminderPDF(
        invoice,
        stage,
        '',
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
      notify({ variant: 'error', message: actionErrorMessage(`Die Vorschau der Mahnung ${invoice.invoiceNumber} konnte nicht erstellt werden.`, error) });
    }
  };

  const handleClosePreview = () => {
    setPreviewModal({
      isOpen: false,
      documents: []
    });
  };

  const formatDate = (date: Date | string) => {
    return formatDateValue(date, company?.locale || 'de-DE', company?.dateFormat);
  };

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const getStatusBadge = (status: Invoice['status']) => {
    const config = { label: statusLabel('invoice', status), color: statusBadgeClass('invoice', status) };
    return (
      <span className={`status-badge px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
        {config.label}
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

  const handleSelectAll = (checked?: boolean) => {
    const eligibleIds = eligibleReminders.filter(r => r.isEligible).map(r => r.invoiceId);
    if (checked !== undefined) {
      setSelectedInvoiceIds(checked ? eligibleIds : []);
      return;
    }

    setSelectedInvoiceIds(selectedInvoiceIds.length === eligibleIds.length ? [] : eligibleIds);
  };

  const handleBulkSendReminders = async () => {
    if (selectedInvoiceIds.length === 0) return;

    try {
      // Get all selected invoices
      const bulkInvoices = invoices.filter(inv => selectedInvoiceIds.includes(inv.id));
      
      if (bulkInvoices.length === 0) {
        logger.error('No valid invoices found for bulk reminder');
        notify({ variant: 'error', message: 'Die ausgewählten Rechnungen wurden nicht gefunden. Bitte die Liste neu laden.' });
        return;
      }

      // For bulk, we use the first invoice as the "primary" for the modal
      // but pass all invoices in bulkInvoices
      const firstInvoice = bulkInvoices[0];
      const firstReminder = eligibleReminders.find(r => r.invoiceId === firstInvoice.id);

      if (!firstReminder) {
        logger.error('Reminder eligibility not found for first invoice');
        notify({ variant: 'error', message: 'Die Mahnberechtigung der ausgewählten Rechnungen ist nicht bekannt. Bitte die Liste neu laden.' });
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
      notify({ variant: 'error', message: actionErrorMessage('Die Sammelmahnung konnte nicht geöffnet werden.', error) });
    }
  };

  const customer = reminderModal.invoice 
    ? customers.find(c => c.id === reminderModal.invoice!.customerId)
    : null;

  return (
    <div className="page-root space-y-8">
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
      <div className="page-header-slot flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          icon={Bell}
          title="Mahnungen"
          subtitle="Verwalten Sie Ihre Mahnungen"
        />
      </div>

      {/* Configuration Warning */}
      {!company.remindersEnabled && (
        <div className="guidance-panel mb-6 border-l-4 border-l-amber-500 p-4">
          <div className="flex items-start">
            <AlertCircle className="h-5 w-5 text-yellow-600 mr-3 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-yellow-800">Mahnwesen nicht aktiviert</h3>
              <p className="text-sm text-yellow-700 mt-1">
                Das Mahnwesen ist derzeit nicht aktiviert. Aktivieren Sie es im Reiter „Einstellungen“ dieser Ansicht.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="theme-tab-group mb-6">
        <ThemeTabBar
          className="theme-tab-bar-attached"
          ariaLabel="Mahnungsbereiche"
          activeTab={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: 'eligible' as const, label: 'Zu mahnende Rechnungen', icon: Bell },
            { id: 'history' as const, label: 'Mahnhistorie', icon: History },
            { id: 'hardship' as const, label: 'Härtefälle', icon: ShieldAlert, count: hardshipCases.length || undefined },
            { id: 'settings' as const, label: 'Einstellungen', icon: SettingsIcon },
          ]}
        />

        {/* Tab Content */}
        <div className="theme-tab-panel">
          {isLoading ? (
            <TableSkeleton rows={5} columns={7} label="Mahnungen werden geladen …" className="overflow-hidden rounded-lg border border-gray-200 bg-white" />
          ) : activeTab === 'settings' ? (
            <ReminderSettingsTab
              settings={settingsForm}
              currencySymbol={getCurrencySymbol(company?.locale || 'de-DE', company?.numberFormat, company?.currency)}
              locale={company?.locale || 'de-DE'}
              numberFormat={company?.numberFormat}
              isSaving={isSavingSettings}
              onChange={(key, value) => setSettingsForm(previous => ({ ...previous, [key]: value }))}
              onSave={() => { void saveReminderSettings(); }}
            />
          ) : loadError ? (
            <div className="px-4 py-10 text-center">
              <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" aria-hidden="true" />
              <p className="text-red-700">{loadError}</p>
              <button
                type="button"
                onClick={() => { void loadData(); }}
                className="btn-primary mt-4 rounded-lg px-4 py-2 text-white"
              >
                Erneut laden
              </button>
            </div>
          ) : activeTab === 'eligible' ? (
            <EligibleRemindersTab
              reminders={eligibleReminders}
              selectedIds={selectedInvoiceIds}
              onSelect={handleSelectInvoice}
              onSelectAll={handleSelectAll}
              onSendReminder={handleSendReminder}
              onSendBulk={handleBulkSendReminders}
              formatDate={formatDate}
              company={company}
            />
          ) : activeTab === 'history' ? (
            <ReminderHistoryTab
              invoices={reminderHistory}
              formatDate={formatDate}
              getStatusBadge={getStatusBadge}
              company={company}
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

interface ReminderSettingsForm {
  remindersEnabled: boolean;
  reminderDaysAfterDue: number;
  reminderDaysBetween: number;
  reminderFeeStage1: number;
  reminderFeeStage2: number;
  reminderFeeStage3: number;
  reminderInterestEnabled: boolean;
  reminderBaseInterestRate: number;
}

type ReminderSettingKey = keyof ReminderSettingsForm;

interface ReminderSettingsTabProps {
  settings: ReminderSettingsForm;
  currencySymbol: string;
  locale: string;
  numberFormat?: Company['numberFormat'];
  isSaving: boolean;
  onChange: (key: ReminderSettingKey, value: boolean | number) => void;
  onSave: () => void;
}

function ReminderSettingsTab({ settings, currencySymbol, locale, numberFormat, isSaving, onChange, onSave }: ReminderSettingsTabProps) {
  const { can } = useAuth();
  const canWrite = can('data.write');
  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Mahnwesen</h2>
          <p className="mt-1 text-sm text-gray-500">Fristen und Gebühren des Mahnwesens zentral festlegen.</p>
        </div>
        {/* Gemeinsamer Schalter: Der frühere Eigenbau war im Dunkelmodus
            eingeschaltet kaum von ausgeschaltet zu unterscheiden. */}
        <button
          type="button"
          role="switch"
          aria-checked={settings.remindersEnabled}
          aria-label="Mahnwesen aktivieren"
          onClick={() => onChange('remindersEnabled', !settings.remindersEnabled)}
          className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-custom focus-visible:ring-offset-2"
        >
          <SwitchTrack checked={settings.remindersEnabled} showLabel={false} />
        </button>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-gray-900">Fristen</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-gray-700">Tage nach Fälligkeit bis zur 1. Mahnung
            <input type="number" min="0" value={settings.reminderDaysAfterDue} onChange={event => onChange('reminderDaysAfterDue', Number(event.target.value) || 0)} className="form-input form-input-compact mt-1" />
            <span className="mt-1 block text-sm font-normal text-gray-600">0 = sofort nach Fälligkeit mahnbar</span>
          </label>
          <label className="block text-sm font-medium text-gray-700">Tage zwischen Mahnstufen
            <input type="number" min="0" value={settings.reminderDaysBetween} onChange={event => onChange('reminderDaysBetween', Number(event.target.value) || 0)} className="form-input form-input-compact mt-1" />
            <span className="mt-1 block text-sm font-normal text-gray-600">0 = sofort erneut mahnbar</span>
          </label>
        </div>
      </section>

      <section id="settings-reminder-fees" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-gray-900">Mahngebühren</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {([1, 2, 3] as const).map(stage => {
            const key = `reminderFeeStage${stage}` as ReminderSettingKey;
            return (
              <label key={stage} className="block text-sm font-medium text-gray-700">{stage}. Mahnung ({currencySymbol})
                <LocalizedNumberInput
                  min="0"
                  step="0.01"
                  value={settings[key] as number}
                  locale={locale}
                  numberFormat={numberFormat}
                  onValueChange={value => onChange(key, value === '' ? 0 : value)}
                  className="form-input form-input-compact mt-1 text-right tabular-nums"
                />
                {stage === 1 && <span className="mt-1 block text-sm font-normal text-gray-600">Viele verzichten bei der ersten Mahnung auf eine Gebühr.</span>}
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-sm text-gray-600">Geben Sie 0 ein, wenn keine Mahngebühren erhoben werden sollen. Üblich sind 0,00 € für die 1. Mahnung, 2,50 € für die 2. und 5,00 € für die 3. Mahnung. Die Gebühren der erreichten Stufen werden zusammengerechnet.</p>
        <p className="mt-2 text-sm text-gray-600">Mahngebühren sind erst ab Verzug zulässig und sollen die tatsächlichen Kosten abbilden. Bei Verbrauchern erkennen Gerichte meist nur wenige Euro je Mahnung an. Auf Mahngebühren und Verzugszinsen wird keine Umsatzsteuer berechnet, da sie Schadensersatz sind.</p>
      </section>

      <section id="settings-reminder-interest" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Verzugszinsen</h3>
            <p className="mt-1 text-sm text-gray-600">Verzugszinsen berechnen und in Mahnungen ausweisen (standardmäßig aus).</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.reminderInterestEnabled}
            aria-label="Verzugszinsen berechnen"
            onClick={() => onChange('reminderInterestEnabled', !settings.reminderInterestEnabled)}
            className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-custom focus-visible:ring-offset-2"
          >
            <SwitchTrack checked={settings.reminderInterestEnabled} showLabel={false} />
          </button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-gray-700">Basiszinssatz in %
            <LocalizedNumberInput
              step="0.01"
              value={settings.reminderBaseInterestRate}
              locale={locale}
              numberFormat={numberFormat}
              onValueChange={value => onChange('reminderBaseInterestRate', value === '' ? 0 : value)}
              className="form-input form-input-compact mt-1 text-right tabular-nums"
            />
            <span className="mt-1 block text-sm font-normal text-gray-600">Die Bundesbank legt den Basiszinssatz zum 1. Januar und 1. Juli neu fest. Bitte pflegen Sie den aktuellen Wert selbst.</span>
          </label>
          <div className="text-sm text-gray-700">
            <p className="font-medium">Aufschlag nach § 288 BGB (automatisch)</p>
            <p className="mt-1 text-gray-600">5 Prozentpunkte bei Verbrauchern (Kundenart Person), 9 Prozentpunkte bei Unternehmern (Kundenart Organisation). Zinsen = offener Betrag x Jahreszins x Verzugstage / 365; der Verzug beginnt am Tag nach der Fälligkeit.</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-gray-600">Hinweis: Gegenüber Unternehmern können Sie zusätzlich eine Verzugspauschale von 40 € verlangen (§ 288 Abs. 5 BGB). Sie wird nicht automatisch berechnet; nehmen Sie sie bei Bedarf in den Mahntext auf.</p>
      </section>

      <div className="flex justify-end">
        <button type="button" onClick={onSave} disabled={isSaving || !canWrite} className="btn-primary inline-flex min-h-10 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
          <Save className="h-4 w-4" />{isSaving ? 'Speichert …' : 'Mahnkonfiguration speichern'}
        </button>
      </div>
    </div>
  );
}

// Eligible Reminders Tab Component
interface EligibleRemindersTabProps {
  reminders: ReminderEligibility[];
  selectedIds: string[];
  onSelect: (id: string) => void;
  onSelectAll: (checked?: boolean) => void;
  onSendReminder: (invoiceId: string, stage: number) => void;
  onSendBulk: () => void;
  formatDate: (date: Date | string) => string;
  company: Company;
}

function EligibleRemindersTab({
  reminders,
  selectedIds,
  onSelect,
  onSelectAll,
  onSendReminder,
  onSendBulk,
  formatDate,
  company
}: EligibleRemindersTabProps) {
  const { can } = useAuth();
  const canWrite = can('data.write');
  const terminology = getTerminology(company.terminologyProfile);
  const { customers } = useCustomers();
  const money = (value: number) => formatCurrency(value, company?.locale || 'de-DE', company?.numberFormat, company?.currency);
  // Dieselbe Funktion wie Mahndialog, PDF und E-Mail; Stufe = nächste Mahnstufe.
  const claimOf = (reminder: ReminderEligibility) => reminderClaimFor(
    company,
    { total: reminder.total, paidAmount: reminder.paidAmount, outstandingAmount: reminder.outstandingAmount, dueDate: reminder.dueDate },
    customers.find(entry => entry.id === reminder.customerId),
    reminder.nextStage,
  );
  const claimTitle = (reminder: ReminderEligibility) => {
    const claim = claimOf(reminder);
    return `Offen ${money(claim.outstanding)} + Mahngebühren ${money(claim.fee)}${claim.interestEnabled ? ` + Verzugszinsen ${money(claim.interest)} (${describeInterest(claim)})` : ''} = ${money(claim.total)}`;
  };
  const [sortState, setSortState] = useState<SortState>({ key: 'dueDate', direction: 'desc' });
  const handleSort = (key: string) => setSortState(previous => previous.key === key
    ? { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: 'asc' });
  const sortedReminders = sortByTableState(reminders, sortState, (reminder, key) => {
    if (key === 'dueDate') return reminder.dueDate;
    if (key === 'customer') return reminder.customerName;
    if (key === 'daysSinceDue') return reminder.daysSinceDue;
    if (key === 'amount') return reminder.outstandingAmount ?? reminder.total;
    if (key === 'status') return reminder.currentStatus;
    if (key === 'nextStage') return reminder.nextStage;
    return reminder.invoiceNumber;
  }, company?.locale || 'de-DE', (left, right) => compareTableValues(right.invoiceNumber, left.invoiceNumber, company?.locale || 'de-DE'));
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
      <BulkSelectionHeader
        itemLabel="Rechnung"
        itemLabelPlural="Rechnungen"
        visibleCount={reminders.length}
        selectedCount={selectedIds.length}
        allSelected={selectedIds.length === eligibleCount && eligibleCount > 0}
        onSelectAll={onSelectAll}
      >
        <button
          type="button"
          onClick={onSendBulk}
          disabled={!canWrite}
          className="action-icon-button bulk-action-icon-button action-icon-blue"
          title="Ausgewählte mahnen"
          aria-label="Ausgewählte mahnen"
        >
          <Send className="h-4 w-4" />
        </button>
      </BulkSelectionHeader>

      {/* Reminders Table: Fälligkeit und Verzug sowie Status und nächste Stufe
          teilen sich je eine Spalte, damit die Tabelle ohne Querscrollen passt. */}
      <div className="hidden w-full max-w-full overflow-hidden tablet:block">
        <table className="w-full table-fixed divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="w-10 px-2 py-2 text-left table-head text-gray-500">
                <span className="sr-only">Auswahl</span>
              </th>
              <SortableTableHeader label="Fällig" sortKey="dueDate" activeKey={sortState.key} direction={sortState.direction} onSort={handleSort} className="w-32 px-2 py-2" />
              <SortableTableHeader label="Rechnungsnr." sortKey="invoiceNumber" activeKey={sortState.key} direction={sortState.direction} onSort={handleSort} className="w-28 px-2 py-2" />
              <SortableTableHeader label={terminology.entity.singular} sortKey="customer" activeKey={sortState.key} direction={sortState.direction} onSort={handleSort} className="px-2 py-2" />
              <SortableTableHeader label="Offen" sortKey="amount" activeKey={sortState.key} direction={sortState.direction} onSort={handleSort} align="right" className="w-24 px-2 py-2" />
              <SortableTableHeader label="Status" sortKey="nextStage" activeKey={sortState.key} direction={sortState.direction} onSort={handleSort} className="w-36 px-2 py-2" />
              <th className="sticky right-0 z-20 w-14 bg-gray-50 px-2 py-2 text-left table-head text-gray-500">
                <span className="sr-only">Aktionen</span>
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedReminders.map((reminder) => (
              <tr key={reminder.invoiceId} className={!reminder.isEligible ? 'bg-gray-50' : ''}>
                <td className="px-2 py-2 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(reminder.invoiceId)}
                    onChange={() => onSelect(reminder.invoiceId)}
                    disabled={!reminder.isEligible}
                    title={reminder.isEligible ? undefined : notEligibleHint(reminder)}
                    className="custom-checkbox disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={`${reminder.invoiceNumber} auswählen`}
                  />
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                  {formatDate(reminder.dueDate)}
                  <span className="block text-xs text-gray-500">{overdueLabel(reminder.daysSinceDue)}</span>
                </td>
                <td className="truncate px-2 py-2 text-sm font-medium text-gray-900" title={reminder.invoiceNumber}>
                  {reminder.invoiceNumber}
                </td>
                <td className="max-w-0 px-2 py-2 text-sm text-gray-900">
                  <span className="block truncate" title={reminder.customerName}>{reminder.customerName}</span>
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right text-sm font-medium tabular-nums text-gray-900">
                  {formatCurrency(reminder.outstandingAmount ?? reminder.total, company?.locale || 'de-DE', company?.numberFormat, company?.currency)}
                  <span className="block text-xs font-normal text-gray-600" title={claimTitle(reminder)}>Forderung {money(claimOf(reminder).total)}</span>
                </td>
                <td className="px-2 py-2">
                  {getStatusBadgeForReminder(reminder.currentStatus)}
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                    Nächste Mahnung:
                    <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${stageBadgeClassName(reminder.nextStage)}`}>{reminder.nextStage}. Mahnung</span>
                    {!reminder.isEligible && reminder.nextEligibleDate && <span>ab {formatDate(reminder.nextEligibleDate)}</span>}
                  </span>
                </td>
                {/* Es gibt nur eine Aktion; ein Drei-Punkte-Menü wäre hier ein
                    zusätzlicher Klick ohne Nutzen. */}
                <td className="sticky right-0 z-10 w-14 bg-white px-2 py-2 whitespace-nowrap text-sm">
                  <button
                    type="button"
                    onClick={() => onSendReminder(reminder.invoiceId, reminder.nextStage)}
                    disabled={!canWrite || !reminder.isEligible}
                    title={reminder.isEligible ? `${reminder.nextStage}. Mahnung senden` : notEligibleHint(reminder)}
                    aria-label={`${reminder.nextStage}. Mahnung senden`}
                    className="action-icon-button action-icon-blue disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-gray-200 rounded-xl border border-gray-100 bg-white tablet:hidden">
        {sortedReminders.map((reminder) => (
          <div key={reminder.invoiceId} className={`p-4 ${!reminder.isEligible ? 'bg-gray-50' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(reminder.invoiceId)}
                  onChange={() => onSelect(reminder.invoiceId)}
                  disabled={!reminder.isEligible}
                  title={reminder.isEligible ? undefined : notEligibleHint(reminder)}
                  className="custom-checkbox mt-0.5 shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`${reminder.invoiceNumber} auswählen`}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">{reminder.invoiceNumber}</p>
                  <p className="truncate text-sm text-gray-600">{reminder.customerName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onSendReminder(reminder.invoiceId, reminder.nextStage)}
                disabled={!canWrite || !reminder.isEligible}
                title={reminder.isEligible ? 'Mahnung senden' : notEligibleHint(reminder)}
                aria-label="Mahnung senden"
                className="action-icon-button action-icon-blue shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div><span className="block text-xs text-gray-500">Fällig</span>{formatDate(reminder.dueDate)}</div>
              <div><span className="block text-xs text-gray-500">Verzug</span>{overdueLabel(reminder.daysSinceDue)}</div>
              <div><span className="block text-xs text-gray-500">Offen</span>{formatCurrency(reminder.outstandingAmount ?? reminder.total, company?.locale || 'de-DE', company?.numberFormat, company?.currency)}</div>
              <div><span className="block text-xs text-gray-500">Gesamtforderung (nächste Stufe)</span><span title={claimTitle(reminder)}>{money(claimOf(reminder).total)}</span></div>
              <div><span className="block text-xs text-gray-500">Status</span>{getStatusBadgeForReminder(reminder.currentStatus)}</div>
              <div className="col-span-2"><span className="block text-xs text-gray-500">Nächste Mahnung</span>
                <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                  reminder.nextStage === 1 ? 'bg-yellow-100 text-yellow-800' : reminder.nextStage === 2 ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800'
                }`}>{reminder.nextStage}. Mahnung</span>
                {!reminder.isEligible && reminder.nextEligibleDate && <span className="ml-2 text-xs text-gray-500">ab {formatDate(reminder.nextEligibleDate)}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 text-right text-xs text-gray-500">
        {reminders.length} {reminders.length === 1 ? 'Rechnung' : 'Rechnungen'}
      </div>
    </div>
  );
}

// Reminder History Tab Component
interface ReminderHistoryTabProps {
  invoices: Invoice[];
  formatDate: (date: Date | string) => string;
  getStatusBadge: (status: Invoice['status']) => React.ReactNode;
  company: Company;
  onDownloadReminder: (invoice: Invoice, stage: 1 | 2 | 3) => void;
  onPreviewReminder: (invoice: Invoice, stage: 1 | 2 | 3) => void;
}

function ReminderHistoryTab({ invoices, formatDate, getStatusBadge, company, onDownloadReminder, onPreviewReminder }: ReminderHistoryTabProps) {
  if (invoices.length === 0) {
    return (
      <div className="text-center py-12">
        <Clock className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-600">Keine Mahnhistorie vorhanden</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">Sobald für eine Rechnung eine Mahnung versendet wurde, erscheint sie hier.</p>
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
                <p className="text-sm text-gray-600 mt-1">{formatCurrency(invoice.total, company?.locale || 'de-DE', company?.numberFormat, company?.currency)}</p>
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
  const terminology = getTerminology(company?.terminologyProfile);
  
  const { customers } = useCustomers();
  const money = (value: number) => formatCurrency(value, company?.locale || 'de-DE', company?.numberFormat, company?.currency);
  const claimOf = (invoice: Invoice) => reminderClaimFor(
    company, invoice, customers.find(entry => entry.id === invoice.customerId), invoice.maxReminderStage || 0,
  );

  if (invoices.length === 0) {
    return (
      <div className="text-center py-12">
        <Info className="h-16 w-16 text-gray-300 mx-auto mb-4" aria-hidden="true" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Keine Härtefälle</h3>
        <p className="text-gray-600">
          Es gibt derzeit keine Rechnungen, die als Härtefälle eingestuft sind.
        </p>
        <p className="text-sm text-gray-600 mt-2">
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
              Diese Rechnungen wurden bereits 3x gemahnt und sind noch immer unbezahlt. Bitte erwägen Sie weitere rechtliche Schritte oder ein persönliches Gespräch mit dem {terminology.entity.dative}.
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
        const claim = claimOf(invoice);
        
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
                <p className="text-xl font-semibold tabular-nums text-red-600">{money(claim.total)}</p>
                <p className="text-xs text-gray-500 mt-1">Gesamtforderung</p>
                <p className="text-xs text-gray-600 mt-0.5">
                  Offen: {money(claim.outstanding)} + Mahngebühren: {money(claim.fee)}
                  {claim.interestEnabled && <> + Verzugszinsen: {money(claim.interest)} ({describeInterest(claim)})</>}
                </p>
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
                <li>Persönlicher Kontakt mit dem {terminology.entity.dative} aufnehmen</li>
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
/** Verzug in Worten; noch nicht fällige Rechnungen zeigen die Restlaufzeit. */
function overdueLabel(daysSinceDue: number): string {
  if (daysSinceDue > 0) return `${daysSinceDue} ${daysSinceDue === 1 ? 'Tag' : 'Tage'} überfällig`;
  if (daysSinceDue === 0) return 'heute fällig';
  return `in ${-daysSinceDue} ${daysSinceDue === -1 ? 'Tag' : 'Tagen'} fällig`;
}

function notEligibleHint(reminder: ReminderEligibility) {
  return reminder.nextEligibleDate
    ? `Noch nicht mahnbar – ab ${formatDateValue(reminder.nextEligibleDate)}`
    : 'Noch nicht mahnbar';
}

function stageBadgeClassName(stage: number) {
  return stage === 1 ? 'bg-yellow-100 text-yellow-800' : stage === 2 ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800';
}

function getStatusBadgeForReminder(status: Invoice['status']) {
  const config = { label: statusLabel('invoice', status), color: statusBadgeClass('invoice', status) };
  return (
    <span className={`status-badge px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
      {config.label}
    </span>
  );
}
