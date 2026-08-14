import React, { useState, useEffect } from 'react';
import logger from '../utils/logger';
import { Plus, Trash2, Save, Clock, Calendar, DollarSign, Edit, Info, LockKeyhole, ChevronDown } from 'lucide-react';
import { JobEntry, Customer, JobMaterial, JobAttachment, JobTimeEntry, CalendarEvent, JobRecurrenceRule } from '../types';
import { useCustomers } from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
import { useDocumentHelpers } from '../hooks/useDocumentHelpers';
import { AttachmentManager } from './AttachmentManager';
import { DocumentPreview } from './DocumentPreview';
import type { PreviewDocument } from '../utils/previewDocuments';
import { RatesAndMaterialsRedirectModal } from './RatesAndMaterialsRedirectModal';
import { ConfirmationModal } from './ConfirmationModal';
import { createDefaultTimeEntry } from '../utils/jobUtils';
import { findDuplicateCustomer, buildDuplicateCustomerMessage, formatCustomerNumber } from '../utils/customerUtils';
import { formatCurrency, formatNumber, getCurrencySymbol } from '../utils/formatters';
import { LocalizedNumberInput } from './LocalizedNumberInput';
import { LocalizedDateInput } from './LocalizedDateInput';
import { LocalizedTimeInput } from './LocalizedTimeInput';
import { getTerminology } from '../utils/terminology';
import { getIsoWeekday, getJobRecurrenceDates, getRecurrenceWeekdayLabel, RECURRENCE_WEEKDAYS } from '../utils/jobRecurrence';
import { DialogShell } from './DialogShell';
import { DEFAULT_TIME_ZONE, TIME_ZONE_OPTIONS } from '../utils/timeZones';
import { useFeedback } from '../context/FeedbackContext';

interface JobEntryFormProps {
  job?: JobEntry | null;
  customers: Customer[];
  defaultDate?: Date | null;
  onSubmit: (jobData: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>) => void | boolean | Promise<void | boolean>;
  onCancel: () => void;
  onCreateCustomer?: () => void;
  onSubmitVacation?: (event: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>) => void | Promise<void>;
  onNavigateToCustomers?: () => void;
  onNavigateToSettings?: () => void;
}

type RecurrenceIntervalUnit = JobRecurrenceRule['intervalUnit'];

function TaxDisabledHint() {
  return (
    <span
      className="group relative inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full text-gray-500 outline-none hover:text-primary-custom focus:text-primary-custom"
      tabIndex={0}
      role="img"
      aria-label="MwSt. durch Kleinunternehmerregelung deaktiviert"
      title="MwSt. durch Kleinunternehmerregelung deaktiviert"
    >
      <Info className="h-3.5 w-3.5" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-normal text-white shadow-lg group-hover:block group-focus:block">
        MwSt. durch Kleinunternehmerregelung deaktiviert
      </span>
    </span>
  );
}

function AutomaticNumberHint() {
  return (
    <span
      className="group relative inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full text-gray-400 outline-none hover:text-primary-custom focus:text-primary-custom"
      tabIndex={0}
      role="img"
      aria-label="Wird automatisch vergeben und kann nicht geändert werden"
    >
      <Info className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-normal text-white shadow-lg group-hover:block group-focus:block">
        Wird automatisch vergeben und kann nicht geändert werden
      </span>
    </span>
  );
}

interface SelectWithChevronProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  containerClassName?: string;
}

function SelectWithChevron({ className = '', containerClassName = '', children, ...props }: SelectWithChevronProps) {
  return (
    <div className={`group relative isolate block w-full min-w-0 max-w-full ${containerClassName}`}>
      <select
        {...props}
        className={`select-with-chevron box-border block w-full min-w-0 max-w-full appearance-none !pr-10 ${className}`}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 transition-transform duration-200 group-focus-within:rotate-180"
        aria-hidden="true"
      />
    </div>
  );
}

export function JobEntryForm({ job, customers, defaultDate, onSubmit, onCancel, onCreateCustomer, onSubmitVacation, onNavigateToCustomers, onNavigateToSettings }: JobEntryFormProps) {
  const { notify } = useFeedback();
  const { addCustomer, refreshCustomers } = useCustomers();
  const { company, hourlyRates } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);
  const workspaceTimeZone = company.timeZone || DEFAULT_TIME_ZONE;
  const currencySymbol = getCurrencySymbol(company.locale, company.numberFormat, company.currency);
  const formatMoney = (amount: number) => formatCurrency(
    amount,
    company.locale,
    company.numberFormat,
    company.currency
  );

  const sectionSelectClass = 'box-border h-[36px] min-h-[36px] max-h-[36px] w-full rounded-lg border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-custom';
  const sectionIconButtonClass = 'theme-control-button box-border inline-flex h-[36px] min-h-[36px] max-h-[36px] w-[36px] shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 transition-colors hover:border-primary-custom hover:bg-primary-custom/10 hover:text-primary-custom';
  const sectionActionButtonClass = 'btn-primary box-border inline-flex h-[36px] min-h-[36px] max-h-[36px] w-[36px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-0 text-xs transition-colors sm:w-auto sm:px-3 sm:text-sm';

  const { getHourlyRatesForCustomer, getCombinedHourlyRatesForCustomer, getCombinedMaterialTemplatesForCustomer } = useDocumentHelpers();


  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [entryType, setEntryType] = useState<'job' | 'vacation'>('job');
  const [vacationForm, setVacationForm] = useState({
    title: 'Urlaub',
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    notes: '',
  });

  const [showRatesRedirectModal, setShowRatesRedirectModal] = useState<{
    isOpen: boolean;
    type: 'hourlyRates' | 'materials';
  }>({
    isOpen: false,
    type: 'hourlyRates'
  });
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [pendingRateNavigation, setPendingRateNavigation] = useState<'customers' | 'settings' | null>(null);
  const [isSavingBeforeNavigation, setIsSavingBeforeNavigation] = useState(false);

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

  // Customer search states
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);
  
  // We'll define these helper functions after formData is available
  

  
  const [formData, setFormData] = useState<Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>>({
    jobNumber: '', // Will be auto-generated
    externalJobNumber: '',
    customerId: '',
    customerName: '',
    customerAddress: '',
    location: '',
    timeZone: DEFAULT_TIME_ZONE,
    title: '',
    description: '',
    date: new Date(),
    startTime: '',
    endTime: '',
    hoursWorked: 0,
    hourlyRate: 0,
    hourlyRateId: '',
    timeEntries: [],
    materials: [],
    status: 'draft', // Standard-Status ist "Entwurf"
    notes: '',
    attachments: [],
  });
  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceIntervalUnit, setRecurrenceIntervalUnit] = useState<RecurrenceIntervalUnit>('week');
  const [recurrenceDurationCount, setRecurrenceDurationCount] = useState(1);
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState<number[]>([getIsoWeekday(new Date())]);
  const [recurrenceStartDate, setRecurrenceStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [isDirty, setIsDirty] = useState(false);
  const [formError, setFormError] = useState('');
  
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

  useEffect(() => {
    if (job) {
      const existingRecurrence = job.recurrence;
      const jobDate = typeof job.date === 'string' ? new Date(job.date) : job.date;
      setFormData({
        jobNumber: job.jobNumber,
        externalJobNumber: job.externalJobNumber || '',
        customerId: job.customerId || '',
        customerName: job.customerName || '',
        customerAddress: job.customerAddress || '',
        location: job.location === 'Online' ? 'Online' : 'Vor Ort',
        timeZone: job.timeZone || workspaceTimeZone,
        title: job.title || '',
        description: job.description || '',
        date: jobDate,
        startTime: job.startTime || '',
        endTime: job.endTime || '',
        hoursWorked: job.hoursWorked,
        hourlyRate: job.hourlyRate,
        hourlyRateId: job.hourlyRateId || '',
        timeEntries: job.timeEntries || [],
        materials: job.materials || [],
        status: job.status,
        notes: job.notes || '',
        attachments: job.attachments || [],
        recurrence: existingRecurrence,
      });
      setRecurrenceEnabled(Boolean(existingRecurrence));
      setRecurrenceInterval(existingRecurrence?.interval || 1);
      setRecurrenceIntervalUnit(existingRecurrence?.intervalUnit || 'week');
      const existingStartDate = existingRecurrence?.startDate || formatDateForInput(jobDate);
      const startWeekday = getIsoWeekday(existingStartDate);
      setRecurrenceDurationCount(existingRecurrence?.duration ?? existingRecurrence?.durationWeeks ?? 1);
      setRecurrenceWeekdays([...new Set([...(existingRecurrence?.weekdays || []), startWeekday])]);
      setRecurrenceStartDate(existingStartDate);
    } else {
      // Für neue Aufträge: keine Standard-Zeiteinträge, Nutzer muss explizit hinzufügen
      // Note: For new jobs, we can't use customer-specific rates yet since customer isn't selected
      const defaultRate = hourlyRates.find(rate => rate.isDefault);
      const initialDate = defaultDate || new Date();
      const initialFormData: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'> = {
        jobNumber: '', // Will be auto-generated
        externalJobNumber: '',
        customerId: '',
        customerName: '',
        customerAddress: '',
        location: 'Vor Ort',
        timeZone: workspaceTimeZone,
        title: '',
        description: '',
        date: initialDate,
        startTime: '',
        endTime: '',
        hoursWorked: 0,
        hourlyRate: 0,
        hourlyRateId: '',
        timeEntries: [],
        materials: [],
        status: 'draft', // Standard-Status ist "Entwurf"
        notes: '',
        attachments: [],
      };
      
      if (defaultRate) {
        initialFormData.hourlyRateId = defaultRate.id;
        initialFormData.hourlyRate = defaultRate.rate;
      }
      
      setFormData(initialFormData);
      setRecurrenceEnabled(false);
      setRecurrenceInterval(1);
      setRecurrenceIntervalUnit('week');
      setRecurrenceDurationCount(1);
      setRecurrenceWeekdays([getIsoWeekday(initialDate)]);
      const initialDateValue = formatDateForInput(initialDate);
      setRecurrenceStartDate(initialDateValue);
      setVacationForm((previous) => ({ ...previous, startDate: initialDateValue, endDate: initialDateValue }));
    }
    setIsDirty(false);
    setFormError('');
    setEntryType('job');
  }, [job, hourlyRates, defaultDate, workspaceTimeZone]);

  // Filter customers based on search term
  const filteredCustomers = customers.filter(customer =>
    customer.name.toLowerCase().includes(customerSearchTerm.toLowerCase()) ||
    (customer.customerNumber && customer.customerNumber.toLowerCase().includes(customerSearchTerm.toLowerCase()))
  );
  
  // Get selected customer display name
  const selectedCustomer = customers.find(customer => customer.id === formData.customerId);
  const selectedCustomerDisplayName = selectedCustomer ? selectedCustomer.name : '';
    
  // Handle customer selection
  const handleCustomerSelectDropdown = (customer: Customer) => {
    handleCustomerChange(customer.id);
    setCustomerSearchTerm(customer.name);
    setIsCustomerDropdownOpen(false);
  };
  
  // Handle customer search input
  const handleCustomerSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomerSearchTerm(e.target.value);
    setIsCustomerDropdownOpen(true);
    
    // If search is cleared, clear the selected customer
    if (!e.target.value) {
      handleCustomerChange('');
    }
  };
  
  // Initialize search term when job is loaded
  useEffect(() => {
    if (formData.customerId && !customerSearchTerm) {
      setCustomerSearchTerm(selectedCustomerDisplayName);
    }
  }, [formData.customerId, selectedCustomerDisplayName, customerSearchTerm]);

  const handleCustomerChange = (customerId: string) => {
    const customer = customers.find(c => c.id === customerId);
    setIsDirty(true);
    setFormData((prev) => ({
      ...prev,
      customerId,
      customerName: customer?.name || ''
    }));
  };

  const addTimeEntry = () => {
    const availableRates = getHourlyRatesForCustomer(formData.customerId);
    const defaultRate = availableRates.find((rate) => rate.isDefault);
    const newTimeEntry = createDefaultTimeEntry(
      defaultRate ? defaultRate.rate : 0,
      defaultRate ? defaultRate.id : '',
      defaultRate?.taxRate != null ? defaultRate.taxRate : 19 // Use hourly rate tax rate or default to 19%
    );
    
    setIsDirty(true);
    setFormData((prev) => ({
      ...prev,
      timeEntries: [...(prev.timeEntries || []), newTimeEntry]
    }));
  };

  const addTimeEntryFromTemplate = (hourlyRateId: string) => {
    // Search in combined templates (both general and customer-specific)
    const template = getCombinedHourlyRatesForCustomer(formData.customerId).find((rate) => rate.id === hourlyRateId);
    if (!template) return;
    
    const newTimeEntry = createDefaultTimeEntry(
      Number(template.rate || 0),
      template.id,
      template.taxRate != null ? template.taxRate : 19
    );
    
    // Set description to template name
    newTimeEntry.description = template.name;
    
    setIsDirty(true);
    setFormData((prev) => ({
      ...prev,
      timeEntries: [...(prev.timeEntries || []), newTimeEntry]
    }));
  };

  const updateTimeEntry = (index: number, field: keyof JobTimeEntry, value: string | number) => {
    setIsDirty(true);
    setFormData((prev) => {
      const timeEntries = [...(prev.timeEntries || [])];
      timeEntries[index] = { ...timeEntries[index], [field]: value };
      
      // Auto-calculate total for hoursWorked and hourlyRate changes
      if (field === 'hoursWorked' || field === 'hourlyRate') {
        const hours = Number(timeEntries[index].hoursWorked) || 0;
        const rate = Number(timeEntries[index].hourlyRate) || 0;
        timeEntries[index].total = hours * rate;
      }
      
      // Auto-calculate hours if both times are set
      if (field === 'startTime' || field === 'endTime') {
        const entry = timeEntries[index];
        if (entry.startTime && entry.endTime) {
          const start = new Date(`2000-01-01T${entry.startTime}:00`);
          const end = new Date(`2000-01-01T${entry.endTime}:00`);
          const diffMs = end.getTime() - start.getTime();
          const diffHours = diffMs / (1000 * 60 * 60);
          
          if (diffHours > 0) {
            const minutes = Math.round(diffHours * 60);
            timeEntries[index].hoursWorked = Math.round((minutes / 60) * 100) / 100;
            const hours = Number(timeEntries[index].hoursWorked) || 0;
            const rate = Number(timeEntries[index].hourlyRate) || 0;
            timeEntries[index].total = hours * rate;
          }
        }
      }
      
      // Update total hours in main job data for backward compatibility
      const totalHours = timeEntries.reduce((sum, entry) => sum + (Number(entry.hoursWorked) || 0), 0);
      
      return { 
        ...prev, 
        timeEntries,
        hoursWorked: totalHours
      };
    });
  };

  const removeTimeEntry = (index: number) => {
    setIsDirty(true);
    setFormData((prev) => {
      const timeEntries = (prev.timeEntries || []).filter((_, i) => i !== index);
      const totalHours = timeEntries.reduce((sum, entry) => sum + (Number(entry.hoursWorked) || 0), 0);
      
      return { 
        ...prev, 
        timeEntries,
        hoursWorked: totalHours
      };
    });
  };



  const handleTimeChange = (field: 'startTime' | 'endTime', value: string) => {
    setIsDirty(true);
    setFormData((prev) => {
      const updated = { ...prev, [field]: value };
      
      // Auto-calculate hours if both times are set
      if (updated.startTime && updated.endTime) {
        const start = new Date(`2000-01-01T${updated.startTime}:00`);
        const end = new Date(`2000-01-01T${updated.endTime}:00`);
        const diffMs = end.getTime() - start.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);
        
        if (diffHours > 0) {
          // Round to nearest minute (1/60 hour = 0.0167 hours) and format to 2 decimal places
          const minutes = Math.round(diffHours * 60);
          updated.hoursWorked = Math.round((minutes / 60) * 100) / 100;
        }
      }
      
      return updated;
    });
  };

  const addMaterial = (templateId?: string) => {
    setIsDirty(true);
    let newMaterial: JobMaterial;
    
    if (templateId) {
      // Use template data - safely handle potential errors
      try {
        const templates = getCombinedMaterialTemplatesForCustomer(formData.customerId) || [];
        const template = templates.find((t) => t.id === templateId);
        
        if (template) {
          // Ensure unitPrice is a number - handle both string and number formats
          const unitPrice = typeof template.unitPrice === 'string' 
            ? parseFloat(template.unitPrice) 
            : Number(template.unitPrice) || 0;
          
          newMaterial = {
            id: Date.now().toString(),
            description: template.name,
            quantity: 1,
            unitPrice: unitPrice,
            taxRate: company?.isSmallBusiness ? 0 : (template.taxRate != null ? template.taxRate : 19), // Use template tax rate or default to 19%, but 0 for small business
            unit: template.unit || 'Stück',
            templateId: template.id,
            total: unitPrice * 1 // quantity * unitPrice
          };
        } else {
          // Fallback if template not found
          newMaterial = {
            id: Date.now().toString(),
            description: '',
            quantity: 1,
            unitPrice: 0,
            taxRate: company?.isSmallBusiness ? 0 : 19, // Default tax rate, but 0 for small business
            unit: 'Stück',
            total: 0
          };
        }
      } catch (error) {
        logger.error('Error loading material template:', error);
        // Fallback on error
        newMaterial = {
          id: Date.now().toString(),
          description: '',
          quantity: 1,
          unitPrice: 0,
          taxRate: company?.isSmallBusiness ? 0 : 19, // Default tax rate, but 0 for small business
          unit: 'Stück',
          total: 0
        };
      }
    } else {
      // Manual entry
      newMaterial = {
        id: Date.now().toString(),
        description: '',
        quantity: 1,
        unitPrice: 0,
        taxRate: company?.isSmallBusiness ? 0 : 19, // Default tax rate, but 0 for small business
        unit: 'Stück',
        total: 0
      };
    }
    
    setFormData(prev => ({
      ...prev,
      materials: [...(prev.materials || []), newMaterial]
    }));
  };

  const updateMaterial = (index: number, field: keyof JobMaterial, value: string | number) => {
    setIsDirty(true);
    setFormData(prev => {
      const materials = [...(prev.materials || [])];
      materials[index] = { ...materials[index], [field]: value };
      
      // Auto-calculate total for quantity and unitPrice changes
      if (field === 'quantity' || field === 'unitPrice') {
        const quantity = Number(materials[index].quantity) || 0;
        const unitPrice = Number(materials[index].unitPrice) || 0;
        materials[index].total = quantity * unitPrice;
      }
      
      return { ...prev, materials };
    });
  };

  const removeMaterial = (index: number) => {
    setIsDirty(true);
    setFormData(prev => ({
      ...prev,
      materials: prev.materials?.filter((_, i) => i !== index) || []
    }));
  };

  const handleAttachmentsChange = (attachments: JobAttachment[]) => {
    setIsDirty(true);
    setFormData(prev => ({
      ...prev,
      attachments
    }));
  };

  const handlePreview = (attachments: (JobAttachment)[], initialIndex: number) => {
    // Convert attachments to preview documents
    const documents: PreviewDocument[] = attachments.map(attachment => ({
      id: attachment.id,
      name: attachment.name,
      type: 'attachment' as const,
      content: attachment.content,
      contentType: attachment.contentType,
      size: attachment.size
    }));
    
    setDocumentPreview({
      isOpen: true,
      documents,
      initialIndex
    });
  };

  const handleClosePreview = () => {
    setDocumentPreview({
      isOpen: false,
      documents: [],
      initialIndex: 0
    });
  };

  const buildRecurrence = () => {
    if (!recurrenceEnabled) return undefined;
    const startDate = recurrenceStartDate || formatDateForInput(formData.date);
    const duration = Math.max(1, recurrenceDurationCount);
    return {
      intervalUnit: recurrenceIntervalUnit,
      interval: Math.max(1, recurrenceInterval),
      ...(recurrenceIntervalUnit === 'week' ? { weekdays: [...recurrenceWeekdays].sort((a, b) => a - b) } : {}),
      startDate,
      duration,
      ...(recurrenceIntervalUnit === 'week' ? { durationWeeks: duration } : {}),
      ...(job?.recurrence?.id ? {
        id: job.recurrence.id,
        occurrenceIndex: job.recurrence.occurrenceIndex,
        totalOccurrences: job.recurrence.totalOccurrences,
      } : {}),
    };
  };

  const getSubmitData = (statusOverride?: JobEntry['status']) => ({
    ...formData,
    ...(statusOverride ? { status: statusOverride } : {}),
    recurrence: recurrenceEnabled ? buildRecurrence() : job?.recurrence ? null : undefined,
  });

  const validateJobForm = () => {
    if (!formData.customerId || !formData.title.trim() || !formData.description.trim()) {
      setFormError('Bitte füllen Sie alle Pflichtfelder aus, bevor Sie den Eintrag weiterführen.');
      return false;
    }

    if (recurrenceEnabled && recurrenceWeekdays.length === 0) {
      setFormError('Bitte mindestens einen Wochentag für die Wiederholung wählen.');
      return false;
    }

    setFormError('');
    return true;
  };

  const getRateNavigationCallback = (target: 'customers' | 'settings') => (
    target === 'customers' ? onNavigateToCustomers : onNavigateToSettings
  );

  const requestRateNavigation = (target: 'customers' | 'settings') => {
    const navigate = getRateNavigationCallback(target);
    setShowRatesRedirectModal({ isOpen: false, type: 'hourlyRates' });

    if (!navigate) return;
    if (!isDirty) {
      navigate();
      return;
    }

    setPendingRateNavigation(target);
  };

  const discardAndNavigateToRates = () => {
    if (!pendingRateNavigation) return;
    const navigate = getRateNavigationCallback(pendingRateNavigation);
    setPendingRateNavigation(null);
    navigate?.();
  };

  const saveAndNavigateToRates = async () => {
    if (!pendingRateNavigation) return;

    const navigate = getRateNavigationCallback(pendingRateNavigation);
    if (!navigate) return;

    setIsSavingBeforeNavigation(true);
    try {
      const saved = await onSubmit(getSubmitData('draft'));
      if (saved === false) return;
      setPendingRateNavigation(null);
      navigate();
    } catch (error) {
      logger.error('Fehler beim Speichern vor dem Verlassen des Formulars:', error);
      setFormError(error instanceof Error ? error.message : 'Die Änderungen konnten nicht gespeichert werden.');
    } finally {
      setIsSavingBeforeNavigation(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Bestehende Entwürfe dürfen auch mit noch offenen Pflichtfeldern weiter
    // bearbeitet und gespeichert werden. Die Prüfung greift beim Erstellen
    // sowie beim Weiterführen in eine aktive Statusstufe.
    if (!job && !validateJobForm()) return;
    if (job && job.status !== 'draft' && !validateJobForm()) return;

    setFormError('');
    try {
      const saved = await onSubmit(getSubmitData());
      if (saved === false) setFormError('Die Änderungen konnten nicht gespeichert werden.');
    } catch (error) {
      logger.error('Fehler beim Speichern des Eintrags:', error);
      setFormError(error instanceof Error ? error.message : 'Die Änderungen konnten nicht gespeichert werden.');
    }
  };

  const handleVacationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!onSubmitVacation || !vacationForm.title.trim() || vacationForm.endDate < vacationForm.startDate) {
      notify({ variant: 'warning', message: 'Bitte geben Sie eine Bezeichnung und einen gültigen Zeitraum an.' });
      return;
    }

    try {
      await onSubmitVacation({
        eventType: 'vacation',
        title: vacationForm.title.trim(),
        startDate: vacationForm.startDate,
        endDate: vacationForm.endDate,
        notes: vacationForm.notes.trim() || undefined,
        allDay: true,
      });
      onCancel();
    } catch {
      // The parent handles and logs the API error; keep the form open for another attempt.
    }
  };

  const handleSubmitAsDraft = async (e: React.FormEvent) => {
    e.preventDefault();

    setFormError('');
    try {
      const saved = await onSubmit(getSubmitData('draft'));
      if (saved === false) setFormError('Der Entwurf konnte nicht gespeichert werden.');
    } catch (error) {
      logger.error('Fehler beim Speichern des Entwurfs:', error);
      setFormError(error instanceof Error ? error.message : 'Der Entwurf konnte nicht gespeichert werden.');
    }
  };

  const formatDateForInput = (date: Date) => {
    const localDate = new Date(date);
    const year = localDate.getFullYear();
    const month = String(localDate.getMonth() + 1).padStart(2, '0');
    const day = String(localDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const requestClose = () => {
    if (isDirty) {
      setShowDiscardModal(true);
      return;
    }
    onCancel();
  };

  const timeHoursPerUnit = (formData.timeEntries || []).reduce(
    (sum, entry) => sum + (Number(entry.hoursWorked) || 0),
    0
  );
  const timeCostPerUnit = (formData.timeEntries || []).reduce(
    (sum, entry) => sum + (Number(entry.total) || 0),
    0
  );
  const recurrenceUnitCount = recurrenceEnabled
    ? getJobRecurrenceDates({
        intervalUnit: recurrenceIntervalUnit,
        interval: recurrenceInterval,
        weekdays: recurrenceWeekdays,
        startDate: recurrenceStartDate,
        duration: recurrenceDurationCount,
      }).length
    : 1;
  const recurrenceDurationLabel = recurrenceIntervalUnit === 'week'
    ? (recurrenceDurationCount === 1 ? 'Woche' : 'Wochen')
    : recurrenceIntervalUnit === 'month'
      ? (recurrenceDurationCount === 1 ? 'Monat' : 'Monate')
      : (recurrenceDurationCount === 1 ? 'Jahr' : 'Jahre');
  const recurrenceIntervalLabel = recurrenceIntervalUnit === 'month'
    ? (recurrenceInterval === 1 ? 'Monat' : 'Monate')
    : (recurrenceInterval === 1 ? 'Jahr' : 'Jahre');
  const recurrencePreviewDescription = recurrenceIntervalUnit === 'week'
    ? `${recurrenceWeekdays.map(getRecurrenceWeekdayLabel).join(' und ')} über ${recurrenceDurationCount} ${recurrenceDurationLabel}`
    : `Alle ${recurrenceInterval} ${recurrenceIntervalLabel} über ${recurrenceDurationCount} ${recurrenceDurationLabel}`;

  const dialogFooter = entryType === 'vacation' ? (
    <>
      <button
        type="button"
        onClick={requestClose}
        className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
      >
        Abbrechen
      </button>
      <button
        type="submit"
        className="btn-primary flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white"
      >
        <Calendar className="h-4 w-4" />
        <span>Eintragen</span>
      </button>
    </>
  ) : (
    <>
      <button
        type="button"
        onClick={requestClose}
        className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
      >
        Abbrechen
      </button>
      {!job && (
        <button
          type="button"
          onClick={handleSubmitAsDraft}
          className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <Save className="h-4 w-4" />
          <span>Als Entwurf speichern</span>
        </button>
      )}
      <button
        type="submit"
        className="btn-primary flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white"
      >
        <Save className="h-4 w-4" />
        <span>{job ? 'Aktualisieren' : 'Erstellen'}</span>
      </button>
    </>
  );

  return (
    <>
      <DialogShell
        titleId="job-entry-dialog-title"
        icon={Calendar}
        title={job ? terminology.work.editLabel : entryType === 'vacation' ? 'Neuer Urlaubseintrag' : terminology.work.newLabel}
        description={entryType === 'vacation' ? 'Erfassen Sie den Zeitraum als Abwesenheit im Kalender.' : 'Erfassen und verwalten Sie Leistungen, Zeiten, Materialien und Anhänge.'}
        onClose={requestClose}
        onSubmit={entryType === 'vacation' ? handleVacationSubmit : handleSubmit}
        onChange={() => {
          setIsDirty(true);
          setFormError('');
        }}
        headerActions={!job && onSubmitVacation ? (
          <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            <button
              type="button"
              onClick={() => setEntryType('job')}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors sm:text-sm ${entryType === 'job' ? 'bg-primary-custom font-medium text-white shadow-sm' : 'text-gray-500 hover:bg-white'}`}
            >
              {terminology.work.singular}
            </button>
            <button
              type="button"
              onClick={() => setEntryType('vacation')}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors sm:text-sm ${entryType === 'vacation' ? 'bg-primary-custom font-medium text-white shadow-sm' : 'text-gray-500 hover:bg-white'}`}
            >
              Urlaub
            </button>
          </div>
        ) : undefined}
        size="xl"
        zIndexClassName="z-[1000]"
        footer={dialogFooter}
      >
        <div className="space-y-4 pb-2">
        {formError && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{formError}</div>}
            {entryType === 'vacation' ? (
              <div className="mx-auto max-w-xl space-y-4 py-2">
                <p className="text-sm text-gray-500">
                  Der Zeitraum wird im Kalender als Abwesenheit angezeigt.
                </p>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Bezeichnung</label>
                  <input
                    type="text"
                    required
                    value={vacationForm.title}
                    onChange={(event) => setVacationForm((previous) => ({ ...previous, title: event.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-primary-custom"
                    placeholder="z. B. Sommerurlaub"
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Von</label>
                    <LocalizedDateInput
                      required
                      value={vacationForm.startDate}
                      onChange={(value) => setVacationForm((previous) => ({ ...previous, startDate: value }))}
                      locale={company.locale}
                      dateFormat={company.dateFormat}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Bis</label>
                    <LocalizedDateInput
                      required
                      min={vacationForm.startDate}
                      value={vacationForm.endDate}
                      onChange={(value) => setVacationForm((previous) => ({ ...previous, endDate: value }))}
                      locale={company.locale}
                      dateFormat={company.dateFormat}
                      className="w-full"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Notiz (optional)</label>
                  <textarea
                    value={vacationForm.notes}
                    onChange={(event) => setVacationForm((previous) => ({ ...previous, notes: event.target.value }))}
                    rows={3}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-primary-custom"
                    placeholder="Weitere Informationen"
                  />
                </div>
              </div>
            ) : (
            <div className="space-y-4 md:space-y-6">
              {/* Basic Information */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 tablet:grid-cols-[minmax(0,2.2fr)_minmax(6.5rem,0.7fr)_minmax(8rem,0.85fr)_minmax(8rem,0.75fr)] sm:gap-3">
                <div className="min-w-0">
                  <label className="mb-1 block text-xs font-medium text-gray-700 sm:text-sm">Titel *</label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full min-w-0 rounded-lg border border-gray-300 px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-custom sm:px-3 sm:text-sm"
                    placeholder="z. B. Deutsch-Kurs B2"
                  />
                </div>

                <div className="min-w-0">
                  <label className="mb-1 flex items-center gap-1 whitespace-nowrap text-xs font-medium text-gray-700 sm:text-sm">
                    <span>{terminology.work.numberLabel}</span>
                    <AutomaticNumberHint />
                  </label>
                  <div
                    className="flex h-[38px] min-w-0 cursor-not-allowed items-center justify-between gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-100 px-2 text-xs text-gray-600 sm:px-3 sm:text-sm"
                    title="Wird automatisch vergeben und kann nicht geändert werden"
                    aria-label={`${terminology.work.numberLabel} automatisch vergeben`}
                  >
                    <span className="truncate">{formData.jobNumber || 'Wird vergeben'}</span>
                    <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                  </div>
                </div>

                <div className="min-w-0">
                  <label className="mb-1 block text-xs font-medium text-gray-700 sm:text-sm">Externe {terminology.work.numberLabel}</label>
                  <input
                    type="text"
                    value={formData.externalJobNumber}
                    onChange={(e) => setFormData(prev => ({ ...prev, externalJobNumber: e.target.value }))}
                    className="w-full min-w-0 rounded-lg border border-gray-300 px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-custom sm:px-3 sm:text-sm"
                    placeholder="Optional"
                  />
                </div>

                <div className="min-w-0">
                  <label className="mb-1 block text-xs font-medium text-gray-700 sm:text-sm">Status</label>
                  <SelectWithChevron
                    value={formData.status}
                    onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value as JobEntry['status'] }))}
                    className="h-[38px] w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-custom sm:px-3 sm:text-sm"
                  >
                    <option value="draft">Entwurf</option>
                    <option value="in-progress">In Bearbeitung</option>
                    <option value="completed">Abgeschlossen</option>
                    <option value="invoiced">Abgerechnet</option>
                  </SelectWithChevron>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 tablet:grid-cols-[minmax(0,1.45fr)_minmax(10.5rem,.75fr)_minmax(15rem,1fr)]">
                <div className="min-w-0">
                  <label className="mb-1 block text-sm font-medium text-gray-700">{terminology.entity.singular} *</label>
                  <div className="flex gap-2">
                    <div className="relative min-w-0 flex-1">
                      <input
                        type="text"
                        value={customerSearchTerm}
                        onChange={handleCustomerSearchChange}
                        onFocus={() => setIsCustomerDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setIsCustomerDropdownOpen(false), 200)}
                        placeholder={`${terminology.entity.singular} suchen oder auswählen...`}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-custom"
                      />
                      {isCustomerDropdownOpen && (
                        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-gray-300 bg-white shadow-lg">
                          {filteredCustomers.length > 0 ? (
                            filteredCustomers.map(customer => (
                              <button
                                key={customer.id}
                                type="button"
                                onClick={() => handleCustomerSelectDropdown(customer)}
                                className="w-full border-b border-gray-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                              >
                                <div className="font-medium">{customer.name}</div>
                                {customer.customerNumber && <div className="text-xs text-gray-500">{terminology.entity.numberShortLabel} {formatCustomerNumber(customer.customerNumber)}</div>}
                                {customer.email && <div className="text-xs text-gray-500">{customer.email}</div>}
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-2 text-xs text-gray-500">{terminology.entity.noResults}</div>
                          )}
                        </div>
                      )}
                    </div>
                    {onCreateCustomer && (
                      <button
                        type="button"
                        onClick={() => {
                          logger.debug('Plus button clicked in JobEntryForm');
                          setShowCustomerForm(true);
                        }}
                        className="box-border inline-flex h-[38px] min-h-[38px] max-h-[38px] w-10 shrink-0 items-center justify-center rounded-lg bg-primary-custom p-0 text-sm text-white transition-colors hover:bg-primary-custom/90"
                        title={terminology.entity.newLabel}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="min-w-[10.5rem]">
                  <label className="mb-1 block text-sm font-medium text-gray-700">Ausführungsort</label>
                  <div className="box-border flex h-[38px] min-w-[10.5rem] flex-nowrap items-center overflow-hidden rounded-lg border border-gray-300 bg-gray-50 p-0.5">
                    {(['Vor Ort', 'Online'] as const).map((location) => (
                      <button
                        key={location}
                        type="button"
                        onClick={() => {
                          setIsDirty(true);
                          setFormData(previous => ({ ...previous, location }));
                        }}
                        className={`theme-switch-option box-border h-[30px] min-h-0 min-w-0 flex-1 whitespace-nowrap rounded-md px-2 text-xs font-medium leading-none transition-colors sm:text-sm ${formData.location === location ? 'theme-switch-active bg-primary-custom text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
                      >
                        {location}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="min-w-0">
                  <label className="mb-1 block text-sm font-medium text-gray-700">Zeitzone</label>
                  <SelectWithChevron
                    value={formData.timeZone || workspaceTimeZone}
                    onChange={(event) => {
                      setIsDirty(true);
                      setFormData(previous => ({ ...previous, timeZone: event.target.value }));
                    }}
                    className="box-border h-[38px] min-h-0 w-full rounded-lg border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-custom sm:px-3 sm:text-sm"
                    aria-label="Zeitzone des Kurses"
                  >
                    {TIME_ZONE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </SelectWithChevron>
                </div>
              </div>

          <div className="grid grid-cols-1 gap-3 tablet:grid-cols-4">
              <div className="min-w-0">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Datum *
              </label>
              <LocalizedDateInput
                value={recurrenceStartDate}
                onChange={(value) => {
                  setIsDirty(true);
                  setRecurrenceStartDate(value);
                  if (value) {
                    const startWeekday = getIsoWeekday(value);
                    setRecurrenceWeekdays((previous) => previous.includes(startWeekday)
                      ? previous
                      : [...previous, startWeekday].sort((a, b) => a - b));
                  }
                  setFormData(prev => ({ ...prev, date: value ? new Date(`${value}T00:00:00`) : prev.date }));
                }}
                locale={company.locale}
                dateFormat={company.dateFormat}
                className="w-full"
              />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Beginn
                </label>
                <LocalizedTimeInput
                  value={formData.startTime || ''}
                  onChange={(value) => handleTimeChange('startTime', value)}
                  timeFormat={company.timeFormat}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ende
                </label>
                <LocalizedTimeInput
                  value={formData.endTime || ''}
                  onChange={(value) => handleTimeChange('endTime', value)}
                  timeFormat={company.timeFormat}
                  className="w-full"
                />
              </div>
              <div className="min-w-0">
                <label className="block text-sm font-medium text-gray-700 mb-1">Wiederholung</label>
                <div className="box-border flex h-[38px] min-w-[11rem] flex-nowrap items-center overflow-hidden rounded-lg border border-gray-300 bg-gray-50 p-0.5">
                  {[
                    { label: 'Einmalig', value: false },
                    { label: 'Kursserie', value: true },
                  ].map(option => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => {
                        setIsDirty(true);
                        setRecurrenceEnabled(option.value);
                      }}
                      className={`theme-switch-option box-border h-[30px] min-h-0 min-w-0 flex-1 whitespace-nowrap rounded-md px-2 text-xs font-medium leading-none transition-colors sm:text-sm ${recurrenceEnabled === option.value ? 'theme-switch-active bg-primary-custom text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
          </div>

          {/* Kursserie */}
          {recurrenceEnabled && (
          <div className="theme-series-panel rounded-lg border border-primary-custom/20 bg-primary-custom/5 p-2.5 sm:p-3">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-3 text-xs text-gray-700 sm:text-sm tablet:flex-nowrap">
                  <label className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                    <span className="font-medium">Jede</span>
                      <input
                        type="number"
                        min="1"
                        max={recurrenceIntervalUnit === 'week' ? 52 : recurrenceIntervalUnit === 'month' ? 12 : 10}
                        value={recurrenceInterval}
                        onChange={(event) => {
                          setIsDirty(true);
                          const maxInterval = recurrenceIntervalUnit === 'week' ? 52 : recurrenceIntervalUnit === 'month' ? 12 : 10;
                          setRecurrenceInterval(Math.min(maxInterval, Math.max(1, Number(event.target.value) || 1)));
                        }}
                        className="w-[4.75rem] rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-custom"
                      />
                    <SelectWithChevron
                      containerClassName="w-[7rem] shrink-0"
                      value={recurrenceIntervalUnit}
                      onChange={(event) => {
                        const nextUnit = event.target.value as RecurrenceIntervalUnit;
                        setIsDirty(true);
                        setRecurrenceIntervalUnit(nextUnit);
                        const maxInterval = nextUnit === 'week' ? 52 : nextUnit === 'month' ? 12 : 10;
                        const maxDuration = nextUnit === 'week' ? 104 : nextUnit === 'month' ? 120 : 100;
                        setRecurrenceInterval((previous) => Math.min(maxInterval, previous));
                        setRecurrenceDurationCount((previous) => Math.min(maxDuration, previous));
                        if (nextUnit === 'week') {
                          const startWeekday = getIsoWeekday(recurrenceStartDate);
                          setRecurrenceWeekdays((previous) => previous.includes(startWeekday)
                            ? previous
                            : [...previous, startWeekday].sort((a, b) => a - b));
                        }
                      }}
                      className="h-[38px] w-[7rem] rounded-lg border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-custom"
                    >
                      <option value="week">Woche(n)</option>
                      <option value="month">Monat(e)</option>
                      <option value="year">Jahr(e)</option>
                    </SelectWithChevron>
                  </label>
                  <label className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                    <span className="font-medium">f&#252;r</span>
                      <input
                        type="number"
                        min="1"
                        max={recurrenceIntervalUnit === 'week' ? 104 : recurrenceIntervalUnit === 'month' ? 120 : 100}
                        value={recurrenceDurationCount}
                        onChange={(event) => {
                          setIsDirty(true);
                          const maxDuration = recurrenceIntervalUnit === 'week' ? 104 : recurrenceIntervalUnit === 'month' ? 120 : 100;
                          setRecurrenceDurationCount(Math.min(maxDuration, Math.max(1, Number(event.target.value) || 1)));
                        }}
                        className="w-[4.75rem] rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-custom"
                      />
                    <span>{recurrenceIntervalUnit === 'week' ? 'Wochen' : recurrenceIntervalUnit === 'month' ? 'Monate' : 'Jahre'}</span>
                  </label>
                {recurrenceIntervalUnit === 'week' ? (
                <fieldset className="flex min-w-0 items-center gap-2 tablet:flex-1">
                  <legend className="sr-only">Wochentage</legend>
                  <div className="grid min-w-0 flex-1 grid-cols-7 gap-1">
                    {RECURRENCE_WEEKDAYS.map((weekday) => {
                      const selected = recurrenceWeekdays.includes(weekday.value);
                      return (
                        <button
                          key={weekday.value}
                          type="button"
                          onClick={() => {
                            if (selected && weekday.value === getIsoWeekday(recurrenceStartDate)) return;
                            setIsDirty(true);
                            setRecurrenceWeekdays((previous) => selected
                              ? previous.filter((value) => value !== weekday.value)
                              : [...previous, weekday.value]);
                          }}
                          aria-pressed={selected}
                          title={weekday.label}
                          className={`theme-switch-option h-[38px] min-h-0 w-full whitespace-nowrap rounded-lg border px-0 py-0 text-xs font-medium transition-colors sm:text-sm ${selected
                            ? 'theme-switch-active border-primary-custom bg-primary-custom text-white'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-primary-custom hover:bg-gray-50'}`}
                        >
                          {weekday.shortLabel}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                ) : (
                  <div className="min-w-0 flex-1 whitespace-nowrap text-xs text-gray-500 sm:text-sm">
                    Am Tag des Startdatums
                  </div>
                )}
              </div>

                <div className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs leading-4 text-blue-900 sm:text-sm">
                  <strong>Vorschau:</strong>{' '}
                  {recurrenceWeekdays.length > 0
                    ? `${recurrencePreviewDescription} = ${recurrenceUnitCount} Einheiten`
                    : 'Bitte mindestens einen Wochentag w\u00e4hlen.'}
                </div>
            </div>
          </div>
          )}

          {/* Description and optional note */}
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Beschreibung *
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-custom"
                placeholder="Detaillierte Beschreibung ..."
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Hinweis <span className="text-xs font-normal text-gray-500">(optional)</span>
              </label>
              <textarea
                value={formData.notes || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-custom"
                placeholder={formData.location === 'Vor Ort'
                  ? 'Interner Hinweis, z. B. abweichender Ausführungsort ...'
                  : 'Interner Hinweis ...'}
              />
            </div>
          </div>

          {/* Time Tracking */}
          <div className="bg-gray-50 rounded-lg p-3 md:p-4">
            <div className="mb-2 flex items-center gap-2">
              <h4 className="shrink-0 whitespace-nowrap text-xs font-medium text-gray-900 sm:text-sm">
                <Clock className="mr-1 inline h-4 w-4 align-text-bottom sm:mr-2" />
                Zeiterfassung
              </h4>
              <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
                <SelectWithChevron
                  containerClassName="min-w-0 flex-[1_1_0%] sm:w-48 sm:flex-none"
                  id="time-entry-template"
                  aria-label="Stundensatz aus Vorlage wählen"
                  onChange={(e) => {
                    if (e.target.value) {
                      addTimeEntryFromTemplate(e.target.value);
                      e.target.value = ''; // Reset dropdown
                    }
                  }}
                  className={sectionSelectClass}
                  defaultValue=""
                >
                  <option value="">Stundensatz wählen...</option>
                  {getCombinedHourlyRatesForCustomer(formData.customerId).map((rate) => (
                    <option key={rate.id} value={rate.id}>
                      {rate.displayName} - {formatMoney(Number(rate.rate) || 0)}/h
                    </option>
                  ))}
                </SelectWithChevron>
                <button
                  type="button"
                  onClick={() => setShowRatesRedirectModal({
                    isOpen: true,
                    type: 'hourlyRates'
                  })}
                  className={sectionIconButtonClass}
                  title="Stundensätze verwalten"
                  aria-label="Stundensätze verwalten"
                >
                  <Edit className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={addTimeEntry}
                  className={sectionActionButtonClass}
                >
                  <Plus className="hidden h-4 w-4 sm:block" />
                  <span className="hidden sm:inline">Manuell</span>
                  <span className="sm:hidden">+</span>
                </button>
              </div>
            </div>

            {formData.timeEntries && formData.timeEntries.length > 0 ? (
              <div className="space-y-3 md:space-y-4">
                {formData.timeEntries.map((timeEntry, index) => (
                  <div key={timeEntry.id} className="border border-gray-200 rounded-lg p-2 md:p-4 bg-white">
                    <div className="flex items-center justify-between mb-2 md:mb-3">
                      <h5 className="text-xs md:text-sm font-medium text-gray-800">
                        Zeiteintrag {index + 1}
                      </h5>
                      {formData.timeEntries!.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeTimeEntry(index)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-red-600 transition-colors hover:bg-red-50 hover:text-red-800"
                          title="Zeiteintrag entfernen"
                          aria-label={`Zeiteintrag ${index + 1} entfernen`}
                        >
                          <Trash2 className="h-3 w-3 md:h-4 md:w-4" />
                        </button>
                      )}
                    </div>
                    
                    {/* Mobile Layout - Simplified for space */}
                    <div className="md:hidden space-y-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Beschreibung
                        </label>
                        <input
                          type="text"
                          value={timeEntry.description}
                          onChange={(e) => updateTimeEntry(index, 'description', e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary-custom"
                          placeholder="z.B. Anfahrt, Montage..."
                        />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Stunden *
                          </label>
                          <LocalizedNumberInput
                            step="0.01"
                            min="0"
                            value={timeEntry.hoursWorked}
                            locale={company.locale}
                            numberFormat={company.numberFormat}
                            onValueChange={(value) => updateTimeEntry(index, 'hoursWorked', value)}
                            onBlur={(e) => {
                              if (e.target.value === '') {
                                updateTimeEntry(index, 'hoursWorked', 0);
                              }
                            }}
                            required
                            className="w-full px-1 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary-custom"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Gesamt ({currencySymbol})
                          </label>
                          <input
                            type="text"
                            value={formatMoney(Number(timeEntry.total) || 0)}
                            readOnly
                            className="w-full px-1 py-1 border border-gray-300 rounded text-xs bg-gray-100"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Desktop Layout */}
                    <div className="hidden md:block">
                      <div className="grid grid-cols-6 gap-3">
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Beschreibung
                          </label>
                          <input
                            type="text"
                            value={timeEntry.description}
                            onChange={(e) => updateTimeEntry(index, 'description', e.target.value)}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-custom"
                            placeholder="z.B. Anfahrt, Montage, Beratung..."
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Stunden *
                          </label>
                          <LocalizedNumberInput
                            step="0.01"
                            min="0"
                            value={timeEntry.hoursWorked}
                            locale={company.locale}
                            numberFormat={company.numberFormat}
                            onValueChange={(value) => updateTimeEntry(index, 'hoursWorked', value)}
                            onBlur={(e) => {
                              if (e.target.value === '') {
                                updateTimeEntry(index, 'hoursWorked', 0);
                              }
                            }}
                            required
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-custom"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Stundensatz ({currencySymbol})
                          </label>
                          <input
                            type="text"
                            value={formatMoney(Number(timeEntry.hourlyRate || 0))}
                            readOnly
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-100"
                          />
                        </div>
                        
                        <div>
                          <label className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-700">
                            <span>MwSt. %</span>
                            {company?.isSmallBusiness && <TaxDisabledHint />}
                          </label>
                          <SelectWithChevron
                            value={company?.isSmallBusiness ? 0 : timeEntry.taxRate}
                            onChange={(e) => updateTimeEntry(index, 'taxRate', parseFloat(e.target.value))}
                            disabled={company?.isSmallBusiness}
                            className={`w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-custom ${
                              company?.isSmallBusiness ? 'bg-gray-100 cursor-not-allowed' : ''
                            }`}
                          >
                            <option value={0}>0%</option>
                            {!company?.isSmallBusiness && <option value={7}>7%</option>}
                            {!company?.isSmallBusiness && <option value={19}>19%</option>}
                          </SelectWithChevron>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Gesamt ({currencySymbol})
                          </label>
                          <input
                            type="text"
                            value={formatMoney(Number(timeEntry.total) || 0)}
                            readOnly
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-100"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-blue-900 sm:p-3">
                  {recurrenceEnabled ? (
                    <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm">
                      <div className="min-w-0">
                        <span className="block font-medium">Pro Einheit</span>
                        <span className="mt-1 block font-bold">
                          {formatNumber(timeHoursPerUnit, company.locale, company.numberFormat, 2)} h
                        </span>
                        <span className="block font-bold">{formatMoney(timeCostPerUnit)}</span>
                      </div>
                      <div className="min-w-0 border-l border-blue-200 pl-2">
                        <span className="block font-medium">Gesamt für Zeitraum</span>
                        <span className="mt-1 block font-bold">
                          {formatNumber(timeHoursPerUnit * recurrenceUnitCount, company.locale, company.numberFormat, 2)} h
                        </span>
                        <span className="block font-bold">{formatMoney(timeCostPerUnit * recurrenceUnitCount)}</span>
                        <span className="mt-0.5 block text-[11px] leading-4 text-blue-800">
                          {recurrenceUnitCount} {recurrenceUnitCount === 1 ? 'Einheit' : 'Einheiten'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">Gesamtstunden:</span>
                        <span className="font-bold">
                          {formatNumber(timeHoursPerUnit, company.locale, company.numberFormat, 2)} h
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-sm">
                        <span className="font-medium">Gesamtkosten:</span>
                        <span className="font-bold">{formatMoney(timeCostPerUnit)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-6 md:py-8">
                <Clock className="h-10 w-10 md:h-12 md:w-12 text-gray-400 mx-auto mb-2 md:mb-3" />
                <p className="text-sm text-gray-500">
                  Noch keine Zeiteinträge erfasst
                </p>
              </div>
            )}
          </div>

          {/* Materials */}
          <div className="bg-gray-50 rounded-lg p-3 md:p-4">
            <div className="mb-2 flex items-center gap-2">
              <h4 className="min-w-0 shrink whitespace-nowrap text-xs font-medium text-gray-900 sm:text-sm">
                <DollarSign className="mr-1 inline h-4 w-4 align-text-bottom sm:mr-2" />
                Materialien & Zusatzkosten
              </h4>
              <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
                <label className="sr-only" htmlFor="material-template">Materialvorlage</label>
                <SelectWithChevron
                  containerClassName="min-w-0 flex-[1_1_0%] sm:w-48 sm:flex-none"
                  id="material-template"
                  onChange={(e) => {
                    if (e.target.value) {
                      addMaterial(e.target.value);
                      e.target.value = ''; // Reset dropdown
                    }
                  }}
                  className={sectionSelectClass}
                  defaultValue=""
                >
                  <option value="">Vorlage wählen...</option>
                  {(() => {
                    try {
                      const templates = getCombinedMaterialTemplatesForCustomer(formData.customerId) || [];
                      return templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.displayName} - {formatMoney(Number(template.unitPrice) || 0)}/{template.unit || 'Stück'}
                        </option>
                      ));
                    } catch (error) {
                      logger.error('Error loading material templates:', error);
                      return [];
                    }
                  })()}
                </SelectWithChevron>
                <button
                  type="button"
                  onClick={() => setShowRatesRedirectModal({
                    isOpen: true,
                    type: 'materials'
                  })}
                  className={sectionIconButtonClass}
                  title="Materialien verwalten"
                  aria-label="Materialien verwalten"
                >
                  <Edit className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={() => addMaterial()}
                  className={sectionActionButtonClass}
                >
                  <Plus className="hidden h-4 w-4 sm:block" />
                  <span className="hidden sm:inline">Manuell</span>
                  <span className="sm:hidden">+</span>
                </button>
              </div>
            </div>

            {formData.materials && formData.materials.length > 0 ? (
              <div className="space-y-2 md:space-y-3">
                {formData.materials.map((material, index) => (
                  <div key={material.id} className="border border-gray-200 rounded-lg p-2 md:p-3 bg-white">
                    {/* Simplified layout for both mobile and desktop */}
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-2 md:gap-3">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Beschreibung
                        </label>
                        <input
                          type="text"
                          value={material.description}
                          onChange={(e) => updateMaterial(index, 'description', e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-custom"
                          placeholder="Beschreibung..."
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Menge</label>
                        <LocalizedNumberInput
                          step="0.01"
                          min="0"
                          value={material.quantity}
                          locale={company.locale}
                          numberFormat={company.numberFormat}
                          onValueChange={(value) => updateMaterial(index, 'quantity', value)}
                          onBlur={(e) => {
                            if (e.target.value === '') {
                              updateMaterial(index, 'quantity', 0);
                            }
                          }}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-custom"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Preis {currencySymbol}</label>
                        <LocalizedNumberInput
                          step="0.01"
                          min="0"
                          value={material.unitPrice}
                          locale={company.locale}
                          numberFormat={company.numberFormat}
                          onValueChange={(value) => updateMaterial(index, 'unitPrice', value)}
                          onBlur={(e) => {
                            if (e.target.value === '') {
                              updateMaterial(index, 'unitPrice', 0);
                            }
                          }}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-custom"
                        />
                      </div>

                      <div>
                        <label className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-700">
                          <span>MwSt. %</span>
                          {company?.isSmallBusiness && <TaxDisabledHint />}
                        </label>
                        <SelectWithChevron
                          value={company?.isSmallBusiness ? 0 : material.taxRate}
                          onChange={(e) => updateMaterial(index, 'taxRate', parseFloat(e.target.value))}
                          disabled={company?.isSmallBusiness}
                          className={`w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-custom ${
                            company?.isSmallBusiness ? 'bg-gray-100 cursor-not-allowed' : ''
                          }`}
                        >
                          <option value={0}>0%</option>
                          {!company?.isSmallBusiness && <option value={7}>7%</option>}
                          {!company?.isSmallBusiness && <option value={19}>19%</option>}
                        </SelectWithChevron>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Gesamt {currencySymbol}</label>
                          <input
                            type="text"
                            value={formatMoney(Number(material.total) || 0)}
                            readOnly
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-100"
                          />
                        </div>
                          <button
                            type="button"
                            onClick={() => removeMaterial(index)}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-red-600 transition-colors hover:bg-red-50 hover:text-red-800"
                            title="Entfernen"
                            aria-label={`Material ${index + 1} entfernen`}
                          >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 md:p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-blue-900">Gesamtkosten Materialien:</span>
                    <span className="font-bold text-blue-900">
                      {formatMoney(formData.materials.reduce((sum, material) => sum + (Number(material.total) || 0), 0))}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 md:py-8">
                <DollarSign className="h-10 w-10 md:h-12 md:w-12 text-gray-400 mx-auto mb-2 md:mb-3" />
                <p className="text-sm text-gray-500 mb-2 md:mb-4">
                  Noch keine Materialien hinzugefügt
                </p>
              </div>
            )}
          </div>

              {/* Attachments */}
              <div>
                <AttachmentManager
                  attachments={formData.attachments || []}
                  onAttachmentsChange={handleAttachmentsChange}
                  allowUpload={true}
                  allowPreview={true}
                  onPreview={handlePreview}
                  title={`${terminology.work.singular}-Anhänge`}
                />
              </div>

            </div>
            )}
          </div>

      </DialogShell>

      {/* Customer Creation Modal */}
      {showCustomerForm && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/55 p-4">
          <div className="bg-white rounded-lg p-4 lg:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {terminology.entity.newLabel}
            </h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              
              // Check for duplicates
              const existingCustomer = findDuplicateCustomer(customers, newCustomerData);
              
              if (existingCustomer) {
                notify({
                  variant: 'warning',
                  title: `${terminology.entity.singular} existiert bereits`,
                  message: buildDuplicateCustomerMessage(existingCustomer, terminology.entity.singular, terminology.entity.numberShortLabel.replace(/\.$/, '')),
                });
                return;
              }
              
              try {
                const createdCustomer = await addCustomer(newCustomerData);
                
                // Pre-select the newly created customer
                if (createdCustomer && createdCustomer.id) {
                  setIsDirty(true);
                  setFormData(prev => ({ ...prev, customerId: createdCustomer.id }));
                }
                
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
                notify({ variant: 'error', message: `Fehler beim Erstellen des ${terminology.entity.genitive}. Bitte versuchen Sie es erneut.` });
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
                  USt-IdNr.
                </label>
                <input
                  type="text"
                  value={newCustomerData.taxId}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, taxId: e.target.value })}
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

      {/* Document Preview Modal */}
      <DocumentPreview
        isOpen={documentPreview.isOpen}
        onClose={handleClosePreview}
        documents={documentPreview.documents}
        initialIndex={documentPreview.initialIndex}
      />

      {/* Rates and Materials Redirect Modal */}
      <RatesAndMaterialsRedirectModal
        isOpen={showRatesRedirectModal.isOpen}
        onClose={() => setShowRatesRedirectModal({ isOpen: false, type: 'hourlyRates' })}
        onNavigateToCustomers={() => requestRateNavigation('customers')}
        onNavigateToSettings={() => requestRateNavigation('settings')}
        type={showRatesRedirectModal.type}
      />

      {pendingRateNavigation && (
        <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/50 p-3 sm:p-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-2xl">
            <div className="border-b border-gray-200 p-4 sm:p-5">
              <h3 className="text-base font-semibold text-gray-900 sm:text-lg">Änderungen speichern?</h3>
            </div>
            <div className="p-4 sm:p-5">
              <p className="text-sm leading-6 text-gray-600">
                Du hast Eingaben im Formular geändert. Sollen sie gespeichert werden, bevor du die Verwaltung öffnest?
              </p>
            </div>
            <div className="form-action-bar border-t border-gray-200 p-4 sm:p-5">
              <button
                type="button"
                onClick={() => setPendingRateNavigation(null)}
                disabled={isSavingBeforeNavigation}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={discardAndNavigateToRates}
                disabled={isSavingBeforeNavigation}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Nicht speichern
              </button>
              <button
                type="button"
                onClick={saveAndNavigateToRates}
                disabled={isSavingBeforeNavigation}
                className="btn-primary rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSavingBeforeNavigation ? 'Speichern ...' : 'Speichern & weiter'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={showDiscardModal}
        onClose={() => setShowDiscardModal(false)}
        onConfirm={() => {
          setShowDiscardModal(false);
          onCancel();
        }}
        title="Änderungen verwerfen?"
        message="Es gibt ungespeicherte Änderungen. Möchten Sie diese wirklich verwerfen?"
        confirmText="Änderungen verwerfen"
        cancelText="Weiter bearbeiten"
        isDestructive
      />
    </>
  );
}
