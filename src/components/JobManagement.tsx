import { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useJobs } from '../context/JobContext';
import { useCompany } from '../context/CompanyContext';
import { JobEntry } from '../types';
import { JobEntryForm } from './JobEntryForm';
import { JobInvoiceGenerator } from './JobInvoiceGenerator';
import { PageHeader } from './PageHeader';
import { FilterSelect, ResponsiveFilterBar } from './ResponsiveFilterBar';
import { ConfirmationModal } from './ConfirmationModal';
import { DocumentPreview } from './DocumentPreview';
import { createJobAttachmentPreviewDocuments } from '../utils/previewDocuments';
import type { PreviewDocument } from '../utils/previewDocuments';
import { generateJobPDF, downloadBlob } from '../utils/pdfGenerator';
import { calculateTotalHours } from '../utils/jobUtils';
import { formatDate, formatNumber } from '../utils/formatters';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { BulkSelectionHeader } from './BulkSelectionHeader';
import { getTerminology } from '../utils/terminology';
import { ImportWizard } from './ImportWizard';

interface JobManagementProps {
  onNavigate?: (page: string) => void;
}

type StatusChangeFeedback = {
  phase: 'loading' | 'success' | 'error';
  completed: number;
  total: number;
  statusText: string;
  errorMessage?: string;
};

export function JobManagement({ onNavigate }: JobManagementProps = {}) {
  const { customers, addCustomer, refreshCustomers } = useCustomers();
  const { jobEntries, addJobEntry, updateJobEntry, deleteJobEntry, refreshJobEntries } = useJobs();
  const { company } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);

  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<JobEntry | null>(null);
  const [showInvoiceGenerator, setShowInvoiceGenerator] = useState(false);
  const [invoiceCreationNotice, setInvoiceCreationNotice] = useState(false);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [isBulkOperation, setIsBulkOperation] = useState(false);
  const [statusChangeFeedback, setStatusChangeFeedback] = useState<StatusChangeFeedback | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('not-invoiced');
  const [customerFilter, setCustomerFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [showAllStats, setShowAllStats] = useState(false);
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
      
      let matchesStatus = false;
      if (statusFilter === 'all') {
        matchesStatus = true;
      } else if (statusFilter === 'not-invoiced') {
        matchesStatus = job.status !== 'invoiced';
      } else {
        matchesStatus = job.status === statusFilter;
      }
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
        onConfirm: () => {
          deleteJobEntry(job.id);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        },
        isDestructive: true,
        isGoBDWarning: true
      });
    } else {
      setConfirmModal({
        isOpen: true,
        title: terminology.work.deleteLabel,
          message: `Möchten Sie den ${terminology.work.singular} "${job.title}" wirklich löschen?`,
        onConfirm: () => {
          deleteJobEntry(job.id);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        },
        isDestructive: true
      });
    }
  };

  const handleFormSubmit = async (jobData: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      if (editingJob) {
        await updateJobEntry(editingJob.id, jobData);
      } else {
        await addJobEntry(jobData);
        // Refresh job entries in other components
        await refreshJobEntries();
      }
      setShowForm(false);
      setEditingJob(null);
    } catch (error) {
      logger.error('Error saving job:', error);
      // Don't close the form if there was an error, so user can retry
      // The error message is already shown by the Context
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

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'high': return 'text-red-600';
      case 'medium': return 'text-yellow-600';
      case 'low': return 'text-green-600';
      default: return 'text-gray-600';
    }
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
      alert(`${selectedJobIds.length} ${terminology.work.singular}/${terminology.work.plural} erfolgreich heruntergeladen.`);
    } catch (error) {
      logger.error('Error downloading jobs:', error);
          alert(`Fehler beim Herunterladen der ${terminology.work.plural}.`);
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
          alert(`${selectedJobIds.length} ${terminology.work.singular}/${terminology.work.plural} erfolgreich gelöscht.`);
        } catch (error) {
          logger.error('Error deleting jobs:', error);
          alert(`Fehler beim Löschen der ${terminology.work.plural}.`);
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
        alert(`${terminology.entity.dataLabel} oder ${terminology.organization.dataLabel} nicht gefunden`);
        return;
      }

      const pdfBlob = await generateJobPDF(job, {
        company,
        customer
      });

      const filename = `${terminology.work.singular}_${job.title.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date(job.date).toLocaleDateString('de-DE').replace(/\./g, '-')}.pdf`;
      downloadBlob(pdfBlob, filename);
    } catch (error) {
      logger.error(`Fehler beim Erstellen der ${terminology.work.singular}-PDF:`, error);
      alert('Fehler beim Erstellen der PDF. Bitte versuchen Sie es erneut.');
    }
  };

  const handlePreview = (job: JobEntry) => {
    // Create preview documents for the job
    const documents = createJobAttachmentPreviewDocuments(job, company?.terminologyProfile);
    
    setDocumentPreview({
      isOpen: true,
      documents,
      initialIndex: 0
    });
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
        onClose={() => {
          setShowInvoiceGenerator(false);
          setSelectedJobIds([]);
        }}
        onInvoiceGenerated={() => {
          setShowInvoiceGenerator(false);
          setSelectedJobIds([]);
        }}
      />
    );
  }

  return (
    <div className="space-y-8 xl:space-y-4 2xl:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 xl:gap-2 2xl:gap-4">
        <PageHeader icon={Briefcase} title={terminology.work.managementLabel}>
        
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-primary-custom px-3 text-sm text-primary-custom transition hover:bg-primary-light-custom sm:px-4 sm:text-base"
          >
            <Upload className="mr-0 h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Importieren</span>
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex h-10 shrink-0 items-center rounded-xl bg-primary-custom px-3 text-sm text-white transition-all duration-300 hover:scale-105 hover:bg-primary-custom/90 sm:px-4 sm:text-base"
          >
            <Plus className="mr-0 h-4 w-4 sm:mr-2" />
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
          className="order-6 flex min-h-[76px] min-w-0 items-center justify-center rounded-xl border border-gray-100 bg-white px-1.5 text-[10px] font-semibold leading-tight text-gray-500 shadow-sm transition-all hover:bg-gray-50 hover:text-gray-700 hover:shadow-md sm:min-h-[84px] sm:px-2.5 sm:text-xs"
        >
          {showAllStats ? 'Zuklappen' : '…'}
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
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
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
            <div className="block lg:hidden">
              <div className="divide-y divide-gray-200">
                {filteredJobs.map((job) => (
                  <div key={job.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-start space-x-3">
                      <div className="flex-shrink-0 pt-1">
                        <input
                          type="checkbox"
                          checked={selectedJobIds.includes(job.id)}
                          onChange={(e) => handleJobSelection(job.id, e.target.checked)}
                          className="custom-checkbox cursor-pointer"
                          title={`${terminology.work.singular} auswählen`}
                        />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <h3 className="min-w-0 truncate text-sm font-medium text-gray-900">
                              {job.priority && (
                                <AlertTriangle className={`mr-1 inline h-4 w-4 align-text-bottom ${getPriorityColor(job.priority)}`} />
                              )}
                              {job.title}
                            </h3>
                            <label
                              className="relative inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center"
                              title={getStatusText(job.status)}
                            >
                              <span className={`h-2.5 w-2.5 rounded-full sm:hidden ${getStatusDotColor(job.status)}`} aria-hidden="true" />
                              <span className={`hidden rounded-full px-2.5 py-1 text-xs font-semibold sm:inline-flex ${getStatusColor(job.status)}`}>
                                {getStatusText(job.status)}
                              </span>
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
                            <ActionMenuItem icon={<Download className="h-4 w-4" />} tone="blue" onClick={() => handleExportJobPDF(job)}>PDF exportieren</ActionMenuItem>
                            <ActionMenuItem icon={<Eye className="h-4 w-4" />} tone="green" onClick={() => handlePreview(job)}>Dokumente anzeigen</ActionMenuItem>
                            <ActionMenuItem icon={<Edit className="h-4 w-4" />} tone="indigo" onClick={() => handleEdit(job)}>Bearbeiten</ActionMenuItem>
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
            <div className="hidden lg:block w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-3 text-left w-12">
                      <span className="sr-only">Auswahl</span>
                    </th>
                    <th className="px-3 py-3 xl:px-2 xl:py-2 2xl:px-3 2xl:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
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
                    <th className="px-3 py-3 xl:px-2 xl:py-2 2xl:px-3 2xl:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-28">
                      Status
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
                  {filteredJobs.map((job) => (
                    <tr key={job.id} className="hover:bg-gray-50">
                      <td className="px-2 py-4 xl:py-2 2xl:py-4 w-12">
                        <div className="flex items-center">
                          <input
                            type="checkbox"
                            checked={selectedJobIds.includes(job.id)}
                          onChange={(e) => handleJobSelection(job.id, e.target.checked)}
                          className="custom-checkbox cursor-pointer"
                          title={`${terminology.work.singular} auswählen`}
                        />
                        </div>
                      </td>
                      <td className="px-3 py-4 xl:px-2 xl:py-2 2xl:px-3 2xl:py-4 w-24">
                        <span className="text-sm text-gray-900 whitespace-nowrap">{formatDate(job.date, locale, company?.dateFormat)}</span>
                      </td>
                      <td className="px-3 py-4 xl:px-2 xl:py-2 2xl:px-3 2xl:py-4">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {job.jobNumber}
                        </div>
                      </td>
                      <td className="min-w-0 px-3 py-4 xl:px-2 xl:py-2 2xl:px-3 2xl:py-4">
                        <div className="min-w-0 max-w-full">
                          <div className="min-w-0 truncate whitespace-nowrap text-sm font-medium text-gray-900">
                            {job.title}
                          </div>
                          <div className="block max-w-full min-w-0 truncate whitespace-nowrap text-xs text-gray-500">
                            {job.description}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-4 xl:px-2 xl:py-2 2xl:px-3 2xl:py-4 w-32">
                        <span className="text-sm text-gray-900 truncate block">{job.customerName}</span>
                      </td>
                      <td className="px-3 py-4 xl:px-2 xl:py-2 2xl:px-3 2xl:py-4 w-28">
                        <label className="relative inline-flex items-center gap-2" title={getStatusText(job.status)}>
                          <span className={`h-2.5 w-2.5 rounded-full ${getStatusDotColor(job.status)}`} aria-hidden="true" />
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
                      <td className="sticky right-0 z-10 bg-white px-3 py-4 xl:px-2 xl:py-2 2xl:px-3 2xl:py-4 text-right w-14 2xl:w-44">
                        <div className="flex justify-end space-x-1">
                          <div className="2xl:hidden">
                            <ActionMenu
                              ariaLabel={`Aktionen für ${job.title}`}
                              triggerClassName="action-icon-button bg-gray-100 text-gray-700 hover:bg-gray-200"
                            >
                              <ActionMenuItem icon={<Download className="h-4 w-4" />} tone="blue" onClick={() => handleExportJobPDF(job)}>PDF exportieren</ActionMenuItem>
                              <ActionMenuItem icon={<Eye className="h-4 w-4" />} tone="green" onClick={() => handlePreview(job)}>Dokumente anzeigen</ActionMenuItem>
                              <ActionMenuItem icon={<Edit className="h-4 w-4" />} tone="indigo" onClick={() => handleEdit(job)}>Bearbeiten</ActionMenuItem>
                              <ActionMenuItem icon={<Trash2 className="h-4 w-4" />} tone="red" onClick={() => handleDelete(job)}>Löschen</ActionMenuItem>
                            </ActionMenu>
                          </div>
                          <div className="hidden 2xl:flex justify-end space-x-1">
                          <button
                            onClick={() => handleExportJobPDF(job)}
                            className="action-icon-button action-icon-blue"
                            title="PDF exportieren"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handlePreview(job)}
                            className="action-icon-button action-icon-green"
                            title="Dokumente anzeigen"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleEdit(job)}
                            className="action-icon-button action-icon-indigo"
                            title={job.status === 'invoiced' ? 'Bearbeiten (GoBD-Warnung wird angezeigt)' : 'Bearbeiten'}
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(job)}
                            className="action-icon-button action-icon-red"
                            title={job.status === 'invoiced' ? 'Löschen (GoBD-Warnung wird angezeigt)' : 'Löschen'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          </div>
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
              <div className="flex flex-col sm:flex-row gap-4 pt-4">
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
