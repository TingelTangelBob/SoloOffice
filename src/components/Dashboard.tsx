import React, { useEffect, useState } from 'react';
import logger from '../utils/logger';
import { AlertTriangle, Banknote, CalendarDays, CheckCircle, ChevronRight, FileText, GraduationCap, Home, Send } from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useJobs } from '../context/JobContext';
import { useCompany } from '../context/CompanyContext';
import { useLoading } from '../context/LoadingContext';
import { calculateTotalHours } from '../utils/jobUtils';
import { formatCurrency, formatDate, formatNumber, formatTime } from '../utils/formatters';
import { blobToBase64 } from '../utils/blobUtils';
import { EmailSendModal } from './EmailSendModal';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { processAttachments } from '../utils/fileUtils';
import { apiService } from '../services/api';
import type { Invoice, JobEntry, NumberFormat, TimeFormat } from '../types';
import { PageHeader } from './PageHeader';
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
import type { MetricTone } from './DashboardMetrics';
import { RevenueAreaChart } from './RevenueAreaChart';

import { getTerminology } from '../utils/terminology';
import { useFeedback } from '../context/FeedbackContext';

interface DashboardProps {
  onNavigate: (page: string, filter?: string, searchTerm?: string, invoiceId?: string, jobSeriesId?: string) => void;
}

type DashboardCourseSeries = {
  key: string;
  job: JobEntry;
  jobs: JobEntry[];
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
  const terminology = getTerminology(company.terminologyProfile);
  const { loading } = useLoading();

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
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-custom mx-auto"></div>
          <p className="mt-4 text-gray-600">Lade Daten...</p>
        </div>
      </div>
    );
  }

  /**
   * Umsatzverlauf der letzten zwölf Monate.
   *
   * Fester Zeitraum statt „alle vorhandenen Monate“: Die Kurve behält dadurch
   * eine gleichbleibende Rasterbreite, Monate ohne Rechnung bleiben als Lücke
   * sichtbar, und die Karte wächst nicht mit jedem weiteren Geschäftsjahr.
   * Die vollständige Historie steht in den Auswertungen.
   */
  const REVENUE_WINDOW_MONTHS = 12;

  const monthKeyOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

  const monthlyRevenue = new Map<string, number>();
  invoices.forEach(invoice => {
    const key = monthKeyOf(new Date(invoice.issueDate));
    monthlyRevenue.set(key, (monthlyRevenue.get(key) || 0) + Number(invoice.total || 0));
  });

  const monthStartOffsetBy = (monthsBack: number) => new Date(today.getFullYear(), today.getMonth() - monthsBack, 1);
  const monthLabelFormat = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
  const monthShortFormat = new Intl.DateTimeFormat(locale, { month: 'short' });

  const revenuePoints = Array.from({ length: REVENUE_WINDOW_MONTHS }, (_, index) => {
    const date = monthStartOffsetBy(REVENUE_WINDOW_MONTHS - 1 - index);
    const key = monthKeyOf(date);

    return {
      key,
      label: monthLabelFormat.format(date),
      shortLabel: monthShortFormat.format(date).replace('.', ''),
      value: monthlyRevenue.get(key) || 0,
    };
  });

  const revenueWindowKeys = new Set(revenuePoints.map(point => point.key));
  const revenueWindowTotal = revenuePoints.reduce((sum, point) => sum + point.value, 0);
  const previousWindowTotal = Array.from({ length: REVENUE_WINDOW_MONTHS }, (_, index) => {
    const date = monthStartOffsetBy(REVENUE_WINDOW_MONTHS * 2 - 1 - index);
    return monthlyRevenue.get(monthKeyOf(date)) || 0;
  }).reduce((sum, value) => sum + value, 0);

  // Ohne Vergleichswert lässt sich keine Veränderung angeben. Dann entfällt die
  // Angabe, statt einen Platzhalter zu zeigen.
  const revenueDelta = previousWindowTotal > 0
    ? ((revenueWindowTotal - previousWindowTotal) / previousWindowTotal) * 100
    : null;

  const money = (value: number) => formatCurrency(value, locale, company?.numberFormat, company?.currency);
  const formatPercent = (value: number) => `${formatNumber(
    Math.abs(value),
    locale,
    company?.numberFormat,
    Math.abs(value) >= 100 ? 0 : 1,
  )} %`;

  const customerRevenue = new Map<string, number>();
  invoices.forEach(invoice => {
    if (!revenueWindowKeys.has(monthKeyOf(new Date(invoice.issueDate)))) return;
    const name = invoice.customerName?.trim() || 'Ohne Zuordnung';
    customerRevenue.set(name, (customerRevenue.get(name) || 0) + Number(invoice.total || 0));
  });
  const topCustomers = Array.from(customerRevenue.entries())
    .filter(([, revenue]) => revenue > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, revenue]) => ({ name, revenue }));
  const topCustomerMax = topCustomers.reduce((max, entry) => Math.max(max, entry.revenue), 0);

  const sentInvoices = invoices.filter(invoice => invoice.status === 'sent');
  const sentAmount = sentInvoices.reduce(
    (sum, invoice) => sum + Number(invoice.outstandingAmount ?? invoice.total),
    0,
  );

  const sumOf = (status: Invoice['status']) => invoices
    .filter(invoice => invoice.status === status)
    .reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const paidAmount = invoices.reduce((sum, invoice) => (
    sum + Number(invoice.paidAmount ?? (invoice.status === 'paid' ? invoice.total : 0))
  ), 0);
  const overdueAmount = invoices
    .filter(invoice => invoice.status === 'overdue')
    .reduce((sum, invoice) => sum + Number(invoice.outstandingAmount ?? invoice.total), 0);

  /**
   * Die Kennzahlen führen den Betrag als Hauptangabe: Für eine
   * Rechnungsanwendung ist die offene Summe die eigentliche Aussage, die reine
   * Anzahl steht als Hinweis daneben.
   */
  const summaryCards: {
    id: string;
    label: string;
    hint: string;
    count: number;
    amount: number;
    icon: typeof FileText;
    iconClass: string;
    tone: MetricTone;
    filter: string;
  }[] = [
    {
      id: 'draft',
      label: 'Entwürfe',
      hint: 'Noch nicht versendet',
      count: invoices.filter(invoice => invoice.status === 'draft').length,
      amount: sumOf('draft'),
      icon: FileText,
      iconClass: 'text-amber-600',
      tone: 'warning',
      filter: 'draft',
    },
    {
      id: 'sent',
      label: 'Versendet',
      hint: 'Offen, Zahlungsziel läuft',
      count: sentInvoices.length,
      amount: sentAmount,
      icon: Send,
      iconClass: 'text-blue-600',
      tone: 'info',
      filter: 'sent',
    },
    {
      id: 'overdue',
      label: 'Überfällig',
      hint: 'Zahlungsziel überschritten',
      count: invoices.filter(invoice => invoice.status === 'overdue').length,
      amount: overdueAmount,
      icon: AlertTriangle,
      iconClass: 'text-red-600',
      tone: 'negative',
      filter: 'overdue',
    },
    {
      id: 'paid',
      label: 'Bezahlt',
      hint: 'Zahlungseingang verbucht',
      count: invoices.filter(invoice => invoice.status === 'paid').length,
      amount: paidAmount,
      icon: CheckCircle,
      iconClass: 'text-green-600',
      tone: 'positive',
      filter: 'paid',
    },
  ];

  const recentInvoices = [...invoices]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
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

  const invoicesCardSpan = ongoingCourseSeries.length > 0
    ? 'md:col-span-2 lg:col-span-3'
    : 'md:col-span-2 lg:col-span-4';

  return (
    <div className="dashboard-metrics space-y-6">
      {/* Der Navigationspunkt heißt „Übersicht“; die Seitenüberschrift folgt
          derselben Bezeichnung. */}
      <PageHeader icon={Home} title="Übersicht" subtitle={`Ihre Rechnungen und ${terminology.entity.plural} auf einen Blick`} />

      {/* Kennzahlen. Der Betrag steht als große Angabe oben, die Anzahl als
          eingefärbter Hinweis daneben: Die Farbe trägt den Status, ohne die
          Karte selbst einzufärben, und wirkt in beiden Farbmodi. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {summaryCards.map(({ id, label, hint, count, amount, icon: CardIcon, iconClass, tone, filter }) => (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate('invoices', filter)}
            className="flex min-w-0 flex-col rounded-xl border border-gray-100 bg-white px-4 py-4 text-left shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
            aria-label={`${label}: ${money(amount)}, ${count} ${count === 1 ? 'Rechnung' : 'Rechnungen'}`}
          >
            <span className="flex min-w-0 items-start justify-between gap-2">
              <MetricValue className="text-lg sm:text-xl lg:text-2xl">{money(amount)}</MetricValue>
              <MetricBadge tone={tone}>{count}</MetricBadge>
            </span>
            <span className="mt-2 flex min-w-0 items-center gap-1.5">
              <CardIcon className={`h-3.5 w-3.5 shrink-0 ${iconClass}`} aria-hidden="true" />
              <span className="min-w-0 truncate text-xs font-medium text-gray-700">{label}</span>
            </span>
            <span className="mt-0.5 hidden truncate text-[11px] text-gray-500 sm:block">{hint}</span>
          </button>
        ))}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Umsatzverlauf */}
        <MetricCard className="md:col-span-2 lg:col-span-3">
          <MetricCardHeader>
            <div className="flex min-w-0 flex-col">
              <MetricValue>{money(revenueWindowTotal)}</MetricValue>
              <MetricCardDescription>Gesamtumsatz der letzten 12 Monate</MetricCardDescription>
            </div>
            {revenueDelta !== null && (
              <DeltaBadge
                value={revenueDelta}
                formattedValue={formatPercent(revenueDelta)}
                label="ggü. Vorjahreszeitraum"
              />
            )}
          </MetricCardHeader>
          <MetricCardContent className="px-2 pb-2 lg:px-4">
            {revenueWindowTotal > 0 ? (
              <RevenueAreaChart
                points={revenuePoints}
                formatValue={money}
                ariaLabel={`Umsatzverlauf der letzten 12 Monate, insgesamt ${money(revenueWindowTotal)}`}
              />
            ) : (
              <MetricEmptyState>In den letzten 12 Monaten wurden keine Umsätze erfasst.</MetricEmptyState>
            )}
          </MetricCardContent>
          {company.reportingEnabled && (
            <MetricCardFooterAction onClick={() => onNavigate('reporting')}>
              Zu den Auswertungen
            </MetricCardFooterAction>
          )}
        </MetricCard>

        {/* Top-Kunden */}
        <MetricCard className="md:col-span-2 lg:col-span-1">
          <MetricCardHeader bordered>
            <div className="min-w-0">
              <MetricCardTitle>Top-{terminology.entity.plural}</MetricCardTitle>
              <MetricCardDescription className="mt-1">Umsatzstärkste der letzten 12 Monate</MetricCardDescription>
            </div>
          </MetricCardHeader>
          <MetricCardContent className="flex flex-1 flex-col justify-center py-1">
            {topCustomers.length > 0 ? (
              <ShareBarList aria-label={`Top-${terminology.entity.plural} nach Umsatz`}>
                {topCustomers.map(({ name, revenue }) => (
                  <ShareBarItem
                    key={name}
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
        </MetricCard>

        {/* Termine der aktuellen Kalenderwoche */}
        <MetricCard className="md:col-span-2 lg:col-span-4">
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
                        <div className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${isToday ? 'text-primary-custom' : 'text-gray-900'}`}>
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
        </MetricCard>

        {/* Aktuelle Rechnungen */}
        <MetricCard className={invoicesCardSpan}>
          <MetricCardHeader>
            <div className="min-w-0">
              <MetricCardTitle>Aktuelle Rechnungen</MetricCardTitle>
              <MetricCardDescription className="mt-1">Die fünf zuletzt angelegten Rechnungen</MetricCardDescription>
            </div>
          </MetricCardHeader>

          {recentInvoices.length > 0 ? (
            <>
              {/* Tabelle ab Tablet */}
              <div className="hidden w-full max-w-full overflow-x-auto tablet:block">
                <table className="w-full min-w-[700px] border-t border-gray-200">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th scope="col" className="px-3 py-2 pl-4 text-left text-xs font-medium text-gray-500 lg:pl-6">Datum</th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500">Rechnung</th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500">{terminology.entity.singular}</th>
                      <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500">Betrag</th>
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
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs font-medium text-gray-900 tabular-nums">
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
                        <span className="font-mono text-sm font-medium text-gray-900 tabular-nums">
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
        </MetricCard>

        {/* Laufende Serien */}
        {ongoingCourseSeries.length > 0 && (
          <MetricCard className="md:col-span-2 lg:col-span-1">
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
    </div>
  );
}
