import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import logger from '../utils/logger';
import { 
  Plus, 
  Edit, 
  Trash2, 
  Clock, 
  User, 
  Calendar, 
  FileText, 
  Search,
  Timer,
  CheckCircle,
  AlertTriangle,
  Briefcase,
  Download,
  Eye,
  RefreshCw,
  X,
  Upload,
  Copy,
  Repeat2,
  Info,
  ChevronDown,
  ChevronUp,
  PenLine,
} from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useJobs } from '../context/JobContext';
import { useCompany } from '../context/CompanyContext';
import { JobEntry } from '../types';
import { JobEntryForm } from './JobEntryForm';
import { JobInvoiceGenerationType, JobInvoiceGenerator } from './JobInvoiceGenerator';
import { PageHeader } from './PageHeader';
import { FilterSelect, ResponsiveFilterBar } from './ResponsiveFilterBar';
import { ConfirmationModal } from './ConfirmationModal';
import { DocumentPreview } from './DocumentPreview';
import { createInvoiceAttachmentPreviewDocuments, createJobAttachmentPreviewDocuments } from '../utils/previewDocuments';
import type { PreviewDocument } from '../utils/previewDocuments';
import { generateJobPDF, downloadBlob } from '../utils/pdfGenerator';
import { calculateTotalHours } from '../utils/jobUtils';
import { formatDate, formatNumber } from '../utils/formatters';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { SignaturePad } from './SignaturePad';
import { apiService } from '../services/api';
import { useElementWidth } from '../hooks/useElementWidth';
import { ACTION_MENU_COLUMN_WIDTH, actionColumnWidth } from '../utils/tableLayout';
import { BulkSelectionHeader } from './BulkSelectionHeader';
import { getTerminology } from '../utils/terminology';
import { ImportWizard } from './ImportWizard';
import { generateUUID } from '../utils/uuid';
import { useFeedback } from '../context/FeedbackContext';

interface JobManagementProps {
  onNavigate?: (page: string, filter?: string, searchTerm?: string, invoiceId?: string, jobSeriesId?: string) => void;
  initialRecurringGroupId?: string;
}

type StatusChangeFeedback = {
  phase: 'loading' | 'success' | 'error';
  completed: number;
  total: number;
  statusText: string;
  errorMessage?: string;
};

type RecurringJobGroup = {
  key: string;
  jobs: JobEntry[];
};

type DisplayedJob = {
  job: JobEntry;
  recurrenceGroup?: RecurringJobGroup;
  isGroupHeader?: boolean;
};

/**
 * Die Auftragstabelle wächst mit ihrem Inhalt und hat laut `min-w-[820px]` eine
 * Mindestbreite. Eine Zeile zeigt höchstens sieben Icon-Aktionen; dazu kommt
 * der Statuspunkt links davon (14 Pixel plus 8 Pixel Abstand).
 */
const JOB_STATUS_INDICATOR_WIDTH = 22;
const JOB_INLINE_ACTIONS_MIN_WIDTH = 820 + actionColumnWidth(7) - ACTION_MENU_COLUMN_WIDTH;

export function JobManagement({ onNavigate, initialRecurringGroupId }: JobManagementProps = {}) {
  const { notify } = useFeedback();
  const { customers, addCustomer, refreshCustomers } = useCustomers();
  const { invoices } = useInvoices();
  const { jobEntries, addJobEntry, updateJobEntry, deleteJobEntry, refreshJobEntries } = useJobs();
  const { company } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);
  const { ref: tableRef, width: tableWidth } = useElementWidth<HTMLDivElement>();
  const showInlineActions = tableWidth >= JOB_INLINE_ACTIONS_MIN_WIDTH;

  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<JobEntry | null>(null);
  const [showInvoiceGenerator, setShowInvoiceGenerator] = useState(false);
  const [invoiceGenerationType, setInvoiceGenerationType] = useState<JobInvoiceGenerationType>('single');
  const [invoiceCreationNotice, setInvoiceCreationNotice] = useState(false);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [isBulkOperation, setIsBulkOperation] = useState(false);
  const [statusChangeFeedback, setStatusChangeFeedback] = useState<StatusChangeFeedback | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('not-invoiced');
  const [customerFilter, setCustomerFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [showAllStats, setShowAllStats] = useState(false);
  const [expandedRecurringGroups, setExpandedRecurringGroups] = useState<Set<string>>(new Set());
  const [showImport, setShowImport] = useState(false);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [newCustomerData, setNewCustomerData] = useState({
    name: '',
    email: '',
    address: '',
    postalCode: '',
    city: '',
    country: 'Deutschland',
    taxId: '',
    phone: ''
  });
  
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

  // Document Preview state
  const [documentPreview, setDocumentPreview] = useState<{
    isOpen: boolean;
    documents: PreviewDocument[];
    initialIndex: number;
  }>({
    isOpen: false,
    documents: [],
    initialIndex: 0
  });

  // Get locale from company settings
  const locale = company?.locale || 'de-DE';

  const hasInitialRecurringGroup = Boolean(
    initialRecurringGroupId && jobEntries.some(job => job.recurrence?.id === initialRecurringGroupId),
  );

  useEffect(() => {
    if (!initialRecurringGroupId || !hasInitialRecurringGroup) return;

    setSearchTerm('');
    setStatusFilter('all');
    setCustomerFilter('all');
    setDateFilter('all');
    setExpandedRecurringGroups(previous => {
      if (previous.has(initialRecurringGroupId)) return previous;
      const next = new Set(previous);
      next.add(initialRecurringGroupId);
      return next;
    });
  }, [hasInitialRecurringGroup, initialRecurringGroupId]);

  useEffect(() => {
    if (!initialRecurringGroupId || !hasInitialRecurringGroup) return;

    const frame = window.requestAnimationFrame(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-recurring-group]'))
        .find(element => element.dataset.recurringGroup === initialRecurringGroupId && element.offsetParent !== null);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [expandedRecurringGroups, hasInitialRecurringGroup, initialRecurringGroupId]);

  // Filter and search jobs
  const filteredJobs = useMemo(() => {
    return jobEntries.filter(job => {
      const jobTitle = job.title || '';
      const jobDescription = job.description || '';
      const jobCustomerName = job.customerName || '';
      const jobJobNumber = job.jobNumber || '';
      const jobExternalJobNumber = job.externalJobNumber || '';
      const searchTermLower = searchTerm.toLowerCase();

      const matchesSearch = jobTitle.toLowerCase().includes(searchTermLower) ||
                           jobDescription.toLowerCase().includes(searchTermLower) ||
                           jobCustomerName.toLowerCase().includes(searchTermLower) ||
                           jobJobNumber.toLowerCase().includes(searchTermLower) ||
                           jobExternalJobNumber.toLowerCase().includes(searchTermLower);
      
      const matchesStatus = statusFilter === 'all' || (
        statusFilter === 'not-invoiced'
          ? job.status !== 'invoiced'
          : job.status === statusFilter
      );
      const matchesCustomer = customerFilter === 'all' || job.customerId === customerFilter;
      
      let matchesDate = true;
      if (dateFilter !== 'all') {
        const jobDate = new Date(job.date);
        const now = new Date();
        
        switch (dateFilter) {
          case 'today':
            matchesDate = jobDate.toDateString() === now.toDateString();
            break;
          case 'week':
            {
              const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
              matchesDate = jobDate >= weekAgo;
              break;
            }
          case 'month':
            {
              const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
              matchesDate = jobDate >= monthAgo;
              break;
            }
        }
      }
      
      return matchesSearch && matchesStatus && matchesCustomer && matchesDate;
    });
  }, [jobEntries, searchTerm, statusFilter, customerFilter, dateFilter]);

  const recurringGroups = useMemo(() => {
    const groups = new Map<string, RecurringJobGroup>();
    filteredJobs.forEach((job) => {
      const key = job.recurrence?.id;
      if (!key) return;
      const group = groups.get(key) || { key, jobs: [] };
      group.jobs.push(job);
      groups.set(key, group);
    });
    groups.forEach((group) => {
      group.jobs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    });
    return groups;
  }, [filteredJobs]);

  const displayedJobs = useMemo<DisplayedJob[]>(() => {
    const rows: DisplayedJob[] = [];
    const emittedGroups = new Set<string>();

    filteredJobs.forEach((job) => {
      const key = job.recurrence?.id;
      const group = key ? recurringGroups.get(key) : undefined;

      if (!group || group.jobs.length < 2) {
        rows.push({ job });
        return;
      }

      if (emittedGroups.has(group.key)) return;
      emittedGroups.add(group.key);

      const jobsToShow = expandedRecurringGroups.has(group.key)
        ? group.jobs
        : group.jobs.slice(0, 1);
      jobsToShow.forEach((groupJob, index) => {
        rows.push({
          job: groupJob,
          recurrenceGroup: group,
          isGroupHeader: index === 0,
        });
      });
    });

    return rows;
  }, [filteredJobs, recurringGroups, expandedRecurringGroups]);

  // Calculate statistics
  const stats = useMemo(() => {
    const totalJobs = filteredJobs.length;
    const completedJobs = filteredJobs.filter(job => job.status === 'completed').length;
    const inProgressJobs = filteredJobs.filter(job => job.status === 'in-progress').length;
    const notInvoicedJobs = filteredJobs.filter(job => job.status !== 'invoiced').length;
    const totalHours = filteredJobs.reduce((sum, job) => sum + calculateTotalHours(job), 0);
    
    return { totalJobs, completedJobs, inProgressJobs, notInvoicedJobs, totalHours };
  }, [filteredJobs]);

  const handleEdit = (job: JobEntry) => {
    // Check if job is invoiced and warn user
    if (job.status === 'invoiced') {
      setConfirmModal({
        isOpen: true,
        title: terminology.work.editLabel,
        message: `Dieser ${terminology.work.singular} wurde bereits abgerechnet. Änderungen an abgerechneten ${terminology.work.plural} sollten nur in Ausnahmefällen vorgenommen werden, da sie die GoBD-Konformität beeinträchtigen können. Möchten Sie trotzdem fortfahren?`,
        onConfirm: () => {
          setEditingJob(job);
          setShowForm(true);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        },
        isGoBDWarning: true
      });
    } else {
      setEditingJob(job);
      setShowForm(true);
    }
  };

  const handleDelete = (job: JobEntry) => {
    // Check if job is invoiced and warn user
    if (job.status === 'invoiced') {
      setConfirmModal({
        isOpen: true,
        title: terminology.work.deleteLabel,
        message: `Dieser ${terminology.work.singular} wurde bereits abgerechnet. Das Löschen abgerechneter ${terminology.work.plural} kann die GoBD-Konformität verletzen und ist rechtlich problematisch. Sind Sie sicher, dass Sie fortfahren möchten?`,
        onConfirm: async () => {
          try {
            await deleteJobEntry(job.id);
          } catch (error) {
            logger.error('Error deleting invoiced job:', error);
            notify({ variant: 'error', message: error instanceof Error ? error.message : 'Der Auftrag konnte nicht gelöscht werden.' });
          } finally {
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
          }
        },
        isDestructive: true,
        isGoBDWarning: true
      });
    } else {
      setConfirmModal({
        isOpen: true,
        title: terminology.work.deleteLabel,
          message: `Möchten Sie den ${terminology.work.singular} "${job.title}" wirklich löschen?`,
        onConfirm: async () => {
          try {
            await deleteJobEntry(job.id);
          } catch (error) {
            logger.error('Error deleting job:', error);
            notify({ variant: 'error', message: error instanceof Error ? error.message : 'Der Auftrag konnte nicht gelöscht werden.' });
          } finally {
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
          }
        },
        isDestructive: true
      });
    }
  };

  const handleFormSubmit = async (jobData: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      if (editingJob) {
        await updateJobEntry(editingJob.id, jobData);
        await refreshJobEntries();
      } else {
        await addJobEntry(jobData);
        // Refresh job entries in other components
        await refreshJobEntries();
      }
      setShowForm(false);
      setEditingJob(null);
      return true;
    } catch (error) {
      logger.error('Error saving job:', error);
      // Don't close the form if there was an error, so user can retry
      throw error;
    }
  };

  const handleStatusChange = async (jobId: string, newStatus: JobEntry['status']) => {
    try {
      // Check if current status is invoiced - prevent changes
      const currentJob = jobEntries.find((j) => j.id === jobId);
      if (currentJob?.status === 'invoiced') {
        setConfirmModal({
          isOpen: true,
          title: 'Status nicht änderbar',
          message: `Der Status von abgerechneten ${terminology.work.plural} kann nicht mehr geändert werden.`,
          onConfirm: () => {
            setConfirmModal((prev) => ({ ...prev, isOpen: false }));
          }
        });
        return;
      }
      
      await runStatusChange([jobId], newStatus);
    } catch (error) {
      logger.error('Error updating job status:', error);
    }
  };

  const getStatusColor = (status: JobEntry['status']) => {
    switch (status) {
      case 'draft': return 'text-gray-600 bg-gray-100';
      case 'in-progress': return 'text-yellow-600 bg-yellow-100';
      case 'completed': return 'text-green-600 bg-green-100';
      case 'invoiced': return 'text-blue-600 bg-blue-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusText = (status: JobEntry['status']) => {
    switch (status) {
      case 'draft': return 'Entwurf';
      case 'in-progress': return 'In Bearbeitung';
      case 'completed': return 'Abgeschlossen';
      case 'invoiced': return 'Abgerechnet';
      default: return status;
    }
  };

  /**
   * Unterschrift vor Ort. Datenmodell, Backend-Endpunkt und PDF-Ausgabe waren
   * bereits vorhanden, es fehlte nur der Einstieg in der Oberfläche.
   */
  const [signingJob, setSigningJob] = useState<JobEntry | null>(null);

  const handleSaveSignature = async (signatureData: string, customerName: string) => {
    if (!signingJob) return;
    try {
      await apiService.addJobSignature(signingJob.id, signatureData, customerName);
      await refreshJobEntries();
      setSigningJob(null);
      notify({ variant: 'success', message: 'Unterschrift wurde gespeichert.' });
    } catch (error) {
      logger.error('Error saving job signature:', error);
      notify({
        variant: 'error',
        message: error instanceof Error ? error.message : 'Die Unterschrift konnte nicht gespeichert werden.',
      });
    }
  };

  const handleDuplicate = async (job: JobEntry) => {
    try {
      const duplicatedJob = await addJobEntry({
        ...job,
        jobNumber: '',
        externalJobNumber: '',
        date: new Date(),
        status: 'draft',
        recurrence: undefined,
        signature: undefined,
        attachments: [],
        timeEntries: (job.timeEntries || []).map((entry) => ({ ...entry, id: generateUUID() })),
        materials: (job.materials || []).map((material) => ({ ...material, id: generateUUID() })),
      });
      await refreshJobEntries();
      setEditingJob(duplicatedJob);
      setShowForm(true);
    } catch (error) {
      logger.error('Error duplicating job:', error);
    }
  };

  const getNotePreview = (notes?: string) => {
    const note = notes?.replace(/\s+/g, ' ').trim() || '';
    if (!note) return '';
    return note.length > 90 ? `${note.slice(0, 87)}...` : note;
  };

  const getStatusDotColor = (status: JobEntry['status']) => {
    switch (status) {
      case 'draft': return 'bg-gray-400';
      case 'in-progress': return 'bg-yellow-500';
      case 'completed': return 'bg-green-500';
      case 'invoiced': return 'bg-blue-500';
      default: return 'bg-gray-400';
    }
  };

  const runStatusChange = async (
    jobIds: string[],
    newStatus: JobEntry['status'],
    clearSelection = false,
  ) => {
    if (newStatus !== 'draft') {
      const hasIncompleteJob = jobIds.some((jobId) => {
        const job = jobEntries.find((entry) => entry.id === jobId);
        return !job?.customerId || !job.title?.trim() || !job.description?.trim();
      });
      if (hasIncompleteJob) {
        setStatusChangeFeedback({
          phase: 'error',
          completed: 0,
          total: jobIds.length,
          statusText: getStatusText(newStatus),
          errorMessage: 'Pflichtfelder fehlen: Kunde, Titel und Beschreibung müssen vor dem Weiterführen ausgefüllt sein.',
        });
        return;
      }
    }

    setIsBulkOperation(true);
    setStatusChangeFeedback({
      phase: 'loading',
      completed: 0,
      total: jobIds.length,
      statusText: getStatusText(newStatus),
    });

    try {
      for (const [index, jobId] of jobIds.entries()) {
        await updateJobEntry(jobId, { status: newStatus });
        setStatusChangeFeedback(prev => prev ? {
          ...prev,
          completed: index + 1,
        } : prev);
      }

      if (clearSelection) {
        setSelectedJobIds([]);
      }

      setStatusChangeFeedback(prev => prev ? {
        ...prev,
        phase: 'success',
        completed: jobIds.length,
      } : prev);
    } catch (error) {
      logger.error('Error updating job statuses:', error);
      setStatusChangeFeedback(prev => prev ? {
        ...prev,
        phase: 'error',
        errorMessage: jobIds.length === 1
          ? 'Der Status konnte nicht geändert werden.'
          : 'Die Statusänderung konnte nicht vollständig abgeschlossen werden.',
      } : prev);
    } finally {
      setIsBulkOperation(false);
    }
  };

  const handleJobSelection = (jobId: string, checked: boolean) => {
    // Allow selection of all jobs, not just completed ones
    setInvoiceCreationNotice(false);
    if (checked) {
      setSelectedJobIds(prev => [...prev, jobId]);
    } else {
      setSelectedJobIds(prev => prev.filter(id => id !== jobId));
    }
  };

  const handleRecurringGroupSelection = (group: RecurringJobGroup, checked: boolean) => {
    setInvoiceCreationNotice(false);
    setSelectedJobIds((previous) => {
      const next = new Set(previous);
      group.jobs.forEach((job) => {
        if (checked) next.add(job.id);
        else next.delete(job.id);
      });
      return [...next];
    });
  };

  const toggleRecurringGroup = (groupKey: string) => {
    setExpandedRecurringGroups((previous) => {
      const next = new Set(previous);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const handleRecurringGroupRowClick = (event: ReactMouseEvent, group?: RecurringJobGroup, isGroupHeader?: boolean) => {
    if (!group || !isGroupHeader) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, select, textarea, a, label')) return;
    toggleRecurringGroup(group.key);
  };

  const handleBulkInvoiceGeneration = () => {
    const completedSelectedJobs = selectedJobIds.filter(jobId => {
      const job = jobEntries.find(j => j.id === jobId);
      return job && job.status === 'completed';
    });
    
    if (completedSelectedJobs.length === 0) {
      setInvoiceCreationNotice(true);
      return;
    }

    setInvoiceCreationNotice(false);
    const selectedJobs = jobEntries.filter((job) => selectedJobIds.includes(job.id));
    const recurringCourseId = selectedJobs[0]?.recurrence?.id;
    const isOneCompleteCourse = Boolean(recurringCourseId)
      && selectedJobs.length > 1
      && selectedJobs.every((job) => job.recurrence?.id === recurringCourseId);
    setInvoiceGenerationType(isOneCompleteCourse ? 'course' : 'single');
    setShowInvoiceGenerator(true);
  };

  // Bulk operations functions
  const handleSelectAllJobs = (checked: boolean) => {
    setInvoiceCreationNotice(false);
    if (checked) {
      // Select ALL jobs, not just completed ones
      setSelectedJobIds(filteredJobs.map(job => job.id));
    } else {
      setSelectedJobIds([]);
    }
  };

  const handleBulkStatusChange = async (newStatus: JobEntry['status']) => {
    if (selectedJobIds.length === 0) return;

    await runStatusChange([...selectedJobIds], newStatus, true);
  };

  const handleBulkDownload = async () => {
    if (selectedJobIds.length === 0) return;
    
    setIsBulkOperation(true);
    try {
      for (const jobId of selectedJobIds) {
        const job = jobEntries.find(j => j.id === jobId);
        const customer = job ? customers.find(c => c.id === job.customerId) : null;
        
        if (job && customer && company) {
          const pdfBlob = await generateJobPDF(job, {
            company,
            customer
          });
          
          const fileName = `${terminology.work.singular}_${job.jobNumber || job.id}_${job.customerName || customer.name}.pdf`;
          downloadBlob(pdfBlob, fileName);
          
          // Add delay between downloads to prevent browser issues
          if (selectedJobIds.indexOf(jobId) < selectedJobIds.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }
      setSelectedJobIds([]);
      notify({ variant: 'success', message: `${selectedJobIds.length} ${terminology.work.singular}/${terminology.work.plural} erfolgreich heruntergeladen.` });
    } catch (error) {
      logger.error('Error downloading jobs:', error);
          notify({ variant: 'error', message: `Fehler beim Herunterladen der ${terminology.work.plural}.` });
    } finally {
      setIsBulkOperation(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedJobIds.length === 0) return;
    
    setConfirmModal({
      isOpen: true,
      title: `${terminology.work.plural} löschen`,
      message: `Sind Sie sicher, dass Sie ${selectedJobIds.length} ${terminology.work.singular}/${terminology.work.plural} löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.`,
      onConfirm: async () => {
        setIsBulkOperation(true);
        try {
          for (const jobId of selectedJobIds) {
            await deleteJobEntry(jobId);
          }
          setSelectedJobIds([]);
          notify({ variant: 'success', message: `${selectedJobIds.length} ${terminology.work.singular}/${terminology.work.plural} erfolgreich gelöscht.` });
        } catch (error) {
          logger.error('Error deleting jobs:', error);
          notify({ variant: 'error', message: `Fehler beim Löschen der ${terminology.work.plural}.` });
        } finally {
          setIsBulkOperation(false);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
      },
      isDestructive: true
    });
  };

  const handleExportJobPDF = async (job: JobEntry) => {
    try {
      const customer = customers.find(c => c.id === job.customerId);
      if (!customer || !company) {
        notify({ variant: 'error', message: `${terminology.entity.dataLabel} oder ${terminology.organization.dataLabel} nicht gefunden` });
        return;
      }

      const pdfBlob = await generateJobPDF(job, {
        company,
        customer
      });

      const filename = `${terminology.work.confirmationLabel}_${job.title.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date(job.date).toLocaleDateString('de-DE').replace(/\./g, '-')}.pdf`;
      downloadBlob(pdfBlob, filename);
    } catch (error) {
      logger.error(`Fehler beim Erstellen der ${terminology.work.singular}-PDF:`, error);
      notify({ variant: 'error', message: 'Fehler beim Erstellen der PDF. Bitte versuchen Sie es erneut.' });
    }
  };

  const handlePreview = (job: JobEntry) => {
    // Create preview documents for the course record and its attachments.
    const documents = createJobAttachmentPreviewDocuments(job, company?.terminologyProfile);
    
    setDocumentPreview({
      isOpen: true,
      documents,
      initialIndex: 0
    });
  };

  const findInvoiceForJobs = (jobsToCheck: JobEntry[]) => invoices.find((invoice) =>
    jobsToCheck.some((job) => invoice.sourceJobs?.some((sourceJob) => sourceJob.jobId === job.id)),
  );

  const handlePreviewInvoice = (job: JobEntry, recurrenceGroup?: RecurringJobGroup) => {
    const invoice = findInvoiceForJobs(recurrenceGroup?.jobs || [job]);
    if (!invoice) return;

    setDocumentPreview({
      isOpen: true,
      documents: createInvoiceAttachmentPreviewDocuments(invoice),
      initialIndex: 0,
    });
  };

  const handleEditInvoice = (job: JobEntry, recurrenceGroup?: RecurringJobGroup) => {
    const invoice = findInvoiceForJobs(recurrenceGroup?.jobs || [job]);
    if (!invoice) return;
    onNavigate?.('invoices', 'all', undefined, invoice.id);
  };

  const handleCreateInvoice = (job: JobEntry, recurrenceGroup?: RecurringJobGroup) => {
    const jobsToInvoice = recurrenceGroup?.jobs || [job];
    if (!jobsToInvoice.some((item) => item.status === 'completed')) {
      setInvoiceCreationNotice(true);
      return;
    }

    setInvoiceCreationNotice(false);
    setSelectedJobIds(jobsToInvoice.map((item) => item.id));
    setInvoiceGenerationType('course');
    setShowInvoiceGenerator(true);
  };

  const handleClosePreview = () => {
    setDocumentPreview({
      isOpen: false,
      documents: [],
      initialIndex: 0
    });
  };

  if (showForm) {
    return (
      <JobEntryForm
        job={editingJob}
        customers={customers}
        onSubmit={handleFormSubmit}
        onCancel={() => {
          setShowForm(false);
          setEditingJob(null);
        }}
        onCreateCustomer={() => {
          logger.debug('onCreateCustomer called in JobManagement');
          setShowCustomerForm(true);
        }}
        onNavigateToCustomers={() => onNavigate && onNavigate('customers')}
        onNavigateToSettings={() => onNavigate && onNavigate('settings')}
      />
    );
  }

  if (showInvoiceGenerator) {
    return (
      <JobInvoiceGenerator
        selectedJobIds={selectedJobIds}
        initialGenerationType={invoiceGenerationType}
        onClose={() => {
          setShowInvoiceGenerator(false);
          setSelectedJobIds([]);
        }}
        onInvoiceGenerated={(createdInvoices) => {
          setShowInvoiceGenerator(false);
          setSelectedJobIds([]);
          const createdInvoice = createdInvoices.length === 1 ? createdInvoices[0] : undefined;
          if (createdInvoice) {
            onNavigate?.('invoices', 'all', undefined, createdInvoice.id);
          }
        }}
      />
    );
  }

  return (
    <div className="space-y-8 xl:space-y-4 2xl:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 xl:gap-2 2xl:gap-4">
        <PageHeader icon={Briefcase} title={terminology.work.managementLabel}>
        
        <div className="flex shrink-0 flex-row gap-2">
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-primary-custom px-3 text-sm text-primary-custom transition hover:bg-primary-light-custom sm:min-w-0 sm:px-4 sm:text-base"
            aria-label="Importieren"
            title="Importieren"
          >
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">Importieren</span>
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary-custom px-3 text-sm text-white transition-all duration-300 hover:scale-105 hover:bg-primary-custom/90 sm:min-w-0 sm:px-4 sm:text-base"
            aria-label={terminology.work.newLabel}
            title={terminology.work.newLabel}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{terminology.work.newLabel}</span>
          </button>
        </div>
        </PageHeader>
      </div>

      <ImportWizard
        resource="jobs"
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        onImported={refreshJobEntries}
      />

      {/* Statistics Cards */}
      <div className="hidden min-w-0 grid-cols-5 gap-3 lg:grid lg:gap-4">
        <button 
          onClick={() => setStatusFilter('not-invoiced')}
          className="order-1 flex min-w-0 flex-col items-center rounded-xl border border-gray-100 bg-white p-3 text-center shadow-sm transition-all duration-300 hover:scale-105 hover:bg-gray-50 hover:shadow-md lg:p-4"
        >
          <div className="w-full min-w-0">
            <p className="flex min-h-10 items-center justify-center break-words text-xs font-medium leading-tight text-gray-600 lg:text-sm">Nicht abgerechnet</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <Timer className="h-6 w-6 shrink-0 text-blue-600 lg:h-8 lg:w-8" />
              <p className="text-lg font-bold text-gray-900 lg:text-2xl">{stats.notInvoicedJobs}</p>
            </div>
          </div>
        </button>

        <button 
          onClick={() => setStatusFilter('all')}
          className="order-4 flex min-w-0 flex-col items-center rounded-xl border border-gray-100 bg-white p-3 text-center shadow-sm transition-all duration-300 hover:scale-105 hover:bg-gray-50 hover:shadow-md lg:p-4"
        >
          <div className="w-full min-w-0">
            <p className="flex min-h-10 items-center justify-center break-words text-xs font-medium leading-tight text-gray-600 lg:text-sm">Gesamt</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <Briefcase className="h-6 w-6 shrink-0 text-gray-600 lg:h-8 lg:w-8" />
              <p className="text-lg font-bold text-gray-900 lg:text-2xl">{stats.totalJobs}</p>
            </div>
          </div>
        </button>

        <button 
          onClick={() => setStatusFilter('in-progress')}
          className="order-2 flex min-w-0 flex-col items-center rounded-xl border border-gray-100 bg-white p-3 text-center shadow-sm transition-all duration-300 hover:scale-105 hover:bg-gray-50 hover:shadow-md lg:p-4"
        >
          <div className="w-full min-w-0">
            <p className="flex min-h-10 items-center justify-center break-words text-xs font-medium leading-tight text-gray-600 lg:text-sm">In Bearbeitung</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <Timer className="h-6 w-6 shrink-0 text-yellow-600 lg:h-8 lg:w-8" />
              <p className="text-lg font-bold text-gray-900 lg:text-2xl">{stats.inProgressJobs}</p>
            </div>
          </div>
        </button>

        <button 
          onClick={() => setStatusFilter('completed')}
          className="order-3 flex min-w-0 flex-col items-center rounded-xl border border-gray-100 bg-white p-3 text-center shadow-sm transition-all duration-300 hover:scale-105 hover:bg-gray-50 hover:shadow-md lg:p-4"
        >
          <div className="w-full min-w-0">
            <p className="flex min-h-10 items-center justify-center break-words text-xs font-medium leading-tight text-gray-600 lg:text-sm">Abgeschlossen</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <CheckCircle className="h-6 w-6 shrink-0 text-green-600 lg:h-8 lg:w-8" />
              <p className="text-lg font-bold text-gray-900 lg:text-2xl">{stats.completedJobs}</p>
            </div>
          </div>
        </button>

        <div className="order-5 flex min-w-0 flex-col items-center rounded-xl border border-gray-100 bg-white p-3 text-center shadow-sm lg:p-4">
          <div className="w-full min-w-0">
            <p className="flex min-h-10 items-center justify-center break-words text-xs font-medium leading-tight text-gray-600 lg:text-sm">Stunden</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <Clock className="h-6 w-6 shrink-0 text-purple-600 lg:h-8 lg:w-8" />
              <p className="text-lg font-bold text-gray-900 lg:text-2xl">{formatNumber(stats.totalHours, locale, company?.numberFormat, 1)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Compact statistics cards for tablet/mobile */}
      <div className={`grid min-w-0 gap-2 sm:gap-3 lg:hidden ${showAllStats ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-5 max-[380px]:grid-cols-4'}`}>
        <button
          onClick={() => setStatusFilter('not-invoiced')}
          className="order-1 flex min-h-[76px] min-w-0 flex-col items-center justify-center rounded-xl border border-gray-100 bg-white p-1.5 text-center shadow-sm transition-all hover:bg-gray-50 hover:shadow-md sm:min-h-[84px] sm:p-2.5"
        >
          <div className="flex min-w-0 flex-col items-center">
            <p className="flex min-h-7 max-w-full items-center justify-center break-words text-center text-[9px] font-medium leading-tight text-gray-600 sm:min-h-8 sm:text-[11px]">Nicht abgerechnet</p>
            <div className="mt-2 flex items-center justify-center gap-1">
              <Timer className="h-4 w-4 shrink-0 text-blue-600 sm:h-5 sm:w-5" />
              <p className="text-base font-bold leading-tight text-gray-900 sm:text-lg">{stats.notInvoicedJobs}</p>
            </div>
          </div>
        </button>

        <button
          onClick={() => setStatusFilter('all')}
          className="order-4 max-[380px]:hidden flex min-h-[76px] min-w-0 flex-col items-center justify-center rounded-xl border border-gray-100 bg-white p-1.5 text-center shadow-sm transition-all hover:bg-gray-50 hover:shadow-md sm:min-h-[84px] sm:p-2.5"
        >
          <div className="flex min-w-0 flex-col items-center">
            <p className="flex min-h-7 max-w-full items-center justify-center break-words text-center text-[9px] font-medium leading-tight text-gray-600 sm:min-h-8 sm:text-[11px]">Gesamt</p>
            <div className="mt-2 flex items-center justify-center gap-1">
              <Briefcase className="h-4 w-4 shrink-0 text-gray-600 sm:h-5 sm:w-5" />
              <p className="text-base font-bold leading-tight text-gray-900 sm:text-lg">{stats.totalJobs}</p>
            </div>
          </div>
        </button>

        <button
          onClick={() => setStatusFilter('in-progress')}
          className="order-2 flex min-h-[76px] min-w-0 flex-col items-center justify-center rounded-xl border border-gray-100 bg-white p-1.5 text-center shadow-sm transition-all hover:bg-gray-50 hover:shadow-md sm:min-h-[84px] sm:p-2.5"
        >
          <div className="flex min-w-0 flex-col items-center">
            <p className="flex min-h-7 max-w-full items-center justify-center break-words text-center text-[9px] font-medium leading-tight text-gray-600 sm:min-h-8 sm:text-[11px]">In Bearbeitung</p>
            <div className="mt-2 flex items-center justify-center gap-1">
              <Timer className="h-4 w-4 shrink-0 text-yellow-600 sm:h-5 sm:w-5" />
              <p className="text-base font-bold leading-tight text-gray-900 sm:text-lg">{stats.inProgressJobs}</p>
            </div>
          </div>
        </button>

        <button
          onClick={() => setStatusFilter('completed')}
          className="order-3 flex min-h-[76px] min-w-0 flex-col items-center justify-center rounded-xl border border-gray-100 bg-white p-1.5 text-center shadow-sm transition-all hover:bg-gray-50 hover:shadow-md sm:min-h-[84px] sm:p-2.5"
        >
          <div className="flex min-w-0 flex-col items-center">
            <p className="flex min-h-7 max-w-full items-center justify-center break-words text-center text-[9px] font-medium leading-tight text-gray-600 sm:min-h-8 sm:text-[11px]">Abgeschlossen</p>
            <div className="mt-2 flex items-center justify-center gap-1">
              <CheckCircle className="h-4 w-4 shrink-0 text-green-600 sm:h-5 sm:w-5" />
              <p className="text-base font-bold leading-tight text-gray-900 sm:text-lg">{stats.completedJobs}</p>
            </div>
          </div>
        </button>

        {showAllStats && (
            <div className="order-5 flex min-h-[76px] min-w-0 flex-col items-center justify-center rounded-xl border border-gray-100 bg-white p-1.5 text-center shadow-sm sm:min-h-[84px] sm:p-2.5">
            <div className="flex min-w-0 flex-col items-center">
              <p className="flex min-h-7 max-w-full items-center justify-center break-words text-center text-[9px] font-medium leading-tight text-gray-600 sm:min-h-8 sm:text-[11px]">Stunden</p>
              <div className="mt-2 flex items-center justify-center gap-1">
                <Clock className="h-4 w-4 shrink-0 text-purple-600 sm:h-5 sm:w-5" />
                <p className="text-base font-bold leading-tight text-gray-900 sm:text-lg">{formatNumber(stats.totalHours, locale, company?.numberFormat, 1)}</p>
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowAllStats((isExpanded) => !isExpanded)}
          aria-label={showAllStats ? 'Statistik-Karten zuklappen' : 'Weitere Statistik-Karten anzeigen'}
          className="order-6 flex min-h-[76px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-gray-100 bg-white px-1.5 text-[10px] font-semibold leading-tight text-gray-500 shadow-sm transition-all hover:bg-gray-50 hover:text-gray-700 hover:shadow-md sm:min-h-[84px] sm:px-2.5 sm:text-xs"
        >
          {/* Ohne Symbol und Beschriftung wirkt die Karte wie eine leere Fläche. */}
          {showAllStats
            ? <ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" />
            : <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />}
          <span>{showAllStats ? 'Weniger' : 'Mehr'}</span>
        </button>
      </div>

      {/* Filters */}
      <ResponsiveFilterBar
        hasActiveFilters={statusFilter !== 'all' || customerFilter !== 'all' || dateFilter !== 'all'}
        search={(
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <input
                type="text"
                placeholder={terminology.work.searchPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 xl:py-1.5 2xl:py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent text-sm lg:text-base"
              />
            </div>
        )}
        filters={(
          <div className="flex flex-col gap-2 sm:flex-row lg:gap-4">
            {/* Status Filter */}
            <FilterSelect
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-custom focus:border-transparent lg:text-base xl:px-2 xl:py-1.5 2xl:px-3 2xl:py-2"
            >
              <option value="all">Alle Status</option>
              <option value="not-invoiced">Alle außer abgerechnet</option>
              <option value="draft">Entwurf</option>
              <option value="in-progress">In Bearbeitung</option>
              <option value="completed">Abgeschlossen</option>
              <option value="invoiced">Abgerechnet</option>
            </FilterSelect>

            {/* Customer Filter */}
            <FilterSelect
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-custom focus:border-transparent lg:text-base xl:px-2 xl:py-1.5 2xl:px-3 2xl:py-2"
            >
              <option value="all">Alle {terminology.entity.plural}</option>
              {customers.map(customer => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </FilterSelect>

            {/* Date Filter */}
            <FilterSelect
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-custom focus:border-transparent lg:text-base xl:px-2 xl:py-1.5 2xl:px-3 2xl:py-2"
            >
              <option value="all">Alle Zeiträume</option>
              <option value="today">Heute</option>
              <option value="week">Diese Woche</option>
              <option value="month">Dieser Monat</option>
            </FilterSelect>
          </div>
        )}
      />

      {/* Jobs List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {filteredJobs.length === 0 ? (
          <div className="p-8 lg:p-12 text-center">
            <Briefcase className="h-12 w-12 lg:h-16 lg:w-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg lg:text-xl font-medium text-gray-900 mb-2">{terminology.work.noResults}</h3>
            <p className="text-gray-500 mb-6">
              {searchTerm || statusFilter !== 'all' || customerFilter !== 'all' || dateFilter !== 'all'
                ? `Versuchen Sie andere Filter oder erstellen Sie einen neuen ${terminology.work.singular}.`
                : `Erstellen Sie Ihren ersten ${terminology.work.singular}, um loszulegen.`}
            </p>
            
            {/* Info box für neue Benutzer */}
            {jobEntries.length === 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 text-left max-w-md mx-auto">
                <h4 className="text-sm font-medium text-blue-900 mb-2">So funktioniert die Rechnungserstellung:</h4>
                <ol className="text-sm text-blue-800 space-y-1">
                  <li>1. {terminology.work.plural} erstellen und Arbeitszeit erfassen</li>
                  <li>2. {terminology.work.plural} als "Abgeschlossen" markieren</li>
                  <li>3. Abgeschlossene {terminology.work.plural} auswählen</li>
                  <li>4. "Rechnung erstellen" klicken</li>
                  <li>5. Rechnungsart wählen (Einzel/Tages/Monatsrechnung)</li>
                </ol>
              </div>
            )}
            
            <button
              onClick={() => setShowForm(true)}
              className="bg-primary-custom text-white px-4 lg:px-6 py-2 lg:py-3 rounded-xl hover:bg-primary-custom/90 transition-all duration-300 hover:scale-105"
            >
              Ersten {terminology.work.singular} erstellen
            </button>
          </div>
        ) : (
          <>
            <BulkSelectionHeader
              itemLabel={terminology.work.singular}
              itemLabelPlural={terminology.work.plural}
              visibleCount={filteredJobs.length}
              selectedCount={selectedJobIds.length}
              allSelected={filteredJobs.length > 0 && filteredJobs.every((job: JobEntry) => selectedJobIds.includes(job.id))}
              onSelectAll={handleSelectAllJobs}
            >
              <div className="flex items-center gap-2">
                <span className="hidden text-xs text-gray-600 sm:inline">Status ändern:</span>
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      handleBulkStatusChange(e.target.value as JobEntry['status']);
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
                  <option value="in-progress">In Bearbeitung</option>
                  <option value="completed">Abgeschlossen</option>
                  <option value="invoiced">Abgerechnet</option>
                </select>
              </div>
              <button
                type="button"
                onClick={handleBulkInvoiceGeneration}
                disabled={isBulkOperation}
                className="action-icon-button bulk-action-icon-button action-icon-green disabled:cursor-not-allowed disabled:opacity-50"
                title="Rechnung erstellen"
                aria-label="Rechnung erstellen"
              >
                <FileText className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleBulkDownload}
                disabled={isBulkOperation}
                className="action-icon-button bulk-action-icon-button action-icon-blue disabled:cursor-not-allowed disabled:opacity-50"
                title="PDF herunterladen"
                aria-label="PDF herunterladen"
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={isBulkOperation}
                className="action-icon-button bulk-action-icon-button action-icon-red disabled:cursor-not-allowed disabled:opacity-50"
                title="Löschen"
                aria-label="Löschen"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </BulkSelectionHeader>
            {invoiceCreationNotice && (
              <div className="flex items-start justify-between gap-2 border-b border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-900 sm:px-4" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-600" />
                <button type="button" onClick={() => setInvoiceCreationNotice(false)} className="order-last shrink-0 rounded p-1 text-yellow-700 hover:bg-yellow-100" aria-label="Hinweis ausblenden"><X className="h-4 w-4" /></button>
                <span>Nur abgeschlossene {terminology.work.plural} können für die Rechnungserstellung ausgewählt werden.</span>
              </div>
            )}
            {/* Mobile View */}
            <div className="block tablet:hidden">
              <div className="divide-y divide-gray-200">
                {displayedJobs.map(({ job, recurrenceGroup, isGroupHeader }) => (
                  <div
                    key={job.id}
                    data-recurring-group={recurrenceGroup && isGroupHeader ? recurrenceGroup.key : undefined}
                    onClick={(event) => handleRecurringGroupRowClick(event, recurrenceGroup, isGroupHeader)}
                    className={`p-4 hover:bg-gray-50 ${recurrenceGroup && isGroupHeader ? 'cursor-pointer' : ''} ${recurrenceGroup && !isGroupHeader ? 'ml-3 border-l-2 border-primary-custom/30 bg-primary-custom/[0.02]' : ''}`}
                  >
                    <div className="flex items-start space-x-3">
                      <div className="flex-shrink-0 pt-1">
                        <input
                          type="checkbox"
                          checked={recurrenceGroup && isGroupHeader
                            ? recurrenceGroup.jobs.every((groupJob) => selectedJobIds.includes(groupJob.id))
                            : selectedJobIds.includes(job.id)}
                          onChange={(e) => recurrenceGroup && isGroupHeader
                            ? handleRecurringGroupSelection(recurrenceGroup, e.target.checked)
                            : handleJobSelection(job.id, e.target.checked)}
                          className="custom-checkbox cursor-pointer"
                          title={`${terminology.work.singular} auswählen`}
                        />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <h3
                              className="min-w-0 truncate text-sm font-medium text-gray-900"
                              title={job.priority ? `Priorität: ${job.priority === 'high' ? 'hoch' : job.priority === 'medium' ? 'mittel' : 'niedrig'}` : undefined}
                            >
                              {job.title}
                            </h3>
                            {recurrenceGroup && isGroupHeader && (
                              <span className="shrink-0 rounded-full bg-primary-custom/10 px-2 py-0.5 text-[11px] font-medium text-primary-custom">
                                {recurrenceGroup.jobs.length} Termine
                              </span>
                            )}
                            <label
                              className="relative inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center"
                              title={getNotePreview(job.notes) ? `Status: ${getStatusText(job.status)} · Hinweis: ${getNotePreview(job.notes)}` : getStatusText(job.status)}
                            >
                              <span className={`h-2.5 w-2.5 rounded-full tablet:hidden ${getStatusDotColor(job.status)}`} aria-hidden="true" />
                              <span className={`hidden rounded-full px-2.5 py-1 text-xs font-semibold tablet:inline-flex ${getStatusColor(job.status)}`}>
                                {getStatusText(job.status)}
                              </span>
                              {job.recurrence && (
                                <Repeat2 className="h-4 w-4 text-primary-custom" aria-label="Wiederkehrend" />
                              )}
                              {getNotePreview(job.notes) && (
                                <Info
                                  className="h-4 w-4 shrink-0 text-primary-custom"
                                  aria-label={`Hinweis: ${getNotePreview(job.notes)}`}
                                />
                              )}
                              <select
                                value={job.status}
                                onChange={(e) => handleStatusChange(job.id, e.target.value as JobEntry['status'])}
                                disabled={job.status === 'invoiced'}
                                aria-label={`Status: ${getStatusText(job.status)}`}
                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                              >
                                <option value="draft">Entwurf</option>
                                <option value="in-progress">In Bearbeitung</option>
                                <option value="completed">Abgeschlossen</option>
                                <option value="invoiced">Abgerechnet</option>
                              </select>
                            </label>
                          </div>
                          <ActionMenu
                            ariaLabel={`Aktionen für ${job.title}`}
                            containerClassName="shrink-0"
                            triggerClassName="action-icon-button bg-gray-100 text-gray-700 hover:bg-gray-200"
                          >
                            <ActionMenuItem icon={<Download className="h-4 w-4" />} tone="blue" onClick={() => handleExportJobPDF(job)}>{terminology.work.confirmationLabel} exportieren</ActionMenuItem>
                            <ActionMenuItem icon={<Eye className="h-4 w-4" />} tone="green" onClick={() => handlePreview(job)}>{terminology.work.confirmationLabel} anzeigen</ActionMenuItem>
                            {((recurrenceGroup && isGroupHeader && recurrenceGroup.jobs.some((item) => item.status === 'completed')) || (!recurrenceGroup && job.status === 'completed')) && (
                              <ActionMenuItem icon={<FileText className="h-4 w-4" />} tone="orange" onClick={() => handleCreateInvoice(job, recurrenceGroup && isGroupHeader ? recurrenceGroup : undefined)}>
                                {recurrenceGroup && isGroupHeader ? 'Rechnung für gesamten Kurs erstellen' : 'Rechnung erstellen'}
                              </ActionMenuItem>
                            )}
                            {job.status === 'invoiced' && findInvoiceForJobs(recurrenceGroup && isGroupHeader ? recurrenceGroup.jobs : [job]) && (
                              <ActionMenuItem icon={<FileText className="h-4 w-4" />} tone="green" onClick={() => handlePreviewInvoice(job, recurrenceGroup && isGroupHeader ? recurrenceGroup : undefined)}>Rechnung anzeigen</ActionMenuItem>
                            )}
                            {job.status === 'invoiced' && findInvoiceForJobs(recurrenceGroup && isGroupHeader ? recurrenceGroup.jobs : [job]) && (
                              <ActionMenuItem icon={<Edit className="h-4 w-4" />} tone="indigo" onClick={() => handleEditInvoice(job, recurrenceGroup && isGroupHeader ? recurrenceGroup : undefined)}>Rechnung bearbeiten</ActionMenuItem>
                            )}
                            <ActionMenuItem icon={<Edit className="h-4 w-4" />} tone="indigo" onClick={() => handleEdit(job)}>Bearbeiten</ActionMenuItem>
                            <ActionMenuItem icon={<PenLine className="h-4 w-4" />} tone="indigo" onClick={() => setSigningJob(job)}>{job.signature ? 'Unterschrift ersetzen' : 'Unterschrift erfassen'}</ActionMenuItem>
                            <ActionMenuItem icon={<Copy className="h-4 w-4" />} tone="blue" onClick={() => handleDuplicate(job)}>Duplizieren</ActionMenuItem>
                            <ActionMenuItem icon={<Trash2 className="h-4 w-4" />} tone="red" onClick={() => handleDelete(job)}>Löschen</ActionMenuItem>
                          </ActionMenu>
                        </div>
                        
                        <p className="mb-2 block min-w-0 truncate whitespace-nowrap text-sm text-gray-500">
                          {job.description}
                        </p>
                        
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <div className="flex items-center whitespace-nowrap">
                            <span className="text-gray-500 mr-2">{terminology.work.numberShortLabel}:</span>
                            <span className="text-gray-900 font-medium">{job.jobNumber}</span>
                          </div>
                          
                          <div className="flex min-w-0 items-center">
                            <User className="h-4 w-4 text-gray-400 mr-1 flex-shrink-0" />
                            <span className="truncate text-gray-900">{job.customerName}</span>
                          </div>
                          
                          <div className="flex items-center whitespace-nowrap">
                            {recurrenceGroup && isGroupHeader && (
                              <button
                                type="button"
                                onClick={() => toggleRecurringGroup(recurrenceGroup.key)}
                                className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-primary-custom/10 hover:text-primary-custom"
                                aria-expanded={expandedRecurringGroups.has(recurrenceGroup.key)}
                                aria-label={expandedRecurringGroups.has(recurrenceGroup.key) ? 'Kursserie einklappen' : 'Kursserie aufklappen'}
                                title={expandedRecurringGroups.has(recurrenceGroup.key) ? 'Kursserie einklappen' : 'Kursserie aufklappen'}
                              >
                                <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${expandedRecurringGroups.has(recurrenceGroup.key) ? 'rotate-180' : ''}`} />
                              </button>
                            )}
                            {recurrenceGroup && !isGroupHeader && (
                              <span className="relative mr-1 inline-flex h-5 w-3 shrink-0 items-center" aria-hidden="true">
                                <span className="absolute bottom-0 left-1 top-0 w-px bg-primary-custom/30" />
                                <span className="absolute left-1 top-1/2 h-px w-2 bg-primary-custom/30" />
                              </span>
                            )}
                            <Calendar className="h-4 w-4 text-gray-400 mr-1 flex-shrink-0" />
                            <span className="text-gray-900">{formatDate(job.date, locale, company?.dateFormat)}</span>
                          </div>
                          
                          <div className="flex items-center whitespace-nowrap">
                            <Clock className="h-4 w-4 text-gray-400 mr-1 flex-shrink-0" />
                            <span className="text-gray-900">{formatNumber(calculateTotalHours(job), locale, company?.numberFormat, 1)}h</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Desktop Table View */}
            <div ref={tableRef} className="hidden tablet:block w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-3 text-left w-12">
                      <span className="sr-only">Auswahl</span>
                    </th>
                    <th className="px-3 py-3 xl:px-2 xl:py-2 2xl:px-3 2xl:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-28">
                      Datum
                    </th>
                    <th className="px-3 py-3 xl:px-2 xl:py-2 2xl:px-3 2xl:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                      Nr.
                    </th>
                    <th className="px-3 py-3 xl:px-2 xl:py-2 2xl:px-3 2xl:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {terminology.work.singular}
                    </th>
                    <th className="px-3 py-3 xl:px-2 xl:py-2 2xl:px-3 2xl:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                      {terminology.entity.singular}
                    </th>
                    <th className="px-3 py-3 xl:px-2 xl:py-2 2xl:px-3 2xl:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                      Std.
                    </th>
                    <th className="sticky right-0 z-20 bg-gray-50 px-3 py-3 xl:px-2 xl:py-2 2xl:px-3 2xl:py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-14 2xl:w-44">
                      <span className="sr-only">Aktionen</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {displayedJobs.map(({ job, recurrenceGroup, isGroupHeader }) => (
                      <tr
                        key={job.id}
                        data-recurring-group={recurrenceGroup && isGroupHeader ? recurrenceGroup.key : undefined}
                        onClick={(event) => handleRecurringGroupRowClick(event, recurrenceGroup, isGroupHeader)}
                        className={`hover:bg-gray-50 ${recurrenceGroup && isGroupHeader ? 'cursor-pointer' : ''} ${recurrenceGroup && !isGroupHeader ? 'bg-primary-custom/[0.02]' : ''}`}
                      >
                      <td className="px-2 py-4 xl:py-2 2xl:py-4 w-12">
                        <div className="flex items-center">
                          <input
                            type="checkbox"
                            checked={recurrenceGroup && isGroupHeader
                              ? recurrenceGroup.jobs.every((groupJob) => selectedJobIds.includes(groupJob.id))
                              : selectedJobIds.includes(job.id)}
                          onChange={(e) => recurrenceGroup && isGroupHeader
                            ? handleRecurringGroupSelection(recurrenceGroup, e.target.checked)
                            : handleJobSelection(job.id, e.target.checked)}
                          className="custom-checkbox cursor-pointer"
                          title={`${terminology.work.singular} auswählen`}
                        />
                        </div>
                      </td>
                      <td className={`w-28 px-3 py-4 xl:px-2 xl:py-2 2xl:px-3 2xl:py-4 ${recurrenceGroup && !isGroupHeader ? 'border-l-2 border-primary-custom' : ''}`}>
                        <div className="flex items-center gap-1">
                          {recurrenceGroup && isGroupHeader && (
                            <button
                              type="button"
                              onClick={() => toggleRecurringGroup(recurrenceGroup.key)}
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-primary-custom/10 hover:text-primary-custom"
                              aria-expanded={expandedRecurringGroups.has(recurrenceGroup.key)}
                              aria-label={expandedRecurringGroups.has(recurrenceGroup.key) ? 'Kursserie einklappen' : 'Kursserie aufklappen'}
                              title={expandedRecurringGroups.has(recurrenceGroup.key) ? 'Kursserie einklappen' : 'Kursserie aufklappen'}
                            >
                              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${expandedRecurringGroups.has(recurrenceGroup.key) ? 'rotate-180' : ''}`} />
                            </button>
                          )}
                          {recurrenceGroup && !isGroupHeader && (
                            <span className="relative inline-flex h-6 w-3 shrink-0 items-center" aria-hidden="true">
                              <span className="absolute bottom-0 left-1 top-0 w-0.5 rounded-full bg-primary-custom/65" />
                              <span className="absolute left-1 top-1/2 h-0.5 w-2 rounded-full bg-primary-custom/65" />
                            </span>
                          )}
                          <span className="text-sm text-gray-900 whitespace-nowrap">{formatDate(job.date, locale, company?.dateFormat)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-4 xl:px-2 xl:py-2 2xl:px-3 2xl:py-4">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {job.jobNumber}
                        </div>
                      </td>
                      <td className="min-w-0 px-3 py-4 xl:px-2 xl:py-2 2xl:px-3 2xl:py-4">
                        <div className="min-w-0 max-w-full">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <div className="min-w-0 truncate whitespace-nowrap text-sm font-medium text-gray-900">
                              {job.title}
                            </div>
                            {recurrenceGroup && isGroupHeader && (
                              <span className="shrink-0 rounded-full bg-primary-custom/10 px-2 py-0.5 text-[11px] font-medium text-primary-custom">
                                {recurrenceGroup.jobs.length} Termine
                              </span>
                            )}
                          </div>
                          <div className="block max-w-full min-w-0 truncate whitespace-nowrap text-xs text-gray-500">
                            {job.description}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-4 xl:px-2 xl:py-2 2xl:px-3 2xl:py-4 w-32">
                        <span className="text-sm text-gray-900 truncate block">{job.customerName}</span>
                      </td>
                      <td className="hidden">
                        <label className="relative inline-flex items-center gap-2" title={getNotePreview(job.notes) ? `Status: ${getStatusText(job.status)} · Hinweis: ${getNotePreview(job.notes)}` : getStatusText(job.status)}>
                          <span className={`h-2.5 w-2.5 rounded-full ${getStatusDotColor(job.status)}`} aria-hidden="true" />
                          {job.recurrence && (
                            <Repeat2 className="h-4 w-4 text-primary-custom" aria-label="Wiederkehrend" />
                          )}
                          {getNotePreview(job.notes) && (
                            <Info
                              className="h-4 w-4 shrink-0 text-primary-custom"
                              aria-label={`Hinweis: ${getNotePreview(job.notes)}`}
                            />
                          )}
                          <span className="sr-only">{getStatusText(job.status)}</span>
                          <select
                          value={job.status}
                          onChange={(e) => handleStatusChange(job.id, e.target.value as JobEntry['status'])}
                          disabled={job.status === 'invoiced'}
                          aria-label={`Status: ${getStatusText(job.status)}`}
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                        >
                          <option value="draft">Entwurf</option>
                          <option value="in-progress">In Bearbeitung</option>
                          <option value="completed">Abgeschlossen</option>
                          <option value="invoiced">Abgerechnet</option>
                          </select>
                        </label>
                      </td>
                      <td className="px-3 py-4 xl:px-2 xl:py-2 2xl:px-3 2xl:py-4 w-20">
                        <span className="text-sm text-gray-900">{formatNumber(calculateTotalHours(job), locale, company?.numberFormat, 1)}h</span>
                      </td>
                      <td style={{ width: (showInlineActions ? actionColumnWidth(7) : ACTION_MENU_COLUMN_WIDTH) + JOB_STATUS_INDICATOR_WIDTH }} className="sticky right-0 z-10 bg-white px-3 py-4 text-right xl:py-2 2xl:py-4">
                        <div className="flex items-center justify-end gap-2">
                          <div className="flex shrink-0 items-center gap-2" title={getNotePreview(job.notes) ? `Status: ${getStatusText(job.status)} · Hinweis: ${getNotePreview(job.notes)}` : getStatusText(job.status)}>
                            <label className="relative inline-flex h-8 w-3.5 shrink-0 cursor-pointer items-center justify-center">
                              <span className={`h-2.5 w-2.5 rounded-full ${getStatusDotColor(job.status)}`} aria-hidden="true" />
                              <select
                                value={job.status}
                                onChange={(e) => handleStatusChange(job.id, e.target.value as JobEntry['status'])}
                                disabled={job.status === 'invoiced'}
                                aria-label={`Status: ${getStatusText(job.status)}`}
                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                              >
                                <option value="draft">Entwurf</option>
                                <option value="in-progress">In Bearbeitung</option>
                                <option value="completed">Abgeschlossen</option>
                                <option value="invoiced">Abgerechnet</option>
                              </select>
                            </label>
                            {job.recurrence && (
                              <span title="Wiederkehrender Kurs">
                                <Repeat2 className="h-4 w-4 text-primary-custom" aria-label="Wiederkehrend" />
                              </span>
                            )}
                          </div>
                          {!showInlineActions && (
                          <div>
                            <ActionMenu
                              ariaLabel={`Aktionen für ${job.title}`}
                              triggerClassName="action-icon-button bg-gray-100 text-gray-700 hover:bg-gray-200"
                            >
                              <ActionMenuItem icon={<Download className="h-4 w-4" />} tone="blue" onClick={() => handleExportJobPDF(job)}>{terminology.work.confirmationLabel} exportieren</ActionMenuItem>
                            <ActionMenuItem icon={<Eye className="h-4 w-4" />} tone="green" onClick={() => handlePreview(job)}>{terminology.work.confirmationLabel} anzeigen</ActionMenuItem>
                            {((recurrenceGroup && isGroupHeader && recurrenceGroup.jobs.some((item) => item.status === 'completed')) || (!recurrenceGroup && job.status === 'completed')) && (
                              <ActionMenuItem icon={<FileText className="h-4 w-4" />} tone="orange" onClick={() => handleCreateInvoice(job, recurrenceGroup && isGroupHeader ? recurrenceGroup : undefined)}>
                                {recurrenceGroup && isGroupHeader ? 'Rechnung für gesamten Kurs erstellen' : 'Rechnung erstellen'}
                              </ActionMenuItem>
                            )}
                            {job.status === 'invoiced' && findInvoiceForJobs(recurrenceGroup && isGroupHeader ? recurrenceGroup.jobs : [job]) && (
                              <ActionMenuItem icon={<FileText className="h-4 w-4" />} tone="green" onClick={() => handlePreviewInvoice(job, recurrenceGroup && isGroupHeader ? recurrenceGroup : undefined)}>Rechnung anzeigen</ActionMenuItem>
                            )}
                            {job.status === 'invoiced' && findInvoiceForJobs(recurrenceGroup && isGroupHeader ? recurrenceGroup.jobs : [job]) && (
                              <ActionMenuItem icon={<Edit className="h-4 w-4" />} tone="indigo" onClick={() => handleEditInvoice(job, recurrenceGroup && isGroupHeader ? recurrenceGroup : undefined)}>Rechnung bearbeiten</ActionMenuItem>
                            )}
                            <ActionMenuItem icon={<Edit className="h-4 w-4" />} tone="indigo" onClick={() => handleEdit(job)}>Bearbeiten</ActionMenuItem>
                              <ActionMenuItem icon={<PenLine className="h-4 w-4" />} tone="indigo" onClick={() => setSigningJob(job)}>{job.signature ? 'Unterschrift ersetzen' : 'Unterschrift erfassen'}</ActionMenuItem>
                            <ActionMenuItem icon={<Copy className="h-4 w-4" />} tone="blue" onClick={() => handleDuplicate(job)}>Duplizieren</ActionMenuItem>
                              <ActionMenuItem icon={<Trash2 className="h-4 w-4" />} tone="red" onClick={() => handleDelete(job)}>Löschen</ActionMenuItem>
                            </ActionMenu>
                          </div>
                          )}
                          {showInlineActions && (
                          <div className="flex flex-nowrap items-center justify-end gap-1">
                          <button
                            onClick={() => handleExportJobPDF(job)}
                            className="action-icon-button action-icon-blue"
                            title={`${terminology.work.confirmationLabel} exportieren`}
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handlePreview(job)}
                            className="action-icon-button action-icon-green"
                            title={`${terminology.work.confirmationLabel} anzeigen`}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {((recurrenceGroup && isGroupHeader && recurrenceGroup.jobs.some((item) => item.status === 'completed')) || (!recurrenceGroup && job.status === 'completed')) && (
                            <button
                              onClick={() => handleCreateInvoice(job, recurrenceGroup && isGroupHeader ? recurrenceGroup : undefined)}
                              className="action-icon-button bg-primary-light-custom text-primary-custom hover:bg-primary-medium-custom"
                              title={recurrenceGroup && isGroupHeader ? 'Rechnung für gesamten Kurs erstellen' : 'Rechnung erstellen'}
                            >
                              <FileText className="h-4 w-4" />
                            </button>
                          )}
                          {job.status === 'invoiced' && findInvoiceForJobs(recurrenceGroup && isGroupHeader ? recurrenceGroup.jobs : [job]) && (
                            <button
                              onClick={() => handlePreviewInvoice(job, recurrenceGroup && isGroupHeader ? recurrenceGroup : undefined)}
                              className="action-icon-button action-icon-green"
                              title="Rechnung anzeigen"
                            >
                              <FileText className="h-4 w-4" />
                            </button>
                          )}
                          {job.status === 'invoiced' && findInvoiceForJobs(recurrenceGroup && isGroupHeader ? recurrenceGroup.jobs : [job]) && (
                            <button
                              onClick={() => handleEditInvoice(job, recurrenceGroup && isGroupHeader ? recurrenceGroup : undefined)}
                              className="action-icon-button action-icon-indigo"
                              title="Rechnung bearbeiten"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleEdit(job)}
                            className="action-icon-button action-icon-indigo"
                            title={job.status === 'invoiced' ? 'Bearbeiten (GoBD-Warnung wird angezeigt)' : 'Bearbeiten'}
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDuplicate(job)}
                            className="action-icon-button action-icon-blue"
                            title="Duplizieren"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(job)}
                            className="action-icon-button action-icon-red"
                            title={job.status === 'invoiced' ? 'Löschen (GoBD-Warnung wird angezeigt)' : 'Löschen'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 text-right text-xs text-gray-500">
              {filteredJobs.length} {filteredJobs.length === 1 ? terminology.work.singular : terminology.work.plural}
            </div>
          </>
        )}
      </div>

      {/* Confirmation Modal */}
      <SignaturePad
        isOpen={Boolean(signingJob)}
        onClose={() => setSigningJob(null)}
        onSave={handleSaveSignature}
        title={`Unterschrift · ${signingJob?.title || ''}`}
        initialCustomerName={signingJob?.customerName || ''}
      />

      <StatusChangeFeedbackModal
        feedback={statusChangeFeedback}
        terminology={terminology}
        onClose={() => setStatusChangeFeedback(null)}
      />

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        isDestructive={confirmModal.isDestructive}
        isGoBDWarning={confirmModal.isGoBDWarning}
      />

      {/* Document Preview Modal */}
      <DocumentPreview
        isOpen={documentPreview.isOpen}
        onClose={handleClosePreview}
        documents={documentPreview.documents}
        initialIndex={documentPreview.initialIndex}
      />

      {/* Customer Creation Modal */}
      {showCustomerForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-lg p-4 lg:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {terminology.entity.newLabel}
            </h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              try {
                await addCustomer(newCustomerData);
                setNewCustomerData({
                  name: '',
                  email: '',
                  address: '',
                  postalCode: '',
                  city: '',
                  country: 'Deutschland',
                  taxId: '',
                  phone: ''
                });
                setShowCustomerForm(false);
                
                // Refresh customers in other components
                await refreshCustomers();
              } catch (error) {
                logger.error('Error creating customer:', error);
              }
            }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  required
                  value={newCustomerData.name}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  E-Mail
                </label>
                <input
                  type="email"
                  value={newCustomerData.email}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  placeholder="optional"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Adresse *
                </label>
                <input
                  type="text"
                  required
                  value={newCustomerData.address}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, address: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    PLZ *
                  </label>
                  <input
                    type="text"
                    required
                    value={newCustomerData.postalCode}
                    onChange={(e) => setNewCustomerData({ ...newCustomerData, postalCode: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Stadt *
                  </label>
                  <input
                    type="text"
                    required
                    value={newCustomerData.city}
                    onChange={(e) => setNewCustomerData({ ...newCustomerData, city: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Land *
                </label>
                <input
                  type="text"
                  required
                  value={newCustomerData.country}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, country: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Telefon
                </label>
                <input
                  type="tel"
                  value={newCustomerData.phone}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                />
              </div>
              <div className="form-action-bar pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-primary-custom text-white py-2 px-4 rounded-lg hover:bg-primary-custom/90 transition-colors"
                >
                  {terminology.entity.createLabel}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCustomerForm(false)}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors"
                >
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
    </div>
  );
}

interface StatusChangeFeedbackModalProps {
  feedback: StatusChangeFeedback | null;
  terminology: ReturnType<typeof getTerminology>;
  onClose: () => void;
}

function StatusChangeFeedbackModal({ feedback, terminology, onClose }: StatusChangeFeedbackModalProps) {
  if (!feedback) return null;

  const isLoading = feedback.phase === 'loading';
  const isSuccess = feedback.phase === 'success';
  const progress = feedback.total > 0
    ? Math.round((feedback.completed / feedback.total) * 100)
    : 0;

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="status-change-feedback-title"
      >
        <div className="flex items-center gap-3 border-b border-gray-200 px-5 py-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            isLoading ? 'bg-blue-50' : isSuccess ? 'bg-green-50' : 'bg-red-50'
          }`}>
            {isLoading ? (
              <RefreshCw className="h-5 w-5 animate-spin text-blue-600" aria-hidden="true" />
            ) : isSuccess ? (
              <CheckCircle className="h-5 w-5 text-green-600" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <h2 id="status-change-feedback-title" className="text-base font-semibold text-gray-900">
              {isLoading ? 'Status wird geändert' : isSuccess ? 'Status erfolgreich geändert' : 'Status konnte nicht geändert werden'}
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">
              {feedback.total === 1
                ? `${terminology.work.singular} wird auf „${feedback.statusText}“ gesetzt.`
                : `${feedback.total} ${terminology.work.plural} werden auf „${feedback.statusText}“ gesetzt.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="ml-auto shrink-0 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Statusmeldung schließen"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5" aria-live="polite">
          {isLoading ? (
            <>
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>Backend-Verarbeitung läuft …</span>
                <span className="font-medium text-gray-900">{feedback.completed} / {feedback.total}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-blue-600 transition-[width] duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500">
                Bitte das Fenster geöffnet lassen, bis die Änderung abgeschlossen ist.
              </p>
            </>
          ) : isSuccess ? (
            <p className="text-sm text-gray-600">
              {feedback.total === 1
                ? `Der ${terminology.work.singular} wurde aktualisiert.`
                : `Alle ${feedback.total} ${terminology.work.plural} wurden aktualisiert.`}
            </p>
          ) : (
            <p className="text-sm text-red-700">{feedback.errorMessage}</p>
          )}
        </div>

        <div className="flex justify-end border-t border-gray-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-custom/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? 'Bitte warten …' : 'Schließen'}
          </button>
        </div>
      </div>
    </div>
  );
}
