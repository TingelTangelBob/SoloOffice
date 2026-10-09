import React, { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import logger from '../utils/logger';
import { Banknote, Briefcase, CalendarDays, ChevronRight, FileCheck, FilePlus2, FileText, GraduationCap, Import, MoreHorizontal, Send, SlidersHorizontal, Upload, Users, Wallet } from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useJobs } from '../context/JobContext';
import { useCompany } from '../context/CompanyContext';
import { useLoading } from '../context/LoadingContext';
import { calculateTotalHours } from '../utils/jobUtils';
import { formatCurrency, formatDate, formatNumber, formatTime } from '../utils/formatters';
import { compareTableValues } from '../utils/tableSort';
import { blobToBase64 } from '../utils/blobUtils';
import { EmailSendModal } from './EmailSendModal';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { processAttachments } from '../utils/fileUtils';
import { apiService } from '../services/api';
import type { EuerEntry, Invoice, JobEntry, NumberFormat, Receipt, TimeFormat } from '../types';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { SwitchTrack } from './ToggleSwitch';
import { useAuth } from '../context/AuthContext';
import { useQuotes } from '../context/QuoteContext';
import {
  DASHBOARD_SIZE_SPANS,
  DEFAULT_DASHBOARD_PREFERENCES,
  balancedColumns,
  dashboardItemSize,
  dashboardLayoutChanged,
  isCardItem,
  isQuickItem,
  moveDashboardItem,
  nextDashboardSize,
  normalizeDashboardPreferences,
  getDashboardItemDefinition,
  packDashboardRows,
  resetDashboardLayout,
  resizeDashboardItem,
  setDashboardItemVisible,
  type DashboardCardItemId,
  type DashboardItemId,
  type DashboardPreferences,
  type DashboardQuickItemId,
} from '../utils/dashboardPreferences';
import {
  aggregateRevenue,
  averageInvoiceAmount,
  buildRevenueRecords,
  compareRevenue,
  countActiveCustomers,
  sumRevenue,
  summarizeIncomeExpense,
  summarizeOpenInvoices,
  summarizeOpenQuotes,
  upcomingJobs,
} from '../utils/dashboardMetrics';
import { REVENUE_CHART_SERIES, getForecastRevenuePoints } from '../utils/dashboardChartSeries';
import {
  DeltaBadge,
  MetricBadge,
  MetricCard,
  MetricCardContent,
  MetricCardDescription,
  MetricCardFooterAction,
  MetricCardHeader,
  MetricCardTitle,
  MetricValue,
  ShareBarItem,
  ShareBarList,
} from './DashboardMetrics';
import { RevenueAreaChart, type RevenuePoint } from './RevenueAreaChart';
import { DashboardMonthSelector } from './DashboardMonthSelector';
import { MonthlyRevenueChart, type MonthlyRevenueComparisonRow } from './MonthlyRevenueChart';
import { IncomeExpenseChart } from './IncomeExpenseChart';
import { DashboardEmptyState } from './DashboardEmptyState';
import { DashboardEditItem, DashboardEditToolbar, DashboardSortableGroup } from './DashboardEditMode';
import { FloatingInfoTooltip, FloatingTooltipBubble } from './InfoTooltip';
import { useFloatingTooltip } from '../hooks/useFloatingTooltip';

import { getTerminology } from '../utils/terminology';
import { useFeedback } from '../context/FeedbackContext';
import { SkeletonBlock } from './TableSkeleton';
import { useExtensions } from '../hooks/useExtensions';
import { useForecast } from '../hooks/useForecast';
import { useVatOverview } from '../hooks/useVatOverview';
import { VatDashboardCard } from './VatDashboardCard';
import { TAX_TEXTS } from '../../backend/shared/taxTexts.js';
import { TaxDashboardCards, type TaxDashboardCardId } from './TaxDashboardCards';
import {
  filterDashboardPointsByMonth,
  filterDashboardRecordsByMonth,
  enqueueDashboardPreferenceSave,
  isDashboardCardVisibleForPrivateView,
  moveDashboardMonthSelection,
  resolveDashboardPeriod,
  sumDashboardRecordsByMonth,
} from '../utils/dashboardPeriod';

interface DashboardProps {
  onNavigate: (page: string, filter?: string, searchTerm?: string, invoiceId?: string, jobSeriesId?: string) => void;
}

type DashboardCourseSeries = {
  key: string;
  job: JobEntry;
  jobs: JobEntry[];
};

type DashboardRevenueRecord = { customerName: string; date: Date; amount: number };

/* Rasterbreiten als feste Klassennamen, damit Tailwind sie beim Bauen findet:
   Tablet zwei Spalten, Desktop zwölf (siehe `packDashboardRows`). */
const MD_SPAN_CLASS: Record<number, string> = { 1: 'md:col-span-1', 2: 'md:col-span-2' };
const LG_SPAN_CLASS: Record<number, string> = {
  1: 'lg:col-span-1', 2: 'lg:col-span-2', 3: 'lg:col-span-3', 4: 'lg:col-span-4',
  5: 'lg:col-span-5', 6: 'lg:col-span-6', 7: 'lg:col-span-7', 8: 'lg:col-span-8',
  9: 'lg:col-span-9', 10: 'lg:col-span-10', 11: 'lg:col-span-11', 12: 'lg:col-span-12',
};

function parseLocalJobDate(value: Date | string | number): Date {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  if (typeof value === 'string') {
    const datePart = value.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      return new Date(`${datePart}T00:00:00`);
    }
  }

  const parsed = new Date(value);
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function getWeekStart(value: Date): Date {
  const start = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const isoWeekday = start.getDay() === 0 ? 7 : start.getDay();
  start.setDate(start.getDate() - isoWeekday + 1);
  return start;
}

function getCalendarWeek(value: Date): number {
  const target = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getJobTimeRange(
  job: JobEntry,
  locale: string,
  timeFormat?: TimeFormat,
  numberFormat?: NumberFormat,
): string {
  const firstTimeEntry = job.timeEntries?.find(entry => entry.startTime || entry.endTime);
  const startTime = job.startTime || firstTimeEntry?.startTime;
  const endTime = job.endTime || firstTimeEntry?.endTime;

  if (startTime && endTime) {
    return `${formatTime(startTime, locale, timeFormat)} – ${formatTime(endTime, locale, timeFormat)}`;
  }

  if (startTime) {
    return `ab ${formatTime(startTime, locale, timeFormat)}`;
  }

  const hours = calculateTotalHours(job);
  return hours > 0 ? `${formatNumber(hours, locale, numberFormat, 1)} Std.` : 'Zeit offen';
}

function getJobStatusDotColor(status: JobEntry['status']): string {
  switch (status) {
    case 'in-progress': return 'bg-yellow-500';
    case 'completed': return 'bg-green-500';
    case 'invoiced': return 'bg-blue-500';
    default: return 'bg-gray-400';
  }
}

function getJobStatusLabel(status: JobEntry['status']): string {
  switch (status) {
    case 'in-progress': return 'In Bearbeitung';
    case 'completed': return 'Abgeschlossen';
    case 'invoiced': return 'Abgerechnet';
    default: return 'Entwurf';
  }
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const { notify } = useFeedback();
  const { customers } = useCustomers();
  const { invoices, updateInvoice } = useInvoices();
  const { jobEntries } = useJobs();
  const { company } = useCompany();
  const { user, can } = useAuth();
  const hasSettingsPermission = can('workspace.settings');
  const { isEnabled: isExtensionEnabled } = useExtensions();
  const taxesEnabled = hasSettingsPermission && isExtensionEnabled('taxes');
  // Die USt-Kachel ist betrieblich: Erweiterung genügt, Einstellungsrecht nicht nötig.
  const vatCardEnabled = isExtensionEnabled('taxes');
  const terminology = getTerminology(company.terminologyProfile);
  const { loading } = useLoading();
  const [preferences, setPreferences] = useState<DashboardPreferences>(DEFAULT_DASHBOARD_PREFERENCES);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [preferencesError, setPreferencesError] = useState(false);
  const preferenceSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const preferenceSaveVersion = useRef(0);
  const [euerEntries, setEuerEntries] = useState<EuerEntry[]>([]);
  const { quotes } = useQuotes();
  /** Entwurf des Bearbeiten-Modus; `null` = normale Ansicht. */
  const [editDraft, setEditDraft] = useState<DashboardPreferences | null>(null);
  const [liveMessage, setLiveMessage] = useState('');
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const earlyPeriod = resolveDashboardPeriod(preferences);
  const forecastYear = earlyPeriod.selectedYear;
  const { forecast, loading: forecastLoading, error: forecastError } = useForecast(forecastYear, taxesEnabled && (preferences.monthView || preferences.year !== 'all'));
  const vatCardWanted = vatCardEnabled && !earlyPeriod.allYears && (editDraft ?? preferences).items.some(item => item.id === 'vat-return' && item.visible);
  const { overview: vatOverview, loading: vatOverviewLoading, error: vatOverviewError } = useVatOverview(forecastYear, vatCardWanted);
  const comparisonYear = Number(earlyPeriod.comparisonMonth.slice(0, 4));
  const { forecast: comparisonForecast, loading: comparisonForecastLoading, error: comparisonForecastError } = useForecast(
    comparisonYear,
    taxesEnabled && preferences.monthView && comparisonYear !== forecastYear,
  );
  const editToolbarRef = useRef<HTMLDivElement>(null);
  const customizeTooltip = useFloatingTooltip<HTMLButtonElement>();
  // Belege werden nur geladen, wenn die Kachel sichtbar ist.
  const receiptsWanted = (editDraft ?? preferences).items.some(item => item.id === 'recent-receipts' && item.visible);

  useEffect(() => {
    if (!receiptsWanted || receipts !== null) return undefined;
    let active = true;
    void apiService.getReceipts().then(list => {
      if (active) setReceipts(list);
    }).catch(error => {
      logger.warn('Belege für die Übersicht konnten nicht geladen werden.', error);
      if (active) setReceipts([]);
    });
    return () => { active = false; };
  }, [receiptsWanted, receipts]);

  const savePreferences = (next: DashboardPreferences) => {
    const normalized = normalizeDashboardPreferences(next);
    setPreferences(normalized);
    setPreferencesError(false);
    const version = ++preferenceSaveVersion.current;
    const pendingSave = enqueueDashboardPreferenceSave(preferenceSaveQueue.current, () => apiService.updateDashboardPreferences(normalized));
    preferenceSaveQueue.current = pendingSave.catch(() => undefined);
    void pendingSave.then(() => {
      if (preferenceSaveVersion.current === version) setPreferencesError(false);
    }).catch(() => {
      if (preferenceSaveVersion.current === version) setPreferencesError(true);
    });
  };

  useEffect(() => {
    let active = true;
    void apiService.getDashboardPreferences().then(value => {
      if (active) setPreferences(normalizeDashboardPreferences(value));
    }).catch(() => undefined).finally(() => { if (active) setPreferencesLoaded(true); });
    return () => { active = false; };
  }, []);

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

  useEffect(() => {
    let active = true;
    void apiService.getEuerEntries().then(entries => {
      if (active) setEuerEntries(entries);
    }).catch(error => {
      logger.warn('EÜR-Einträge für die Dashboard-Auswertung konnten nicht geladen werden.', error);
      if (active) setEuerEntries([]);
    });
    return () => { active = false; };
  }, []);

  // Get locale from company settings, default to 'de-DE'
  const locale = company?.locale || 'de-DE';

  const today = new Date();
  const todayDate = parseLocalJobDate(today);
  const firstOfSelectedMonth = new Date(`${earlyPeriod.selectedMonth}-01T00:00:00`);
  const calendarAnchor = preferences.monthView && earlyPeriod.selectedMonth !== `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    ? new Date(firstOfSelectedMonth.getFullYear(), firstOfSelectedMonth.getMonth(), 7) : today;
  const currentWeekStart = getWeekStart(calendarAnchor);
  const currentWeekEnd = new Date(currentWeekStart);
  currentWeekEnd.setDate(currentWeekEnd.getDate() + 6);
  const currentWeekNumber = getCalendarWeek(calendarAnchor);

  const calendarJobs = preferences.monthView ? filterDashboardRecordsByMonth(jobEntries, earlyPeriod.selectedMonth, job => job.date) : jobEntries;
  const currentWeekJobs = calendarJobs
    .map(job => ({ job, date: parseLocalJobDate(job.date) }))
    .filter(({ date }) => date >= currentWeekStart && date <= currentWeekEnd)
    .sort((a, b) => {
      const dateDifference = a.date.getTime() - b.date.getTime();
      if (dateDifference !== 0) return dateDifference;
      return (a.job.startTime || '').localeCompare(b.job.startTime || '');
    });

  const currentWeekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(currentWeekStart);
    date.setDate(date.getDate() + index);

    return {
      date,
      jobs: currentWeekJobs
        .filter(({ date: jobDate }) => jobDate.getTime() === date.getTime())
        .map(({ job }) => job),
    };
  });

  const recurringJobsBySeries = new Map<string, JobEntry[]>();
  calendarJobs.forEach(job => {
    const seriesId = job.recurrence?.id;
    if (!seriesId) return;
    const seriesJobs = recurringJobsBySeries.get(seriesId) || [];
    seriesJobs.push(job);
    recurringJobsBySeries.set(seriesId, seriesJobs);
  });

  const ongoingCourseSeries: DashboardCourseSeries[] = Array.from(recurringJobsBySeries.entries())
    .filter(([, jobs]) => preferences.monthView ? jobs.length > 0 : jobs.length > 1 && jobs.some(job => job.status === 'draft' || job.status === 'in-progress'))
    .map(([key, jobs]) => {
      const sortedJobs = [...jobs].sort(
        (a, b) => parseLocalJobDate(a.date).getTime() - parseLocalJobDate(b.date).getTime(),
      );
      const activeJobs = sortedJobs.filter(job => job.status === 'draft' || job.status === 'in-progress');
      const representativeJob = activeJobs.find(job => parseLocalJobDate(job.date) >= todayDate)
        || activeJobs[0]
        || sortedJobs[0];

      return { key, job: representativeJob, jobs: sortedJobs };
    })
    .sort((a, b) => parseLocalJobDate(a.job.date).getTime() - parseLocalJobDate(b.job.date).getTime());

  const handleSendEmail = async (invoice: Invoice) => {
    const customer = customers.find(c => c.id === invoice.customerId);
    if (!customer) {
      notify({ variant: 'error', message: `${terminology.entity.dataLabel} nicht gefunden.` });
      return;
    }

    if (!customer.email) {
      notify({ variant: 'warning', message: terminology.entity.emailMissingMessage });
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
        notify({ variant: 'warning', message: 'Bitte wählen Sie mindestens eine E-Mail-Adresse aus.' });
        return;
      }

      // Generate PDFs for each format and send emails
      const customer = customers.find(c => c.id === emailModal.invoice!.customerId);
      if (!customer) {
      notify({ variant: 'error', message: `${terminology.entity.dataLabel} nicht gefunden.` });
        return;
      }

      // Process additional attachments
      let processedAttachments: { name: string; content: string; contentType: string }[] = [];
      if (attachments && attachments.length > 0) {
        try {
          processedAttachments = await processAttachments(attachments);
        } catch (error) {
          logger.error('Fehler beim Verarbeiten der Anhänge:', error);
          notify({ variant: 'error', message: 'Fehler beim Verarbeiten der Anhänge' });
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
      
      notify({ variant: 'success', message: `Rechnung erfolgreich per E-Mail versendet! (${formatLabels.join(', ')})${attachmentInfo}` });
      
      // Automatically mark as sent if it was draft
      if (emailModal.invoice.status === 'draft') {
        await updateInvoice(emailModal.invoice.id, { status: 'sent' });
      }
      
      // Close email dialog
      setEmailModal({ isOpen: false, invoice: null, customer: null });
    } catch (error) {
      logger.error('Fehler beim E-Mail-Versand:', error);
      notify({ variant: 'error', message: 'Fehler beim E-Mail-Versand: ' + (error as Error).message });
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
      <div className="page-root space-y-3" role="status" aria-live="polite">
        <span className="sr-only">Übersicht wird geladen …</span>
        <div aria-hidden="true" className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex h-[4.5rem] items-center justify-center rounded-xl border border-gray-200 bg-white">
              <SkeletonBlock className="h-3 w-28" />
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <SkeletonBlock className="h-6 w-40" />
            <SkeletonBlock className="mt-3 h-3 w-56" />
            <SkeletonBlock className="mt-8 h-52 w-full" />
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <SkeletonBlock className="h-4 w-32" />
            <div className="mt-6 space-y-5">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="flex items-center gap-4">
                  <SkeletonBlock className="h-3 flex-1" />
                  <SkeletonBlock className="h-3 w-16" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /**
   * Die Dashboard-Auswertung arbeitet mit Zahlungseingängen. Dadurch wird bei
   * bezahlten Rechnungen das tatsächliche Zahlungsdatum verwendet. Offene
   * Rechnungen können optional zugeschaltet werden und verwenden dann ihr
   * Rechnungsdatum.
   */
  const period = earlyPeriod;
  const allYears = period.allYears;
  const includeUnpaidInvoices = preferences.includeUnpaidInvoices;
  const { monthKeys, selectedMonth, comparisonMonth } = period;
  const dashboardYear = period.selectedYear;
  const selectedPeriodYear = period.selectedYear;
  const availableYears = Array.from(new Set([
    today.getFullYear(),
    ...(typeof preferences.year === 'number' ? [preferences.year] : []),
    ...invoices.map(invoice => parseLocalJobDate(invoice.issueDate).getFullYear()),
    ...euerEntries.map(entry => parseLocalJobDate(entry.entryDate).getFullYear()),
  ])).sort((a, b) => b - a);

  const revenueInvoices = invoices.map(invoice => {
    const hasUnconfirmedSourceJob = invoice.sourceJobs?.some(sourceJob => {
      const source = jobEntries.find(job => job.id === sourceJob.jobId);
      return source && source.status !== 'completed' && source.status !== 'invoiced';
    }) ?? false;
    return { ...invoice, sourceJobsEligible: !hasUnconfirmedSourceJob };
  });
  const revenueRecords: DashboardRevenueRecord[] = buildRevenueRecords({
    invoices: revenueInvoices,
    euerEntries,
    customers,
    includeUnpaidInvoices,
  });

  const recordsForYear = (year: number | 'all') => {
    const records = year === 'all' ? revenueRecords : revenueRecords.filter(record => record.date.getFullYear() === year);
    return preferences.monthView ? filterDashboardRecordsByMonth(records, selectedMonth, record => record.date) : records;
  };
  const annualRevenuePoints = aggregateRevenue(revenueRecords, allYears ? 'all' : selectedPeriodYear, locale);
  const revenuePoints = preferences.monthView ? filterDashboardPointsByMonth(annualRevenuePoints, selectedMonth) : annualRevenuePoints;
  const previousPoints = !allYears && preferences.comparePrevious
    ? aggregateRevenue(revenueRecords, Number(dashboardYear) - 1, locale) : [];
  const sumRecordsForMonth = (monthKey: string) => sumDashboardRecordsByMonth(revenueRecords, monthKey, record => record.date, record => record.amount);
  const revenueWindowTotal = preferences.monthView ? sumRecordsForMonth(selectedMonth) : sumRevenue(revenuePoints);
  const previousWindowTotal = preferences.monthView ? sumRecordsForMonth(comparisonMonth) : sumRevenue(previousPoints);

  // Ohne Vergleichswert lässt sich keine Veränderung angeben. Dann entfällt die
  // Angabe, statt einen Platzhalter zu zeigen.
  const revenueDelta = preferences.monthView
    ? compareRevenue(revenueWindowTotal, previousWindowTotal)
    : !allYears && preferences.comparePrevious
    ? compareRevenue(revenueWindowTotal, previousWindowTotal) : null;

  const money = (value: number) => formatCurrency(value, locale, company?.numberFormat, company?.currency);
  const formatPercent = (value: number) => `${formatNumber(
    Math.abs(value),
    locale,
    company?.numberFormat,
    Math.abs(value) >= 100 ? 0 : 1,
  )} %`;

  const customerRevenue = new Map<string, number>();
  recordsForYear(allYears ? 'all' : dashboardYear).forEach(record => {
    customerRevenue.set(record.customerName, (customerRevenue.get(record.customerName) || 0) + record.amount);
  });
  const topCustomers = Array.from(customerRevenue.entries())
    .filter(([, revenue]) => revenue > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, revenue]) => ({ name, revenue }));
  const topCustomerMax = topCustomers.reduce((max, entry) => Math.max(max, entry.revenue), 0);

  const periodInvoices = preferences.monthView ? filterDashboardRecordsByMonth(invoices, earlyPeriod.selectedMonth, invoice => invoice.issueDate) : invoices;
  const periodJobs = preferences.monthView ? filterDashboardRecordsByMonth(jobEntries, earlyPeriod.selectedMonth, job => job.date) : jobEntries;
  const recentInvoices = [...periodInvoices]
    .sort((a, b) => compareTableValues(b.issueDate, a.issueDate, locale)
      || compareTableValues(b.invoiceNumber, a.invoiceNumber, locale)
      || compareTableValues(b.createdAt, a.createdAt, locale))
    .slice(0, 5);

  const jobActivityTimestamp = (job: JobEntry): number => {
    const value = job.createdAt || job.updatedAt || job.date;
    const timestamp = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  };

  const recentJobs = [...periodJobs]
    .sort((a, b) => {
      const activityDifference = jobActivityTimestamp(b) - jobActivityTimestamp(a);
      if (activityDifference !== 0) return activityDifference;
      return parseLocalJobDate(b.date).getTime() - parseLocalJobDate(a.date).getTime();
    })
    .slice(0, 5);

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid': return 'Bezahlt';
      case 'sent': return 'Versendet';
      case 'draft': return 'Entwurf';
      case 'overdue': return 'Überfällig';
      default: return status;
    }
  };

  const getStatusDotColor = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-green-500';
      case 'sent': return 'bg-blue-500';
      case 'draft': return 'bg-gray-400';
      case 'overdue': return 'bg-red-500';
      default: return 'bg-gray-400';
    }
  };

  const greetingName = user?.firstName?.trim() || user?.displayName?.trim() || company.name?.trim();
  const editing = editDraft !== null;
  const layout = editDraft ?? preferences;
  const periodYear: number | 'all' = allYears ? 'all' : selectedPeriodYear;
  const selectedMonthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(`${selectedMonth}-01T00:00:00`));
  const comparisonMonthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(`${comparisonMonth}-01T00:00:00`));
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const selectedMonthOngoing = preferences.monthView && selectedMonth === currentMonthKey;
  const comparisonMonthOngoing = preferences.monthView && comparisonMonth === currentMonthKey;
  const periodLabel = preferences.monthView ? `${selectedMonthLabel}${selectedMonthOngoing ? ' · bisher' : ''}` : allYears ? 'gesamt' : String(dashboardYear);
  const jobsEnabled = Boolean(company.jobTrackingEnabled);
  const quotesEnabled = Boolean(company.quotesEnabled);
  const seriesTitle = terminology.work.plural.toLocaleLowerCase('de-DE').includes('kurs')
    ? 'Laufende Kursserien'
    : `Laufende ${terminology.work.plural}`;

  // Zusätzliche Zeitreihen im Umsatzverlauf (Vorzeitraum u. a.), siehe
  // `dashboardChartSeries.ts`.
  const yearForecast = forecast && forecast.year === selectedPeriodYear && forecast.profileComplete ? forecast : null;
  const comparisonYearForecast = comparisonYear === selectedPeriodYear
    ? yearForecast
    : comparisonForecast && comparisonForecast.year === comparisonYear && comparisonForecast.profileComplete ? comparisonForecast : null;
  const seriesContext = { preferences, allYears, year: periodYear, records: revenueRecords, locale, forecast: yearForecast, taxesEnabled };
  const unavailableSeries = new Map(REVENUE_CHART_SERIES.map(series => [series.id,
    series.group === 'levies' && includeUnpaidInvoices
      ? 'Die Umsatzreihe mit offenen Rechnungen wird nicht mit Zahlungs- und Forecastwerten kombiniert.'
      : series.unavailableReason(seriesContext)]));
  const financialPreferencesSelected = REVENUE_CHART_SERIES.some(series => series.group === 'levies' && series.isActive(preferences));
  const financialSeriesActive = REVENUE_CHART_SERIES.some(series => series.group === 'levies'
    && !unavailableSeries.get(series.id) && series.isActive(preferences));
  const chartOverlays = REVENUE_CHART_SERIES.flatMap(series => {
    if (preferences.monthView && series.id === 'previous-period') return [];
    const overlay = series.group === 'levies' && includeUnpaidInvoices ? null : series.build(seriesContext);
    if (!overlay) return [];
    return preferences.monthView ? [{ ...overlay, points: filterDashboardPointsByMonth(overlay.points, selectedMonth) }] : [overlay];
  });
  const chartAnnualRevenuePoints: RevenuePoint[] = financialSeriesActive && !includeUnpaidInvoices
    ? getForecastRevenuePoints(yearForecast, [], locale) : annualRevenuePoints;
  const chartRevenuePoints = preferences.monthView ? filterDashboardPointsByMonth(chartAnnualRevenuePoints, selectedMonth) : chartAnnualRevenuePoints;
  const comparisonChartMonth = comparisonYearForecast?.monthly.find(item => item.month === comparisonMonth);
  const comparisonChartValue = financialSeriesActive && !includeUnpaidInvoices && comparisonChartMonth
    ? comparisonChartMonth.revenue
    : sumRecordsForMonth(comparisonMonth);
  const comparisonSeriesContext = { ...seriesContext, year: comparisonYear, forecast: comparisonYearForecast };
  const monthlyChartRows: MonthlyRevenueComparisonRow[] = [{
    key: 'revenue', label: financialSeriesActive ? 'EÜR-Einnahmen' : 'Rechnungsumsatz', color: 'var(--dashboard-chart-line)',
    current: chartRevenuePoints[0]?.value ?? 0,
    comparison: financialSeriesActive && !comparisonYearForecast ? null : comparisonChartValue,
    currentEstimate: Boolean(chartRevenuePoints[0]?.forecast),
    comparisonEstimate: financialSeriesActive && Boolean(comparisonChartMonth?.forecast),
    tooltip: financialSeriesActive ? TAX_TEXTS.tooltip(dashboardYear) : undefined,
  }, ...chartOverlays.map(overlay => {
    const comparison = REVENUE_CHART_SERIES.find(series => series.id === overlay.key)?.build(comparisonSeriesContext);
    const comparisonPoint = comparison?.points.find(point => point.key === comparisonMonth);
    return {
      key: overlay.key, label: overlay.label, color: overlay.color ?? 'var(--dashboard-chart-line)',
      current: overlay.points[0]?.value ?? null, comparison: comparisonPoint?.value ?? null,
      currentEstimate: Boolean(overlay.estimated || overlay.points[0]?.forecast),
      comparisonEstimate: Boolean(comparison?.estimated || comparisonPoint?.forecast),
      tooltip: overlay.tooltip,
    };
  })];
  const openInvoices = summarizeOpenInvoices(periodInvoices, euerEntries, today);
  const incomeExpenseBase = summarizeIncomeExpense({ invoices, euerEntries, year: periodYear, locale });
  const incomeExpense = preferences.monthView ? (() => {
    const point = incomeExpenseBase.points.find(item => item.key === selectedMonth);
    const selected = point ? [point] : [];
    const income = selected.reduce((sum, item) => sum + item.income, 0);
    const expenses = selected.reduce((sum, item) => sum + item.expenses, 0);
    return { ...incomeExpenseBase, points: selected, income, expenses, result: income - expenses };
  })() : incomeExpenseBase;
  const invoicesInPeriod = preferences.monthView ? invoices.filter(invoice => `${parseLocalJobDate(invoice.issueDate).getFullYear()}-${String(parseLocalJobDate(invoice.issueDate).getMonth() + 1).padStart(2, '0')}` === selectedMonth) : invoices;
  const jobsInPeriod = preferences.monthView ? jobEntries.filter(job => `${parseLocalJobDate(job.date).getFullYear()}-${String(parseLocalJobDate(job.date).getMonth() + 1).padStart(2, '0')}` === selectedMonth) : jobEntries;
  const averageInvoice = averageInvoiceAmount(invoicesInPeriod, periodYear, !includeUnpaidInvoices);
  const activeCustomerCount = countActiveCustomers({ invoices: invoicesInPeriod, jobs: jobsInPeriod, year: periodYear });
  const nextJobs = upcomingJobs(periodJobs, preferences.monthView ? firstOfSelectedMonth : today, 5);
  const periodQuotes = preferences.monthView ? filterDashboardRecordsByMonth(quotes, selectedMonth, quote => quote.issueDate) : quotes;
  const openQuotes = summarizeOpenQuotes(periodQuotes, today);
  const unbilledJobs = periodJobs
    .filter(job => job.status === 'completed')
    .sort((a, b) => parseLocalJobDate(b.date).getTime() - parseLocalJobDate(a.date).getTime());
  const unbilledHours = unbilledJobs.reduce((sum, job) => sum + calculateTotalHours(job), 0);
  const periodReceipts = preferences.monthView ? filterDashboardRecordsByMonth(receipts ?? [], selectedMonth, receipt => receipt.createdAt) : receipts ?? [];
  const latestReceipts = [...periodReceipts]
    .sort((a, b) => compareTableValues(b.createdAt, a.createdAt, locale))
    .slice(0, 5);

  /* --------------------------------------------------------------------
   * Registry: Schnellzugriffe und Kacheln. Welche IDs es gibt, ihre
   * Standard-Sichtbarkeit und erlaubten Breiten stehen im gemeinsamen Modul
   * `backend/utils/dashboardPreferences.js`; hier stehen Beschriftung,
   * Verfügbarkeit (Module) und Darstellung. `Record<…>` erzwingt, dass jede
   * dort ergänzte ID auch hier umgesetzt wird.
   * ------------------------------------------------------------------ */
  const quickActions: Record<DashboardQuickItemId, { label: string; ariaLabel: string; description: string; icon: ReactNode; available: boolean; onClick: () => void }> = {
    'quick-invoice': { label: 'Rechnung schreiben', ariaLabel: 'Neue Rechnung schreiben', description: 'Neue Rechnung anlegen', icon: <FileText className="h-7 w-7" />, available: true, onClick: () => onNavigate('invoices', 'new') },
    'quick-receipt': { label: 'Beleg hochladen', ariaLabel: 'Beleg hochladen', description: 'Beleg hochladen und auslesen', icon: <Upload className="h-7 w-7" />, available: true, onClick: () => onNavigate('documents', 'receipts') },
    'quick-customer': { label: terminology.entity.newLabel, ariaLabel: `Neuen ${terminology.entity.singular} anlegen`, description: `${terminology.entity.singular} anlegen`, icon: <Users className="h-7 w-7" />, available: true, onClick: () => onNavigate('customers', 'new') },
    'quick-course': { label: terminology.work.newLabel, ariaLabel: `Neuen ${terminology.work.singular} anlegen`, description: `${terminology.work.singular} anlegen`, icon: <Briefcase className="h-7 w-7" />, available: jobsEnabled, onClick: () => onNavigate('jobs', 'new') },
    'quick-quote': { label: 'Angebot schreiben', ariaLabel: 'Neues Angebot schreiben', description: 'Neues Angebot anlegen', icon: <FileCheck className="h-7 w-7" />, available: quotesEnabled, onClick: () => onNavigate('quote-editor') },
    'quick-calendar': { label: 'Kalender', ariaLabel: 'Kalender öffnen', description: 'Termine im Kalender ansehen', icon: <CalendarDays className="h-7 w-7" />, available: jobsEnabled, onClick: () => onNavigate('calendar') },
    'quick-credit-note': { label: 'Gutschrift erstellen', ariaLabel: 'Neue Gutschrift erstellen', description: 'Gutschrift zu einer Rechnung erstellen', icon: <FilePlus2 className="h-7 w-7" />, available: true, onClick: () => onNavigate('credit-notes', 'new') },
    'quick-euer': { label: 'Ausgabe erfassen', ariaLabel: 'Ausgabe in der EÜR erfassen', description: 'Neue Ausgabe in der EÜR buchen', icon: <Wallet className="h-7 w-7" />, available: true, onClick: () => onNavigate('euer', 'new') },
    'quick-import': { label: 'Daten importieren', ariaLabel: 'Datenimport öffnen', description: 'Daten aus einer Datei übernehmen', icon: <Import className="h-7 w-7" />, available: true, onClick: () => onNavigate('data-import') },
  };

  const cardMeta: Record<DashboardCardItemId, { label: string; description: string; available: boolean }> = {
    revenue: { label: 'Umsatzverlauf', description: 'Umsatz je Monat mit optionalem Vorjahresvergleich', available: true },
    'top-customers': { label: `Top-${terminology.entity.plural}`, description: `Umsatzstärkste ${terminology.entity.plural} im Zeitraum`, available: true },
    'week-calendar': { label: 'Termine der Kalenderwoche', description: 'Wochenübersicht der aktuellen Kalenderwoche', available: jobsEnabled },
    'recent-jobs': { label: `Aktuelle ${terminology.work.plural}`, description: `Die zuletzt angelegten ${terminology.work.plural}`, available: jobsEnabled },
    'recent-invoices': { label: 'Aktuelle Rechnungen', description: 'Die neuesten Rechnungen mit Schnellaktionen', available: true },
    'course-series': { label: seriesTitle, description: 'Regelmäßige Termine im Überblick', available: jobsEnabled },
    'open-invoices': { label: 'Offene Posten', description: 'Offene und überfällige Rechnungen zum heutigen Tag', available: true },
    'income-expense': { label: 'Einnahmen und Ausgaben', description: 'Einnahmen und Ausgaben aus der EÜR im Zeitraum', available: true },
    'upcoming-jobs': { label: 'Nächste Termine', description: 'Die nächsten geplanten Termine ab heute', available: jobsEnabled },
    'open-quotes': { label: 'Offene Angebote', description: 'Versendete Angebote ohne Antwort', available: quotesEnabled },
    'unbilled-jobs': { label: 'Noch nicht abgerechnet', description: `Abgeschlossene ${terminology.work.plural} ohne Rechnung`, available: jobsEnabled },
    'average-invoice': { label: 'Ø Rechnungsbetrag', description: 'Durchschnittlicher Rechnungsbetrag im Zeitraum', available: true },
    'active-customers': { label: `Aktive ${terminology.entity.plural}`, description: `${terminology.entity.plural} mit Rechnung oder Termin im Zeitraum`, available: true },
    'recent-receipts': { label: 'Neueste Belege', description: 'Zuletzt hochgeladene Belege mit Lesestatus', available: true },
    taxes: { label: 'Steuern', description: 'Jahresprognose und Monatsrichtwert', available: true },
    'tax-reserve': { label: 'Verbleibende Rücklage', description: 'Unverbindliche Abgabenrücklage', available: true },
    'tax-position': { label: 'Wo stehe ich?', description: 'Einordnung zu Steuer- und Sozialschwellen', available: true },
    'small-business': { label: 'Kleinunternehmerregelung (§ 19 UStG)', description: 'Ist-Ampel und Jahresprognose', available: true },
    'fixed-costs': { label: 'Betriebliche Fixkosten', description: 'Monats- und Jahresrichtwert', available: true },
    'tax-advances': { label: 'Vorauszahlungen', description: 'Erfasste und geplante Vorauszahlungstermine', available: true },
    'health-backpayment': { label: 'Mögliche KV-Nachzahlung', description: 'Jahresbezogene Schätzung gegenüber dem Bescheid', available: true },
    'vat-return': { label: 'Umsatzsteuer-Voranmeldung', description: 'Zahllast des Voranmeldungszeitraums aus erfassten Belegen', available: true },
  };

  const itemLabel = (id: DashboardItemId) => isQuickItem(id) ? quickActions[id].label : cardMeta[id as DashboardCardItemId].label;
  const isPrivateTaxCard = (id: DashboardItemId) => !isQuickItem(id)
    && getDashboardItemDefinition(id)?.requiredExtension === 'taxes'
    && isDashboardCardVisibleForPrivateView(id, false) === false;
  const definitionAvailable = (id: DashboardItemId) => !getDashboardItemDefinition(id)?.requiredExtension || (id === 'vat-return' ? vatCardEnabled : taxesEnabled);
  const isAvailable = (id: DashboardItemId) => definitionAvailable(id) && (isQuickItem(id) ? quickActions[id].available : cardMeta[id as DashboardCardItemId].available);
  // Laufende Serien erscheinen wie bisher nur, wenn es welche gibt. Im
  // Bearbeiten-Modus bleiben sie sichtbar, damit man sie anordnen kann.
  const isRendered = (id: DashboardItemId) => editing || id !== 'course-series' || ongoingCourseSeries.length > 0;

  const visibleItems = layout.items.filter(item => item.visible && isAvailable(item.id)
    && !(isPrivateTaxCard(item.id) && !preferences.showPrivateLevies) && isRendered(item.id));
  const quickIds = visibleItems.map(item => item.id).filter(isQuickItem);
  const cardItems = visibleItems.filter(item => isCardItem(item.id));
  const cardIds = cardItems.map(item => item.id as DashboardCardItemId);
  const lgSpans = packDashboardRows(cardItems.map(item => ({ id: item.id, span: DASHBOARD_SIZE_SPANS[dashboardItemSize(item)] })), 12);
  const mdSpans = packDashboardRows(cardItems.map(item => ({ id: item.id, span: DASHBOARD_SIZE_SPANS[dashboardItemSize(item)] > 6 ? 2 : 1 })), 2);
  const spanClass = (id: DashboardItemId) => `${MD_SPAN_CLASS[mdSpans.get(id) ?? 2]} ${LG_SPAN_CLASS[lgSpans.get(id) ?? 12]}`;
  // Im Bearbeiten-Modus braucht jede Kachel Platz für ihre Steuerleiste,
  // deshalb dort zwischen 640 und 1024 px nur zwei Spalten.
  const quickColumns = {
    '--quick-cols-base': balancedColumns(quickIds.length, 2),
    '--quick-cols-sm': balancedColumns(quickIds.length, editing ? 2 : 4),
    '--quick-cols-lg': balancedColumns(quickIds.length, 4),
    '--quick-cols-xl': balancedColumns(quickIds.length, 6),
  } as CSSProperties;

  /* Bearbeiten-Modus: Änderungen landen in einem Entwurf und werden erst
     mit „Fertig“ gespeichert. */
  const announce = (message: string) => setLiveMessage(message);
  const updateDraft = (update: (items: DashboardPreferences['items']) => DashboardPreferences['items'], message?: string) => {
    setEditDraft(current => current ? { ...current, items: update(current.items) } : current);
    if (message) announce(message);
  };
  const startEditing = () => {
    customizeTooltip.close();
    setEditDraft({ ...preferences, items: preferences.items.map(item => ({ ...item })) });
    announce('Bearbeiten-Modus. Kacheln verschieben, ausblenden oder hinzufügen; „Fertig“ speichert.');
    focusToolbar();
  };
  const leaveEditing = (message: string) => {
    setEditDraft(null);
    announce(message);
    requestAnimationFrame(() => customizeTooltip.anchorRef.current?.focus({ preventScroll: true }));
  };
  const finishEditing = () => {
    if (editDraft && dashboardLayoutChanged(editDraft, preferences)) {
      savePreferences({ ...preferences, items: editDraft.items });
      leaveEditing('Dashboard gespeichert.');
    } else {
      leaveEditing('Bearbeiten beendet, keine Änderungen.');
    }
  };
  const cancelEditing = () => leaveEditing('Änderungen verworfen.');
  const focusToolbar = () => requestAnimationFrame(() => editToolbarRef.current?.focus({ preventScroll: true }));
  const moveWithin = (ids: DashboardItemId[], id: DashboardItemId, direction: -1 | 1) => {
    const target = ids[ids.indexOf(id) + direction];
    if (!target) return;
    updateDraft(items => moveDashboardItem(items, id, target), `${itemLabel(id)} auf Position ${ids.indexOf(id) + direction + 1} von ${ids.length}.`);
  };
  const editControls = (ids: DashboardItemId[], id: DashboardItemId) => {
    const index = ids.indexOf(id);
    const preference = layout.items.find(item => item.id === id);
    const next = preference && isCardItem(id) ? nextDashboardSize(preference) : null;
    return {
      id,
      label: itemLabel(id),
      canMoveBack: index > 0,
      canMoveForward: index >= 0 && index < ids.length - 1,
      onMoveBack: () => moveWithin(ids, id, -1),
      onMoveForward: () => moveWithin(ids, id, 1),
      onHide: () => {
        updateDraft(items => setDashboardItemVisible(items, id, false), `${itemLabel(id)} ausgeblendet. Über „Hinzufügen“ wieder einblenden.`);
        focusToolbar();
      },
      size: preference && next ? dashboardItemSize(preference) : undefined,
      onCycleSize: next ? () => updateDraft(items => resizeDashboardItem(items, id, next), `Breite von ${itemLabel(id)} geändert.`) : undefined,
    };
  };
  const addGroups = ([['Schnellzugriffe', true], ['Kacheln', false]] as const).map(([title, quick]) => ({
    title,
    options: layout.items
      .filter(item => !item.visible && isQuickItem(item.id) === quick && isAvailable(item.id)
        && !(isPrivateTaxCard(item.id) && !preferences.showPrivateLevies))
      .map(item => ({
        id: item.id,
        label: itemLabel(item.id),
        description: isQuickItem(item.id) ? quickActions[item.id].description : cardMeta[item.id as DashboardCardItemId].description,
      })),
  }));

  const renderQuickAction = (id: DashboardQuickItemId) => {
    const action = quickActions[id];
    return (
      <button type="button" onClick={action.onClick} className="dashboard-quick-action group w-full flex-1" aria-label={action.ariaLabel}>
        <span className="dashboard-quick-action-icon">{action.icon}</span>
        {action.label}
      </button>
    );
  };

  const listButtonClass = 'flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 lg:px-6';

  const renderCard = (id: DashboardCardItemId): ReactNode => {
    const taxCardIds = new Set<TaxDashboardCardId>(['taxes', 'tax-reserve', 'tax-position', 'small-business', 'fixed-costs', 'tax-advances', 'health-backpayment']);
    if (taxCardIds.has(id as TaxDashboardCardId)) {
      return <TaxDashboardCards id={id as TaxDashboardCardId} forecast={forecast} year={dashboardYear} month={selectedMonth} monthView={preferences.monthView}
        compareMonth={comparisonMonth} comparisonForecast={comparisonYearForecast?.monthly.find(item => item.month === comparisonMonth)}
        privateLeviesVisible={preferences.showPrivateLevies || id === 'small-business'}
        loading={(forecastLoading || (preferences.monthView && comparisonYear !== selectedPeriodYear && comparisonForecastLoading)) && !allYears}
        error={allYears ? 'Wähle ein einzelnes Steuerjahr, um die Schätzung anzuzeigen.' : forecastError ?? comparisonForecastError}
        onSetup={() => onNavigate('settings', 'taxes')} onFixedCosts={() => onNavigate('fixed-costs')} />;
    }
    if (id === 'vat-return') {
      return <VatDashboardCard overview={vatOverview} loading={vatOverviewLoading && !allYears} year={dashboardYear}
        error={allYears ? 'Wähle ein einzelnes Steuerjahr, um die Umsatzsteuer anzuzeigen.' : vatOverviewError}
        onOpen={() => onNavigate('vat')} onSetup={() => onNavigate('settings', 'taxes')} />;
    }
    switch (id) {
      case 'revenue':
        return (
          <MetricCard>
            <MetricCardHeader>
              <div className="flex min-w-0 flex-col">
                <MetricValue>{money(revenueWindowTotal)}</MetricValue>
                <MetricCardDescription>Gesamtumsatz {periodLabel} · {includeUnpaidInvoices ? 'bezahlt und offen' : 'nur bezahlt'}</MetricCardDescription>
                {preferences.monthView && <MetricCardDescription className="mt-1">Vergleichsmonat {comparisonMonthLabel}{comparisonMonthOngoing ? ' · bisher' : ''}: {money(previousWindowTotal)}</MetricCardDescription>}
                {!preferences.monthView && !allYears && preferences.comparePrevious && <MetricCardDescription className="mt-1">Vorjahr: {money(previousWindowTotal)}</MetricCardDescription>}
              </div>
              {revenueDelta !== null && !selectedMonthOngoing && !comparisonMonthOngoing && (
                <DeltaBadge
                  value={revenueDelta}
                  formattedValue={formatPercent(revenueDelta)}
                  label={preferences.monthView ? `ggü. ${comparisonMonthLabel}` : `ggü. ${Number(dashboardYear) - 1}`}
                />
              )}
            </MetricCardHeader>
            <MetricCardContent className="flex flex-1 flex-col px-2 pb-2 lg:px-4">
              {financialSeriesActive && <p className="px-2 pb-2 text-xs text-gray-500">Diagramm: EÜR-Zahlungen und Prognose. Die Umsatzkennzahl zeigt Rechnungszahlungen.</p>}
              {preferences.monthView ? <MonthlyRevenueChart rows={monthlyChartRows}
                currentLabel={periodLabel} comparisonLabel={`${comparisonMonthLabel}${comparisonMonthOngoing ? ' · bisher' : ''}`}
                formatValue={money} ariaLabel={`Umsatz- und Kostenvergleich ${periodLabel} mit ${comparisonMonthLabel}`} /> : chartRevenuePoints.some(point => point.value !== 0) || previousWindowTotal > 0 || chartOverlays.some(overlay => overlay.points.some(point => point.value !== 0)) ? (
                <RevenueAreaChart
                  points={chartRevenuePoints}
                  overlays={chartOverlays}
                  currentLabel={periodLabel}
                  onToggle={key => {
                    const series = REVENUE_CHART_SERIES.find(item => item.id === key);
                    if (series && !series.unavailableReason(seriesContext)) savePreferences(series.toggle(preferences));
                  }}
                  formatValue={money}
                  ariaLabel={`Umsatzverlauf ${periodLabel}, insgesamt ${money(revenueWindowTotal)}`}
                />
              ) : (
                <DashboardEmptyState
                  variant="chart"
                  title={`Noch keine Umsätze ${allYears ? 'erfasst' : `in ${dashboardYear}`}`}
                  description={includeUnpaidInvoices ? 'Festgeschriebene Rechnungen erscheinen hier im Verlauf.' : 'Bezahlte Rechnungen erscheinen hier nach Zahlungsdatum.'}
                  action={{ label: 'Rechnung schreiben', onClick: () => onNavigate('invoices', 'new') }}
                />
              )}
              {includeUnpaidInvoices && financialPreferencesSelected && <p role="note" className="px-3 pb-3 text-xs leading-5 text-amber-800">Die Umsatzreihe enthält offene Rechnungen nach Rechnungsdatum. Daher wird sie nicht mit der Zahlungs-/Forecastreihe vermischt.</p>}
            </MetricCardContent>
            {company.reportingEnabled && (
              <MetricCardFooterAction onClick={() => onNavigate('reporting')}>
                Zu den Auswertungen
              </MetricCardFooterAction>
            )}
          </MetricCard>
        );

      case 'top-customers':
        return (
          <MetricCard>
            <MetricCardHeader bordered>
              <div className="min-w-0">
                <MetricCardTitle>Top-{terminology.entity.plural}</MetricCardTitle>
                <MetricCardDescription className="mt-1">Umsatzstärkste {periodLabel}</MetricCardDescription>
              </div>
            </MetricCardHeader>
            <MetricCardContent className="flex flex-1 flex-col justify-center py-1">
              {topCustomers.length > 0 ? (
                <ShareBarList aria-label={`Top-${terminology.entity.plural} nach Umsatz`}>
                  {topCustomers.map(({ name, revenue }, index) => (
                    <ShareBarItem
                      key={name}
                      index={index}
                      label={name}
                      value={money(revenue)}
                      share={topCustomerMax > 0 ? (revenue / topCustomerMax) * 100 : 0}
                    />
                  ))}
                </ShareBarList>
              ) : (
                <DashboardEmptyState variant="customers" title="Noch keine Umsätze"
                  description={`Sobald Rechnungen bezahlt sind, stehen hier die umsatzstärksten ${terminology.entity.plural}.`} />
              )}
            </MetricCardContent>
            <MetricCardFooterAction onClick={() => onNavigate('customers')}>
              Alle {terminology.entity.plural}
            </MetricCardFooterAction>
          </MetricCard>
        );

      case 'week-calendar':
        return (
          <MetricCard>
            <MetricCardHeader bordered>
              <div className="flex min-w-0 items-start gap-3">
                <span className="shrink-0 rounded-lg bg-primary-custom/10 p-2 text-primary-custom">
                  <CalendarDays className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <MetricCardTitle>Termine · KW {currentWeekNumber}</MetricCardTitle>
                  <MetricCardDescription className="mt-1 truncate">
                    {formatDate(currentWeekStart, locale, company?.dateFormat)} – {formatDate(currentWeekEnd, locale, company?.dateFormat)}
                  </MetricCardDescription>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('calendar')}
                className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary-custom transition-colors hover:text-primary-custom/80"
              >
                Kalender
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </MetricCardHeader>

            {currentWeekJobs.length > 0 ? (
              <div className="overflow-x-auto">
                <div className="grid min-w-[700px] grid-cols-7 divide-x divide-gray-200">
                  {currentWeekDays.map(({ date, jobs }) => {
                    const isToday = date.getTime() === parseLocalJobDate(today).getTime();

                    return (
                      <div key={date.toISOString()} className={`min-w-0 ${isToday ? 'bg-primary-custom/5' : ''}`}>
                        <div className={`border-b border-gray-200 px-2 py-2 text-center ${isToday ? 'bg-primary-custom/10' : 'bg-gray-50'}`}>
                          <div className="text-xs font-medium text-gray-500">
                            {date.toLocaleDateString(locale, { weekday: 'short' }).replace('.', '')}
                          </div>
                          <div className={`mt-0.5 text-sm font-semibold tabular-nums ${isToday ? 'text-primary-custom' : 'text-gray-900'}`}>
                            {formatDate(date, locale, company?.dateFormat)}
                          </div>
                        </div>
                        <div className="min-h-[5.5rem] space-y-2 p-2">
                          {jobs.length > 0 ? jobs.map((job) => (
                            <button
                              key={job.id}
                              type="button"
                              onClick={() => onNavigate('jobs', undefined, job.jobNumber)}
                              className="group relative w-full min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 py-2 pl-3 pr-2 text-left transition-colors hover:border-primary-custom hover:bg-primary-custom/5"
                              aria-label={`${job.title} am ${formatDate(date, locale, company?.dateFormat)} · ${getJobStatusLabel(job.status)} öffnen`}
                              title={getJobStatusLabel(job.status)}
                            >
                              {/* Der Status liegt als Streifen am linken Rand statt
                                  als Punkt in der Zeile: In den schmalen Tagesspalten
                                  bleibt so die volle Breite für Titel und Kunde. */}
                              <span
                                className={`absolute inset-y-0 left-0 w-1 ${getJobStatusDotColor(job.status)}`}
                                aria-hidden="true"
                              />
                              <span className="block min-w-0">
                                <span className="block truncate text-xs font-semibold text-gray-900 group-hover:text-primary-custom">{job.title}</span>
                                <span className="mt-1 block truncate text-[11px] text-gray-500">{job.customerName}</span>
                                <span className="mt-1 block truncate text-[11px] text-gray-500">
                                  {getJobTimeRange(job, locale, company?.timeFormat, company?.numberFormat)}
                                </span>
                              </span>
                            </button>
                          )) : (
                            <div className="pt-3 text-center text-xs text-gray-400">–</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <DashboardEmptyState variant="calendar" title="Keine Termine in dieser Woche"
                description={`Geplante ${terminology.work.plural} erscheinen hier tageweise.`}
                action={{ label: terminology.work.newLabel, onClick: () => onNavigate('jobs', 'new') }} />
            )}
          </MetricCard>
        );

      case 'recent-jobs':
        // Unabhängig von der Kalenderwoche, damit auch importierte Aufträge
        // direkt auf der Übersicht auffindbar sind.
        return (
          <MetricCard>
            <MetricCardHeader bordered>
              <div className="flex min-w-0 items-start gap-3">
                <span className="shrink-0 rounded-lg bg-primary-custom/10 p-2 text-primary-custom">
                  <Briefcase className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <MetricCardTitle>Aktuelle {terminology.work.plural}</MetricCardTitle>
                  <MetricCardDescription className="mt-1">
                    Die fünf zuletzt angelegten oder importierten {terminology.work.plural}
                  </MetricCardDescription>
                </div>
              </div>
              <MetricBadge tone="neutral">{jobEntries.length}</MetricBadge>
            </MetricCardHeader>

            {recentJobs.length > 0 ? (
              <MetricCardContent className="divide-y divide-gray-100">
                {recentJobs.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => onNavigate('jobs', undefined, job.jobNumber || job.title)}
                    className={listButtonClass}
                    aria-label={`${job.title} öffnen`}
                  >
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${getJobStatusDotColor(job.status)}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">{job.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-gray-500">
                        {[job.jobNumber, job.customerName].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-gray-500">
                      <span className="hidden tabular-nums sm:inline">{formatDate(job.date, locale, company?.dateFormat)}</span>
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </button>
                ))}
              </MetricCardContent>
            ) : (
              <DashboardEmptyState variant="jobs" title={`Noch keine ${terminology.work.plural}`}
                action={{ label: terminology.work.newLabel, onClick: () => onNavigate('jobs', 'new') }} />
            )}
            <MetricCardFooterAction onClick={() => onNavigate('jobs')}>
              Alle {terminology.work.plural}
            </MetricCardFooterAction>
          </MetricCard>
        );

      case 'recent-invoices':
        return (
          <MetricCard>
            <MetricCardHeader>
              <div className="min-w-0">
                <MetricCardTitle>Aktuelle Rechnungen</MetricCardTitle>
                <MetricCardDescription className="mt-1">Die fünf neuesten Rechnungen nach Rechnungsdatum</MetricCardDescription>
              </div>
            </MetricCardHeader>

            {recentInvoices.length > 0 ? (
              <>
                {/* Tabelle ab Tablet */}
                <div className="hidden w-full max-w-full overflow-x-auto tablet:block">
                  <table className="w-full min-w-[700px] border-t border-gray-200">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th scope="col" className="whitespace-nowrap px-3 py-2 pl-4 text-left text-xs font-medium text-gray-500 lg:pl-6">Datum</th>
                        <th scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-gray-500">Rechnung</th>
                        <th scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-gray-500">{terminology.entity.singular}</th>
                        <th scope="col" className="whitespace-nowrap px-3 py-2 text-right text-xs font-medium text-gray-500">Betrag</th>
                        <th scope="col" className="sticky right-0 z-20 w-14 bg-white px-2 py-2 text-left text-xs font-medium text-gray-500 2xl:w-44 2xl:px-3">
                          <span className="sr-only">Aktionen</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {recentInvoices.map((invoice) => (
                        <tr
                          key={invoice.id}
                          className="cursor-pointer transition-colors hover:bg-gray-50"
                          onClick={() => onNavigate('invoices', 'all', invoice.invoiceNumber)}
                          title={`Zur Rechnung ${invoice.invoiceNumber}`}
                        >
                          <td className="whitespace-nowrap px-3 py-2 pl-4 text-xs text-gray-500 tabular-nums lg:pl-6">
                            {formatDate(invoice.issueDate, locale, company?.dateFormat)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">
                            <span className="inline-flex items-center gap-2">
                              <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-px font-mono text-xs font-medium text-primary-custom">
                                {invoice.invoiceNumber}
                              </span>
                              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                                <span className={`h-2 w-2 shrink-0 rounded-full ${getStatusDotColor(invoice.status)}`} aria-hidden="true" />
                                {getStatusLabel(invoice.status)}
                              </span>
                            </span>
                          </td>
                          <td className="max-w-[220px] truncate px-3 py-2 text-xs text-gray-700">
                            {invoice.customerName}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-xs font-medium text-gray-900 tabular-nums">
                            {money(invoice.total)}
                          </td>
                          {/* Eine Zeile hat höchstens eine Aktion. Ein Drei-Punkte-Menü
                              würde bei bezahlten Rechnungen leer aufklappen. */}
                          <td className="sticky right-0 z-10 w-14 whitespace-nowrap bg-white px-2 py-2">
                            <div
                              className="flex items-center justify-end gap-1"
                              onClick={(e: React.MouseEvent) => e.stopPropagation()}
                            >
                              {invoice.status === 'draft' && (
                                <button
                                  type="button"
                                  className="action-icon-button action-icon-blue"
                                  title="Per E-Mail versenden"
                                  aria-label="Per E-Mail versenden"
                                  onClick={() => handleSendEmail(invoice)}
                                >
                                  <Send className="h-4 w-4" />
                                </button>
                              )}
                              {(invoice.status === 'sent' || invoice.status === 'overdue') && (
                                <button
                                  type="button"
                                  className="action-icon-button action-icon-green"
                                  title="Zahlungseingang in der Rechnung erfassen"
                                  aria-label="Zahlungseingang erfassen"
                                  onClick={() => onNavigate('invoices', 'all', invoice.invoiceNumber)}
                                >
                                  <Banknote className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Karten unterhalb von Tablet */}
                <div className="border-t border-gray-200 tablet:hidden">
                  {recentInvoices.map((invoice) => (
                    <div
                      key={invoice.id}
                      className="cursor-pointer border-b border-gray-100 px-4 py-3 transition-colors last:border-b-0 hover:bg-gray-50"
                      onClick={() => onNavigate('invoices', 'all', invoice.invoiceNumber)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="shrink-0 rounded border border-gray-200 bg-gray-50 px-1.5 py-px font-mono text-xs font-medium text-primary-custom">
                              {invoice.invoiceNumber}
                            </span>
                            <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-gray-500">
                              <span className={`h-2 w-2 shrink-0 rounded-full ${getStatusDotColor(invoice.status)}`} aria-hidden="true" />
                              <span className="truncate">{getStatusLabel(invoice.status)}</span>
                            </span>
                          </div>
                          <div className="mt-1 flex min-w-0 items-center gap-2">
                            <p className="min-w-0 truncate text-xs text-gray-700">{invoice.customerName}</p>
                            <span className="shrink-0 text-xs text-gray-500 tabular-nums">
                              {formatDate(invoice.issueDate, locale, company?.dateFormat)}
                            </span>
                          </div>
                        </div>
                        <div
                          className="flex shrink-0 items-center gap-2"
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        >
                          <span className="text-sm font-medium text-gray-900 tabular-nums">
                            {money(invoice.total)}
                          </span>
                          {/* Der Platz für die Aktion bleibt auch in Zeilen ohne
                              Aktion reserviert. Sonst rückt deren Betrag als
                              einziger nach rechts und die Spalte franst aus. */}
                          <span className="flex w-8 shrink-0 justify-end">
                            {invoice.status === 'draft' && (
                              <button
                                type="button"
                                className="action-icon-button action-icon-blue shrink-0"
                                title="Per E-Mail versenden"
                                aria-label="Per E-Mail versenden"
                                onClick={() => handleSendEmail(invoice)}
                              >
                                <Send className="h-4 w-4" />
                              </button>
                            )}
                            {(invoice.status === 'sent' || invoice.status === 'overdue') && (
                              <button
                                type="button"
                                className="action-icon-button action-icon-green shrink-0"
                                title="Zahlungseingang in der Rechnung erfassen"
                                aria-label="Zahlungseingang erfassen"
                                onClick={() => onNavigate('invoices', 'all', invoice.invoiceNumber)}
                              >
                                <Banknote className="h-4 w-4" />
                              </button>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <MetricCardFooterAction onClick={() => onNavigate('invoices')}>
                  Alle Rechnungen
                </MetricCardFooterAction>
              </>
            ) : (
              <DashboardEmptyState variant="invoices" title="Noch keine Rechnungen"
                description="Ihre neuesten Rechnungen erscheinen hier mit Status und Betrag."
                action={{ label: 'Erste Rechnung schreiben', onClick: () => onNavigate('invoices', 'new') }} />
            )}
          </MetricCard>
        );

      case 'course-series':
        return (
          <MetricCard>
            <MetricCardHeader bordered>
              <div className="flex min-w-0 items-start gap-3">
                <span className="shrink-0 rounded-lg bg-primary-custom/10 p-2 text-primary-custom">
                  <GraduationCap className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <MetricCardTitle>{seriesTitle}</MetricCardTitle>
                  <MetricCardDescription className="mt-1">Regelmäßige Termine im Überblick</MetricCardDescription>
                </div>
              </div>
            </MetricCardHeader>

            {ongoingCourseSeries.length > 0 ? (
              <MetricCardContent className="divide-y divide-gray-100">
                {ongoingCourseSeries.slice(0, 5).map((series) => {
                  const weekAppointmentCount = series.jobs.filter((job) => {
                    const date = parseLocalJobDate(job.date);
                    return date >= currentWeekStart && date <= currentWeekEnd;
                  }).length;

                  return (
                    <button
                      key={series.key}
                      type="button"
                      onClick={() => onNavigate('jobs', undefined, undefined, undefined, series.key)}
                      className={listButtonClass}
                      aria-label={`${series.job.title} öffnen`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{series.job.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-gray-500">{series.job.customerName}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                          {weekAppointmentCount === 1 ? '1 Termin diese KW' : `${weekAppointmentCount} Termine diese KW`}
                        </span>
                      </span>
                      <MetricBadge tone="neutral">{series.jobs.length}</MetricBadge>
                    </button>
                  );
                })}
              </MetricCardContent>
            ) : (
              <DashboardEmptyState variant="series" title="Keine laufenden Serien"
                description="Die Kachel erscheint, sobald wiederkehrende Termine geplant sind." />
            )}

            <MetricCardFooterAction onClick={() => onNavigate('jobs')}>
              {ongoingCourseSeries.length > 5
                ? `${ongoingCourseSeries.length - 5} weitere anzeigen`
                : `Alle ${terminology.work.plural}`}
            </MetricCardFooterAction>
          </MetricCard>
        );

      case 'open-invoices':
        return (
          <MetricCard>
            <MetricCardHeader bordered>
              <div className="flex min-w-0 flex-col">
                <MetricValue>{money(openInvoices.total)}</MetricValue>
                <MetricCardDescription>
                  {preferences.monthView ? `Offene Rechnungen aus ${selectedMonthLabel} · heutiger Zahlungsstatus` : 'Offene Posten'} · {openInvoices.items.length === 1 ? '1 Rechnung' : `${openInvoices.items.length} Rechnungen`}
                </MetricCardDescription>
              </div>
              {openInvoices.overdueCount > 0 && (
                <MetricBadge tone="negative" className="whitespace-nowrap">{openInvoices.overdueCount} überfällig</MetricBadge>
              )}
            </MetricCardHeader>
            {openInvoices.items.length > 0 ? (
              <MetricCardContent className="divide-y divide-gray-100">
                {openInvoices.items.slice(0, 4).map(({ invoice, outstanding, overdue, dueDate }) => (
                  <button key={invoice.id} type="button" onClick={() => onNavigate('invoices', 'all', invoice.invoiceNumber)}
                    className={listButtonClass} aria-label={`Rechnung ${invoice.invoiceNumber} öffnen`}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${overdue ? 'bg-red-500' : 'bg-blue-500'}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">{invoice.customerName}</span>
                      <span className="mt-0.5 block truncate text-xs text-gray-500">
                        {invoice.invoiceNumber} · {overdue ? 'fällig seit' : 'fällig am'} {formatDate(dueDate, locale, company?.dateFormat)}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-gray-900 tabular-nums">{money(outstanding)}</span>
                  </button>
                ))}
              </MetricCardContent>
            ) : (
              <DashboardEmptyState variant="paid" title="Keine offenen Posten" description="Alle festgeschriebenen Rechnungen sind bezahlt." />
            )}
            <MetricCardFooterAction onClick={() => onNavigate('invoices', 'not-paid')}>
              {openInvoices.items.length > 4 ? `Alle ${openInvoices.items.length} offenen Rechnungen` : 'Zu den Rechnungen'}
            </MetricCardFooterAction>
          </MetricCard>
        );

      case 'income-expense':
        return (
          <MetricCard>
            <MetricCardHeader>
              <div className="flex min-w-0 flex-col">
                <MetricValue className={incomeExpense.result < 0 ? 'text-rose-700' : ''}>{money(incomeExpense.result)}</MetricValue>
                <MetricCardDescription>
                  Ergebnis {periodLabel} · Einnahmen {money(incomeExpense.income)} · Ausgaben {money(incomeExpense.expenses)}
                </MetricCardDescription>
              </div>
            </MetricCardHeader>
            <MetricCardContent className="flex flex-1 flex-col px-2 pb-2 lg:px-4">
              {financialSeriesActive && <p className="px-2 pb-2 text-xs text-gray-500">Diagramm: EÜR-Zahlungen und Prognose. Die Umsatzkennzahl zeigt Rechnungszahlungen.</p>}
              {incomeExpense.income > 0 || incomeExpense.expenses > 0 ? (
                <IncomeExpenseChart points={incomeExpense.points} formatValue={money}
                  ariaLabel={`Einnahmen und Ausgaben ${periodLabel}: Einnahmen ${money(incomeExpense.income)}, Ausgaben ${money(incomeExpense.expenses)}`} />
              ) : (
                <DashboardEmptyState variant="bars" title={`Noch keine Buchungen ${allYears ? 'erfasst' : `in ${dashboardYear}`}`}
                  description="Zahlungseingänge und Ausgaben aus der EÜR erscheinen hier je Monat."
                  action={{ label: 'Ausgabe erfassen', onClick: () => onNavigate('euer', 'new') }} />
              )}
            </MetricCardContent>
            <MetricCardFooterAction onClick={() => onNavigate('euer')}>Zur EÜR</MetricCardFooterAction>
          </MetricCard>
        );

      case 'upcoming-jobs':
        return (
          <MetricCard>
            <MetricCardHeader bordered>
              <div className="min-w-0">
                <MetricCardTitle>Nächste Termine</MetricCardTitle>
                <MetricCardDescription className="mt-1">{preferences.monthView ? `Termine im ${selectedMonthLabel}` : 'Ab heute, chronologisch'}</MetricCardDescription>
              </div>
            </MetricCardHeader>
            {nextJobs.length > 0 ? (
              <MetricCardContent className="divide-y divide-gray-100">
                {nextJobs.map(({ job, date }) => (
                  <button key={job.id} type="button" onClick={() => onNavigate('jobs', undefined, job.jobNumber || job.title)}
                    className={listButtonClass} aria-label={`${job.title} am ${formatDate(date, locale, company?.dateFormat)} öffnen`}>
                    <span className="flex w-11 shrink-0 flex-col items-center rounded-lg bg-primary-custom/10 py-1 text-primary-custom">
                      <span className="text-[10px] font-medium uppercase leading-none">{date.toLocaleDateString(locale, { weekday: 'short' }).replace('.', '')}</span>
                      <span className="mt-0.5 text-sm font-semibold leading-none tabular-nums">{date.getDate()}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">{job.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-gray-500">
                        {[job.customerName, getJobTimeRange(job, locale, company?.timeFormat, company?.numberFormat)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                ))}
              </MetricCardContent>
            ) : (
              <DashboardEmptyState variant="calendar" title="Keine anstehenden Termine"
                action={{ label: terminology.work.newLabel, onClick: () => onNavigate('jobs', 'new') }} />
            )}
            <MetricCardFooterAction onClick={() => onNavigate('calendar')}>Zum Kalender</MetricCardFooterAction>
          </MetricCard>
        );

      case 'open-quotes':
        return (
          <MetricCard>
            <MetricCardHeader bordered>
              <div className="flex min-w-0 flex-col">
                <MetricValue>{money(openQuotes.total)}</MetricValue>
                <MetricCardDescription>
                  {preferences.monthView ? `Angebote aus ${selectedMonthLabel} · heutiger Status` : 'Offene Angebote'} · {openQuotes.items.length === 1 ? '1 versendet' : `${openQuotes.items.length} versendet`}
                </MetricCardDescription>
              </div>
            </MetricCardHeader>
            {openQuotes.items.length > 0 ? (
              <MetricCardContent className="divide-y divide-gray-100">
                {openQuotes.items.slice(0, 4).map(({ quote, validUntil, expired }) => (
                  <button key={quote.id} type="button" onClick={() => onNavigate('quote-editor', quote.id)}
                    className={listButtonClass} aria-label={`Angebot ${quote.quoteNumber} öffnen`}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${expired ? 'bg-amber-500' : 'bg-blue-500'}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">{quote.customerName}</span>
                      <span className="mt-0.5 block truncate text-xs text-gray-500">
                        {quote.quoteNumber} · {expired ? 'abgelaufen am' : 'gültig bis'} {formatDate(validUntil, locale, company?.dateFormat)}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-gray-900 tabular-nums">{money(quote.total)}</span>
                  </button>
                ))}
              </MetricCardContent>
            ) : (
              <DashboardEmptyState variant="quotes" title="Keine offenen Angebote"
                action={{ label: 'Angebot schreiben', onClick: () => onNavigate('quote-editor') }} />
            )}
            <MetricCardFooterAction onClick={() => onNavigate('quotes')}>Alle Angebote</MetricCardFooterAction>
          </MetricCard>
        );

      case 'unbilled-jobs':
        return (
          <MetricCard>
            <MetricCardHeader bordered>
              <div className="flex min-w-0 flex-col">
                <MetricValue>{unbilledJobs.length}</MetricValue>
                <MetricCardDescription>
                  Abgeschlossen, noch ohne Rechnung{unbilledHours > 0 ? ` · ${formatNumber(unbilledHours, locale, company?.numberFormat, 1)} Std.` : ''}
                </MetricCardDescription>
              </div>
            </MetricCardHeader>
            {unbilledJobs.length > 0 ? (
              <MetricCardContent className="divide-y divide-gray-100">
                {unbilledJobs.slice(0, 4).map(job => (
                  <button key={job.id} type="button" onClick={() => onNavigate('jobs', undefined, job.jobNumber || job.title)}
                    className={listButtonClass} aria-label={`${job.title} öffnen`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">{job.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-gray-500">
                        {[job.customerName, formatDate(job.date, locale, company?.dateFormat)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                  </button>
                ))}
              </MetricCardContent>
            ) : (
              <DashboardEmptyState variant="jobs" title="Alles abgerechnet"
                description={`Abgeschlossene ${terminology.work.plural} ohne Rechnung erscheinen hier.`} />
            )}
            <MetricCardFooterAction onClick={() => onNavigate('jobs')}>Alle {terminology.work.plural}</MetricCardFooterAction>
          </MetricCard>
        );

      case 'average-invoice':
        return (
          <MetricCard>
            <MetricCardHeader className="flex-1">
              {averageInvoice.count > 0 ? (
                <div className="flex min-w-0 flex-col">
                  <MetricValue>{money(averageInvoice.average)}</MetricValue>
                  <MetricCardDescription>
                    Ø Rechnungsbetrag {periodLabel} · {averageInvoice.count === 1 ? '1 Rechnung' : `${averageInvoice.count} Rechnungen`}{includeUnpaidInvoices ? '' : ', nur bezahlte'}
                  </MetricCardDescription>
                </div>
              ) : (
                <DashboardEmptyState compact variant="metric" title="Ø Rechnungsbetrag"
                  description={`Noch keine ${includeUnpaidInvoices ? '' : 'bezahlten '}Rechnungen ${allYears ? 'erfasst' : `in ${dashboardYear}`}.`} />
              )}
            </MetricCardHeader>
          </MetricCard>
        );

      case 'active-customers':
        return (
          <MetricCard>
            <MetricCardHeader className="flex-1">
              {customers.length > 0 ? (
                <div className="flex min-w-0 flex-col">
                  <MetricValue>{activeCustomerCount}</MetricValue>
                  <MetricCardDescription>
                    Aktive {terminology.entity.plural} {periodLabel} · von {customers.length}
                  </MetricCardDescription>
                </div>
              ) : (
                <DashboardEmptyState compact variant="customers" title={`Noch keine ${terminology.entity.plural}`}
                  action={{ label: terminology.entity.newLabel, onClick: () => onNavigate('customers', 'new') }} />
              )}
            </MetricCardHeader>
          </MetricCard>
        );

      case 'recent-receipts':
        return (
          <MetricCard>
            <MetricCardHeader bordered>
              <div className="min-w-0">
                <MetricCardTitle>Neueste Belege</MetricCardTitle>
                <MetricCardDescription className="mt-1">Zuletzt hochgeladen</MetricCardDescription>
              </div>
            </MetricCardHeader>
            {receipts === null ? (
              <div className="space-y-3 px-4 py-4 lg:px-6" aria-hidden="true">
                {Array.from({ length: 3 }, (_, index) => <SkeletonBlock key={index} className="h-4 w-full" />)}
              </div>
            ) : latestReceipts.length > 0 ? (
              <MetricCardContent className="divide-y divide-gray-100">
                {latestReceipts.map(receipt => {
                  const status = receiptStatus(receipt);
                  return (
                    <button key={receipt.id} type="button" onClick={() => onNavigate('documents', 'receipts')}
                      className={listButtonClass} aria-label={`Beleg ${receipt.extractedData?.vendorName || receipt.name} öffnen`}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{receipt.extractedData?.vendorName || receipt.name}</span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-gray-500">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} aria-hidden="true" />
                          <span className="truncate">{status.label}</span>
                        </span>
                      </span>
                      {typeof receipt.extractedData?.grossAmount === 'number' && (
                        <span className="shrink-0 text-sm font-medium text-gray-900 tabular-nums">{money(receipt.extractedData.grossAmount)}</span>
                      )}
                    </button>
                  );
                })}
              </MetricCardContent>
            ) : (
              <DashboardEmptyState variant="receipts" title="Noch keine Belege"
                description="Hochgeladene Belege werden lokal ausgelesen und erscheinen hier."
                action={{ label: 'Beleg hochladen', onClick: () => onNavigate('documents', 'receipts') }} />
            )}
            <MetricCardFooterAction onClick={() => onNavigate('documents', 'receipts')}>Alle Belege</MetricCardFooterAction>
          </MetricCard>
        );
    }
  };

  return (
    <div className="dashboard-metrics page-root space-y-6" aria-busy={!preferencesLoaded}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-3">
        <h1 className="min-w-0 max-w-full truncate text-lg font-semibold text-gray-900 sm:text-2xl">Willkommen<span className="hidden min-[400px]:inline"> zurück</span>{greetingName ? `, ${greetingName}` : ''}</h1>
        {!editing && <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <label className="sr-only" htmlFor="dashboard-year">Jahr auswählen</label>
          <select id="dashboard-year" value={allYears ? 'all' : dashboardYear} onChange={event => {
            // Das laufende Jahr wird als `null` gespeichert, damit die Übersicht im
            // neuen Jahr automatisch mitwandert.
            const selected = event.target.value === 'all' ? 'all' : Number(event.target.value);
            const year = selected === today.getFullYear() ? null : selected;
            savePreferences({ ...preferences, year, monthView: false, comparePrevious: year === 'all' ? false : preferences.comparePrevious });
          }} disabled={!preferencesLoaded} className="form-input dashboard-header-control w-[6.5rem] px-2 py-1.5 text-sm disabled:opacity-60 sm:w-28">
            <option value="all">Gesamt</option>
            {availableYears.map(year => <option key={year} value={year}>{year}</option>)}
          </select>
          <button type="button" {...customizeTooltip.anchorProps} aria-describedby={undefined}
            onClick={startEditing} disabled={!preferencesLoaded} aria-label="Dashboard anpassen" className="dashboard-header-button">
            <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
          </button>
          <FloatingTooltipBubble id={customizeTooltip.id} anchorRef={customizeTooltip.anchorRef} open={customizeTooltip.open}>Dashboard anpassen</FloatingTooltipBubble>
          <ActionMenu fitViewport ariaLabel="Dashboard-Optionen" title="Dashboard-Optionen" icon={<MoreHorizontal className="h-5 w-5" />}
            menuClassName="w-[min(22rem,calc(100vw-1rem))] min-w-[18rem]" triggerClassName="dashboard-header-button" disabled={!preferencesLoaded}>
            <div className="flex items-center justify-between gap-2 pl-3 pr-1.5 pt-1">
              <p className="text-xs font-medium text-gray-500">Auswertung</p>
              <FloatingInfoTooltip label="So wird gerechnet"
                text="Bezahlte Rechnungen zählen nach Zahlungsdatum, offene nach Rechnungsdatum. Entwürfe und nicht bestätigte Aufträge fließen nicht ein." />
            </div>
            <ActionMenuItem icon={<SwitchTrack checked={!includeUnpaidInvoices} />} role="menuitemcheckbox" aria-checked={!includeUnpaidInvoices}
              onClick={event => { event.preventDefault(); savePreferences({ ...preferences, includeUnpaidInvoices: !includeUnpaidInvoices }); }}>
              Nur bezahlte Rechnungen
            </ActionMenuItem>
            {REVENUE_CHART_SERIES.filter(series => series.group === 'comparison' && !(preferences.monthView && series.id === 'previous-period')).map(series => {
              const reason = series.unavailableReason(seriesContext);
              const active = !reason && series.isActive(preferences);
              return (
                <ActionMenuItem key={series.id} icon={<SwitchTrack checked={active} />} role="menuitemcheckbox" aria-checked={active}
                  disabled={Boolean(reason)} title={reason ?? undefined}
                  onClick={event => { event.preventDefault(); if (!reason) savePreferences(series.toggle(preferences)); }}>
                  {series.menuLabel}
                </ActionMenuItem>
              );
            })}
            {taxesEnabled && <>
              <div className="mt-1 border-t border-gray-100 px-3 pt-2"><p className="text-xs font-medium text-gray-500">Kosten &amp; Abgaben einblenden</p></div>
              <ActionMenuItem icon={<SwitchTrack checked={preferences.showPrivateLevies} />} role="menuitemcheckbox" aria-checked={preferences.showPrivateLevies}
                onClick={event => { event.preventDefault(); savePreferences({ ...preferences, showPrivateLevies: !preferences.showPrivateLevies }); }}>
                Private Abgaben einblenden
              </ActionMenuItem>
              {REVENUE_CHART_SERIES.filter(series => series.group === 'levies' && (!series.private || preferences.showPrivateLevies)).map(series => {
                const reason = unavailableSeries.get(series.id) ?? null;
                const active = !reason && series.isActive(preferences);
                return <ActionMenuItem key={series.id} accessory={<FloatingInfoTooltip label={`Hinweise zu ${series.menuLabel}`} text={reason ?? `${TAX_TEXTS.badge}. ${TAX_TEXTS.tooltip(dashboardYear)}`} />} icon={<SwitchTrack checked={active} />} role="menuitemcheckbox" aria-checked={active}
                  disabled={Boolean(reason)} title={reason ?? undefined} multiline
                  onClick={event => { event.preventDefault(); if (!reason) savePreferences(series.toggle(preferences)); }}>
                  <span className="flex min-w-0 items-center gap-1">{series.menuLabel}{series.private && <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-600">privat</span>}</span>
                </ActionMenuItem>;
              })}
            </>}
            <div className="mt-1 border-t border-gray-100 px-3 pt-2"><p className="text-xs font-medium text-gray-500">Ansicht</p></div>
            <ActionMenuItem icon={<SwitchTrack checked={preferences.monthView} />} role="menuitemcheckbox" aria-checked={preferences.monthView}
              onClick={event => { event.preventDefault(); savePreferences({ ...preferences, monthView: !preferences.monthView, month: selectedMonth, compareMonth: comparisonMonth, year: Number(selectedMonth.slice(0, 4)) }); }}>
              Monatsansicht mit Vergleich
            </ActionMenuItem>
            <ActionMenuItem icon={<SwitchTrack checked={allYears} />} role="menuitemcheckbox" aria-checked={allYears}
              disabled={preferences.monthView}
              onClick={event => { event.preventDefault(); savePreferences({ ...preferences, year: allYears ? null : 'all', comparePrevious: allYears ? preferences.comparePrevious : false }); }}>
              Gesamter Zeitraum
            </ActionMenuItem>
            {allYears && <p className="px-3 pb-1 text-xs text-gray-500">Der Vergleich ist für „Gesamt“ nicht verfügbar.</p>}
          </ActionMenu>
        </div>}
      </div>

      {!editing && preferences.monthView && <DashboardMonthSelector monthKeys={monthKeys} selectedMonth={selectedMonth} comparisonMonth={comparisonMonth}
        locale={locale} currentMonth={currentMonthKey} onComparisonChange={month => savePreferences({ ...preferences, compareMonth: month })}
        onMonthChange={month => {
          const selection = moveDashboardMonthSelection(monthKeys, selectedMonth, comparisonMonth, month);
          savePreferences({ ...preferences, month: selection.selectedMonth, compareMonth: selection.comparisonMonth, year: Number(selection.selectedMonth.slice(0, 4)) });
        }} />}


      {/* Ein Abstand für alles: zwischen Schnellzugriffen, Kacheln und Reihen. */}
      <div className="flex min-w-0 flex-col gap-3">
        {editing && (
          <div ref={editToolbarRef} tabIndex={-1} className="rounded-xl outline-none">
            <DashboardEditToolbar
              onReset={() => updateDraft(() => resetDashboardLayout(preferences).items, 'Standardauswahl wiederhergestellt. Mit „Fertig“ speichern.')}
              onCancel={cancelEditing}
              onDone={finishEditing}
              canReset={dashboardLayoutChanged(layout, resetDashboardLayout(layout))}
              addGroups={addGroups}
              onAdd={id => {
                updateDraft(items => setDashboardItemVisible(items, id, true), `${itemLabel(id)} hinzugefügt.`);
                focusToolbar();
              }}
            />
          </div>
        )}
        {editing && taxesEnabled && !preferences.showPrivateLevies && <p role="note" className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">Private Abgaben sind ausgeblendet – im ⋯-Menü einschalten.</p>}

        {quickIds.length > 0 && (editing ? (
          <DashboardSortableGroup ids={quickIds} labelOf={itemLabel} onMove={(active, over) => updateDraft(items => moveDashboardItem(items, active, over))}>
            <div className="dashboard-quick-actions grid gap-3" style={quickColumns}>
              {quickIds.map(id => (
                <DashboardEditItem key={id} compactLabel {...editControls(quickIds, id)}>{renderQuickAction(id)}</DashboardEditItem>
              ))}
            </div>
          </DashboardSortableGroup>
        ) : (
          <div className="dashboard-quick-actions grid gap-3" style={quickColumns}>
            {quickIds.map(id => <Fragment key={id}>{renderQuickAction(id)}</Fragment>)}
          </div>
        ))}

        {preferencesError && <p role="status" className="text-xs text-red-700">Dashboard-Einstellungen konnten nicht gespeichert werden.</p>}
        {taxesEnabled && allYears && (financialPreferencesSelected || cardIds.some(id => getDashboardItemDefinition(id)?.requiredExtension === 'taxes')) && <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Steuer- und Abgabenschätzungen benötigen ein einzelnes Steuerjahr. Bitte wähle oben ein Jahr aus.</p>}
        {taxesEnabled && !allYears && (financialSeriesActive || cardIds.some(id => ['taxes', 'tax-reserve', 'tax-position', 'small-business', 'fixed-costs', 'tax-advances', 'health-backpayment'].includes(id))) && forecast?.profileComplete && forecast.warnings.length > 0 && <details className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <summary className="cursor-pointer font-medium">Hinweise zur Steuerschätzung ({forecast.warnings.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">{forecast.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>
        </details>}

        {cardIds.length > 0 ? (editing ? (
          <DashboardSortableGroup ids={cardIds} labelOf={itemLabel} onMove={(active, over) => updateDraft(items => moveDashboardItem(items, active, over))}>
            <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-12">
              {cardIds.map(id => (
                <DashboardEditItem key={id} className={spanClass(id)} {...editControls(cardIds, id)}>{renderCard(id)}</DashboardEditItem>
              ))}
            </div>
          </DashboardSortableGroup>
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-12">
            {cardIds.map(id => <div key={id} className={`flex min-w-0 flex-col ${spanClass(id)}`}>{renderCard(id)}</div>)}
          </div>
        )) : !editing && preferencesLoaded && (
          <MetricCard>
            <DashboardEmptyState variant="metric" title="Alle Kacheln sind ausgeblendet"
              description="Über „Dashboard anpassen“ lassen sich Kacheln wieder hinzufügen."
              action={{ label: 'Kacheln hinzufügen', onClick: startEditing }} />
          </MetricCard>
        )}
      </div>

      <p className="sr-only" aria-live="polite" role="status">{liveMessage}</p>

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

function receiptStatus(receipt: Receipt): { label: string; dot: string } {
  if (receipt.linkedEuerEntryId) return { label: 'In der EÜR gebucht', dot: 'bg-green-500' };
  switch (receipt.ocrStatus) {
    case 'pending':
    case 'processing': return { label: 'Wird ausgelesen', dot: 'bg-gray-400' };
    case 'failed': return { label: 'Auslesen fehlgeschlagen', dot: 'bg-red-500' };
    default: return { label: 'Bitte prüfen', dot: 'bg-amber-500' };
  }
}
