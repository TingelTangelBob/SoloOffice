import { useState, useEffect, useCallback } from 'react';
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
  Database,
  Lock
} from 'lucide-react';
import { apiService } from '../services/api';
import { useCompany } from '../context/CompanyContext';
import { formatDate as formatDateValue, formatTime } from '../utils/formatters';
import { getTerminology } from '../utils/terminology';

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

interface SmtpSettings {
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string;
  email_from: string;
  email_from_name: string;
  is_enabled: boolean;
  test_email: string;
}

interface EmailManagementProps {
  onClose?: () => void;
}

export function EmailManagement({ onClose }: EmailManagementProps) {
  const { company } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const [activeTab, setActiveTab] = useState<'history' | 'settings' | 'test' | 'statistics'>('history');
  
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

  // SMTP Settings State
  const [smtpSettings, setSmtpSettings] = useState<SmtpSettings>({
    smtp_host: '',
    smtp_port: 587,
    smtp_secure: false,
    smtp_user: '',
    smtp_pass: '',
    email_from: '',
    email_from_name: '',
    is_enabled: false,
    test_email: ''
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testEmailRecipient, setTestEmailRecipient] = useState('');
  const [testEmailSubject, setTestEmailSubject] = useState('');
  const [testEmailMessage, setTestEmailMessage] = useState('');

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
    try {
      const data = await apiService.getSmtpSettings<SmtpSettings>();
      
      if (data.success) {
        setSmtpSettings(data.settings);
        setTestEmailRecipient(data.settings.test_email || '');
      } else {
        setMessage({ type: 'error', text: 'Fehler beim Laden der SMTP-Einstellungen' });
      }
    } catch (error) {
      logger.error('Error loading SMTP settings:', error);
      setMessage({ type: 'error', text: 'Fehler beim Laden der SMTP-Einstellungen' });
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'history') {
      void loadEmails();
    } else if (activeTab === 'settings') {
      void loadSmtpSettings();
    } else if (activeTab === 'statistics') {
      void loadStatistics();
    }
  }, [activeTab, loadEmails, loadSmtpSettings, loadStatistics]);

  const saveSmtpSettings = async () => {
    setIsSavingSettings(true);
    try {
      const data = await apiService.saveSmtpSettings({
        ...smtpSettings,
        test_email: testEmailRecipient
      });
      
      if (data.success) {
        setMessage({ type: 'success', text: 'SMTP-Einstellungen erfolgreich gespeichert' });
      } else {
        setMessage({ type: 'error', text: data.message || 'Fehler beim Speichern der SMTP-Einstellungen' });
      }
    } catch (error) {
      logger.error('Error saving SMTP settings:', error);
      setMessage({ type: 'error', text: 'Fehler beim Speichern der SMTP-Einstellungen' });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const testSmtpConnection = async () => {
    setIsTestingConnection(true);
    try {
      const useDatabaseSettings = smtpSettings.smtp_pass === '****' || !smtpSettings.smtp_host;
      const data = await apiService.testSmtpConnection(
        useDatabaseSettings,
        useDatabaseSettings ? null : smtpSettings,
      );
      
      if (data.success) {
        setMessage({ type: 'success', text: data.message });
      } else {
        setMessage({ type: 'error', text: data.message });
      }
    } catch (error) {
      logger.error('Error testing SMTP:', error);
      setMessage({ type: 'error', text: 'Fehler beim Testen der SMTP-Verbindung' });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const sendTestEmail = async () => {
    if (!testEmailRecipient) {
      setMessage({ type: 'error', text: 'Bitte geben Sie eine Empfänger-E-Mail-Adresse ein' });
      return;
    }

    setIsSendingTest(true);
    try {
      const data = await apiService.sendTestEmail(
        testEmailRecipient,
        testEmailSubject || undefined,
        testEmailMessage || undefined
      );
      
      if (data.success) {
        setMessage({ 
          type: 'success', 
          text: `Test-E-Mail erfolgreich an ${testEmailRecipient} versendet` 
        });
        setTestEmailSubject('');
        setTestEmailMessage('');
        // Reload email history to show the test email
        if (activeTab === 'history') {
          loadEmails();
        }
      } else {
        setMessage({ type: 'error', text: data.message });
      }
    } catch (error) {
      logger.error('Error sending test email:', error);
      setMessage({ type: 'error', text: 'Fehler beim Versenden der Test-E-Mail' });
    } finally {
      setIsSendingTest(false);
    }
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl max-w-7xl w-full max-h-[95vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center">
            <Mail className="h-6 w-6 text-primary-custom mr-3" />
            <h2 className="text-xl font-semibold text-gray-900">E-Mail-Verwaltung</h2>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-6 w-6" />
            </button>
          )}
        </div>

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
              onClick={() => setMessage(null)}
              className="ml-auto text-current opacity-70 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-6 flex-shrink-0">
          <button
            onClick={() => setActiveTab('history')}
            className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'history'
                ? 'border-primary-custom text-primary-custom'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center space-x-2">
              <Mail className="h-4 w-4" />
              <span>E-Mail-Historie</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('statistics')}
            className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'statistics'
                ? 'border-primary-custom text-primary-custom'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center space-x-2">
              <TrendingUp className="h-4 w-4" />
              <span>Statistiken</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'settings'
                ? 'border-primary-custom text-primary-custom'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center space-x-2">
              <Settings className="h-4 w-4" />
              <span>SMTP-Konfiguration</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('test')}
            className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'test'
                ? 'border-primary-custom text-primary-custom'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center space-x-2">
              <TestTube className="h-4 w-4" />
              <span>Test-E-Mail</span>
            </div>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Email History Tab */}
          {activeTab === 'history' && (
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
                    onClick={() => loadEmails(1)}
                    disabled={isLoading}
                    className="px-4 py-2 bg-primary-custom text-white rounded-lg hover:brightness-90 transition-colors disabled:opacity-50 flex items-center space-x-2"
                  >
                    <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
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
                  <div className="flex flex-col items-center justify-center h-64">
                    <Mail className="h-12 w-12 text-gray-400 mb-4" />
                    <p className="text-gray-500">Keine E-Mails gefunden</p>
                  </div>
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
                      onClick={() => loadEmails(currentPage - 1)}
                      disabled={currentPage <= 1 || isLoading}
                      className="px-4 py-2 border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      Zurück
                    </button>
                    <button
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

          {/* Statistics Tab */}
          {activeTab === 'statistics' && (
            <div className="p-6">
              {isLoadingStats ? (
                <div className="flex items-center justify-center h-64">
                  <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
                  <span className="ml-2 text-gray-600">Lade Statistiken...</span>
                </div>
              ) : statistics ? (
                <div className="space-y-6">
                  {/* Overview Stats */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                      <div className="flex items-center">
                        <Database className="h-8 w-8 text-blue-500 mr-3" />
                        <div>
                          <p className="text-sm text-blue-600">Gesamt</p>
                          <p className="text-2xl font-bold text-blue-900">{statistics.total.toLocaleString('de-DE')}</p>
                        </div>
                      </div>
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                      <div className="flex items-center">
                        <CheckCircle className="h-8 w-8 text-green-500 mr-3" />
                        <div>
                          <p className="text-sm text-green-600">Gesendet</p>
                          <p className="text-2xl font-bold text-green-900">{statistics.sent.toLocaleString('de-DE')}</p>
                        </div>
                      </div>
                    </div>
                    <div className="bg-red-50 border border-red-200 rounded-lg p-6">
                      <div className="flex items-center">
                        <XCircle className="h-8 w-8 text-red-500 mr-3" />
                        <div>
                          <p className="text-sm text-red-600">Fehlgeschlagen</p>
                          <p className="text-2xl font-bold text-red-900">{statistics.failed.toLocaleString('de-DE')}</p>
                        </div>
                      </div>
                    </div>
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
                      <div className="flex items-center">
                        <Calendar className="h-8 w-8 text-purple-500 mr-3" />
                        <div>
                          <p className="text-sm text-purple-600">Letzte 30 Tage</p>
                          <p className="text-2xl font-bold text-purple-900">{statistics.last30Days.toLocaleString('de-DE')}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Top Recipients */}
                  {statistics.topRecipients.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Häufigste Empfänger</h3>
                      <div className="space-y-3">
                        {statistics.topRecipients.slice(0, 10).map((recipient, index) => (
                          <div key={recipient.recipient_email} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <div className="flex items-center space-x-3">
                              <div className="flex-shrink-0 w-6 h-6 bg-primary-custom text-white rounded-full flex items-center justify-center text-xs font-bold">
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
                <div className="flex flex-col items-center justify-center h-64">
                  <TrendingUp className="h-12 w-12 text-gray-400 mb-4" />
                  <p className="text-gray-500">Keine Statistiken verfügbar</p>
                </div>
              )}
            </div>
          )}

          {/* SMTP Settings Tab */}
          {activeTab === 'settings' && (
            <div className="p-6">
              <div className="max-w-2xl mx-auto space-y-6">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start">
                    <Lock className="h-5 w-5 text-blue-500 mr-3 mt-0.5" />
                    <div>
                      <h3 className="font-medium text-blue-900">SMTP-Konfiguration</h3>
                      <p className="text-sm text-blue-800 mt-1">
                        Diese Einstellungen überschreiben die Backend-Umgebungsvariablen. Alle E-Mails werden über diese Konfiguration versendet, wenn sie aktiviert ist.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <label className="text-sm font-medium text-gray-700">
                      SMTP-Konfiguration aktivieren
                    </label>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={smtpSettings.is_enabled}
                        onChange={(e) => setSmtpSettings(prev => ({ ...prev, is_enabled: e.target.checked }))}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-custom/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-custom"></div>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        SMTP-Server *
                      </label>
                      <input
                        type="text"
                        required
                        value={smtpSettings.smtp_host}
                        onChange={(e) => setSmtpSettings(prev => ({ ...prev, smtp_host: e.target.value }))}
                        placeholder="smtp.gmail.com"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom/20"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Port *
                      </label>
                      <input
                        type="number"
                        required
                        min="1"
                        max="65535"
                        value={smtpSettings.smtp_port}
                        onChange={(e) => setSmtpSettings(prev => ({ ...prev, smtp_port: parseInt(e.target.value) || 587 }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom/20"
                      />
                    </div>
                  </div>

                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="smtp_secure"
                      checked={smtpSettings.smtp_secure}
                      onChange={(e) => setSmtpSettings(prev => ({ ...prev, smtp_secure: e.target.checked }))}
                      className="custom-checkbox"
                    />
                    <label htmlFor="smtp_secure" className="ml-3 text-sm font-medium text-gray-700 cursor-pointer">
                      SSL/TLS verwenden (für Port 465)
                    </label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Benutzername *
                      </label>
                      <input
                        type="text"
                        required
                        value={smtpSettings.smtp_user}
                        onChange={(e) => setSmtpSettings(prev => ({ ...prev, smtp_user: e.target.value }))}
                        placeholder="ihr-email@example.com"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom/20"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Passwort *
                      </label>
                      <input
                        type="password"
                        required
                        value={smtpSettings.smtp_pass}
                        onChange={(e) => setSmtpSettings(prev => ({ ...prev, smtp_pass: e.target.value }))}
                        placeholder={smtpSettings.smtp_pass ? '****' : 'Ihr SMTP-Passwort'}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom/20"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Absender-E-Mail *
                      </label>
                      <input
                        type="email"
                        required
                        value={smtpSettings.email_from}
                        onChange={(e) => setSmtpSettings(prev => ({ ...prev, email_from: e.target.value }))}
                        placeholder="noreply@example.com"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom/20"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Absender-Name
                      </label>
                      <input
                        type="text"
                        value={smtpSettings.email_from_name}
                        onChange={(e) => setSmtpSettings(prev => ({ ...prev, email_from_name: e.target.value }))}
                        placeholder="SoloOffice"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Test-E-Mail-Adresse
                    </label>
                    <input
                      type="email"
                      value={testEmailRecipient}
                      onChange={(e) => setTestEmailRecipient(e.target.value)}
                      placeholder="test@example.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom/20"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Standard-Empfänger für Test-E-Mails
                    </p>
                  </div>

                  <div className="flex items-center space-x-3 pt-4">
                    <button
                      onClick={saveSmtpSettings}
                      disabled={isSavingSettings}
                      className="btn-primary text-white px-6 py-2 rounded-lg hover:brightness-90 transition-colors disabled:opacity-50 flex items-center space-x-2"
                    >
                      {isSavingSettings ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Settings className="h-4 w-4" />
                      )}
                      <span>{isSavingSettings ? 'Speichert...' : 'Speichern'}</span>
                    </button>
                    <button
                      onClick={testSmtpConnection}
                      disabled={isTestingConnection}
                      className="btn-secondary text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 flex items-center space-x-2"
                    >
                      {isTestingConnection ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <TestTube className="h-4 w-4" />
                      )}
                      <span>{isTestingConnection ? 'Teste...' : 'Verbindung testen'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Test Email Tab */}
          {activeTab === 'test' && (
            <div className="p-6">
              <div className="max-w-2xl mx-auto space-y-6">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-start">
                    <TestTube className="h-5 w-5 text-green-500 mr-3 mt-0.5" />
                    <div>
                      <h3 className="font-medium text-green-900">Test-E-Mail senden</h3>
                      <p className="text-sm text-green-800 mt-1">
                        Senden Sie eine Test-E-Mail, um Ihre SMTP-Konfiguration zu überprüfen.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Empfänger-E-Mail-Adresse *
                    </label>
                    <input
                      type="email"
                      required
                      value={testEmailRecipient}
                      onChange={(e) => setTestEmailRecipient(e.target.value)}
                      placeholder="empfaenger@example.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom/20"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Betreff (optional)
                    </label>
                    <input
                      type="text"
                      value={testEmailSubject}
                      onChange={(e) => setTestEmailSubject(e.target.value)}
                        placeholder="Test-E-Mail von SoloOffice"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom/20"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Nachricht (optional)
                    </label>
                    <textarea
                      value={testEmailMessage}
                      onChange={(e) => setTestEmailMessage(e.target.value)}
                      placeholder="Zusätzliche Nachricht für die Test-E-Mail..."
                      rows={4}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom/20"
                    />
                  </div>

                  <div className="flex items-center space-x-3 pt-4">
                    <button
                      onClick={sendTestEmail}
                      disabled={isSendingTest || !testEmailRecipient}
                      className="btn-primary text-white px-6 py-2 rounded-lg hover:brightness-90 transition-colors disabled:opacity-50 flex items-center space-x-2"
                    >
                      {isSendingTest ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      <span>{isSendingTest ? 'Sendet...' : 'Test-E-Mail senden'}</span>
                    </button>
                  </div>

                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Hinweise:</h4>
                    <ul className="text-xs text-gray-600 space-y-1">
                      <li>• Die Test-E-Mail wird mit der aktuellen SMTP-Konfiguration versendet</li>
                      <li>• Stellen Sie sicher, dass die SMTP-Einstellungen gespeichert und aktiviert sind</li>
                      <li>• Die Test-E-Mail wird in der E-Mail-Historie gespeichert</li>
                      <li>• Bei Fehlern überprüfen Sie die SMTP-Konfiguration und Verbindung</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Email Detail Modal */}
        {selectedEmail && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-60 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">E-Mail-Details</h3>
                <button
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
                        dangerouslySetInnerHTML={{ __html: selectedEmail.body_html }}
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
