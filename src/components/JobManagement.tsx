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
  Filter,
  Timer,
  CheckCircle,
  AlertTriangle,
  Briefcase,
  Download,
  Eye,
  PenTool,
  Mail
} from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useJobs } from '../context/JobContext';
import { useCompany } from '../context/CompanyContext';
import { JobEntry, Customer } from '../types';
import { JobEntryForm } from './JobEntryForm';
import { JobInvoiceGenerator } from './JobInvoiceGenerator';
import { PageHeader } from './PageHeader';
import { ConfirmationModal } from './ConfirmationModal';
import { SignaturePad } from './SignaturePad';
import { DocumentPreview, createJobAttachmentPreviewDocuments, PreviewDocument } from './DocumentPreview';
import { generateJobPDF, downloadBlob } from '../utils/pdfGenerator';
import { calculateTotalHours } from '../utils/jobUtils';

interface JobManagementProps {
  onNavigate?: (page: string) => void;
}

export function JobManagement({ onNavigate }: JobManagementProps = {}) {
  const { customers, addCustomer, refreshCustomers } = useCustomers();
  const { jobEntries, addJobEntry, updateJobEntry, deleteJobEntry, refreshJobEntries, addJobSignature } = useJobs();
  const { company } = useCompany();

  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<JobEntry | null>(null);
  const [showInvoiceGenerator, setShowInvoiceGenerator] = useState(false);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [isBulkOperation, setIsBulkOperation] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('not-invoiced');
  const [customerFilter, setCustomerFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
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

  // Signature Pad state
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [signingJob, setSigningJob] = useState<JobEntry | null>(null);

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

  // Helper function to format currency
  const formatCurrencyValue = (amount: number) => {
    const currency = company?.currency || 'EUR';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

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
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            matchesDate = jobDate >= weekAgo;
            break;
          case 'month':
            const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
            matchesDate = jobDate >= monthAgo;
            break;
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
    const totalHours = filteredJobs.reduce((sum: number, job: any) => sum + calculateTotalHours(job), 0);
    
    return { totalJobs, completedJobs, inProgressJobs, notInvoicedJobs, totalHours };
  }, [filteredJobs]);

  const handleEdit = (job: JobEntry) => {
    // Check if job is invoiced and warn user
    if (job.status === 'invoiced') {
      setConfirmModal({
        isOpen: true,
        title: 'Auftrag bearbeiten',
        message: 'Dieser Auftrag wurde bereits abgerechnet. Änderungen an abgerechneten Aufträgen sollten nur in Ausnahmefällen vorgenommen werden, da sie die GoBD-Konformität beeinträchtigen können. Möchten Sie trotzdem fortfahren?',
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
        title: 'Auftrag löschen',
        message: 'Dieser Auftrag wurde bereits abgerechnet. Das Löschen abgerechneter Aufträge kann die GoBD-Konformität verletzen und ist rechtlich problematisch. Sind Sie sicher, dass Sie fortfahren möchten?',
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
        title: 'Auftrag löschen',
        message: `Möchten Sie den Auftrag "${job.title}" wirklich löschen?`,
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
      const currentJob = jobEntries.find((j: any) => j.id === jobId);
      if (currentJob?.status === 'invoiced') {
        setConfirmModal({
          isOpen: true,
          title: 'Status nicht änderbar',
          message: 'Der Status von abgerechneten Aufträgen kann nicht mehr geändert werden.',
          onConfirm: () => {
            setConfirmModal((prev: any) => ({ ...prev, isOpen: false }));
          }
        });
        return;
      }
      
      await updateJobEntry(jobId, { status: newStatus });
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

  const handleJobSelection = (jobId: string, checked: boolean) => {
    // Allow selection of all jobs, not just completed ones
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
      alert('Keine abgeschlossenen Aufträge ausgewählt. Nur abgeschlossene Aufträge können abgerechnet werden.');
      return;
    }
    
    setShowInvoiceGenerator(true);
  };

  // Bulk operations functions
  const handleSelectAllJobs = (checked: boolean) => {
    if (checked) {
      // Select ALL jobs, not just completed ones
      setSelectedJobIds(filteredJobs.map(job => job.id));
    } else {
      setSelectedJobIds([]);
    }
  };

  const handleBulkStatusChange = async (newStatus: JobEntry['status']) => {
    if (selectedJobIds.length === 0) return;
    
    setIsBulkOperation(true);
    try {
      for (const jobId of selectedJobIds) {
        await updateJobEntry(jobId, { status: newStatus });
      }
      setSelectedJobIds([]);
      alert(`${selectedJobIds.length} Auftrag/Aufträge erfolgreich aktualisiert.`);
    } catch (error) {
      logger.error('Error updating job statuses:', error);
      alert('Fehler beim Aktualisieren der Aufträge.');
    } finally {
      setIsBulkOperation(false);
    }
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
          
          const fileName = `Auftrag_${job.jobNumber || job.id}_${job.customerName || customer.name}.pdf`;
          downloadBlob(pdfBlob, fileName);
          
          // Add delay between downloads to prevent browser issues
          if (selectedJobIds.indexOf(jobId) < selectedJobIds.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }
      setSelectedJobIds([]);
      alert(`${selectedJobIds.length} Auftrag/Aufträge erfolgreich heruntergeladen.`);
    } catch (error) {
      logger.error('Error downloading jobs:', error);
      alert('Fehler beim Herunterladen der Aufträge.');
    } finally {
      setIsBulkOperation(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedJobIds.length === 0) return;
    
    setConfirmModal({
      isOpen: true,
      title: 'Aufträge löschen',
      message: `Sind Sie sicher, dass Sie ${selectedJobIds.length} Auftrag/Aufträge löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.`,
      onConfirm: async () => {
        setIsBulkOperation(true);
        try {
          for (const jobId of selectedJobIds) {
            await deleteJobEntry(jobId);
          }
          setSelectedJobIds([]);
          alert(`${selectedJobIds.length} Auftrag/Aufträge erfolgreich gelöscht.`);
        } catch (error) {
          logger.error('Error deleting jobs:', error);
          alert('Fehler beim Löschen der Aufträge.');
        } finally {
          setIsBulkOperation(false);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
      },
      isDestructive: true
    });
  };

  // Get only completed jobs for selection
  const completedJobIds = filteredJobs.filter(job => job.status === 'completed').map(job => job.id);
  const selectedCompletedJobs = selectedJobIds.filter(jobId => completedJobIds.includes(jobId));

  const handleExportJobPDF = async (job: JobEntry) => {
    try {
      const customer = customers.find(c => c.id === job.customerId);
      if (!customer || !company) {
        alert('Kunden- oder Firmendaten nicht gefunden');
        return;
      }

      const pdfBlob = await generateJobPDF(job, {
        company,
        customer
      });

      const filename = `Auftrag_${job.title.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date(job.date).toLocaleDateString('de-DE').replace(/\./g, '-')}.pdf`;
      downloadBlob(pdfBlob, filename);
    } catch (error) {
      logger.error('Fehler beim Erstellen der Auftrags-PDF:', error);
      alert('Fehler beim Erstellen der PDF. Bitte versuchen Sie es erneut.');
    }
  };

  const handlePreview = (job: JobEntry) => {
    // Create preview documents for the job
    const documents = createJobAttachmentPreviewDocuments(job);
    
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

  const handleSignature = (job: JobEntry) => {
    // Check if job is already completed or invoiced
    if (job.status === 'completed' || job.status === 'invoiced') {
      alert('Dieser Auftrag ist bereits abgeschlossen oder abgerechnet.');
      return;
    }
    
    setSigningJob(job);
    setShowSignaturePad(true);
  };

  const handleSignatureSave = async (signatureData: string, customerName: string) => {
    if (!signingJob) {
      alert('Fehler: Kein Auftrag zum Signieren gefunden.');
      return;
    }
    
    try {
      await addJobSignature(signingJob.id, signatureData, customerName);
      setShowSignaturePad(false);
      setSigningJob(null);
    } catch (error) {
      logger.error('JobManagement: Error adding signature:', error);
      alert('Fehler beim Speichern der Unterschrift. Bitte versuchen Sie es erneut.');
    }
  };

  const handleSignatureClose = () => {
    setShowSignaturePad(false);
    setSigningJob(null);
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
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <PageHeader icon={Briefcase} title="Auftragsmanagement">
        
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          {selectedJobIds.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-2">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center">
                  <CheckCircle className="h-4 w-4 text-blue-600 mr-2" />
                  <span className="text-sm text-blue-800 font-medium">
                    {selectedJobIds.length} Auftrag{selectedJobIds.length > 1 ? 'e' : ''} ausgewählt
                    {selectedJobIds.length > 0 && (
                      <span className="ml-1 text-xs">
                        ({selectedJobIds.filter(jobId => {
                          const job = jobEntries.find((j: JobEntry) => j.id === jobId);
                          return job && job.status === 'completed';
                        }).length} abgeschlossen)
                      </span>
                    )}
                  </span>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-2">
                  {/* Bulk Status Change */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-blue-800">Status ändern:</span>
                    <select
                      onChange={(e) => {
                        if (e.target.value) {
                          handleBulkStatusChange(e.target.value as JobEntry['status']);
                          e.target.value = '';
                        }
                      }}
                      disabled={isBulkOperation}
                      className="text-xs px-2 py-1 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500"
                      defaultValue=""
                    >
                      <option value="">Wählen...</option>
                      <option value="pending">Ausstehend</option>
                      <option value="in-progress">In Bearbeitung</option>
                      <option value="completed">Abgeschlossen</option>
                      <option value="invoiced">Abgerechnet</option>
                    </select>
                  </div>

                  {/* Bulk Invoice Generation */}
                  <button
                    onClick={handleBulkInvoiceGeneration}
                    disabled={isBulkOperation || selectedJobIds.filter(jobId => {
                      const job = jobEntries.find((j: JobEntry) => j.id === jobId);
                      return job && job.status === 'completed';
                    }).length === 0}
                    className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 transition-colors flex items-center text-sm disabled:bg-gray-400"
                  >
                    <FileText className="h-4 w-4 mr-1" />
                    Rechnung erstellen
                  </button>

                  {/* Bulk Download */}
                  <button
                    onClick={handleBulkDownload}
                    disabled={isBulkOperation}
                    className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 transition-colors flex items-center text-sm disabled:bg-gray-400"
                  >
                    <Download className="h-4 w-4 mr-1" />
                    PDF herunterladen
                  </button>

                  {/* Bulk Delete */}
                  <button
                    onClick={handleBulkDelete}
                    disabled={isBulkOperation}
                    className="bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 transition-colors flex items-center text-sm disabled:bg-gray-400"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Löschen
                  </button>

                  {/* Clear Selection */}
                  <button
                    onClick={() => setSelectedJobIds([])}
                    className="bg-gray-200 text-gray-700 px-3 py-1 rounded hover:bg-gray-300 transition-colors text-sm"
                  >
                    Auswahl aufheben
                  </button>
                </div>
              </div>
              
              <p className="text-xs text-blue-600 mt-2">
                <strong>Hinweis:</strong> Alle Aufträge können ausgewählt werden, aber nur abgeschlossene Aufträge können abgerechnet werden.
              </p>
            </div>
          )}
          
          <button
            onClick={() => setShowForm(true)}
            className="bg-primary-custom text-white px-3 lg:px-4 py-2 rounded-xl hover:bg-primary-custom/90 transition-all duration-300 hover:scale-105 flex items-center text-sm lg:text-base"
          >
            <Plus className="h-4 w-4 mr-2" />
            Neuer Auftrag
          </button>
        </div>
        </PageHeader>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 lg:gap-4">
        <button 
          onClick={() => setStatusFilter('not-invoiced')}
          className="bg-white p-3 lg:p-4 rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:bg-gray-50 transition-all duration-300 hover:scale-105 text-left cursor-pointer"
        >
          <div className="flex items-center">
            <Timer className="h-6 w-6 lg:h-8 lg:w-8 text-blue-600 mr-2 lg:mr-3" />
            <div>
              <p className="text-xs lg:text-sm font-medium text-gray-600">Nicht abgerechnet</p>
              <p className="text-lg lg:text-2xl font-bold text-gray-900">{stats.notInvoicedJobs}</p>
            </div>
          </div>
        </button>

        <button 
          onClick={() => setStatusFilter('all')}
          className="bg-white p-3 lg:p-4 rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:bg-gray-50 transition-all duration-300 hover:scale-105 text-left cursor-pointer"
        >
          <div className="flex items-center">
            <Briefcase className="h-6 w-6 lg:h-8 lg:w-8 text-gray-600 mr-2 lg:mr-3" />
            <div>
              <p className="text-xs lg:text-sm font-medium text-gray-600">Gesamt</p>
              <p className="text-lg lg:text-2xl font-bold text-gray-900">{stats.totalJobs}</p>
            </div>
          </div>
        </button>

        <button 
          onClick={() => setStatusFilter('in-progress')}
          className="bg-white p-3 lg:p-4 rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:bg-gray-50 transition-all duration-300 hover:scale-105 text-left cursor-pointer"
        >
          <div className="flex items-center">
            <Timer className="h-6 w-6 lg:h-8 lg:w-8 text-yellow-600 mr-2 lg:mr-3" />
            <div>
              <p className="text-xs lg:text-sm font-medium text-gray-600">In Bearbeitung</p>
              <p className="text-lg lg:text-2xl font-bold text-gray-900">{stats.inProgressJobs}</p>
            </div>
          </div>
        </button>

        <button 
          onClick={() => setStatusFilter('completed')}
          className="bg-white p-3 lg:p-4 rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:bg-gray-50 transition-all duration-300 hover:scale-105 text-left cursor-pointer"
        >
          <div className="flex items-center">
            <CheckCircle className="h-6 w-6 lg:h-8 lg:w-8 text-green-600 mr-2 lg:mr-3" />
            <div>
              <p className="text-xs lg:text-sm font-medium text-gray-600">Abgeschlossen</p>
              <p className="text-lg lg:text-2xl font-bold text-gray-900">{stats.completedJobs}</p>
            </div>
          </div>
        </button>

        <div className="bg-white p-3 lg:p-4 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center">
            <Clock className="h-6 w-6 lg:h-8 lg:w-8 text-purple-600 mr-2 lg:mr-3" />
            <div>
              <p className="text-xs lg:text-sm font-medium text-gray-600">Stunden</p>
              <p className="text-lg lg:text-2xl font-bold text-gray-900">{stats.totalHours.toFixed(1)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 lg:p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <input
                type="text"
                placeholder="Auftrag suchen..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent text-sm lg:text-base"
              />
            </div>
          </div>

          {/* Filters Row */}
          <div className="flex flex-col sm:flex-row gap-2 lg:gap-4">
            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent text-sm lg:text-base"
            >
              <option value="all">Alle Status</option>
              <option value="not-invoiced">Alle außer abgerechnet</option>
              <option value="draft">Entwurf</option>
              <option value="in-progress">In Bearbeitung</option>
              <option value="completed">Abgeschlossen</option>
              <option value="invoiced">Abgerechnet</option>
            </select>

            {/* Customer Filter */}
            <select
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent text-sm lg:text-base"
            >
              <option value="all">Alle Kunden</option>
              {customers.map(customer => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>

            {/* Date Filter */}
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent text-sm lg:text-base"
            >
              <option value="all">Alle Zeiträume</option>
              <option value="today">Heute</option>
              <option value="week">Diese Woche</option>
              <option value="month">Dieser Monat</option>
            </select>
          </div>
        </div>
      </div>

      {/* Jobs List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        {/* Info box wenn es nicht-abgeschlossene Aufträge gibt (ohne bereits abgerechnete) */}
        {filteredJobs.some((job: JobEntry) => job.status !== 'completed' && job.status !== 'invoiced') && filteredJobs.length > 0 && (
          <div className="bg-yellow-50 border-b border-yellow-200 p-4">
            <div className="flex items-start space-x-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="text-sm font-medium text-yellow-900">Hinweis zur Rechnungserstellung</h4>
                <p className="text-sm text-yellow-800 mt-1">
                  Sie haben {filteredJobs.filter((job: JobEntry) => job.status !== 'completed' && job.status !== 'invoiced').length} Auftrag(e), 
                  die noch nicht als "Abgeschlossen" markiert sind. Nur abgeschlossene Aufträge können für die 
                  Rechnungserstellung ausgewählt werden.
                </p>
              </div>
            </div>
          </div>
        )}
        
        {filteredJobs.length === 0 ? (
          <div className="p-8 lg:p-12 text-center">
            <Briefcase className="h-12 w-12 lg:h-16 lg:w-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg lg:text-xl font-medium text-gray-900 mb-2">Keine Aufträge gefunden</h3>
            <p className="text-gray-500 mb-6">
              {searchTerm || statusFilter !== 'all' || customerFilter !== 'all' || dateFilter !== 'all'
                ? 'Versuchen Sie andere Filter oder erstellen Sie einen neuen Auftrag.'
                : 'Erstellen Sie Ihren ersten Auftrag, um loszulegen.'}
            </p>
            
            {/* Info box für neue Benutzer */}
            {jobEntries.length === 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 text-left max-w-md mx-auto">
                <h4 className="text-sm font-medium text-blue-900 mb-2">So funktioniert die Rechnungserstellung:</h4>
                <ol className="text-sm text-blue-800 space-y-1">
                  <li>1. Aufträge erstellen und Arbeitszeit erfassen</li>
                  <li>2. Aufträge als "Abgeschlossen" markieren</li>
                  <li>3. Abgeschlossene Aufträge auswählen</li>
                  <li>4. "Rechnung erstellen" klicken</li>
                  <li>5. Rechnungsart wählen (Einzel/Tages/Monatsrechnung)</li>
                </ol>
              </div>
            )}
            
            <button
              onClick={() => setShowForm(true)}
              className="bg-primary-custom text-white px-4 lg:px-6 py-2 lg:py-3 rounded-xl hover:bg-primary-custom/90 transition-all duration-300 hover:scale-105"
            >
              Ersten Auftrag erstellen
            </button>
          </div>
        ) : (
          <>
            {/* Mobile View */}
            <div className="block lg:hidden">
              <div className="p-4 border-b bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">                        <input
                          type="checkbox"
                          onChange={(e) => handleSelectAllJobs(e.target.checked)}
                          checked={
                            filteredJobs.length > 0 &&
                            filteredJobs.every((job: JobEntry) => selectedJobIds.includes(job.id))
                          }
                          className="custom-checkbox"
                          title="Alle Aufträge auswählen"
                        />
                    <span className="ml-2 text-sm text-gray-600">Alle auswählen</span>
                  </div>
                  <span className="text-xs text-gray-500">
                    {filteredJobs.filter((job: JobEntry) => job.status === 'completed').length} abgeschlossen
                  </span>
                </div>
              </div>
              
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
                          title="Auftrag auswählen"
                        />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-sm font-medium text-gray-900 truncate flex items-center">
                            {job.priority && (
                              <AlertTriangle className={`h-4 w-4 mr-1 flex-shrink-0 ${getPriorityColor(job.priority)}`} />
                            )}
                            {job.title}
                          </h3>
                          <div className="flex items-center space-x-1 ml-2">
                            <button
                              onClick={() => handleExportJobPDF(job)}
                              className="text-blue-600 hover:text-blue-900 p-1"
                              title="PDF exportieren"
                            >
                              <Download className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handlePreview(job)}
                              className="text-green-600 hover:text-green-900 p-1"
                              title="Dokumente anzeigen"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            {!job.signature && job.status !== 'completed' && job.status !== 'invoiced' && (
                              <button
                                onClick={() => handleSignature(job)}
                                className="text-purple-600 hover:text-purple-900 p-1"
                                title="Unterschrift hinzufügen"
                              >
                                <PenTool className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleEdit(job)}
                              className="p-1 text-indigo-600 hover:text-indigo-900"
                              title={job.status === 'invoiced' ? 'Bearbeiten (GoBD-Warnung wird angezeigt)' : 'Bearbeiten'}
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(job)}
                              className="p-1 text-red-600 hover:text-red-900"
                              title={job.status === 'invoiced' ? 'Löschen (GoBD-Warnung wird angezeigt)' : 'Löschen'}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        
                        <p className="text-sm text-gray-500 mb-3 line-clamp-2">
                          {job.description}
                        </p>
                        
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div className="flex items-center">
                            <span className="text-gray-500 mr-2">Nr:</span>
                            <span className="text-gray-900 font-medium">{job.jobNumber}</span>
                          </div>
                          
                          <div className="flex items-center">
                            <span className="text-gray-500 mr-2">Ext:</span>
                            <span className="text-gray-900">{job.externalJobNumber || '-'}</span>
                          </div>
                          
                          <div className="flex items-center">
                            <User className="h-4 w-4 text-gray-400 mr-1 flex-shrink-0" />
                            <span className="text-gray-900 truncate">{job.customerName}</span>
                          </div>
                          
                          <div className="flex items-center">
                            <Calendar className="h-4 w-4 text-gray-400 mr-1 flex-shrink-0" />
                            <span className="text-gray-900">{new Date(job.date).toLocaleDateString(locale)}</span>
                          </div>
                          
                          <div className="flex items-center col-span-2">
                            <Clock className="h-4 w-4 text-gray-400 mr-1 flex-shrink-0" />
                            <span className="text-gray-900">{calculateTotalHours(job).toFixed(1)}h</span>
                          </div>
                        </div>
                        
                        <div className="mt-3">
                          <select
                            value={job.status}
                            onChange={(e) => handleStatusChange(job.id, e.target.value as JobEntry['status'])}
                            disabled={job.status === 'invoiced'}
                            className={`text-xs font-semibold rounded-full px-3 py-1 border-0 ${getStatusColor(job.status)} focus:ring-2 focus:ring-primary-custom w-auto ${
                              job.status === 'invoiced' ? 'cursor-not-allowed opacity-75' : ''
                            }`}
                            title={job.status === 'invoiced' ? 'Status von abgerechneten Aufträgen kann nicht geändert werden' : ''}
                          >
                            <option value="draft">Entwurf</option>
                            <option value="in-progress">In Bearbeitung</option>
                            <option value="completed">Abgeschlossen</option>
                            <option value="invoiced">Abgerechnet</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Desktop Table View */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full min-w-[980px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-3 text-left w-12">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          onChange={(e) => handleSelectAllJobs(e.target.checked)}
                          checked={
                            filteredJobs.length > 0 &&
                            filteredJobs.every((job: JobEntry) => selectedJobIds.includes(job.id))
                          }
                          className="custom-checkbox"
                          title="Alle Aufträge auswählen"
                        />
                      </div>
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                      Nr.
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                      Ext.
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Auftrag
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                      Kunde
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                      Datum
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-28">
                      Status
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                      Std.
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                      Aktionen
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredJobs.map((job) => (
                    <tr key={job.id} className="hover:bg-gray-50">
                      <td className="px-2 py-4 w-12">
                        <div className="flex items-center">
                          <input
                            type="checkbox"
                            checked={selectedJobIds.includes(job.id)}
                            onChange={(e) => handleJobSelection(job.id, e.target.checked)}
                            className="custom-checkbox cursor-pointer"
                            title="Auftrag auswählen"
                          />
                          {job.status !== 'completed' && job.status !== 'invoiced' && (
                            <span className="ml-1 text-xs text-gray-400" title="Auftrag noch nicht abgeschlossen">
                              ⚠️
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-4 w-24">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {job.jobNumber}
                        </div>
                      </td>
                      <td className="px-3 py-4 w-20">
                        <div className="text-sm text-gray-600 truncate">
                          {job.externalJobNumber || '-'}
                        </div>
                      </td>
                      <td className="px-3 py-4">
                        <div>
                          <div className="text-sm font-medium text-gray-900 flex items-center">
                            {job.priority && (
                              <AlertTriangle className={`h-4 w-4 mr-2 flex-shrink-0 ${getPriorityColor(job.priority)}`} />
                            )}
                            <span className="truncate">{job.title}</span>
                          </div>
                          <div className="text-sm text-gray-500 truncate max-w-xs">
                            {job.description}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-4 w-32">
                        <div className="flex items-center">
                          <User className="h-4 w-4 text-gray-400 mr-2 flex-shrink-0" />
                          <span className="text-sm text-gray-900 truncate">{job.customerName}</span>
                        </div>
                      </td>
                      <td className="px-3 py-4 w-24">
                        <div className="flex items-center">
                          <Calendar className="h-4 w-4 text-gray-400 mr-2 flex-shrink-0" />
                          <span className="text-sm text-gray-900 whitespace-nowrap">{new Date(job.date).toLocaleDateString(locale)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-4 w-28">
                        <select
                          value={job.status}
                          onChange={(e) => handleStatusChange(job.id, e.target.value as JobEntry['status'])}
                          disabled={job.status === 'invoiced'}
                          className={`text-xs font-semibold rounded-full px-2 py-1 border-0 ${getStatusColor(job.status)} focus:ring-2 focus:ring-primary-custom ${
                            job.status === 'invoiced' ? 'cursor-not-allowed opacity-75' : ''
                          }`}
                          title={job.status === 'invoiced' ? 'Status von abgerechneten Aufträgen kann nicht geändert werden' : ''}
                        >
                          <option value="draft">Entwurf</option>
                          <option value="in-progress">In Bearbeitung</option>
                          <option value="completed">Abgeschlossen</option>
                          <option value="invoiced">Abgerechnet</option>
                        </select>
                      </td>
                      <td className="px-3 py-4 w-20">
                        <div className="flex items-center">
                          <Clock className="h-4 w-4 text-gray-400 mr-2 flex-shrink-0" />
                          <span className="text-sm text-gray-900">{calculateTotalHours(job).toFixed(1)}h</span>
                        </div>
                      </td>
                      <td className="px-3 py-4 text-right w-24">
                        <div className="flex justify-end space-x-1">
                          <button
                            onClick={() => handleExportJobPDF(job)}
                            className="text-blue-600 hover:text-blue-900 p-1"
                            title="PDF exportieren"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handlePreview(job)}
                            className="text-green-600 hover:text-green-900 p-1"
                            title="Dokumente anzeigen"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {!job.signature && job.status !== 'completed' && job.status !== 'invoiced' && (
                            <button
                              onClick={() => handleSignature(job)}
                              className="text-purple-600 hover:text-purple-900 p-1"
                              title="Unterschrift hinzufügen"
                            >
                              <PenTool className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleEdit(job)}
                            className="p-1 text-indigo-600 hover:text-indigo-900"
                            title={job.status === 'invoiced' ? 'Bearbeiten (GoBD-Warnung wird angezeigt)' : 'Bearbeiten'}
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(job)}
                            className="p-1 text-red-600 hover:text-red-900"
                            title={job.status === 'invoiced' ? 'Löschen (GoBD-Warnung wird angezeigt)' : 'Löschen'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Confirmation Modal */}
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
              Neuer Kunde
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
                  Kunde erstellen
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
      
      {/* Signature Pad Modal */}
      <SignaturePad
        isOpen={showSignaturePad}
        onClose={handleSignatureClose}
        onSave={handleSignatureSave}
        title="Kundenunterschrift"
        initialCustomerName={signingJob?.customerName || ''}
      />

      {/* Document Preview Modal */}
      <DocumentPreview
        isOpen={documentPreview.isOpen}
        onClose={handleClosePreview}
        documents={documentPreview.documents}
        initialIndex={documentPreview.initialIndex}
      />
    </div>
  );
}
