import React, { useState, useEffect } from 'react';
import logger from '../utils/logger';
import { X, Plus, Trash2, Save, Clock, Calendar, DollarSign, Edit, PenTool } from 'lucide-react';
import { JobEntry, Customer, JobMaterial, JobAttachment, JobTimeEntry, JobSignature } from '../types';
import { useCustomers } from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
import { useDocumentHelpers } from '../hooks/useDocumentHelpers';
import { AttachmentManager } from './AttachmentManager';
import { DocumentPreview, PreviewDocument } from './DocumentPreview';
import { SignaturePad } from './SignaturePad';
import { RatesAndMaterialsRedirectModal } from './RatesAndMaterialsRedirectModal';
import { createDefaultTimeEntry } from '../utils/jobUtils';
import { generateUUID } from '../utils/uuid';
import { findDuplicateCustomer, showDuplicateCustomerAlert, formatCustomerNumber } from '../utils/customerUtils';

interface JobEntryFormProps {
  job?: JobEntry | null;
  customers: Customer[];
  defaultDate?: Date | null;
  onSubmit: (jobData: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
  onCreateCustomer?: () => void;
  onNavigateToCustomers?: () => void;
  onNavigateToSettings?: () => void;
}

export function JobEntryForm({ job, customers, defaultDate, onSubmit, onCancel, onCreateCustomer, onNavigateToCustomers, onNavigateToSettings }: JobEntryFormProps) {
  const { addCustomer, refreshCustomers } = useCustomers();
  const { company, addMaterialTemplate, updateMaterialTemplate, deleteMaterialTemplate, addHourlyRate, updateHourlyRate, deleteHourlyRate, getHourlyRates } = useCompany();

  const { getHourlyRatesForCustomer, getCombinedHourlyRatesForCustomer, getCombinedMaterialTemplatesForCustomer } = useDocumentHelpers();


  const [showCustomerForm, setShowCustomerForm] = useState(false);

  const [showRatesRedirectModal, setShowRatesRedirectModal] = useState<{
    isOpen: boolean;
    type: 'hourlyRates' | 'materials';
  }>({
    isOpen: false,
    type: 'hourlyRates'
  });

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
  

  
  // Signature Pad state
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  
  const [formData, setFormData] = useState<Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>>({
    jobNumber: '', // Will be auto-generated
    externalJobNumber: '',
    customerId: '',
    customerName: '',
    customerAddress: '',
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
    signature: undefined
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

  useEffect(() => {
    if (job) {
      setFormData({
        jobNumber: job.jobNumber,
        externalJobNumber: job.externalJobNumber || '',
        customerId: job.customerId,
        customerName: job.customerName,
        customerAddress: job.customerAddress || '',
        title: job.title,
        description: job.description,
        date: typeof job.date === 'string' ? new Date(job.date) : job.date,
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
        signature: job.signature || undefined
      });
    } else {
      // Für neue Aufträge: keine Standard-Zeiteinträge, Nutzer muss explizit hinzufügen
      // Note: For new jobs, we can't use customer-specific rates yet since customer isn't selected
      const defaultRate = getHourlyRates().find((rate: any) => rate.isDefault);
      const initialFormData: any = {
        jobNumber: '', // Will be auto-generated
        externalJobNumber: '',
        customerId: '',
        customerName: '',
        customerAddress: '',
        title: '',
        description: '',
        date: defaultDate || new Date(), // Use defaultDate if provided
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
        signature: undefined
      };
      
      if (defaultRate) {
        initialFormData.hourlyRateId = defaultRate.id;
        initialFormData.hourlyRate = defaultRate.rate;
      }
      
      setFormData(initialFormData);
    }
  }, [job, company.hourlyRates, defaultDate]);

  // Filter customers based on search term
  const filteredCustomers = customers.filter(customer =>
    customer.name.toLowerCase().includes(customerSearchTerm.toLowerCase()) ||
    (customer.customerNumber && customer.customerNumber.toLowerCase().includes(customerSearchTerm.toLowerCase()))
  );
  
  // Get selected customer display name
  const selectedCustomer = customers.find(customer => customer.id === formData.customerId);
  const selectedCustomerDisplayName = selectedCustomer ? selectedCustomer.name : '';
    
  // Handle customer selection
  const handleCustomerSelectDropdown = (customer: any) => {
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
    setFormData((prev: any) => ({
      ...prev,
      customerId,
      customerName: customer?.name || ''
    }));
  };

  const addTimeEntry = () => {
    const availableRates = getHourlyRatesForCustomer(formData.customerId);
    const defaultRate = availableRates.find((rate: any) => rate.isDefault);
    const newTimeEntry = createDefaultTimeEntry(
      defaultRate ? defaultRate.rate : 0,
      defaultRate ? defaultRate.id : '',
      defaultRate?.taxRate != null ? defaultRate.taxRate : 19 // Use hourly rate tax rate or default to 19%
    );
    
    setFormData((prev: any) => ({
      ...prev,
      timeEntries: [...(prev.timeEntries || []), newTimeEntry]
    }));
  };

  const addTimeEntryFromTemplate = (hourlyRateId: string) => {
    // Search in combined templates (both general and customer-specific)
    const template = getCombinedHourlyRatesForCustomer(formData.customerId).find((rate: any) => rate.id === hourlyRateId);
    if (!template) return;
    
    const newTimeEntry = createDefaultTimeEntry(
      parseFloat(template.rate || 0),
      template.id,
      template.taxRate != null ? template.taxRate : 19
    );
    
    // Set description to template name
    newTimeEntry.description = template.name;
    
    setFormData((prev: any) => ({
      ...prev,
      timeEntries: [...(prev.timeEntries || []), newTimeEntry]
    }));
  };

  const updateTimeEntry = (index: number, field: keyof JobTimeEntry, value: string | number) => {
    setFormData((prev: any) => {
      const timeEntries = [...(prev.timeEntries || [])];
      timeEntries[index] = { ...timeEntries[index], [field]: value };
      
      // Auto-calculate total for hoursWorked and hourlyRate changes
      if (field === 'hoursWorked' || field === 'hourlyRate') {
        const hours = parseFloat(timeEntries[index].hoursWorked) || 0;
        const rate = parseFloat(timeEntries[index].hourlyRate) || 0;
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
            const hours = parseFloat(timeEntries[index].hoursWorked) || 0;
            const rate = parseFloat(timeEntries[index].hourlyRate) || 0;
            timeEntries[index].total = hours * rate;
          }
        }
      }
      
      // Update total hours in main job data for backward compatibility
      const totalHours = timeEntries.reduce((sum, entry) => sum + (parseFloat(entry.hoursWorked) || 0), 0);
      
      return { 
        ...prev, 
        timeEntries,
        hoursWorked: totalHours
      };
    });
  };

  const removeTimeEntry = (index: number) => {
    setFormData((prev: any) => {
      const timeEntries = (prev.timeEntries || []).filter((_: any, i: number) => i !== index);
      const totalHours = timeEntries.reduce((sum: number, entry: any) => sum + (parseFloat(entry.hoursWorked) || 0), 0);
      
      return { 
        ...prev, 
        timeEntries,
        hoursWorked: totalHours
      };
    });
  };



  const handleTimeChange = (field: 'startTime' | 'endTime', value: string) => {
    setFormData((prev: any) => {
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
    let newMaterial: JobMaterial;
    
    if (templateId) {
      // Use template data - safely handle potential errors
      try {
        const templates = getCombinedMaterialTemplatesForCustomer(formData.customerId) || [];
        const template = templates.find((t: any) => t.id === templateId);
        
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
    setFormData(prev => {
      const materials = [...(prev.materials || [])];
      materials[index] = { ...materials[index], [field]: value };
      
      // Auto-calculate total for quantity and unitPrice changes
      if (field === 'quantity' || field === 'unitPrice') {
        const quantity = parseFloat(materials[index].quantity) || 0;
        const unitPrice = parseFloat(materials[index].unitPrice) || 0;
        materials[index].total = quantity * unitPrice;
      }
      
      return { ...prev, materials };
    });
  };

  const removeMaterial = (index: number) => {
    setFormData(prev => ({
      ...prev,
      materials: prev.materials?.filter((_, i) => i !== index) || []
    }));
  };

  const handleAttachmentsChange = (attachments: JobAttachment[]) => {
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

  const handleSignature = () => {
    // Check if customer is selected
    if (!formData.customerId) {
      alert('Bitte wählen Sie zuerst einen Kunden aus.');
      return;
    }
    setShowSignaturePad(true);
  };

  const handleSignatureSave = (signatureData: string, customerName: string) => {
    const signature: JobSignature = {
      id: generateUUID(),
      customerName: customerName.trim(),
      signatureData,
      signedAt: new Date(),
      ipAddress: undefined // Will be set by backend
    };
    
    setFormData(prev => ({
      ...prev,
      signature,
      status: 'completed' // Automatically set to completed when signed
    }));
    
    setShowSignaturePad(false);
  };

  const handleSignatureClose = () => {
    setShowSignaturePad(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.customerId || !formData.title || !formData.description) {
      alert('Bitte füllen Sie alle Pflichtfelder aus.');
      return;
    }
    
    // Convert date to string format for backend
    const submitData = {
      ...formData,
      date: formData.date instanceof Date ? formData.date.toISOString().split('T')[0] : formData.date
    };
    
    onSubmit(submitData);
  };

  const handleSubmitAsDraft = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.customerId || !formData.title || !formData.description) {
      alert('Bitte füllen Sie alle Pflichtfelder aus.');
      return;
    }
    
    // Convert date to string format for backend
    const submitData = {
      ...formData,
      status: 'draft' as const,
      date: formData.date instanceof Date ? formData.date.toISOString().split('T')[0] : formData.date
    };
    
    onSubmit(submitData);
  };

  const formatDateForInput = (date: Date) => {
    return new Date(date).toISOString().split('T')[0];
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-2 md:p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[95vh] md:max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-3 md:p-4 border-b border-gray-200 flex-shrink-0">
          <h3 className="text-base md:text-lg font-semibold text-gray-900">
            {job ? 'Auftrag bearbeiten' : 'Neuer Auftrag'}
          </h3>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 p-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-3 md:p-4">
            <div className="space-y-4 md:space-y-6">
              {/* Basic Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Kunde *
              </label>
              <div className="flex gap-2">
                <div className="w-full max-w-sm relative">
                  <input
                    type="text"
                    value={customerSearchTerm}
                    onChange={handleCustomerSearchChange}
                    onFocus={() => setIsCustomerDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setIsCustomerDropdownOpen(false), 200)}
                    placeholder="Kunde suchen oder auswählen..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom text-sm"
                    required
                  />
                  {isCustomerDropdownOpen && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      {filteredCustomers.length > 0 ? (
                        filteredCustomers.map(customer => (
                          <button
                            key={customer.id}
                            type="button"
                            onClick={() => handleCustomerSelectDropdown(customer)}
                            className="w-full text-left px-3 py-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none border-b border-gray-100 last:border-b-0 text-sm"
                          >
                            <div className="font-medium">{customer.name}</div>
                            {customer.customerNumber && (
                              <div className="text-xs text-gray-500">Nr: {formatCustomerNumber(customer.customerNumber)}</div>
                            )}
                            {customer.email && (
                              <div className="text-xs text-gray-500">{customer.email}</div>
                            )}
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-gray-500 text-xs">
                          Keine Kunden gefunden
                        </div>
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
                    className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center text-sm"
                    title="Neuen Kunden anlegen"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value as JobEntry['status'] }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom text-sm"
              >
                <option value="draft">Entwurf</option>
                <option value="in-progress">In Bearbeitung</option>
                <option value="completed">Abgeschlossen</option>
                <option value="invoiced">Abgerechnet</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Titel *
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom text-sm"
                placeholder="z.B. Website-Entwicklung"
              />
            </div>
          </div>

          {/* Customer Address - Full width under customer selection */}
          <div className="col-span-1 md:col-span-2 lg:col-span-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Kundenanschrift (Ausführungsort)
              <span className="text-gray-500 text-xs ml-1">
                - Optional, falls abweichend vom Rechnungsempfänger
              </span>
            </label>
            <textarea
              value={formData.customerAddress || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, customerAddress: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom text-sm"
              placeholder="z.B. Max Mustermann
Musterstraße 123
12345 Musterstadt"
            />
          </div>

          <div className="col-span-1 md:col-span-2 lg:col-span-3">
            {/* Job Numbers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Auftragsnummer
                </label>
                <input
                  type="text"
                  value={formData.jobNumber}
                  readOnly
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-sm text-gray-600"
                  placeholder="Wird automatisch generiert"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Externe Auftragsnummer
                </label>
                <input
                  type="text"
                  value={formData.externalJobNumber}
                  onChange={(e) => setFormData(prev => ({ ...prev, externalJobNumber: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom text-sm"
                  placeholder="Optional: Externe Referenznummer"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Datum *
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="date"
                  value={formatDateForInput(formData.date)}
                  onChange={(e) => setFormData(prev => ({ ...prev, date: new Date(e.target.value) }))}
                  required
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom text-sm"
                />
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Beschreibung *
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              required
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom text-sm"
              placeholder="Detaillierte Beschreibung der Arbeiten..."
            />
          </div>

          {/* Time Tracking */}
          <div className="bg-gray-50 rounded-lg p-3 md:p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-gray-900 flex items-center">
                <Clock className="h-4 w-4 mr-2" />
                Zeiterfassung
              </h4>
              <div className="flex items-center space-x-2">
                <div className="flex items-center space-x-1">
                  <label className="text-xs text-gray-600">Aus Vorlage:</label>
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        addTimeEntryFromTemplate(e.target.value);
                        e.target.value = ''; // Reset dropdown
                      }
                    }}
                    className="text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-custom"
                    defaultValue=""
                  >
                    <option value="">Stundensatz wählen...</option>
                    {getCombinedHourlyRatesForCustomer(formData.customerId).map((rate: any) => (
                      <option key={rate.id} value={rate.id}>
                        {rate.displayName} - {parseFloat(rate.rate || 0).toFixed(2)}€/h
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowRatesRedirectModal({
                      isOpen: true,
                      type: 'hourlyRates'
                    })}
                    className="p-1 text-blue-600 hover:text-blue-800 border border-gray-300 rounded hover:bg-blue-50 transition-colors"
                    title="Stundensätze verwalten"
                  >
                    <Edit className="h-3 w-3" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={addTimeEntry}
                  className="btn-secondary px-2 md:px-3 py-1 rounded text-xs md:text-sm flex items-center space-x-1"
                >
                  <Plus className="h-3 w-3" />
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
                          className="text-red-600 hover:text-red-800 p-1"
                          title="Zeiteintrag entfernen"
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
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={timeEntry.hoursWorked}
                            onChange={(e) => {
                              const value = e.target.value;
                              if (value === '' || !isNaN(parseFloat(value))) {
                                updateTimeEntry(index, 'hoursWorked', value === '' ? '' : parseFloat(value));
                              }
                            }}
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
                            Gesamt (€)
                          </label>
                          <input
                            type="text"
                            value={(parseFloat(timeEntry.total) || 0).toFixed(2)}
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
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={timeEntry.hoursWorked}
                            onChange={(e) => {
                              const value = e.target.value;
                              if (value === '' || !isNaN(parseFloat(value))) {
                                updateTimeEntry(index, 'hoursWorked', value === '' ? '' : parseFloat(value));
                              }
                            }}
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
                            Stundensatz (€)
                          </label>
                          <input
                            type="text"
                            value={`${parseFloat(timeEntry.hourlyRate || 0).toFixed(2)}€`}
                            readOnly
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-100"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            MwSt. (%)
                          </label>
                          <select
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
                          </select>
                          {company?.isSmallBusiness && (
                            <p className="text-xs text-gray-500 mt-1">
                              MwSt. durch Kleinunternehmerregelung deaktiviert
                            </p>
                          )}
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Gesamt (€)
                          </label>
                          <input
                            type="text"
                            value={(parseFloat(timeEntry.total) || 0).toFixed(2)}
                            readOnly
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-100"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 md:p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-blue-900">Gesamtstunden:</span>
                    <span className="font-bold text-blue-900">
                      {(formData.timeEntries.reduce((sum, entry) => sum + (parseFloat(entry.hoursWorked) || 0), 0)).toFixed(2)}h
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="font-medium text-blue-900">Gesamtkosten:</span>
                    <span className="font-bold text-blue-900">
                      {(formData.timeEntries.reduce((sum, entry) => sum + (parseFloat(entry.total) || 0), 0)).toFixed(2)}€
                    </span>
                  </div>
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
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-3 gap-3">
              <h4 className="text-sm font-medium text-gray-900 flex items-center">
                <DollarSign className="h-4 w-4 mr-2" />
                Materialien & Zusatzkosten
              </h4>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      addMaterial(e.target.value);
                      e.target.value = ''; // Reset dropdown
                    }
                  }}
                  className="text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-custom"
                  defaultValue=""
                >
                  <option value="">Vorlage wählen...</option>
                  {(() => {
                    try {
                      const templates = getCombinedMaterialTemplatesForCustomer(formData.customerId) || [];
                      return templates.map((template: any) => (
                        <option key={template.id} value={template.id}>
                          {template.displayName} - {parseFloat(template.unitPrice || 0).toFixed(2)}€/{template.unit || 'Stück'}
                        </option>
                      ));
                    } catch (error) {
                      logger.error('Error loading material templates:', error);
                      return [];
                    }
                  })()}
                </select>
                <button
                  type="button"
                  onClick={() => setShowRatesRedirectModal({
                    isOpen: true,
                    type: 'materials'
                  })}
                  className="btn-secondary px-2 py-1 rounded text-xs flex items-center space-x-1"
                  title="Materialien verwalten"
                >
                  <Edit className="h-3 w-3" />
                </button>

                <button
                  type="button"
                  onClick={() => addMaterial()}
                  className="btn-secondary px-2 py-1 rounded text-xs flex items-center space-x-1"
                >
                  <Plus className="h-3 w-3" />
                  <span className="hidden sm:inline">Manuell</span>
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
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={material.quantity}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '' || !isNaN(parseFloat(value))) {
                              updateMaterial(index, 'quantity', value === '' ? '' : parseFloat(value));
                            }
                          }}
                          onBlur={(e) => {
                            if (e.target.value === '') {
                              updateMaterial(index, 'quantity', 0);
                            }
                          }}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-custom"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Preis €</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={material.unitPrice}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '' || !isNaN(parseFloat(value))) {
                              updateMaterial(index, 'unitPrice', value === '' ? '' : parseFloat(value));
                            }
                          }}
                          onBlur={(e) => {
                            if (e.target.value === '') {
                              updateMaterial(index, 'unitPrice', 0);
                            }
                          }}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-custom"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">MwSt. %</label>
                        <select
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
                        </select>
                        {company?.isSmallBusiness && (
                          <p className="text-xs text-gray-500 mt-1">
                            MwSt. durch Kleinunternehmerregelung deaktiviert
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Gesamt €</label>
                          <input
                            type="text"
                            value={(parseFloat(material.total) || 0).toFixed(2)}
                            readOnly
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-100"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeMaterial(index)}
                          className="text-red-600 hover:text-red-800 p-1 ml-2"
                          title="Entfernen"
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
                      {(formData.materials.reduce((sum, material) => sum + (parseFloat(material.total) || 0), 0)).toFixed(2)}€
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

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notizen
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom text-sm"
              placeholder="Zusätzliche Notizen oder Kommentare..."
            />
          </div>

              {/* Attachments */}
              <div>
                <AttachmentManager
                  attachments={formData.attachments || []}
                  onAttachmentsChange={handleAttachmentsChange}
                  allowUpload={true}
                  allowPreview={true}
                  onPreview={handlePreview}
                  title="Auftrag-Anhänge"
                />
              </div>

              {/* Signature Section */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Kundenunterschrift
                </label>
                {formData.signature ? (
                  <div className="border border-gray-300 rounded-lg p-3 bg-green-50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-green-800">
                        Unterschrift vorhanden
                      </span>
                      <span className="text-xs text-green-600">
                        {new Date(formData.signature.signedAt).toLocaleString('de-DE')}
                      </span>
                    </div>
                    <div className="text-sm text-gray-700 mb-2">
                      Kunde: <strong>{formData.signature.customerName}</strong>
                    </div>
                    <img 
                      src={formData.signature.signatureData} 
                      alt="Kundenunterschrift" 
                      className="max-h-20 border border-gray-200 rounded bg-white"
                    />
                  </div>
                ) : (
                  <div className="border border-gray-300 rounded-lg p-3 bg-gray-50">
                    <p className="text-sm text-gray-600 mb-3">
                      Noch keine Unterschrift vorhanden. Nach dem Hinzufügen einer Unterschrift wird der Auftrag automatisch als "Abgeschlossen" markiert.
                    </p>
                    <button
                      type="button"
                      onClick={handleSignature}
                      disabled={!formData.customerId}
                      className="inline-flex items-center px-3 py-2 border border-purple-300 rounded-lg text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <PenTool className="h-4 w-4 mr-2" />
                      Unterschrift hinzufügen
                    </button>
                    {!formData.customerId && (
                      <p className="text-xs text-red-600 mt-1">
                        Bitte wählen Sie zuerst einen Kunden aus.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons - Fixed at bottom */}
          <div className="flex-shrink-0 border-t border-gray-200 p-3 md:p-4">
            <div className="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Abbrechen
              </button>
              {!job && (
                <button
                  type="button"
                  onClick={handleSubmitAsDraft}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center justify-center space-x-2"
                >
                  <Save className="h-4 w-4" />
                  <span>Als Entwurf speichern</span>
                </button>
              )}
              <button
                type="submit"
                className="btn-primary text-white px-4 py-2 rounded-lg flex items-center justify-center space-x-2 text-sm"
              >
                <Save className="h-4 w-4" />
                <span>{job ? 'Aktualisieren' : 'Erstellen'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Customer Creation Modal */}
      {showCustomerForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-lg p-4 lg:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Neuer Kunde
            </h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              
              // Check for duplicates
              const existingCustomer = findDuplicateCustomer(customers, newCustomerData);
              
              if (existingCustomer) {
                showDuplicateCustomerAlert(existingCustomer);
                return;
              }
              
              try {
                const createdCustomer = await addCustomer(newCustomerData);
                
                // Pre-select the newly created customer
                if (createdCustomer && createdCustomer.id) {
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
                alert('Fehler beim Erstellen des Kunden. Bitte versuchen Sie es erneut.');
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
        initialCustomerName={formData.customerName}
      />

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
        onNavigateToCustomers={() => onNavigateToCustomers && onNavigateToCustomers()}
        onNavigateToSettings={() => onNavigateToSettings && onNavigateToSettings()}
        type={showRatesRedirectModal.type}
      />
    </div>
  );
}
