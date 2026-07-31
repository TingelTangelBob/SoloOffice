import { useState, useEffect } from 'react';
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
import { apiService } from '../services/api';
import { 
  InvoiceJournalResponse, 
  ReportingStatistics,
  InvoiceJournalEntry,
  CustomerStats 
} from '../types';

export function ReportingManagement() {
  const { customers } = useCustomers();
  
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
  
  // State for PDF generation
  const [generatingPDF, setGeneratingPDF] = useState(false);
  
  // Error handling
  const [error, setError] = useState<string>('');

  // Load initial data
  useEffect(() => {
    loadJournalData();
    loadStatistics();
  }, []);

  const loadJournalData = async () => {
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
  };

  const loadStatistics = async () => {
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
  };

  const handleGeneratePDF = async () => {
    setGeneratingPDF(true);
    try {
      let title = 'Rechnungsjournal';
      if (startDate && endDate) {
        title += ` vom ${new Date(startDate).toLocaleDateString('de-DE')} bis ${new Date(endDate).toLocaleDateString('de-DE')}`;
      } else if (startDate) {
        title += ` ab ${new Date(startDate).toLocaleDateString('de-DE')}`;
      } else if (endDate) {
        title += ` bis ${new Date(endDate).toLocaleDateString('de-DE')}`;
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
    setTimeout(() => loadJournalData(), 100);
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
        const currentQuarter = Math.floor(today.getMonth() / 3);
        // Erster Tag des aktuellen Quartals
        start = new Date(today.getFullYear(), currentQuarter * 3, 1);
        // Letzter Tag des aktuellen Quartals
        end = new Date(today.getFullYear(), (currentQuarter + 1) * 3, 0);
        break;
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
    setTimeout(() => loadJournalData(), 100);
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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <PageHeader
          icon={BarChart3}
          title="Reporting & Auswertungen"
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
                  {(statistics.yearOverview?.totalAmount || 0).toLocaleString('de-DE', { 
                    style: 'currency', 
                    currency: 'EUR' 
                  })}
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
                  {(statistics.yearOverview?.paidAmount || 0).toLocaleString('de-DE', { 
                    style: 'currency', 
                    currency: 'EUR' 
                  })}
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
                  {(statistics.yearOverview?.overdueAmount || 0).toLocaleString('de-DE', { 
                    style: 'currency', 
                    currency: 'EUR' 
                  })}
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
                    Kunde
                  </label>
                  <select
                    value={selectedCustomer}
                    onChange={(e) => setSelectedCustomer(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  >
                    <option value="">Alle Kunden</option>
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
                      {journalData.summary.subtotalSum.toLocaleString('de-DE', { 
                        style: 'currency', 
                        currency: 'EUR' 
                      })}
                    </div>
                    <div className="text-blue-600">Nettosumme</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-700">
                      {journalData.summary.totalAmount.toLocaleString('de-DE', { 
                        style: 'currency', 
                        currency: 'EUR' 
                      })}
                    </div>
                    <div className="text-blue-600">Bruttosumme</div>
                  </div>
                </div>
                {journalData.dateRange.startDate && journalData.dateRange.endDate && (
                  <div className="mt-3 text-center text-xs text-blue-600">
                    Zeitraum: {new Date(journalData.dateRange.startDate).toLocaleDateString('de-DE')} - {new Date(journalData.dateRange.endDate).toLocaleDateString('de-DE')}
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-2 font-medium text-gray-700">Rechnung</th>
                      <th className="text-left py-3 px-2 font-medium text-gray-700">Datum</th>
                      <th className="text-left py-3 px-2 font-medium text-gray-700">Kunde</th>
                      <th className="text-right py-3 px-2 font-medium text-gray-700">Betrag</th>
                      <th className="text-center py-3 px-2 font-medium text-gray-700">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journalData.invoices.map((invoice: InvoiceJournalEntry) => (
                      <tr key={invoice.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-2 font-mono text-xs">
                          {invoice.invoiceNumber || 'N/A'}
                        </td>
                        <td className="py-3 px-2 text-xs">
                          {invoice.issueDate ? 
                            new Date(invoice.issueDate).toLocaleDateString('de-DE') : 
                            'N/A'
                          }
                        </td>
                        <td className="py-3 px-2 text-xs max-w-32 truncate" title={invoice.customerName}>
                          {invoice.customerName || 'N/A'}
                        </td>
                        <td className="py-3 px-2 text-xs text-right font-medium">
                          {(invoice.total || 0).toLocaleString('de-DE', { 
                            style: 'currency', 
                            currency: 'EUR' 
                          })}
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
                    setTimeout(() => loadStatistics(), 100);
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
                              {monthData.totalSum.toLocaleString('de-DE', { 
                                style: 'currency', 
                                currency: 'EUR',
                                maximumFractionDigits: 0
                              })}
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
              <h2 className="text-lg font-semibold text-gray-900">Top Kunden {selectedYear}</h2>
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
                        {customer.totalRevenue.toLocaleString('de-DE', { 
                          style: 'currency', 
                          currency: 'EUR' 
                        })}
                      </p>
                      <p className="text-xs text-gray-500">
                        Ø {customer.avgInvoiceAmount.toLocaleString('de-DE', { 
                          style: 'currency', 
                          currency: 'EUR' 
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Keine Kundendaten verfügbar</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
