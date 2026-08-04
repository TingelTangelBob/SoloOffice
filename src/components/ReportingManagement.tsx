import { useState, useEffect, useCallback, useMemo } from 'react';
import logger from '../utils/logger';
import { 
  BarChart3, 
  Download, 
  FileText, 
  TrendingUp, 
  Users,
  DollarSign,
  RefreshCw,
  Filter,
  X,
  AlertCircle
} from 'lucide-react';
import { PageHeader } from './PageHeader';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useCompany } from '../context/CompanyContext';
import { apiService } from '../services/api';
import {
  InvoiceJournalResponse, 
  ReportingStatistics,
  InvoiceJournalEntry,
  CustomerStats,
  CreditNote,
  EuerEntry,
} from '../types';
import { formatCurrency, formatDate } from '../utils/formatters';
import { getTerminology } from '../utils/terminology';

interface ReportingManagementProps {
  onNavigate?: (page: string) => void;
}

export function ReportingManagement({ onNavigate }: ReportingManagementProps) {
  const { customers } = useCustomers();
  const { invoices } = useInvoices();
  const { company } = useCompany();
  const terminology = getTerminology(company?.terminologyProfile);
  const formatAmount = (amount: number) => formatCurrency(amount, company?.locale || 'de-DE', company?.numberFormat, company?.currency);
  
  // State for invoice journal
  const [journalData, setJournalData] = useState<InvoiceJournalResponse | null>(null);
  const [journalLoading, setJournalLoading] = useState(false);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  
  // State for statistics
  const [statistics, setStatistics] = useState<ReportingStatistics | null>(null);
  const [statisticsLoading, setStatisticsLoading] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [euerEntries, setEuerEntries] = useState<EuerEntry[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  
  // State for PDF generation
  const [generatingPDF, setGeneratingPDF] = useState(false);
  
  // Error handling
  const [error, setError] = useState<string>('');

  const loadJournalData = useCallback(async () => {
    setJournalLoading(true);
    setError('');
    try {
      const data = await apiService.getInvoiceJournal({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        customerId: selectedCustomer || undefined
      });
      setJournalData(data);
    } catch (err) {
      logger.error('Error loading journal data:', err);
      setError('Fehler beim Laden des Rechnungsjournals');
    } finally {
      setJournalLoading(false);
    }
  }, [endDate, selectedCustomer, startDate]);

  const loadStatistics = useCallback(async () => {
    setStatisticsLoading(true);
    setError('');
    try {
      const data = await apiService.getReportingStatistics(selectedYear);
      setStatistics(data);
    } catch (err) {
      logger.error('Error loading statistics:', err);
      setError('Fehler beim Laden der Statistiken');
    } finally {
      setStatisticsLoading(false);
    }
  }, [selectedYear]);

  const loadEuerData = useCallback(async () => {
    try {
      const [entries, notes] = await Promise.all([apiService.getEuerEntries(selectedYear), apiService.getCreditNotes()]);
      setEuerEntries(entries);
      setCreditNotes(notes);
    } catch (err) {
      logger.error('Error loading EÜR data:', err);
      setError('Fehler beim Laden der EÜR-Auswertung');
    }
  }, [selectedYear]);

  // Load initial data and refresh when the selected filters change.
  useEffect(() => {
    void loadJournalData();
    void loadStatistics();
    void loadEuerData();
  }, [loadEuerData, loadJournalData, loadStatistics]);

  const handleGeneratePDF = async () => {
    setGeneratingPDF(true);
    try {
      let title = 'Rechnungsjournal';
      if (startDate && endDate) {
        title += ` vom ${formatDate(startDate, company?.locale || 'de-DE', company?.dateFormat)} bis ${formatDate(endDate, company?.locale || 'de-DE', company?.dateFormat)}`;
      } else if (startDate) {
        title += ` ab ${formatDate(startDate, company?.locale || 'de-DE', company?.dateFormat)}`;
      } else if (endDate) {
        title += ` bis ${formatDate(endDate, company?.locale || 'de-DE', company?.dateFormat)}`;
      }

      await apiService.generateInvoiceJournalPDF({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        customerId: selectedCustomer || undefined,
        title
      });
    } catch (err) {
      logger.error('Error generating PDF:', err);
      setError('Fehler beim Erstellen des PDFs');
    } finally {
      setGeneratingPDF(false);
    }
  };

  const handleFilterChange = () => {
    loadJournalData();
  };

  const clearFilters = () => {
    setStartDate('');
    setEndDate('');
    setSelectedCustomer('');
  };

  const setTimePreset = (preset: string) => {
    const today = new Date();
    let start: Date, end: Date;

    switch (preset) {
      case 'thisMonth':
        // Erster Tag des aktuellen Monats
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        // Letzter Tag des aktuellen Monats
        end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        break;
      case 'lastMonth':
        // Erster Tag des letzten Monats
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        // Letzter Tag des letzten Monats
        end = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      case 'thisQuarter':
        {
          const currentQuarter = Math.floor(today.getMonth() / 3);
          // Erster Tag des aktuellen Quartals
          start = new Date(today.getFullYear(), currentQuarter * 3, 1);
          // Letzter Tag des aktuellen Quartals
          end = new Date(today.getFullYear(), (currentQuarter + 1) * 3, 0);
          break;
        }
      case 'thisYear':
        // 1. Januar des aktuellen Jahres
        start = new Date(today.getFullYear(), 0, 1);
        // 31. Dezember des aktuellen Jahres
        end = new Date(today.getFullYear(), 11, 31);
        break;
      case 'lastYear':
        // 1. Januar des letzten Jahres
        start = new Date(today.getFullYear() - 1, 0, 1);
        // 31. Dezember des letzten Jahres
        end = new Date(today.getFullYear() - 1, 11, 31);
        break;
      case 'last30days':
        // 30 Tage rückwirkend von heute
        start = new Date(today);
        start.setDate(today.getDate() - 30);
        end = new Date(today);
        break;
      default:
        return;
    }

    // Formatiere Datum zu YYYY-MM-DD für input[type="date"]
    const formatDate = (date: Date) => {
      return date.getFullYear() + '-' + 
             String(date.getMonth() + 1).padStart(2, '0') + '-' + 
             String(date.getDate()).padStart(2, '0');
    };

    setStartDate(formatDate(start));
    setEndDate(formatDate(end));
    
    // Automatisch filtern nach Preset-Auswahl

  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'text-green-600 bg-green-50';
      case 'overdue': return 'text-red-600 bg-red-50';
      case 'sent': return 'text-blue-600 bg-blue-50';
      case 'draft': return 'text-gray-600 bg-gray-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'paid': return 'Bezahlt';
      case 'overdue': return 'Überfällig';
      case 'sent': return 'Gesendet';
      case 'draft': return 'Entwurf';
      default: return status;
    }
  };

  const monthNames = [
    'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
    'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'
  ];

  const euerRows = useMemo(() => {
    const linkedInvoiceIds = new Set(euerEntries.filter(entry => entry.sourceType === 'invoice_payment' && entry.sourceId).map(entry => entry.sourceId));
    const automatic = [...invoices, ...creditNotes]
      .filter(invoice => invoice.status === 'paid' && new Date(invoice.issueDate).getFullYear() === selectedYear && !linkedInvoiceIds.has(invoice.id))
      .map(invoice => ({
        entryType: 'income' as const,
        date: String(invoice.issueDate).slice(0, 10),
        description: invoice.documentType === 'credit_note' ? `Gutschrift ${invoice.invoiceNumber}` : `Rechnung ${invoice.invoiceNumber}`,
        amount: invoice.documentType === 'credit_note' ? -Math.abs(Number(invoice.total || 0)) : Math.abs(Number(invoice.total || 0)),
      }));
    const manual = euerEntries.map(entry => ({
      entryType: entry.entryType,
      date: String(entry.entryDate).slice(0, 10),
      description: entry.description,
      amount: Number(entry.amount || 0),
    }));
    return [...automatic, ...manual];
  }, [creditNotes, euerEntries, invoices, selectedYear]);

  const euerSummary = useMemo(() => {
    const income = euerRows.filter(row => row.entryType === 'income').reduce((sum, row) => sum + row.amount, 0);
    const expenses = euerRows.filter(row => row.entryType === 'expense').reduce((sum, row) => sum + row.amount, 0);
    return { income, expenses, profit: income - expenses };
  }, [euerRows]);

  const euerMonthly = useMemo(() => Array.from({ length: 12 }, (_, month) => {
    const rows = euerRows.filter(row => new Date(`${row.date}T00:00:00`).getMonth() === month);
    const income = rows.filter(row => row.entryType === 'income').reduce((sum, row) => sum + row.amount, 0);
    const expenses = rows.filter(row => row.entryType === 'expense').reduce((sum, row) => sum + row.amount, 0);
    return { month, income, expenses, profit: income - expenses };
  }), [euerRows]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <PageHeader
          icon={BarChart3}
          title="Auswertungen"
          subtitle="Rechnungsjournale, Statistiken und Auswertungen"
        />
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center">
          <AlertCircle className="h-5 w-5 text-red-500 mr-2" />
          <span className="text-red-700">{error}</span>
          <button
            onClick={() => setError('')}
            className="ml-auto text-red-500 hover:text-red-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Statistics Cards */}
      {statistics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center">
              <div className="flex items-center justify-center w-10 h-10 bg-blue-100 rounded-lg">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Rechnungen {selectedYear}</p>
                <p className="text-2xl font-bold text-gray-900">
                  {statistics.yearOverview?.totalInvoices || 0}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center">
              <div className="flex items-center justify-center w-10 h-10 bg-green-100 rounded-lg">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Gesamtumsatz</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatAmount(statistics.yearOverview?.totalAmount || 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center">
              <div className="flex items-center justify-center w-10 h-10 bg-green-100 rounded-lg">
                <TrendingUp className="h-5 w-5 text-green-600" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Bezahlt</p>
                <p className="text-2xl font-bold text-green-600">
                  {formatAmount(statistics.yearOverview?.paidAmount || 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center">
              <div className="flex items-center justify-center w-10 h-10 bg-red-100 rounded-lg">
                <AlertCircle className="h-5 w-5 text-red-600" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Überfällig</p>
                <p className="text-2xl font-bold text-red-600">
                  {formatAmount(statistics.yearOverview?.overdueAmount || 0)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Invoice Journal Section */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-4 lg:p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <FileText className="h-5 w-5 text-primary-custom mr-2" />
                <h2 className="text-lg font-semibold text-gray-900">Rechnungsjournal</h2>
              </div>
              <button
                onClick={handleGeneratePDF}
                disabled={generatingPDF || journalLoading || !journalData}
                className="btn-primary text-white px-4 py-2 rounded-lg hover:brightness-90 transition-colors flex items-center space-x-2 disabled:opacity-50"
              >
                {generatingPDF ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span>{generatingPDF ? 'Erstelle PDF...' : 'PDF Export'}</span>
              </button>
            </div>

            {/* Filter Section */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center">
                <Filter className="h-4 w-4 mr-1" />
                Filter
              </h3>
              
              {/* Preset Filter Buttons */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  Schnellfilter
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setTimePreset('thisMonth')}
                    className="px-3 py-1 text-xs bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-colors"
                  >
                    Dieser Monat
                  </button>
                  <button
                    onClick={() => setTimePreset('lastMonth')}
                    className="px-3 py-1 text-xs bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-colors"
                  >
                    Letzter Monat
                  </button>
                  <button
                    onClick={() => setTimePreset('thisQuarter')}
                    className="px-3 py-1 text-xs bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-colors"
                  >
                    Dieses Quartal
                  </button>
                  <button
                    onClick={() => setTimePreset('thisYear')}
                    className="px-3 py-1 text-xs bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-colors"
                  >
                    Dieses Jahr
                  </button>
                  <button
                    onClick={() => setTimePreset('lastYear')}
                    className="px-3 py-1 text-xs bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-colors"
                  >
                    Letztes Jahr
                  </button>
                  <button
                    onClick={() => setTimePreset('last30days')}
                    className="px-3 py-1 text-xs bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-colors"
                  >
                    Letzte 30 Tage
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Von Datum
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Bis Datum
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    {terminology.entity.singular}
                  </label>
                  <select
                    value={selectedCustomer}
                    onChange={(e) => setSelectedCustomer(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  >
                    <option value="">Alle {terminology.entity.plural}</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={handleFilterChange}
                  disabled={journalLoading}
                  className="btn-secondary text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200 transition-colors flex items-center space-x-2"
                >
                  {journalLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Filter className="h-4 w-4" />
                  )}
                  <span>Filter anwenden</span>
                </button>
                <button
                  onClick={clearFilters}
                  className="text-gray-500 hover:text-gray-700 px-2 py-2 text-sm"
                >
                  Filter löschen
                </button>
              </div>
            </div>

            {/* Summary */}
            {journalData?.summary && (
              <div className="mb-4 p-4 bg-blue-50 rounded-lg">
                <h3 className="text-sm font-medium text-blue-900 mb-2">Zusammenfassung</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-700">{journalData.summary.totalInvoices}</div>
                    <div className="text-blue-600">Rechnungen</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-700">
                      {formatAmount(journalData.summary.subtotalSum)}
                    </div>
                    <div className="text-blue-600">Nettosumme</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-700">
                      {formatAmount(journalData.summary.totalAmount)}
                    </div>
                    <div className="text-blue-600">Bruttosumme</div>
                  </div>
                </div>
                {journalData.dateRange.startDate && journalData.dateRange.endDate && (
                  <div className="mt-3 text-center text-xs text-blue-600">
                    Zeitraum: {formatDate(journalData.dateRange.startDate, company?.locale || 'de-DE', company?.dateFormat)} - {formatDate(journalData.dateRange.endDate, company?.locale || 'de-DE', company?.dateFormat)}
                  </div>
                )}
              </div>
            )}

            {/* Journal Table */}
            {journalLoading ? (
              <div className="flex justify-center py-8">
                <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
              </div>
            ) : journalData?.invoices.length ? (
              <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-2 font-medium text-gray-700">Datum</th>
                      <th className="text-left py-3 px-2 font-medium text-gray-700">Rechnung</th>
                      <th className="text-left py-3 px-2 font-medium text-gray-700">{terminology.entity.singular}</th>
                      <th className="text-right py-3 px-2 font-medium text-gray-700">Betrag</th>
                      <th className="text-center py-3 px-2 font-medium text-gray-700">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journalData.invoices.map((invoice: InvoiceJournalEntry) => (
                      <tr key={invoice.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-2 text-xs">
                          {invoice.issueDate ? 
                            formatDate(invoice.issueDate, company?.locale || 'de-DE', company?.dateFormat) :
                            'N/A'
                          }
                        </td>
                        <td className="py-3 px-2 font-mono text-xs">
                          {invoice.invoiceNumber || 'N/A'}
                        </td>
                        <td className="py-3 px-2 text-xs max-w-32 truncate" title={invoice.customerName}>
                          {invoice.customerName || 'N/A'}
                        </td>
                        <td className="py-3 px-2 text-xs text-right font-medium">
                          {formatAmount(invoice.total || 0)}
                        </td>
                        <td className="py-3 px-2 text-center">
                          <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(invoice.status)}`}>
                            {getStatusText(invoice.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-gray-100 lg:hidden">
                {journalData.invoices.map((invoice: InvoiceJournalEntry) => (
                  <div key={invoice.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm text-gray-900">{invoice.invoiceNumber || 'N/A'}</p>
                        <p className="truncate text-sm text-gray-600">{invoice.customerName || 'N/A'}</p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-gray-900">
                        {formatAmount(invoice.total || 0)}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-gray-500">
                      <span>{invoice.issueDate ? formatDate(invoice.issueDate, company?.locale || 'de-DE', company?.dateFormat) : 'N/A'}</span>
                      <span className={`inline-block rounded-full px-2 py-1 font-medium ${getStatusColor(invoice.status)}`}>
                        {getStatusText(invoice.status)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              </>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Keine Rechnungen für den ausgewählten Zeitraum</p>
              </div>
            )}
          </div>
        </div>

        {/* Statistics Section */}
        <div className="space-y-6">
          {/* Year Selector & Monthly Revenue Chart */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 lg:p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <BarChart3 className="h-5 w-5 text-primary-custom mr-2" />
                <h2 className="text-lg font-semibold text-gray-900">Jahresstatistik</h2>
              </div>
              <div className="flex items-center space-x-2">
                <select
                  value={selectedYear}
                  onChange={(e) => {
                    setSelectedYear(parseInt(e.target.value));
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-custom"
                >
                  {Array.from({ length: 5 }, (_, i) => {
                    const year = new Date().getFullYear() - i;
                    return (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    );
                  })}
                </select>
                <button
                  onClick={loadStatistics}
                  disabled={statisticsLoading}
                  className="text-primary-custom hover:text-primary-custom/80"
                >
                  <RefreshCw className={`h-4 w-4 ${statisticsLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {statisticsLoading ? (
              <div className="flex justify-center py-8">
                <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
              </div>
            ) : statistics?.monthlyRevenue ? (
              <div>
                {/* Simple bar chart visualization */}
                <div className="space-y-2">
                  {Array.from({ length: 12 }, (_, i) => {
                    const monthData = statistics.monthlyRevenue.find(m => m.month === i + 1);
                    const maxValue = Math.max(...statistics.monthlyRevenue.map(m => m.totalSum));
                    const percentage = maxValue > 0 ? ((monthData?.totalSum || 0) / maxValue) * 100 : 0;
                    
                    return (
                      <div key={i} className="flex items-center space-x-2">
                        <div className="w-8 text-xs text-gray-600">
                          {monthNames[i]}
                        </div>
                        <div className="flex-1 bg-gray-200 rounded-full h-4 relative">
                          <div
                            className="bg-primary-custom h-4 rounded-full transition-all duration-500"
                            style={{ width: `${percentage}%` }}
                          ></div>
                          {monthData && (
                            <span className="absolute right-2 top-0 h-4 flex items-center text-xs text-white font-medium">
                              {formatAmount(monthData.totalSum)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <BarChart3 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Keine Daten für {selectedYear} verfügbar</p>
              </div>
            )}
          </div>

          {/* Top Customers */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 lg:p-6">
            <div className="flex items-center mb-4">
              <Users className="h-5 w-5 text-primary-custom mr-2" />
              <h2 className="text-lg font-semibold text-gray-900">Top {terminology.entity.plural} {selectedYear}</h2>
            </div>

            {statistics?.topCustomers.length ? (
              <div className="space-y-3">
                {statistics.topCustomers.slice(0, 5).map((customer: CustomerStats, index) => (
                  <div key={customer.customerId} className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="flex items-center justify-center w-6 h-6 bg-primary-custom text-white rounded-full text-xs font-bold">
                        {index + 1}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{customer.customerName}</p>
                        <p className="text-xs text-gray-500">
                          {customer.invoiceCount} Rechnung{customer.invoiceCount !== 1 ? 'en' : ''}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900">
                        {formatAmount(customer.totalRevenue)}
                      </p>
                      <p className="text-xs text-gray-500">
                        Ø {formatAmount(customer.avgInvoiceAmount)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Keine {terminology.entity.dataLabel} verfügbar</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-gray-900">EÜR-Auswertung {selectedYear}</h2><p className="mt-1 text-sm text-gray-500">Einnahmen, Ausgaben und Überschuss aus dem EÜR-Journal an einem Ort.</p></div>
          <button type="button" onClick={() => onNavigate?.('euer')} className="action-button flex items-center gap-2">EÜR öffnen <TrendingUp className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Einnahmen</p><p className="mt-1 font-semibold text-emerald-900">{formatAmount(euerSummary.income)}</p></div><div className="rounded-lg bg-rose-50 p-3"><p className="text-xs text-rose-700">Ausgaben</p><p className="mt-1 font-semibold text-rose-900">{formatAmount(euerSummary.expenses)}</p></div><div className="rounded-lg bg-blue-50 p-3"><p className="text-xs text-blue-700">Überschuss</p><p className="mt-1 font-semibold text-blue-900">{formatAmount(euerSummary.profit)}</p></div></div>
        <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead><tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500"><th className="px-3 py-3">Monat</th><th className="px-3 py-3 text-right">Einnahmen</th><th className="px-3 py-3 text-right">Ausgaben</th><th className="px-3 py-3 text-right">Überschuss</th></tr></thead><tbody>{euerMonthly.map(item => <tr key={item.month} className="border-b border-gray-100"><td className="px-3 py-2 font-medium text-gray-700">{monthNames[item.month]}</td><td className="px-3 py-2 text-right text-emerald-700">{formatAmount(item.income)}</td><td className="px-3 py-2 text-right text-rose-700">{formatAmount(item.expenses)}</td><td className="px-3 py-2 text-right font-medium text-gray-900">{formatAmount(item.profit)}</td></tr>)}</tbody></table></div>
        <p className="mt-4 text-xs text-gray-500">Die EÜR-Auswertung ist eine vorbereitende Arbeitsunterlage. Zahlungseingangsdaten und Teilzahlungen sollten geprüft werden.</p>
      </section>
    </div>
  );
}
