import { useState, useEffect, useCallback, useRef } from 'react';
import logger from '../utils/logger';
import {
  Mail,
  Send,
  Settings,
  TestTube,
  RefreshCw,
  Search,
  Calendar,
  User,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Eye,
  X,
  TrendingUp,
  BellRing,
  Database
} from 'lucide-react';
import { apiService } from '../services/api';
import { isDemoMode } from '../services/demoApi';
import { useCompany } from '../context/CompanyContext';
import { formatDate as formatDateValue, formatTime } from '../utils/formatters';
import { getTerminology } from '../utils/terminology';
import { sanitizeHtml } from '../utils/sanitizeHtml';
import { ThemeTabBar } from './ThemeTabBar';
import { NotificationSettingsPanel } from './NotificationSettingsPanel';
import { EmptyState } from './EmptyState';
import { useAuth } from '../context/AuthContext';
import { useFeedback } from '../context/FeedbackContext';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { SMTP_SETTINGS_GUARD_ID } from '../utils/navigationGuard';
import { SettingsCard, SettingsField, SettingsSaveBar, SettingsToggleRow } from './settings/SettingsUi';
import {
  defaultTestEmailRecipient,
  isSingleEmailAddress,
  SMTP_PROVIDERS,
  smtpProviderForSettings,
  smtpFormFromSettings,
  smtpSettingsDirty,
  smtpSettingsPayload,
  validateSmtpSettings,
  type SmtpFieldErrors,
  type SmtpFormSettings,
  type SmtpProvider,
} from '../utils/smtpSettings';

interface EmailAttachment {
  filename: string;
  size?: number;
}

interface EmailHistoryItem {
  id: string;
  sender_email: string;
  sender_name: string;
  recipient_email: string;
  subject: string;
  body_html?: string;
  attachments: EmailAttachment[];
  message_id?: string;
  invoice_id?: string;
  invoice_number?: string;
  customer_id?: string;
  customer_name?: string;
  email_type: string;
  status: 'sent' | 'failed';
  error_message?: string;
  sent_at: string;
  created_at: string;
  attachment_count: number;
}

interface EmailStatistics {
  total: number;
  sent: number;
  failed: number;
  last30Days: number;
  dailyStats: Array<{
    date: string;
    count: number;
    sent_count: number;
    failed_count: number;
  }>;
  topRecipients: Array<{
    recipient_email: string;
    customer_name: string;
    email_count: number;
  }>;
}

interface EmailManagementProps {
  onClose?: () => void;
  embedded?: boolean;
}

type EmailManagementTab = 'notifications' | 'activity' | 'settings';

export function EmailManagement({ onClose, embedded = false }: EmailManagementProps) {
  const { company } = useCompany();
  const { workspace, can } = useAuth();
  const { confirm } = useFeedback();
  const workspaceId = workspace?.id ?? null;
  const currentWorkspace = useRef(workspaceId);
  currentWorkspace.current = workspaceId;
  const canManageSmtp = can('workspace.settings');
  const terminology = getTerminology(company.terminologyProfile);
  useEffect(() => {
    if (embedded) return undefined;

    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [embedded]);

  const [activeTab, setActiveTab] = useState<EmailManagementTab>('settings');
  
  // Email History State
  const [emails, setEmails] = useState<EmailHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'sent' | 'failed'>('all');
  const [selectedEmail, setSelectedEmail] = useState<EmailHistoryItem | null>(null);

  // Statistics State
  const [statistics, setStatistics] = useState<EmailStatistics | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  // Zugangsdaten werden nur als neuer Entwurf im Arbeitsspeicher gehalten.
  const [smtpSettings, setSmtpSettings] = useState<SmtpFormSettings>(() => smtpFormFromSettings());
  const [savedSmtpSettings, setSavedSmtpSettings] = useState<SmtpFormSettings | null>(null);
  const [smtpProvider, setSmtpProvider] = useState<SmtpProvider>('eigen');
  const [smtpUserManuallyEdited, setSmtpUserManuallyEdited] = useState(false);
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<string | null | undefined>(undefined);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [smtpErrors, setSmtpErrors] = useState<SmtpFieldErrors>({});
  const [connectionResult, setConnectionResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [smtpSaveMessage, setSmtpSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [testEmailRecipient, setTestEmailRecipient] = useState('');
  const [testEmailSubject, setTestEmailSubject] = useState('');
  const [testEmailMessage, setTestEmailMessage] = useState('');
  const [testRecipientError, setTestRecipientError] = useState<string | undefined>();
  const settingsLoadVersion = useRef(0);
  const smtpBusy = isSavingSettings || isTestingConnection || isSendingTest;
  const smtpReady = savedSmtpSettings !== null && loadedWorkspaceId === workspaceId && !isLoadingSettings && !settingsLoadError;
  const smtpDirty = smtpReady && smtpSettingsDirty(savedSmtpSettings, smtpSettings);
  useUnsavedChangesGuard({
    id: SMTP_SETTINGS_GUARD_ID,
    isDirty: smtpDirty || smtpBusy,
    message: 'Die E-Mail-Einrichtung enthält ungespeicherte Änderungen. Diese beim Verlassen verwerfen?',
  });

  // Messages State
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);

  const loadEmails = useCallback(async (page = currentPage) => {
    setIsLoading(true);
    try {
      const data = await apiService.getEmailHistory<EmailHistoryItem>({
        page,
        limit: 20,
        filter: statusFilter,
        search: searchTerm
      });
      
      if (data.success) {
        setEmails(data.emails);
        setTotalPages(data.pagination.totalPages);
        setCurrentPage(data.pagination.currentPage);
      } else {
        setMessage({ type: 'error', text: data.message || 'Fehler beim Laden der E-Mail-Historie' });
      }
    } catch (error) {
      logger.error('Error loading emails:', error);
      setMessage({ type: 'error', text: 'Fehler beim Laden der E-Mail-Historie' });
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, searchTerm, statusFilter]);

  const loadStatistics = useCallback(async () => {
    setIsLoadingStats(true);
    try {
      const data = await apiService.getEmailStatistics<EmailStatistics>();
      
      if (data.success) {
        setStatistics(data.statistics);
      } else {
        setMessage({ type: 'error', text: 'Fehler beim Laden der Statistiken' });
      }
    } catch (error) {
      logger.error('Error loading statistics:', error);
      setMessage({ type: 'error', text: 'Fehler beim Laden der Statistiken' });
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  const loadSmtpSettings = useCallback(async () => {
    const requestedWorkspace = workspaceId;
    const version = ++settingsLoadVersion.current;
    setIsLoadingSettings(true);
    setSettingsLoadError(null);
    setSavedSmtpSettings(null);
    setLoadedWorkspaceId(undefined);
    setIsSavingSettings(false);
    setIsTestingConnection(false);
    setIsSendingTest(false);
    setTestRecipientError(undefined);
    setSmtpSettings(smtpFormFromSettings());
    setSmtpProvider('eigen');
    setSmtpUserManuallyEdited(false);
    setSmtpErrors({});
    setConnectionResult(null);
    setSmtpSaveMessage(null);
    setTestResult(null);
    setTestEmailRecipient('');
    setTestEmailSubject('');
    setTestEmailMessage('');
    try {
      const data = await apiService.getSmtpSettings<Record<string, unknown>>();
      if (version !== settingsLoadVersion.current || requestedWorkspace !== currentWorkspace.current) return;
      if (!data.success) throw new Error(data.message || 'Die E-Mail-Einrichtung konnte nicht geladen werden.');
      const settings = smtpFormFromSettings(data.settings);
      setSmtpSettings(settings);
      setSmtpProvider(smtpProviderForSettings(settings));
      setSmtpUserManuallyEdited(!!settings.smtp_user && settings.smtp_user !== settings.email_from);
      setSavedSmtpSettings(settings);
      setLoadedWorkspaceId(requestedWorkspace);
      setTestEmailRecipient(defaultTestEmailRecipient(settings));
    } catch (error) {
      if (version !== settingsLoadVersion.current || requestedWorkspace !== currentWorkspace.current) return;
      setSettingsLoadError(error instanceof Error ? error.message : 'Die E-Mail-Einrichtung konnte nicht geladen werden.');
    } finally {
      if (version === settingsLoadVersion.current && requestedWorkspace === currentWorkspace.current) setIsLoadingSettings(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadSmtpSettings();
    return () => { settingsLoadVersion.current += 1; };
  }, [loadSmtpSettings]);

  useEffect(() => {
    if (activeTab === 'activity') {
      void loadEmails();
      void loadStatistics();
    }
  }, [activeTab, loadEmails, loadStatistics]);

  const refreshActivity = async () => {
    await Promise.all([loadEmails(1), loadStatistics()]);
  };

  const changeSmtpSettings = (changes: Partial<SmtpFormSettings>) => {
    setSmtpSettings(current => ({ ...current, ...changes }));
    setSmtpErrors(current => {
      const next = { ...current };
      for (const field of Object.keys(changes) as Array<keyof SmtpFormSettings>) delete next[field];
      return next;
    });
    setSmtpSaveMessage(null);
    setConnectionResult(null);
    setTestResult(null);
  };

  const changeSmtpProvider = (provider: SmtpProvider) => {
    setSmtpProvider(provider);
    if (provider === 'eigen') return;
    const preset = SMTP_PROVIDERS[provider];
    changeSmtpSettings({ smtp_host: preset.smtp_host, smtp_port: preset.smtp_port, smtp_secure: preset.smtp_secure });
  };

  const changeSenderAddress = (email_from: string) => {
    changeSmtpSettings({ email_from, ...(!smtpUserManuallyEdited ? { smtp_user: email_from } : {}) });
  };

  const validateSmtpForm = (requireConnection: boolean) => {
    const errors = validateSmtpSettings(smtpSettings, requireConnection);
    setSmtpErrors(errors);
    const firstError = Object.keys(errors)[0];
    if (firstError) document.getElementById(`smtp-${firstError}`)?.focus();
    return !firstError;
  };

  const saveSmtpSettings = async () => {
    if (!canManageSmtp || smtpBusy || !smtpReady || !savedSmtpSettings || !validateSmtpForm(smtpSettings.is_enabled)) return;
    const requestedWorkspace = workspaceId;
    const requestedSettingsVersion = settingsLoadVersion.current;
    setIsSavingSettings(true);
    setSmtpSaveMessage(null);
    try {
      const payload = smtpSettingsPayload(smtpSettings);
      const data = await apiService.saveSmtpSettings(payload);
      if (requestedSettingsVersion !== settingsLoadVersion.current || requestedWorkspace !== currentWorkspace.current) return;
      if (!data.success) throw new Error(data.message || 'Die E-Mail-Einrichtung konnte nicht gespeichert werden.');
      const saved = smtpFormFromSettings({ ...payload, smtp_pass_set: !!smtpSettings.smtp_pass || smtpSettings.smtp_pass_set });
      setSmtpSettings(saved);
      setSavedSmtpSettings(saved);
      if (!testEmailRecipient.trim() || testEmailRecipient.trim() === defaultTestEmailRecipient(savedSmtpSettings)) {
        setTestEmailRecipient(defaultTestEmailRecipient(saved));
      }
      setSmtpSaveMessage({ type: 'success', text: 'E-Mail-Einrichtung gespeichert.' });
      setTestResult(null);
    } catch (error) {
      if (requestedSettingsVersion === settingsLoadVersion.current && requestedWorkspace === currentWorkspace.current) {
        setSmtpSaveMessage({ type: 'error', text: error instanceof Error ? error.message : 'Die E-Mail-Einrichtung konnte nicht gespeichert werden.' });
      }
    } finally {
      if (requestedSettingsVersion === settingsLoadVersion.current) setIsSavingSettings(false);
    }
  };

  const discardSmtpSettings = () => {
    if (!savedSmtpSettings || smtpBusy) return;
    setSmtpSettings(savedSmtpSettings);
    setSmtpProvider(smtpProviderForSettings(savedSmtpSettings));
    setSmtpUserManuallyEdited(!!savedSmtpSettings.smtp_user && savedSmtpSettings.smtp_user !== savedSmtpSettings.email_from);
    setSmtpErrors({});
    setConnectionResult(null);
    setSmtpSaveMessage(null);
    setTestResult(null);
  };

  const testSmtpConnection = async () => {
    if (!canManageSmtp || smtpBusy || !smtpReady || !savedSmtpSettings || !validateSmtpForm(true)) return;
    const requestedWorkspace = workspaceId;
    const requestedSettingsVersion = settingsLoadVersion.current;
    setIsTestingConnection(true);
    setConnectionResult(null);
    try {
      // Auch bei einem gespeicherten Passwort werden die sichtbaren Entwurfswerte geprüft.
      const data = await apiService.testSmtpConnection(false, smtpSettingsPayload(smtpSettings));
      if (requestedSettingsVersion !== settingsLoadVersion.current || requestedWorkspace !== currentWorkspace.current) return;
      setConnectionResult({
        type: data.success ? 'success' : 'error',
        text: data.success && !isDemoMode ? 'Verbindung und Anmeldung erfolgreich geprüft. Es wurde keine E-Mail versendet.' : data.message,
      });
    } catch (error) {
      if (requestedSettingsVersion === settingsLoadVersion.current && requestedWorkspace === currentWorkspace.current) {
        setConnectionResult({ type: 'error', text: error instanceof Error ? error.message : 'Die Verbindung konnte nicht geprüft werden.' });
      }
    } finally {
      if (requestedSettingsVersion === settingsLoadVersion.current) setIsTestingConnection(false);
    }
  };

  const sendTestEmail = async () => {
    if (!canManageSmtp || smtpBusy || !smtpReady || !savedSmtpSettings) return;
    if (smtpDirty || !savedSmtpSettings.is_enabled) {
      setTestResult({ type: 'error', text: smtpDirty ? 'Bitte die Änderungen zuerst speichern. Die Testmail nutzt die gespeicherte Einrichtung.' : 'Bitte den E-Mail-Versand aktivieren und speichern.' });
      return;
    }
    if (!isSingleEmailAddress(testEmailRecipient)) {
      setTestRecipientError('Bitte eine gültige Empfängeradresse eintragen.');
      document.getElementById('smtp-test-recipient')?.focus();
      return;
    }
    const requestedWorkspace = workspaceId;
    const requestedSettingsVersion = settingsLoadVersion.current;
    const recipient = testEmailRecipient.trim();
    setIsSendingTest(true);
    setTestResult(null);
    setTestRecipientError(undefined);
    try {
      const data = await apiService.sendTestEmail(recipient, testEmailSubject.trim() || undefined, testEmailMessage.trim() || undefined);
      if (requestedSettingsVersion !== settingsLoadVersion.current || requestedWorkspace !== currentWorkspace.current) return;
      setTestResult({
        type: data.success ? (data.warning ? 'warning' : 'success') : 'error',
        text: `${data.message}${data.success && data.warning ? ` ${data.warning}` : ''}`,
      });
    } catch (error) {
      if (requestedSettingsVersion === settingsLoadVersion.current && requestedWorkspace === currentWorkspace.current) {
        setTestResult({ type: 'error', text: error instanceof Error ? error.message : 'Die Testmail konnte nicht versendet werden.' });
      }
    } finally {
      if (requestedSettingsVersion === settingsLoadVersion.current) setIsSendingTest(false);
    }
  };

  const closeManagement = async () => {
    if (smtpBusy) return;
    if (smtpDirty && !await confirm({
      title: 'Ungespeicherte E-Mail-Einrichtung',
      message: 'Die Änderungen an der E-Mail-Einrichtung beim Schließen verwerfen?',
      confirmText: 'Änderungen verwerfen',
      cancelText: 'Weiter bearbeiten',
      isDestructive: true,
    })) return;
    onClose?.();
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return `${formatDateValue(date, company.locale, company.dateFormat)} ${formatTime(date, company.locale, company.timeFormat)}`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'sent':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'sent':
        return 'text-green-700 bg-green-50 border-green-200';
      case 'failed':
        return 'text-red-700 bg-red-50 border-red-200';
      default:
        return 'text-gray-700 bg-gray-50 border-gray-200';
    }
  };

  return (
    <div className={embedded ? 'w-full' : 'dialog-overlay fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4'}>
      <div
        role={embedded ? 'region' : 'dialog'}
        aria-modal={embedded ? undefined : true}
        aria-labelledby={embedded ? undefined : 'email-management-title'}
        aria-label={embedded ? 'E-Mail-Versand' : undefined}
        className={embedded
          ? 'flex w-full flex-col overflow-hidden'
          : 'flex max-h-[95vh] w-full max-w-7xl flex-col overflow-hidden rounded-lg bg-white shadow-xl'}
      >
        {/* Der eingebettete Bereich verwendet die Überschrift seiner Einstellungskarte. */}
        {!embedded && <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 p-6">
          <div className="flex items-center">
            <Mail className="h-6 w-6 text-primary-custom mr-3" />
            <h2 id="email-management-title" className="text-lg font-semibold text-gray-900">E-Mail-Verwaltung</h2>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={() => void closeManagement()}
              className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
              disabled={smtpBusy}
              aria-label="E-Mail-Verwaltung schließen"
            >
              <X className="h-6 w-6" />
            </button>
          )}
        </div>}

        {/* Messages */}
        {message && (
          <div className={`mx-6 mt-4 p-4 rounded-lg flex items-center ${
            message.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800' :
            message.type === 'error' ? 'bg-red-50 border border-red-200 text-red-800' :
            'bg-yellow-50 border border-yellow-200 text-yellow-800'
          }`}>
            {message.type === 'success' ? (
              <CheckCircle className="h-5 w-5 mr-2" />
            ) : (
              <AlertTriangle className="h-5 w-5 mr-2" />
            )}
            <span>{message.text}</span>
            <button
              type="button"
              onClick={() => setMessage(null)}
              className="ml-auto text-current opacity-70 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className={`theme-tab-group ${embedded ? '' : 'flex min-h-0 flex-1 flex-col overflow-hidden'} rounded-none border-x-0 border-b-0 shadow-none`}>
          <ThemeTabBar
            className="theme-tab-bar-attached theme-tab-bar-modal email-management-tab-bar flex-shrink-0"
            ariaLabel="E-Mail-Bereiche"
            activeTab={activeTab}
            onChange={setActiveTab}
            tabs={[
              { id: 'settings' as const, label: 'Einrichten & testen', icon: Settings },
              { id: 'notifications' as const, label: 'Benachrichtigungen', icon: BellRing },
              { id: 'activity' as const, label: 'Versandverlauf', icon: TrendingUp },
            ]}
          />

        {/* Content */}
        <div className={`theme-tab-panel p-0 ${embedded ? '' : 'min-h-0 flex-1 overflow-y-auto'}`}>
          {/* Notification Settings Tab */}
          {activeTab === 'notifications' && (
            <div className="p-6">
              <div className="mx-auto max-w-3xl">
                <NotificationSettingsPanel />
              </div>
            </div>
          )}

          {/* Activity Tab: statistics first, followed by the email history */}
          {activeTab === 'activity' && (
            <>
              <div className="border-b border-gray-200 p-6">
                <div className="mb-5">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Statistiken</h3>
                    <p className="mt-1 text-sm text-gray-500">Versandstatus und häufigste Empfänger auf einen Blick.</p>
                  </div>
                </div>

                {isLoadingStats ? (
                  <div className="flex h-32 items-center justify-center">
                    <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
                    <span className="ml-2 text-gray-600">Lade Statistiken...</span>
                  </div>
                ) : statistics ? (
                  <div className="space-y-6">
                    {/* Overview Stats */}
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-6">
                        <div className="flex items-center">
                          <Database className="mr-3 h-8 w-8 text-blue-500" />
                          <div>
                            <p className="text-sm text-blue-600">Gesamt</p>
                            <p className="text-2xl font-bold text-blue-900">{statistics.total.toLocaleString('de-DE')}</p>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-lg border border-green-200 bg-green-50 p-6">
                        <div className="flex items-center">
                          <CheckCircle className="mr-3 h-8 w-8 text-green-500" />
                          <div>
                            <p className="text-sm text-green-600">Gesendet</p>
                            <p className="text-2xl font-bold text-green-900">{statistics.sent.toLocaleString('de-DE')}</p>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
                        <div className="flex items-center">
                          <XCircle className="mr-3 h-8 w-8 text-red-500" />
                          <div>
                            <p className="text-sm text-red-600">Fehlgeschlagen</p>
                            <p className="text-2xl font-bold text-red-900">{statistics.failed.toLocaleString('de-DE')}</p>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-lg border border-purple-200 bg-purple-50 p-6">
                        <div className="flex items-center">
                          <Calendar className="mr-3 h-8 w-8 text-purple-500" />
                          <div>
                            <p className="text-sm text-purple-600">Letzte 30 Tage</p>
                            <p className="text-2xl font-bold text-purple-900">{statistics.last30Days.toLocaleString('de-DE')}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Top Recipients */}
                    {statistics.topRecipients.length > 0 && (
                      <div className="rounded-lg border border-gray-200 bg-white p-6">
                        <h3 className="mb-4 text-lg font-semibold text-gray-900">Häufigste Empfänger</h3>
                        <div className="space-y-3">
                          {statistics.topRecipients.slice(0, 10).map((recipient, index) => (
                            <div key={recipient.recipient_email} className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
                              <div className="flex items-center space-x-3">
                                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary-custom text-xs font-bold text-white">
                                  {index + 1}
                                </div>
                                <div>
                                  <p className="font-medium text-gray-900">{recipient.recipient_email}</p>
                                  {recipient.customer_name && (
                                    <p className="text-sm text-gray-500">{recipient.customer_name}</p>
                                  )}
                                </div>
                              </div>
                              <div className="text-sm font-medium text-gray-600">
                                {recipient.email_count} E-Mails
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex h-32 flex-col items-center justify-center">
                    <TrendingUp className="mb-3 h-10 w-10 text-gray-400" />
                    <p className="text-gray-500">Keine Statistiken verfügbar</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Email History Tab */}
          {activeTab === 'activity' && (
            <div className="h-full flex flex-col">
              {/* Search and Filters */}
              <div className="p-6 border-b border-gray-200 flex-shrink-0">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex-1 min-w-64">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder={`Suche nach E-Mail, Betreff, ${terminology.entity.singular}...`}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-primary-custom/20"
                      />
                    </div>
                  </div>
                  <div>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as 'all' | 'sent' | 'failed')}
                      className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom/20"
                    >
                      <option value="all">Alle Status</option>
                      <option value="sent">Gesendet</option>
                      <option value="failed">Fehlgeschlagen</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => { void refreshActivity(); }}
                    disabled={isLoading || isLoadingStats}
                    className="px-4 py-2 bg-primary-custom text-white rounded-lg hover:brightness-90 transition-colors disabled:opacity-50 flex items-center space-x-2"
                  >
                    <RefreshCw className={`h-4 w-4 ${isLoading || isLoadingStats ? 'animate-spin' : ''}`} />
                    <span>Aktualisieren</span>
                  </button>
                </div>
              </div>

              {/* Email List */}
              <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center h-64">
                    <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
                    <span className="ml-2 text-gray-600">Lade E-Mails...</span>
                  </div>
                ) : emails.length === 0 ? (
                  <EmptyState variant="metric" title="Noch keine E-Mails vorhanden" description="Versendete E-Mails erscheinen hier im Verlauf." />
                ) : (
                  <div className="divide-y divide-gray-200">
                    {emails.map((email) => (
                      <div
                        key={email.id}
                        className="p-6 hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => setSelectedEmail(email)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4 flex-1">
                            <div className="flex-shrink-0">
                              {getStatusIcon(email.status)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2 mb-1">
                                <h4 className="font-medium text-gray-900 truncate">
                                  {email.subject}
                                </h4>
                                {email.invoice_number && (
                                  <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded">
                                    {email.invoice_number}
                                  </span>
                                )}
                                <span className={`text-xs px-2 py-1 rounded border ${getStatusColor(email.status)}`}>
                                  {email.status === 'sent' ? 'Gesendet' : 'Fehlgeschlagen'}
                                </span>
                              </div>
                              <div className="flex items-center space-x-4 text-sm text-gray-500">
                                <div className="flex items-center">
                                  <User className="h-4 w-4 mr-1" />
                                  {email.recipient_email}
                                </div>
                                <div className="flex items-center">
                                  <Clock className="h-4 w-4 mr-1" />
                                  {formatDate(email.sent_at)}
                                </div>
                                {email.attachment_count > 0 && (
                                  <div className="flex items-center">
                                    <FileText className="h-4 w-4 mr-1" />
                                    {email.attachment_count} Anhang{email.attachment_count > 1 ? 'e' : ''}
                                  </div>
                                )}
                              </div>
                              {email.error_message && (
                                <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded">
                                  <strong>Fehler:</strong> {email.error_message}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex-shrink-0 ml-4">
                            <Eye className="h-4 w-4 text-gray-400" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="p-6 border-t border-gray-200 flex justify-between items-center flex-shrink-0">
                  <div className="text-sm text-gray-500">
                    Seite {currentPage} von {totalPages}
                  </div>
                  <div className="flex space-x-2">
                    <button
                      type="button"
                      onClick={() => loadEmails(currentPage - 1)}
                      disabled={currentPage <= 1 || isLoading}
                      className="px-4 py-2 border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      Zurück
                    </button>
                    <button
                      type="button"
                      onClick={() => loadEmails(currentPage + 1)}
                      disabled={currentPage >= totalPages || isLoading}
                      className="px-4 py-2 border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      Weiter
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* E-Mail-Einrichtung und echte Testmail gehören in denselben Ablauf. */}
          {activeTab === 'settings' && (
            <div className={embedded ? '' : 'p-4 sm:p-6'}>
              <div className="mx-auto max-w-3xl space-y-4">
                {!smtpReady && !settingsLoadError ? (
                  <p role="status" className="flex items-center gap-2 py-6 text-sm text-gray-600">
                    <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> E-Mail-Einrichtung wird geladen …
                  </p>
                ) : settingsLoadError ? (
                  <div className="space-y-3">
                    <p role="alert" className="text-sm text-red-600">{settingsLoadError}</p>
                    <button type="button" onClick={() => void loadSmtpSettings()} className="btn-secondary rounded-lg px-4 py-2 text-sm">Erneut laden</button>
                  </div>
                ) : (
                  <>
                    <SettingsCard title="Postfach einrichten" icon={Mail} description="Das Postfach für Rechnungen, Angebote und Mahnungen einrichten.">
                      <fieldset disabled={smtpBusy || !canManageSmtp} className="min-w-0 space-y-4 disabled:opacity-70">
                        <SettingsToggleRow
                          label="E-Mail-Versand aktivieren"
                          description="Nach dem Speichern steht dieses Postfach für den Versand bereit."
                          checked={smtpSettings.is_enabled}
                          onChange={is_enabled => changeSmtpSettings({ is_enabled })}
                          disabled={smtpBusy || !canManageSmtp}
                        />
                        <SettingsField id="smtp-provider" label="Mailanbieter" hint="Server, Port und Verschlüsselung werden vorbelegt und können angepasst werden.">
                          <select id="smtp-provider" value={smtpProvider} onChange={e => changeSmtpProvider(e.target.value as SmtpProvider)} aria-describedby="smtp-provider-message" className="form-input form-input-compact w-full">
                            {Object.entries(SMTP_PROVIDERS).map(([value, provider]) => <option key={value} value={value}>{provider.label}</option>)}
                          </select>
                        </SettingsField>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <SettingsField id="smtp-email_from" label="Absenderadresse" required hint="An diese Adresse geht auch Ihre Kopie jeder Kundenmail." error={smtpErrors.email_from}>
                            <input id="smtp-email_from" type="email" value={smtpSettings.email_from} onChange={e => changeSenderAddress(e.target.value)} autoComplete="email" placeholder="buero@example.de" aria-invalid={!!smtpErrors.email_from} aria-describedby="smtp-email_from-message" className="form-input form-input-compact w-full" />
                          </SettingsField>
                          <SettingsField id="smtp-email_from_name" label="Absendername" hint="Zum Beispiel Ihr Name oder Firmenname.">
                            <input id="smtp-email_from_name" type="text" value={smtpSettings.email_from_name} onChange={e => changeSmtpSettings({ email_from_name: e.target.value })} autoComplete="organization" aria-describedby="smtp-email_from_name-message" className="form-input form-input-compact w-full" />
                          </SettingsField>
                          <SettingsField id="smtp-smtp_user" label="Benutzername" required hint="Meist die vollständige E-Mail-Adresse des Postfachs." error={smtpErrors.smtp_user}>
                            <input id="smtp-smtp_user" type="text" value={smtpSettings.smtp_user} onChange={e => { setSmtpUserManuallyEdited(true); changeSmtpSettings({ smtp_user: e.target.value }); }} autoComplete="off" spellCheck={false} aria-invalid={!!smtpErrors.smtp_user} aria-describedby="smtp-smtp_user-message" className="form-input form-input-compact w-full" />
                          </SettingsField>
                          <SettingsField id="smtp-smtp_pass" label={smtpSettings.smtp_pass_set ? 'Passwort ändern' : 'Passwort'} required={!smtpSettings.smtp_pass_set} hint={smtpSettings.smtp_pass_set ? 'Passwort gespeichert. Leer lassen, um es beizubehalten.' : SMTP_PROVIDERS[smtpProvider].hint} error={smtpErrors.smtp_pass}>
                            <input id="smtp-smtp_pass" type="password" value={smtpSettings.smtp_pass} onChange={e => changeSmtpSettings({ smtp_pass: e.target.value })} autoComplete="new-password" placeholder={smtpSettings.smtp_pass_set ? 'Gespeichertes Passwort beibehalten' : ''} aria-invalid={!!smtpErrors.smtp_pass} aria-describedby="smtp-smtp_pass-message" className="form-input form-input-compact w-full" />
                          </SettingsField>
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <SettingsField id="smtp-smtp_host" label="SMTP-Server" required error={smtpErrors.smtp_host}>
                            <input id="smtp-smtp_host" type="text" value={smtpSettings.smtp_host} onChange={e => changeSmtpSettings({ smtp_host: e.target.value })} autoComplete="off" spellCheck={false} placeholder="smtp.example.de" aria-invalid={!!smtpErrors.smtp_host} aria-describedby={smtpErrors.smtp_host ? 'smtp-smtp_host-message' : undefined} className="form-input form-input-compact w-full" />
                          </SettingsField>
                          <div className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-3">
                            <SettingsField id="smtp-smtp_port" label="Port" required error={smtpErrors.smtp_port}>
                              <input id="smtp-smtp_port" type="text" inputMode="numeric" value={smtpSettings.smtp_port} onChange={e => changeSmtpSettings({ smtp_port: e.target.value })} aria-invalid={!!smtpErrors.smtp_port} aria-describedby={smtpErrors.smtp_port ? 'smtp-smtp_port-message' : undefined} className="form-input form-input-compact w-full" />
                            </SettingsField>
                            <SettingsField id="smtp-smtp_secure" label="Verschlüsselung" hint="Die Werte stehen bei Ihrem Mailanbieter.">
                              <select id="smtp-smtp_secure" value={smtpSettings.smtp_secure ? 'tls' : 'starttls'} onChange={e => {
                                const smtp_secure = e.target.value === 'tls';
                                const defaultPort = smtpSettings.smtp_port === '465' || smtpSettings.smtp_port === '587';
                                changeSmtpSettings({ smtp_secure, ...(defaultPort ? { smtp_port: smtp_secure ? '465' : '587' } : {}) });
                              }} aria-describedby="smtp-smtp_secure-message" className="form-input form-input-compact w-full">
                                <option value="starttls">STARTTLS (meist 587)</option>
                                <option value="tls">SSL/TLS (meist 465)</option>
                              </select>
                            </SettingsField>
                          </div>
                        </div>
                      </fieldset>
                      <div className="mt-4 border-t border-gray-200 pt-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <button type="button" onClick={() => void testSmtpConnection()} disabled={smtpBusy || !canManageSmtp} className="btn-secondary inline-flex min-h-10 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
                            {isTestingConnection ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <TestTube className="h-4 w-4" aria-hidden="true" />}
                            {isTestingConnection ? 'Prüft …' : 'Verbindung prüfen'}
                          </button>
                          <p className="text-xs text-gray-600">Prüft Server und Anmeldung mit den eingetragenen Werten.</p>
                        </div>
                        {connectionResult && <p role={connectionResult.type === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${connectionResult.type === 'error' ? 'text-red-600' : 'text-green-700'}`}>{connectionResult.text}</p>}
                      </div>
                      <p className="mt-4 text-xs leading-5 text-gray-600">Bei jeder Kundenmail wird automatisch eine unsichtbare Kopie (BCC) an die gespeicherte Absenderadresse geschickt. Die Kunden sehen diese Kopie nicht.</p>
                    </SettingsCard>

                    <SettingsCard title="Testmail senden" icon={Send} description={isDemoMode ? 'Im Demo-Modus wird der Versand simuliert. Es wird keine echte E-Mail versendet.' : 'Eine echte E-Mail mit der gespeicherten Einrichtung versenden und den Empfang im Postfach prüfen.'}>
                      {smtpDirty ? <p className="mb-3 text-sm text-gray-600">Bitte die Änderungen zuerst speichern. Die Testmail nutzt die gespeicherte Einrichtung.</p>
                        : !savedSmtpSettings?.is_enabled && <p className="mb-3 text-sm text-gray-600">Bitte oben den E-Mail-Versand aktivieren und speichern.</p>}
                      <fieldset disabled={smtpBusy || !canManageSmtp} className="min-w-0 space-y-3 disabled:opacity-70">
                        <SettingsField id="smtp-test-recipient" label="Empfänger der Testmail" required hint="Am besten das eigene Postfach verwenden." error={testRecipientError}>
                          <input id="smtp-test-recipient" type="email" value={testEmailRecipient} onChange={e => { setTestEmailRecipient(e.target.value); setTestRecipientError(undefined); setTestResult(null); }} autoComplete="email" placeholder={savedSmtpSettings?.email_from || 'buero@example.de'} aria-invalid={!!testRecipientError} aria-describedby="smtp-test-recipient-message" className="form-input form-input-compact w-full" />
                        </SettingsField>
                        <details>
                          <summary className="cursor-pointer text-sm text-gray-700">Betreff und Nachricht anpassen (optional)</summary>
                          <div className="mt-3 space-y-3">
                            <SettingsField id="smtp-test-subject" label="Betreff">
                              <input id="smtp-test-subject" type="text" value={testEmailSubject} onChange={e => setTestEmailSubject(e.target.value)} placeholder="Test-E-Mail von SoloOffice" className="form-input form-input-compact w-full" />
                            </SettingsField>
                            <SettingsField id="smtp-test-message" label="Nachricht">
                              <textarea id="smtp-test-message" value={testEmailMessage} onChange={e => setTestEmailMessage(e.target.value)} rows={3} className="form-input w-full" />
                            </SettingsField>
                          </div>
                        </details>
                      </fieldset>
                      <button type="button" onClick={() => void sendTestEmail()} disabled={smtpBusy || smtpDirty || !savedSmtpSettings?.is_enabled || !canManageSmtp} className="btn-primary mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50">
                        {isSendingTest ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                        {isSendingTest ? 'Sendet …' : 'Testmail senden'}
                      </button>
                      {testResult && <p role={testResult.type === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${testResult.type === 'error' ? 'text-red-600' : testResult.type === 'warning' ? 'text-yellow-700' : 'text-green-700'}`}>{testResult.text}</p>}
                    </SettingsCard>
                  </>
                )}
              </div>
            </div>
          )}

        </div>
        </div>

        <SettingsSaveBar
          dirty={smtpDirty}
          saving={isSavingSettings}
          dirtyLabel="E-Mail-Einrichtung"
          message={smtpSaveMessage}
          saveDisabled={smtpBusy || !canManageSmtp}
          onSave={() => void saveSmtpSettings()}
          onDiscard={smtpBusy ? undefined : discardSmtpSettings}
        />

        {/* Email Detail Modal */}
        {selectedEmail && (
          <div className="dialog-overlay fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-60 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">E-Mail-Details</h3>
                <button
                  type="button"
                  onClick={() => setSelectedEmail(null)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
              
              <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-gray-500">Von:</label>
                      <p className="text-gray-900">{selectedEmail.sender_name} &lt;{selectedEmail.sender_email}&gt;</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-500">An:</label>
                      <p className="text-gray-900">{selectedEmail.recipient_email}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-500">Betreff:</label>
                      <p className="text-gray-900">{selectedEmail.subject}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-500">Gesendet am:</label>
                      <p className="text-gray-900">{formatDate(selectedEmail.sent_at)}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-500">Status:</label>
                      <div className="flex items-center space-x-2">
                        {getStatusIcon(selectedEmail.status)}
                        <span className={`text-sm px-2 py-1 rounded border ${getStatusColor(selectedEmail.status)}`}>
                          {selectedEmail.status === 'sent' ? 'Gesendet' : 'Fehlgeschlagen'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-500">Typ:</label>
                      <p className="text-gray-900">{selectedEmail.email_type}</p>
                    </div>
                  </div>

                  {selectedEmail.invoice_number && (
                    <div>
                      <label className="text-sm font-medium text-gray-500">Rechnung:</label>
                      <p className="text-gray-900">{selectedEmail.invoice_number}</p>
                    </div>
                  )}

                  {selectedEmail.customer_name && (
                    <div>
                      <label className="text-sm font-medium text-gray-500">{terminology.entity.singular}:</label>
                      <p className="text-gray-900">{selectedEmail.customer_name}</p>
                    </div>
                  )}

                  {selectedEmail.error_message && (
                    <div>
                      <label className="text-sm font-medium text-gray-500">Fehlermeldung:</label>
                      <p className="text-red-600 bg-red-50 p-3 rounded border border-red-200">{selectedEmail.error_message}</p>
                    </div>
                  )}

                  {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                    <div>
                      <label className="text-sm font-medium text-gray-500 mb-2 block">Anhänge:</label>
                      <div className="space-y-2">
                        {selectedEmail.attachments.map((attachment, index) => (
                          <div key={index} className="flex items-center space-x-2 p-2 bg-gray-50 rounded border border-gray-200">
                            <FileText className="h-4 w-4 text-gray-500" />
                            <span className="text-sm text-gray-900">{attachment.filename}</span>
                            {attachment.size && (
                              <span className="text-xs text-gray-500">({attachment.size} Bytes)</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedEmail.body_html && (
                    <div>
                      <label className="text-sm font-medium text-gray-500 mb-2 block">E-Mail-Inhalt:</label>
                      <div 
                        className="border border-gray-200 rounded-lg p-4 bg-gray-50 max-h-96 overflow-y-auto"
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedEmail.body_html) }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
