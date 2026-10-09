import React, { useEffect, useState } from 'react';
import logger from '../utils/logger';
import { ArrowDown, ArrowUp, Banknote, Briefcase, CalendarDays, ChevronRight, FileText, GraduationCap, MoreHorizontal, Send, SlidersHorizontal, Upload, Users } from 'lucide-react';
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
import type { EuerEntry, Invoice, JobEntry, NumberFormat, TimeFormat } from '../types';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { DialogShell } from './DialogShell';
import { SwitchTrack } from './ToggleSwitch';
import { useAuth } from '../context/AuthContext';
import { DEFAULT_DASHBOARD_PREFERENCES, normalizeDashboardPreferences, type DashboardItemId, type DashboardPreferences } from '../utils/dashboardPreferences';
import { aggregateRevenue, buildRevenueRecords, compareRevenue, sumRevenue } from '../utils/dashboardMetrics';
import {
  DeltaBadge,
  MetricBadge,
  MetricCard,
  MetricCardContent,
  MetricCardDescription,
  MetricCardFooterAction,
  MetricCardHeader,
  MetricCardTitle,
  MetricEmptyState,
  MetricValue,
  ShareBarItem,
  ShareBarList,
} from './DashboardMetrics';
import { RevenueAreaChart } from './RevenueAreaChart';

import { getTerminology } from '../utils/terminology';
import { useFeedback } from '../context/FeedbackContext';
import { SkeletonBlock } from './TableSkeleton';

interface DashboardProps {
  onNavigate: (page: string, filter?: string, searchTerm?: string, invoiceId?: string, jobSeriesId?: string) => void;
}

type DashboardCourseSeries = {
  key: string;
  job: JobEntry;
  jobs: JobEntry[];
};

type DashboardRevenueRecord = { customerName: string; date: Date; amount: number };

const DASHBOARD_ITEM_LABELS: Record<DashboardItemId, string> = {
  'quick-invoice': 'Rechnung schreiben', 'quick-receipt': 'Beleg hochladen',
  'quick-customer': 'Neuer Kunde / Träger', 'quick-course': 'Neuer Kurs',
  revenue: 'Umsatzverlauf', 'top-customers': 'Umsatzstärkste Kunden / Träger',
  'week-calendar': 'Termine der Kalenderwoche', 'recent-jobs': 'Aktuelle Kurse / Aufträge',
  'recent-invoices': 'Aktuelle Rechnungen', 'course-series': 'Laufende Kursserien',
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
  const { user } = useAuth();
  const terminology = getTerminology(company.terminologyProfile);
  const { loading } = useLoading();
  const [preferences, setPreferences] = useState<DashboardPreferences>(DEFAULT_DASHBOARD_PREFERENCES);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [preferencesError, setPreferencesError] = useState(false);
  const [euerEntries, setEuerEntries] = useState<EuerEntry[]>([]);

  const savePreferences = (next: DashboardPreferences) => {
    const normalized = normalizeDashboardPreferences(next);
    setPreferences(normalized);
    setPreferencesError(false);
    void apiService.updateDashboardPreferences(normalized).catch(() => setPreferencesError(true));
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
  const currentWeekStart = getWeekStart(today);
  const currentWeekEnd = new Date(currentWeekStart);
  currentWeekEnd.setDate(currentWeekEnd.getDate() + 6);
  const currentWeekNumber = getCalendarWeek(today);

  const currentWeekJobs = jobEntries
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
  jobEntries.forEach(job => {
    const seriesId = job.recurrence?.id;
    if (!seriesId) return;
    const seriesJobs = recurringJobsBySeries.get(seriesId) || [];
    seriesJobs.push(job);
    recurringJobsBySeries.set(seriesId, seriesJobs);
  });

  const ongoingCourseSeries: DashboardCourseSeries[] = Array.from(recurringJobsBySeries.entries())
    .filter(([, jobs]) => jobs.length > 1 && jobs.some(job => job.status === 'draft' || job.status === 'in-progress'))
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
      <div className="page-root space-y-6" role="status" aria-live="polite">
        <span className="sr-only">Übersicht wird geladen …</span>
        <div aria-hidden="true" className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex h-[4.5rem] items-center justify-center rounded-xl border border-gray-200 bg-white">
              <SkeletonBlock className="h-3 w-28" />
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
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
  const dashboardYear = preferences.year ?? today.getFullYear();
  const allYears = preferences.year === 'all';
  const includeUnpaidInvoices = preferences.includeUnpaidInvoices;
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

  const recordsForYear = (year: number | 'all') => year === 'all'
    ? revenueRecords : revenueRecords.filter(record => record.date.getFullYear() === year);
  const revenuePoints = aggregateRevenue(revenueRecords, dashboardYear, locale);
  const previousPoints = !allYears && preferences.comparePrevious
    ? aggregateRevenue(revenueRecords, Number(dashboardYear) - 1, locale) : [];
  const revenueWindowTotal = sumRevenue(revenuePoints);
  const previousWindowTotal = sumRevenue(previousPoints);

  // Ohne Vergleichswert lässt sich keine Veränderung angeben. Dann entfällt die
  // Angabe, statt einen Platzhalter zu zeigen.
  const revenueDelta = !allYears && preferences.comparePrevious
    ? compareRevenue(revenueWindowTotal, previousWindowTotal) : null;

  const money = (value: number) => formatCurrency(value, locale, company?.numberFormat, company?.currency);
  const formatPercent = (value: number) => `${formatNumber(
    Math.abs(value),
    locale,
    company?.numberFormat,
    Math.abs(value) >= 100 ? 0 : 1,
  )} %`;

  const customerRevenue = new Map<string, number>();
  recordsForYear(dashboardYear).forEach(record => {
    customerRevenue.set(record.customerName, (customerRevenue.get(record.customerName) || 0) + record.amount);
  });
  const topCustomers = Array.from(customerRevenue.entries())
    .filter(([, revenue]) => revenue > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, revenue]) => ({ name, revenue }));
  const topCustomerMax = topCustomers.reduce((max, entry) => Math.max(max, entry.revenue), 0);

  const recentInvoices = [...invoices]
    .sort((a, b) => compareTableValues(b.issueDate, a.issueDate, locale)
      || compareTableValues(b.invoiceNumber, a.invoiceNumber, locale)
      || compareTableValues(b.createdAt, a.createdAt, locale))
    .slice(0, 5);

  const jobActivityTimestamp = (job: JobEntry): number => {
    const value = job.createdAt || job.updatedAt || job.date;
    const timestamp = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  };

  const recentJobs = [...jobEntries]
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

  const orderOf = (id: DashboardItemId) => preferences.items.findIndex(item => item.id === id);
  const isVisible = (id: DashboardItemId) => preferences.items.find(item => item.id === id)?.visible !== false;
  const invoicesCardSpan = isVisible('course-series') && ongoingCourseSeries.length > 0
    ? 'md:col-span-2 lg:col-span-3'
    : 'md:col-span-2 lg:col-span-4';
  const moveItem = (id: DashboardItemId, direction: -1 | 1) => {
    const items = [...preferences.items];
    const index = items.findIndex(item => item.id === id);
    const quick = id.startsWith('quick-');
    let nextIndex = index + direction;
    while (nextIndex >= 0 && nextIndex < items.length && items[nextIndex].id.startsWith('quick-') !== quick) nextIndex += direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return;
    [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
    savePreferences({ ...preferences, items });
  };
  const itemLabel = (id: DashboardItemId): string => {
    switch (id) {
      case 'quick-customer': return terminology.entity.newLabel;
      case 'quick-course': return terminology.work.newLabel;
      case 'top-customers': return `Top-${terminology.entity.plural}`;
      case 'recent-jobs': return `Aktuelle ${terminology.work.plural}`;
      default: return DASHBOARD_ITEM_LABELS[id];
    }
  };

  const canMoveItem = (id: DashboardItemId, direction: -1 | 1) => {
    const index = orderOf(id);
    const quick = id.startsWith('quick-');
    let nextIndex = index + direction;
    while (nextIndex >= 0 && nextIndex < preferences.items.length && preferences.items[nextIndex].id.startsWith('quick-') !== quick) nextIndex += direction;
    return index >= 0 && nextIndex >= 0 && nextIndex < preferences.items.length;
  };
  const greetingName = user?.firstName?.trim() || user?.displayName?.trim() || company.name?.trim();

  return (
    <div className="dashboard-metrics page-root space-y-6" aria-busy={!preferencesLoaded}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h1 className="min-w-0 truncate text-lg font-semibold text-gray-900 sm:text-2xl">Willkommen<span className="hidden min-[400px]:inline"> zurück</span>{greetingName ? `, ${greetingName}` : ''}</h1>
        <div className="flex shrink-0 items-center gap-1.5">
          <label className="sr-only" htmlFor="dashboard-year">Jahr auswählen</label>
          <select id="dashboard-year" value={allYears ? 'all' : dashboardYear} onChange={event => {
            // Das laufende Jahr wird als `null` gespeichert, damit die Übersicht im
            // neuen Jahr automatisch mitwandert.
            const selected = event.target.value === 'all' ? 'all' : Number(event.target.value);
            const year = selected === today.getFullYear() ? null : selected;
            savePreferences({ ...preferences, year, comparePrevious: year === 'all' ? false : preferences.comparePrevious });
          }} disabled={!preferencesLoaded} className="form-input min-h-10 w-[6.5rem] px-2 py-1.5 text-sm disabled:opacity-60 sm:w-28">
            <option value="all">Gesamt</option>
            {availableYears.map(year => <option key={year} value={year}>{year}</option>)}
          </select>
          <ActionMenu ariaLabel="Dashboard-Optionen" title="Dashboard-Optionen" icon={<MoreHorizontal className="h-5 w-5" />}
            menuClassName="w-[min(22rem,calc(100vw-1rem))] min-w-[18rem]" triggerClassName="action-icon-button action-icon-blue" disabled={!preferencesLoaded}>
            <p className="px-3 pb-1 pt-2 text-xs font-medium text-gray-500">Auswertung</p>
            <ActionMenuItem icon={<SwitchTrack checked={!includeUnpaidInvoices} />} role="menuitemcheckbox" aria-checked={!includeUnpaidInvoices}
              onClick={event => { event.preventDefault(); savePreferences({ ...preferences, includeUnpaidInvoices: !includeUnpaidInvoices }); }}>
              Nur bezahlte Rechnungen
            </ActionMenuItem>
            <ActionMenuItem icon={<SwitchTrack checked={preferences.comparePrevious && !allYears} />} role="menuitemcheckbox" aria-checked={preferences.comparePrevious && !allYears}
              disabled={allYears} title={allYears ? 'Für den gesamten Zeitraum gibt es keinen einzelnen Vorzeitraum.' : undefined}
              onClick={event => { event.preventDefault(); if (!allYears) savePreferences({ ...preferences, comparePrevious: !preferences.comparePrevious }); }}>
              Mit Vorzeitraum vergleichen
            </ActionMenuItem>
            <ActionMenuItem icon={<SwitchTrack checked={allYears} />} role="menuitemcheckbox" aria-checked={allYears}
              onClick={event => { event.preventDefault(); savePreferences({ ...preferences, year: allYears ? null : 'all', comparePrevious: allYears ? preferences.comparePrevious : false }); }}>
              Gesamter Zeitraum
            </ActionMenuItem>
            {allYears && <p className="px-3 pb-1 text-xs text-gray-500">Der Vergleich ist für „Gesamt“ nicht verfügbar.</p>}
            <div className="my-1 border-t border-gray-100" />
            <ActionMenuItem icon={<SlidersHorizontal className="h-4 w-4" />} role="menuitem" onClick={() => setCustomizeOpen(true)}>Dashboard anpassen …</ActionMenuItem>
            <p className="px-3 pb-2 pt-2 text-[11px] leading-4 text-gray-500">Bezahlte Rechnungen zählen nach Zahlungsdatum, offene nach Rechnungsdatum. Entwürfe und nicht bestätigte Aufträge fließen nicht ein.</p>
          </ActionMenu>
        </div>
      </div>

      <div className="dashboard-quick-actions grid grid-cols-2 gap-3 sm:grid-cols-4">
          {isVisible('quick-invoice') && <button style={{ order: orderOf('quick-invoice') }} type="button" onClick={() => onNavigate('invoices', 'new')} className="dashboard-quick-action group" aria-label="Neue Rechnung schreiben">
            <span className="dashboard-quick-action-icon"><FileText className="h-7 w-7" /></span>
            Rechnung schreiben
          </button>}
          {isVisible('quick-receipt') && <button style={{ order: orderOf('quick-receipt') }} type="button" onClick={() => onNavigate('documents', 'receipts')} className="dashboard-quick-action group" aria-label="Beleg hochladen">
            <span className="dashboard-quick-action-icon"><Upload className="h-7 w-7" /></span>
            Beleg hochladen
          </button>}
          {isVisible('quick-customer') && <button style={{ order: orderOf('quick-customer') }} type="button" onClick={() => onNavigate('customers', 'new')} className="dashboard-quick-action group" aria-label={`Neuen ${terminology.entity.singular} anlegen`}>
            <span className="dashboard-quick-action-icon"><Users className="h-7 w-7" /></span>
            {terminology.entity.newLabel}
          </button>}
          {isVisible('quick-course') && <button style={{ order: orderOf('quick-course') }} type="button" onClick={() => onNavigate('jobs', 'new')} className="dashboard-quick-action group" aria-label={`Neuen ${terminology.work.singular} anlegen`}>
            <span className="dashboard-quick-action-icon"><Briefcase className="h-7 w-7" /></span>
          {terminology.work.newLabel}
          </button>}
      </div>

      {preferencesError && <p role="status" className="text-xs text-red-700">Dashboard-Einstellungen konnten nicht gespeichert werden.</p>}

      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Umsatzverlauf */}
        {isVisible('revenue') && <MetricCard style={{ order: orderOf('revenue') }} className={isVisible('top-customers') ? 'md:col-span-2 lg:col-span-3' : 'md:col-span-2 lg:col-span-4'}>
          <MetricCardHeader>
            <div className="flex min-w-0 flex-col">
              <MetricValue>{money(revenueWindowTotal)}</MetricValue>
              <MetricCardDescription>Gesamtumsatz {allYears ? 'gesamt' : dashboardYear} · {includeUnpaidInvoices ? 'bezahlt und offen' : 'nur bezahlt'}</MetricCardDescription>
              {!allYears && preferences.comparePrevious && <MetricCardDescription className="mt-1">Vorjahr: {money(previousWindowTotal)}</MetricCardDescription>}
            </div>
            {revenueDelta !== null && (
              <DeltaBadge
                value={revenueDelta}
                formattedValue={formatPercent(revenueDelta)}
                label={`ggü. ${Number(dashboardYear) - 1}`}
              />
            )}
          </MetricCardHeader>
          <MetricCardContent className="px-2 pb-2 lg:px-4">
            {revenueWindowTotal > 0 || previousWindowTotal > 0 ? (
              <RevenueAreaChart
                points={revenuePoints}
                previousPoints={previousPoints}
                currentLabel={String(dashboardYear)}
                previousLabel={String(Number(dashboardYear) - 1)}
                formatValue={money}
                ariaLabel={`Umsatzverlauf ${allYears ? 'gesamt' : dashboardYear}, insgesamt ${money(revenueWindowTotal)}`}
              />
            ) : (
              <MetricEmptyState>Für {allYears ? 'den Gesamtzeitraum' : dashboardYear} wurden keine Umsätze erfasst.</MetricEmptyState>
            )}
          </MetricCardContent>
          {company.reportingEnabled && (
            <MetricCardFooterAction onClick={() => onNavigate('reporting')}>
              Zu den Auswertungen
            </MetricCardFooterAction>
          )}
        </MetricCard>}

        {/* Top-Kunden */}
        {isVisible('top-customers') && <MetricCard style={{ order: orderOf('top-customers') }} className="md:col-span-2 lg:col-span-1">
          <MetricCardHeader bordered>
            <div className="min-w-0">
              <MetricCardTitle>Top-{terminology.entity.plural}</MetricCardTitle>
              <MetricCardDescription className="mt-1">Umsatzstärkste {allYears ? 'gesamt' : dashboardYear}</MetricCardDescription>
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
              <MetricEmptyState>Noch keine Umsätze erfasst.</MetricEmptyState>
            )}
          </MetricCardContent>
          <MetricCardFooterAction onClick={() => onNavigate('customers')}>
            Alle {terminology.entity.plural}
          </MetricCardFooterAction>
        </MetricCard>}

        {/* Termine der aktuellen Kalenderwoche */}
        {isVisible('week-calendar') && <MetricCard style={{ order: orderOf('week-calendar') }} className="md:col-span-2 lg:col-span-4">
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
            <MetricEmptyState>In dieser Kalenderwoche sind keine Termine geplant.</MetricEmptyState>
          )}
        </MetricCard>}

        {/* Aktuelle Aufträge: unabhängig von der Kalenderwoche, damit auch
            importierte Aufträge direkt auf der Übersicht auffindbar sind. */}
        {isVisible('recent-jobs') && <MetricCard style={{ order: orderOf('recent-jobs') }} className="md:col-span-2 lg:col-span-4">
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
                  className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 lg:px-6"
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
            <MetricEmptyState>Noch keine {terminology.work.plural} vorhanden.</MetricEmptyState>
          )}
          <MetricCardFooterAction onClick={() => onNavigate('jobs')}>
            Alle {terminology.work.plural}
          </MetricCardFooterAction>
        </MetricCard>}

        {/* Aktuelle Rechnungen */}
        {isVisible('recent-invoices') && <MetricCard style={{ order: orderOf('recent-invoices') }} className={invoicesCardSpan}>
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
            <MetricEmptyState>Noch keine Rechnungen vorhanden.</MetricEmptyState>
          )}
        </MetricCard>}

        {/* Laufende Serien */}
        {isVisible('course-series') && ongoingCourseSeries.length > 0 && (
          <MetricCard style={{ order: orderOf('course-series') }} className="md:col-span-2 lg:col-span-1">
            <MetricCardHeader bordered>
              <div className="flex min-w-0 items-start gap-3">
                <span className="shrink-0 rounded-lg bg-primary-custom/10 p-2 text-primary-custom">
                  <GraduationCap className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <MetricCardTitle>
                    {terminology.work.plural.toLocaleLowerCase('de-DE').includes('kurs')
                      ? 'Laufende Kursserien'
                      : `Laufende ${terminology.work.plural}`}
                  </MetricCardTitle>
                  <MetricCardDescription className="mt-1">Regelmäßige Termine im Überblick</MetricCardDescription>
                </div>
              </div>
            </MetricCardHeader>

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
                    className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 lg:px-6"
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

            <MetricCardFooterAction onClick={() => onNavigate('jobs')}>
              {ongoingCourseSeries.length > 5
                ? `${ongoingCourseSeries.length - 5} weitere anzeigen`
                : `Alle ${terminology.work.plural}`}
            </MetricCardFooterAction>
          </MetricCard>
        )}
      </div>

      <EmailSendModal
        isOpen={emailModal.isOpen}
        onClose={handleEmailModalClose}
        onSend={handleEmailSend}
        document={emailModal.invoice!}
        documentType="invoice"
        customer={emailModal.customer!}
        isLoading={isSendingEmail === emailModal.invoice?.id}
      />
      {customizeOpen && <DialogShell
        title="Dashboard anpassen"
        description="Blende Bereiche ein oder aus und lege ihre Reihenfolge fest. Änderungen werden direkt gespeichert."
        titleId="dashboard-customize-title"
        onClose={() => setCustomizeOpen(false)}
        size="md"
        fitContent
        footer={<div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <button type="button" className="min-h-11 rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50" onClick={() => savePreferences({ ...preferences, items: DEFAULT_DASHBOARD_PREFERENCES.items })}>Auf Standard zurücksetzen</button>
          <button type="button" className="btn-primary min-h-11 rounded-lg px-6 py-2 text-sm font-semibold text-white transition hover:brightness-90" onClick={() => setCustomizeOpen(false)}>Fertig</button>
        </div>}
      >
        {([['Schnellzugriffe', true], ['Kacheln', false]] as const).map(([groupTitle, quickGroup]) => (
          <section key={groupTitle} className="mb-4 last:mb-0" aria-label={groupTitle}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{groupTitle}</h3>
            <ol className="space-y-2">
              {preferences.items.filter(item => item.id.startsWith('quick-') === quickGroup).map(item => {
                const label = itemLabel(item.id);
                return <li key={item.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5">
                  <button type="button" role="switch" aria-checked={item.visible} aria-label={`${label} anzeigen`}
                    onClick={() => savePreferences({ ...preferences, items: preferences.items.map(entry => entry.id === item.id ? { ...entry, visible: !entry.visible } : entry) })}
                    className="flex min-h-9 min-w-0 flex-1 items-center gap-3 text-left text-sm text-gray-800">
                    <SwitchTrack checked={item.visible} />
                    <span className={`truncate ${item.visible ? '' : 'text-gray-400'}`}>{label}</span>
                  </button>
                  <button type="button" aria-label={`${label} nach oben`} title="Nach oben" disabled={!canMoveItem(item.id, -1)} onClick={() => moveItem(item.id, -1)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" aria-label={`${label} nach unten`} title="Nach unten" disabled={!canMoveItem(item.id, 1)} onClick={() => moveItem(item.id, 1)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 disabled:opacity-40"><ArrowDown className="h-4 w-4" /></button>
                </li>;
              })}
            </ol>
          </section>
        ))}
      </DialogShell>}
    </div>
  );
}
