import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import logger from '../utils/logger';
import { Plus, Edit, Trash2, Archive, ArchiveRestore, Mail, Phone, MapPin, X, Clock, Package, Users, Upload, Download, Building2, UserRound, FileText, FileCheck, Briefcase, StickyNote } from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
import { useAuth } from '../context/AuthContext';
import { Customer, CustomerEmail, CustomerType, HourlyRate, MaterialTemplate } from '../types';
import { apiService } from '../services/api';
import { findDuplicateCustomer, buildDuplicateCustomerMessage, formatCustomerNumber } from '../utils/customerUtils';
import { PageHeader } from './PageHeader';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { ConfirmationModal } from './ConfirmationModal';
import { formatCurrency, getCurrencySymbol } from '../utils/formatters';
import { LocalizedNumberInput } from './LocalizedNumberInput';
import { getTerminology } from '../utils/terminology';
import { ImportWizard } from './ImportWizard';
import { DialogShell } from './DialogShell';
import { useElementWidth } from '../hooks/useElementWidth';
import { useFeedback } from '../context/FeedbackContext';
import { usePageSearch } from '../context/PageSearchContext';
import { downloadCustomerCsv, downloadCustomerPdf } from '../utils/customerExport';
import { SortableTableHeader } from './SortableTableHeader';
import { sortByTableState, type SortState } from '../utils/tableSort';

const formatCustomerAddress = (customer: Customer) => (
  [
    customer.address,
    [customer.postalCode, customer.city].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ')
);

interface CustomerManagementProps {
  initialFilter?: string;
  initialCustomerId?: string;
  onNavigate?: (page: string, filter?: string, searchTerm?: string, invoiceId?: string, jobSeriesId?: string) => void;
}

function customerTypeLabel(customerType?: CustomerType): string {
  return customerType === 'organization' ? 'Organisation' : 'Person';
}

function CustomerTypeIcon({ customerType, className = 'h-4 w-4' }: { customerType?: CustomerType; className?: string }) {
  const Icon = customerType === 'organization' ? Building2 : UserRound;
  return <Icon className={className} aria-hidden="true" />;
}

export function CustomerManagement({ initialFilter, initialCustomerId, onNavigate }: CustomerManagementProps = {}) {
  const { confirm, notify } = useFeedback();
  const { can } = useAuth();
  const canWrite = can('data.write');
  const { customers, addCustomer, updateCustomer, archiveCustomer, restoreCustomer, refreshCustomers } = useCustomers();
  const { company } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);
  const currencySymbol = getCurrencySymbol(company.locale, company.numberFormat, company.currency);
  const { query: searchTerm } = usePageSearch({ placeholder: terminology.entity.searchPlaceholder });
  const { ref: tableRef, width: tableWidth } = useElementWidth<HTMLDivElement>();
  const showAddressColumn = tableWidth >= 920;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [additionalEmails, setAdditionalEmails] = useState<CustomerEmail[]>([]);
  const [newEmailData, setNewEmailData] = useState({ email: '', label: '' });
  const [isAddingEmail, setIsAddingEmail] = useState(false);
  const [customerHourlyRates, setCustomerHourlyRates] = useState<HourlyRate[]>([]);
  const [editingHourlyRate, setEditingHourlyRate] = useState<HourlyRate | null>(null);
  const [isHourlyRateModalOpen, setIsHourlyRateModalOpen] = useState(false);
  const [isCreateHourlyRateModalOpen, setIsCreateHourlyRateModalOpen] = useState(false);
  const [newHourlyRateData, setNewHourlyRateData] = useState({
    name: '',
    description: '',
    rate: 0,
    taxRate: 19,
    isDefault: false
  });
  const [customerMaterials, setCustomerMaterials] = useState<MaterialTemplate[]>([]);
  const [editingMaterial, setEditingMaterial] = useState<MaterialTemplate | null>(null);
  const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false);
  const [isCreateMaterialModalOpen, setIsCreateMaterialModalOpen] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [deleteCustomerId, setDeleteCustomerId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [sortState, setSortState] = useState<SortState>({ key: 'customerNumber', direction: 'asc' });
  const [newMaterialData, setNewMaterialData] = useState({
    name: '',
    description: '',
    unitPrice: 0,
    unit: 'Stück',
    taxRate: 19,
    isDefault: false
  });
  const [formData, setFormData] = useState({
    customerNumber: '',
    name: '',
    customerType: 'person' as CustomerType,
    email: '',
    address: '',
    addressSupplement: '',
    city: '',
    postalCode: '',
    country: 'Deutschland',
    taxId: '',
    leitwegId: '',
    phone: '',
    notes: '',
  });
  const initialFormSnapshot = useRef('');
  const handledInitialNewCustomer = useRef(false);
  const handledInitialCustomerEdit = useRef(false);

  useEffect(() => {
    void refreshCustomers(showArchived).catch(error => logger.error('Error loading customer archive:', error));
  }, [refreshCustomers, showArchived]);

  const handleSort = (key: string) => setSortState(previous => previous.key === key
    ? { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: 'asc' });

  const filteredCustomers = useMemo(() => {
    const searchTermLower = searchTerm.toLocaleLowerCase(company.locale || 'de-DE');
    const filtered = customers.filter(customer => {
      const customerName = customer.name || '';
      const customerEmail = customer.email || '';
      return (
        customerName.toLocaleLowerCase(company.locale || 'de-DE').includes(searchTermLower) ||
        customerEmail.toLocaleLowerCase(company.locale || 'de-DE').includes(searchTermLower) ||
        (customer.customerNumber || '').toLocaleLowerCase(company.locale || 'de-DE').includes(searchTermLower) ||
        (customer.phone || '').toLocaleLowerCase(company.locale || 'de-DE').includes(searchTermLower) ||
        (customer.city || '').toLocaleLowerCase(company.locale || 'de-DE').includes(searchTermLower)
      );
    });
    return sortByTableState(filtered, sortState, (customer, key) => {
      if (key === 'name') return customer.name;
      if (key === 'email') return customer.email;
      if (key === 'phone') return customer.phone;
      if (key === 'address') return formatCustomerAddress(customer);
      return customer.customerNumber;
    }, company.locale || 'de-DE');
  }, [company.locale, customers, searchTerm, sortState]);

  const handleOpenModal = useCallback((customer?: Customer) => {
    if (!canWrite) {
      notify({ variant: 'warning', message: 'Sie haben in diesem Workspace nur Leserechte für Kunden.' });
      return;
    }

    if (customer) {
      setEditingCustomer(customer);
      setFormData({
        customerNumber: customer.customerNumber,
        name: customer.name,
        customerType: customer.customerType || 'person',
        email: customer.email,
        address: customer.address,
        addressSupplement: customer.addressSupplement || '',
        city: customer.city,
        postalCode: customer.postalCode,
        country: customer.country,
        taxId: customer.taxId || '',
        leitwegId: customer.leitwegId || '',
        phone: customer.phone || '',
        notes: customer.notes || '',
      });
      setAdditionalEmails(customer.additionalEmails || []);
      setCustomerHourlyRates(customer.hourlyRates || []);
      setCustomerMaterials(customer.materials || []);
      initialFormSnapshot.current = JSON.stringify({
        formData: {
          customerNumber: customer.customerNumber,
          name: customer.name,
          customerType: customer.customerType || 'person',
          email: customer.email,
          address: customer.address,
          addressSupplement: customer.addressSupplement || '',
          city: customer.city,
          postalCode: customer.postalCode,
          country: customer.country,
          taxId: customer.taxId || '',
          leitwegId: customer.leitwegId || '',
          phone: customer.phone || '',
          notes: customer.notes || '',
        },
        additionalEmails: customer.additionalEmails || [],
        customerHourlyRates: customer.hourlyRates || [],
        customerMaterials: customer.materials || [],
      });
    } else {
      setEditingCustomer(null);
      // Generate next customer number for display
      // Always format as 4-digit number with leading zeros (e.g., 0001, 0002, etc.)
      const existingNumbers = customers.map(c => parseInt(c.customerNumber)).filter(n => !isNaN(n));
      const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
      const customerNumber = String(nextNumber).padStart(4, '0');
      
      setFormData({
        customerNumber,
        name: '',
        customerType: 'person',
        email: '',
        address: '',
        addressSupplement: '',
        city: '',
        postalCode: '',
        country: 'Deutschland',
        taxId: '',
        leitwegId: '',
        phone: '',
        notes: '',
      });
      setAdditionalEmails([]);
      setCustomerHourlyRates([]);
      setCustomerMaterials([]);
      initialFormSnapshot.current = JSON.stringify({
        formData: {
          customerNumber,
          name: '',
          customerType: 'person',
          email: '',
          address: '',
          addressSupplement: '',
          city: '',
          postalCode: '',
          country: 'Deutschland',
          taxId: '',
          leitwegId: '',
          phone: '',
          notes: '',
        },
        additionalEmails: [],
        customerHourlyRates: [],
        customerMaterials: [],
      });
    }
    setNewEmailData({ email: '', label: '' });
    setIsAddingEmail(false);
    setEditingHourlyRate(null);
    setIsHourlyRateModalOpen(false);
    setIsCreateHourlyRateModalOpen(false);
    setNewHourlyRateData({
      name: '',
      description: '',
      rate: 0,
      taxRate: 19,
      isDefault: false
    });
    setEditingMaterial(null);
    setIsMaterialModalOpen(false);
    setIsCreateMaterialModalOpen(false);
    setNewMaterialData({
      name: '',
      description: '',
      unitPrice: 0,
      unit: 'Stück',
      taxRate: 19,
      isDefault: false
    });
    setIsModalOpen(true);
  }, [canWrite, customers, notify]);

  useEffect(() => {
    if (initialFilter !== 'new') {
      handledInitialNewCustomer.current = false;
      return;
    }
    if (handledInitialNewCustomer.current) return;
    handledInitialNewCustomer.current = true;
    handleOpenModal();
  }, [handleOpenModal, initialFilter]);

  useEffect(() => {
    if (initialFilter !== 'edit' || !initialCustomerId) {
      handledInitialCustomerEdit.current = false;
      return;
    }
    if (handledInitialCustomerEdit.current) return;
    const customer = customers.find(item => item.id === initialCustomerId);
    if (!customer) return;
    handledInitialCustomerEdit.current = true;
    handleOpenModal(customer);
  }, [customers, handleOpenModal, initialCustomerId, initialFilter]);

  const hasFormChanges = JSON.stringify({
    formData,
    additionalEmails,
    customerHourlyRates,
    customerMaterials,
  }) !== initialFormSnapshot.current;

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingCustomer(null);
    setIsHourlyRateModalOpen(false);
    setEditingHourlyRate(null);
    setIsCreateHourlyRateModalOpen(false);
    setIsMaterialModalOpen(false);
    setEditingMaterial(null);
    setIsCreateMaterialModalOpen(false);
  };

  const requestCloseModal = () => {
    if (isSavingCustomer) return;
    if (hasFormChanges) {
      setShowDiscardModal(true);
      return;
    }
    handleCloseModal();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canWrite || isSavingCustomer) return;
    setIsSavingCustomer(true);
    
    // Check for duplicates
    const existingCustomer = findDuplicateCustomer(customers, formData, editingCustomer?.id);
    
    if (existingCustomer) {
      const shouldContinue = await confirm({
        title: `${terminology.entity.singular} existiert bereits`,
        message: `${buildDuplicateCustomerMessage(existingCustomer, terminology.entity.singular, terminology.entity.numberShortLabel.replace(/\.$/, ''))}\n\nMöchten Sie trotzdem speichern?`,
        confirmText: 'Trotzdem speichern',
      });
      if (!shouldContinue) {
        setIsSavingCustomer(false);
        return;
      }
    }
    
    const isCreatingCustomer = !editingCustomer;
    const failedParts: string[] = [];

    try {
      if (editingCustomer) {
        await updateCustomer(editingCustomer.id, formData);
      } else {
        const newCustomer = await addCustomer(formData);

        const tempAdditionalEmails = additionalEmails.filter(email => email.id.startsWith('temp-'));
        for (const email of tempAdditionalEmails) {
          try {
            await apiService.addCustomerEmail(newCustomer.id, email.email, email.label);
          } catch (error) {
            logger.error('Error adding additional email:', error);
            failedParts.push('zusätzliche E-Mail-Adressen');
          }
        }

        const tempHourlyRates = customerHourlyRates.filter(rate => rate.id.startsWith('temp-'));
        for (const rate of tempHourlyRates) {
          try {
            await apiService.createCustomerHourlyRate(newCustomer.id, {
              name: rate.name,
              description: rate.description,
              rate: rate.rate,
              taxRate: rate.taxRate,
              isDefault: rate.isDefault
            });
          } catch (error) {
            logger.error('Error adding hourly rate:', error);
            failedParts.push('Stundensätze');
          }
        }

        const tempMaterials = customerMaterials.filter(material => material.id.startsWith('temp-'));
        for (const material of tempMaterials) {
          try {
            await apiService.createCustomerMaterial(newCustomer.id, {
              name: material.name,
              description: material.description,
              unitPrice: material.unitPrice,
              unit: material.unit,
              taxRate: material.taxRate,
              isDefault: material.isDefault
            });
          } catch (error) {
            logger.error('Error adding material:', error);
            failedParts.push('Materialien');
          }
        }
      }
    } catch (error) {
      logger.error('Error saving customer:', error);
      notify({ variant: 'error', message: `Fehler beim Speichern des ${terminology.entity.genitive}. Bitte versuchen Sie es erneut.` });
      setIsSavingCustomer(false);
      return;
    }

    // The main customer is already persisted. Close the dialog before the
    // refresh so a failed refresh cannot invite the user to submit twice.
    handleCloseModal();

    if (isCreatingCustomer) {
      try {
        await refreshCustomers(showArchived);
      } catch (error) {
        logger.error('Error refreshing customers after save:', error);
        failedParts.push('Aktualisierung der Kundenliste');
      }
    }

    if (failedParts.length > 0) {
      notify({
        variant: 'warning',
        title: `${terminology.entity.singular} nur teilweise gespeichert`,
        message: `Die Stammdaten wurden gespeichert. Nicht gespeichert: ${[...new Set(failedParts)].join(', ')}. Bitte prüfen Sie den ${terminology.entity.singular} und ergänzen Sie die fehlenden Daten.`,
      });
    } else {
      notify({ variant: 'success', message: `${terminology.entity.singular} wurde erfolgreich gespeichert.` });
    }

    setIsSavingCustomer(false);
  };

  const handleDelete = (id: string) => {
    if (!canWrite) {
      notify({ variant: 'warning', message: 'Sie haben in diesem Workspace nur Leserechte für Kunden.' });
      return;
    }
    setDeleteCustomerId(id);
  };

  const confirmDeleteCustomer = async () => {
    if (!deleteCustomerId || !canWrite) return;

    const id = deleteCustomerId;
    setDeleteCustomerId(null);
    try {
      await archiveCustomer(id);
      await refreshCustomers(showArchived);
    } catch (error) {
      logger.error('Error archiving customer:', error);
    }
  };

  const handleRestore = async (id: string) => {
    if (!canWrite) {
      notify({ variant: 'warning', message: 'Sie haben in diesem Workspace nur Leserechte für Kunden.' });
      return;
    }
    try {
      await restoreCustomer(id);
      await refreshCustomers(showArchived);
    } catch (error) {
      logger.error('Error restoring customer:', error);
    }
  };

  const handleAddEmail = async () => {
    if (!canWrite) return;
    if (!newEmailData.email.trim()) {
      notify({ variant: 'warning', message: 'Bitte geben Sie eine E-Mail-Adresse ein.' });
      return;
    }

    // Check if email already exists
    if (additionalEmails.some(email => email.email === newEmailData.email.trim())) {
      notify({ variant: 'warning', message: 'Diese E-Mail-Adresse wurde bereits hinzugefügt.' });
      return;
    }

    if (editingCustomer) {
      // Save to backend if editing existing customer
      try {
        const newEmail = await apiService.addCustomerEmail(
          editingCustomer.id,
          newEmailData.email.trim(),
          newEmailData.label.trim() || undefined
        );
        setAdditionalEmails([...additionalEmails, newEmail]);
      } catch (error) {
        logger.error('Error adding email:', error);
        notify({ variant: 'error', message: 'Fehler beim Hinzufügen der E-Mail-Adresse.' });
      }
    } else {
      // Add to local state for new customer
      const tempEmail: CustomerEmail = {
        id: `temp-${Date.now()}`,
        email: newEmailData.email.trim(),
        label: newEmailData.label.trim() || undefined,
        isActive: true
      };
      setAdditionalEmails([...additionalEmails, tempEmail]);
    }

    setNewEmailData({ email: '', label: '' });
    setIsAddingEmail(false);
  };

  const handleRemoveEmail = async (emailId: string) => {
    if (!canWrite) return;
    if (editingCustomer && !emailId.startsWith('temp-')) {
      // Remove from backend if editing existing customer
      try {
        await apiService.deleteCustomerEmail(editingCustomer.id, emailId);
        setAdditionalEmails(additionalEmails.filter(email => email.id !== emailId));
      } catch (error) {
        logger.error('Error removing email:', error);
        notify({ variant: 'error', message: 'Fehler beim Entfernen der E-Mail-Adresse.' });
      }
    } else {
      // Remove from local state
      setAdditionalEmails(additionalEmails.filter(email => email.id !== emailId));
    }
  };

  const handleCreateHourlyRate = async () => {
    if (!canWrite) return;
    if (!newHourlyRateData.name || newHourlyRateData.rate <= 0) {
      notify({ variant: 'warning', message: 'Bitte geben Sie mindestens einen Namen und einen gültigen Stundensatz ein.' });
      return;
    }

    if (editingCustomer) {
      // Save to backend if editing existing customer
      try {
        const newRate = await apiService.createCustomerHourlyRate(editingCustomer.id, newHourlyRateData);
        
        // Ensure rate value is properly converted to number
        const normalizedRate = {
          ...newRate,
          rate: Number(newRate.rate),
          taxRate: newRate.taxRate != null ? Number(newRate.taxRate) : 19
        };
        
        setCustomerHourlyRates([...customerHourlyRates, normalizedRate]);
        await refreshCustomers(); // Refresh AppContext
      } catch (error) {
        logger.error('Error creating customer hourly rate:', error);
        notify({ variant: 'error', message: 'Fehler beim Erstellen des Stundensatzes.' });
        return;
      }
    } else {
      // Add to local state for new customer
      const tempRate: HourlyRate = {
        id: `temp-${Date.now()}`,
        name: newHourlyRateData.name,
        description: newHourlyRateData.description,
        rate: newHourlyRateData.rate,
        taxRate: newHourlyRateData.taxRate,
        isDefault: newHourlyRateData.isDefault,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      setCustomerHourlyRates([...customerHourlyRates, tempRate]);
    }

    setIsCreateHourlyRateModalOpen(false);
    setNewHourlyRateData({
      name: '',
      description: '',
      rate: 0,
      taxRate: 19,
      isDefault: false
    });
  };

  const handleOpenHourlyRateModal = (rate: HourlyRate) => {
    if (!canWrite) return;
    setEditingHourlyRate(rate);
    setIsHourlyRateModalOpen(true);
  };

  const handleCloseHourlyRateModal = () => {
    setIsHourlyRateModalOpen(false);
    setEditingHourlyRate(null);
  };

  const handleOpenCreateHourlyRateModal = () => {
    if (!canWrite) return;
    setNewHourlyRateData({
      name: '',
      description: '',
      rate: 0,
      taxRate: 19,
      isDefault: false
    });
    setIsCreateHourlyRateModalOpen(true);
  };

  const handleCloseCreateHourlyRateModal = () => {
    setIsCreateHourlyRateModalOpen(false);
    setNewHourlyRateData({
      name: '',
      description: '',
      rate: 0,
      taxRate: 19,
      isDefault: false
    });
  };

  const handleUpdateHourlyRate = async (rateId: string, rateData: Partial<HourlyRate>) => {
    if (!canWrite) return;
    if (editingCustomer && !rateId.startsWith('temp-')) {
      // Update in backend if editing existing customer and not temporary
      try {
        const updatedRate = await apiService.updateCustomerHourlyRate(editingCustomer.id, rateId, rateData);
        
        // Ensure rate value is properly converted to number
        const normalizedRate = {
          ...updatedRate,
          rate: Number(updatedRate.rate),
          taxRate: updatedRate.taxRate != null ? Number(updatedRate.taxRate) : 19
        };
        
        setCustomerHourlyRates(customerHourlyRates.map(rate => 
          rate.id === rateId ? normalizedRate : rate
        ));
        await refreshCustomers(); // Refresh AppContext
      } catch (error) {
        logger.error('Error updating customer hourly rate:', error);
        notify({ variant: 'error', message: 'Fehler beim Aktualisieren des Stundensatzes.' });
        return;
      }
    } else {
      // Update in local state (temporary or new customer)
      const updatedLocalRate = {
        ...customerHourlyRates.find(rate => rate.id === rateId),
        ...rateData,
        rate: Number(rateData.rate || 0),
        taxRate: rateData.taxRate != null ? Number(rateData.taxRate) : 19
      } as HourlyRate;
      
      setCustomerHourlyRates(customerHourlyRates.map(rate => 
        rate.id === rateId ? updatedLocalRate : rate
      ));
    }
    
    setIsHourlyRateModalOpen(false);
    setEditingHourlyRate(null);
  };

  const handleDeleteHourlyRate = async (rateId: string) => {
    if (!canWrite) return;
    const confirmed = await confirm({
      title: 'Stundensatz löschen',
      message: 'Möchten Sie diesen Stundensatz wirklich löschen?',
      confirmText: 'Löschen',
      isDestructive: true,
    });
    if (confirmed) {
      if (editingCustomer && !rateId.startsWith('temp-')) {
        // Delete from backend if editing existing customer and not temporary
        try {
          await apiService.deleteCustomerHourlyRate(editingCustomer.id, rateId);
          setCustomerHourlyRates(customerHourlyRates.filter(rate => rate.id !== rateId));
          await refreshCustomers(); // Refresh AppContext
        } catch (error) {
          logger.error('Error deleting customer hourly rate:', error);
          notify({ variant: 'error', message: 'Fehler beim Löschen des Stundensatzes.' });
        }
      } else {
        // Remove from local state (temporary or new customer)
        setCustomerHourlyRates(customerHourlyRates.filter(rate => rate.id !== rateId));
      }
    }
  };

  // Material handlers
  const handleCreateMaterial = async () => {
    if (!canWrite) return;
    if (!newMaterialData.name || newMaterialData.unitPrice <= 0) {
      notify({ variant: 'warning', message: 'Bitte geben Sie mindestens einen Namen und einen gültigen Preis ein.' });
      return;
    }

    if (editingCustomer) {
      // Save to backend if editing existing customer
      try {
        const newMaterial = await apiService.createCustomerMaterial(editingCustomer.id, newMaterialData);
        
        // Ensure price value is properly converted to number
        const normalizedMaterial = {
          ...newMaterial,
          unitPrice: Number(newMaterial.unitPrice),
          taxRate: newMaterial.taxRate != null ? Number(newMaterial.taxRate) : 19
        };
        
        setCustomerMaterials([...customerMaterials, normalizedMaterial]);
        await refreshCustomers(); // Refresh AppContext
      } catch (error) {
        logger.error('Error creating customer material:', error);
        notify({ variant: 'error', message: 'Fehler beim Erstellen des Materials.' });
        return;
      }
    } else {
      // Add to local state for new customer
      const tempMaterial: MaterialTemplate = {
        id: `temp-${Date.now()}`,
        name: newMaterialData.name,
        description: newMaterialData.description,
        unitPrice: newMaterialData.unitPrice,
        unit: newMaterialData.unit,
        taxRate: newMaterialData.taxRate,
        isDefault: newMaterialData.isDefault,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      setCustomerMaterials([...customerMaterials, tempMaterial]);
    }

    setIsCreateMaterialModalOpen(false);
    setNewMaterialData({
      name: '',
      description: '',
      unitPrice: 0,
      unit: 'Stück',
      taxRate: 19,
      isDefault: false
    });
  };

  const handleOpenMaterialModal = (material: MaterialTemplate) => {
    if (!canWrite) return;
    setEditingMaterial(material);
    setIsMaterialModalOpen(true);
  };

  const handleCloseMaterialModal = () => {
    setIsMaterialModalOpen(false);
    setEditingMaterial(null);
  };

  const handleOpenCreateMaterialModal = () => {
    if (!canWrite) return;
    setNewMaterialData({
      name: '',
      description: '',
      unitPrice: 0,
      unit: 'Stück',
      taxRate: 19,
      isDefault: false
    });
    setIsCreateMaterialModalOpen(true);
  };

  const handleCloseCreateMaterialModal = () => {
    setIsCreateMaterialModalOpen(false);
    setNewMaterialData({
      name: '',
      description: '',
      unitPrice: 0,
      unit: 'Stück',
      taxRate: 19,
      isDefault: false
    });
  };

  const handleUpdateMaterial = async (materialId: string, materialData: Partial<MaterialTemplate>) => {
    if (!canWrite) return;
    if (editingCustomer && !materialId.startsWith('temp-')) {
      // Update in backend if editing existing customer and not temporary
      try {
        const updatedMaterial = await apiService.updateCustomerMaterial(editingCustomer.id, materialId, materialData);
        
        // Ensure price value is properly converted to number
        const normalizedMaterial = {
          ...updatedMaterial,
          unitPrice: Number(updatedMaterial.unitPrice),
          taxRate: updatedMaterial.taxRate != null ? Number(updatedMaterial.taxRate) : 19
        };
        
        setCustomerMaterials(customerMaterials.map(material => 
          material.id === materialId ? normalizedMaterial : material
        ));
        await refreshCustomers(); // Refresh AppContext
      } catch (error) {
        logger.error('Error updating customer material:', error);
        notify({ variant: 'error', message: 'Fehler beim Aktualisieren des Materials.' });
        return;
      }
    } else {
      // Update in local state (temporary or new customer)
      const updatedLocalMaterial = {
        ...customerMaterials.find(material => material.id === materialId),
        ...materialData,
        unitPrice: Number(materialData.unitPrice || 0),
        taxRate: materialData.taxRate != null ? Number(materialData.taxRate) : 19
      } as MaterialTemplate;
      
      setCustomerMaterials(customerMaterials.map(material => 
        material.id === materialId ? updatedLocalMaterial : material
      ));
    }
    
    setIsMaterialModalOpen(false);
    setEditingMaterial(null);
  };

  const handleDeleteMaterial = async (materialId: string) => {
    if (!canWrite) return;
    const confirmed = await confirm({
      title: 'Material löschen',
      message: 'Möchten Sie dieses Material wirklich löschen?',
      confirmText: 'Löschen',
      isDestructive: true,
    });
    if (confirmed) {
      if (editingCustomer && !materialId.startsWith('temp-')) {
        // Delete from backend if editing existing customer and not temporary
        try {
          await apiService.deleteCustomerMaterial(editingCustomer.id, materialId);
          setCustomerMaterials(customerMaterials.filter(material => material.id !== materialId));
          await refreshCustomers(); // Refresh AppContext
        } catch (error) {
          logger.error('Error deleting customer material:', error);
          notify({ variant: 'error', message: 'Fehler beim Löschen des Materials.' });
        }
      } else {
        // Remove from local state (temporary or new customer)
        setCustomerMaterials(customerMaterials.filter(material => material.id !== materialId));
      }
    }
  };

  const openCustomerPage = (customer: Customer, tab?: string) => {
    onNavigate?.('customer', customer.id, tab);
  };

  const renderCustomerActions = (customer: Customer) => (
    <ActionMenu containerClassName="shrink-0" menuClassName="min-w-56">
      <ActionMenuItem
        icon={<UserRound className="h-4 w-4" />}
        tone="blue"
        onClick={() => openCustomerPage(customer)}
      >
        Kundenseite öffnen
      </ActionMenuItem>
      {canWrite && (
        <>
          <ActionMenuItem
            icon={<Edit className="h-4 w-4" />}
            tone="indigo"
            onClick={() => handleOpenModal(customer)}
          >
            Bearbeiten
          </ActionMenuItem>
          <ActionMenuItem
            icon={<FileText className="h-4 w-4" />}
            tone="blue"
            onClick={() => onNavigate?.('invoices', 'new', customer.id)}
          >
            Rechnung schreiben
          </ActionMenuItem>
          {company.quotesEnabled && (
            <ActionMenuItem
              icon={<FileCheck className="h-4 w-4" />}
              tone="orange"
              onClick={() => onNavigate?.('quote-editor', 'new', customer.id)}
            >
              Angebot erstellen
            </ActionMenuItem>
          )}
          {company.jobTrackingEnabled && (
            <ActionMenuItem
              icon={<Briefcase className="h-4 w-4" />}
              tone="green"
              onClick={() => onNavigate?.('jobs', 'new', customer.id)}
            >
              {terminology.work.newLabel}
            </ActionMenuItem>
          )}
          <ActionMenuItem
            icon={<StickyNote className="h-4 w-4" />}
            tone="gray"
            onClick={() => openCustomerPage(customer, 'notes')}
          >
            Notiz hinzufügen
          </ActionMenuItem>
        </>
      )}
      <ActionMenuItem
        icon={<Download className="h-4 w-4" />}
        tone="gray"
        onClick={() => downloadCustomerCsv([customer], `kunde-${customer.customerNumber}`)}
      >
        Als CSV exportieren
      </ActionMenuItem>
      <ActionMenuItem
        icon={<Download className="h-4 w-4" />}
        tone="gray"
        onClick={() => downloadCustomerPdf([customer], `kunde-${customer.customerNumber}`)}
      >
        Als PDF exportieren
      </ActionMenuItem>
      {canWrite && (
        <ActionMenuItem
          icon={customer.isActive === false ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          tone={customer.isActive === false ? 'green' : 'red'}
          onClick={() => customer.isActive === false ? void handleRestore(customer.id) : handleDelete(customer.id)}
        >
          {customer.isActive === false ? 'Wiederherstellen' : 'Archivieren'}
        </ActionMenuItem>
      )}
    </ActionMenu>
  );

  return (
    <div className="page-root space-y-8">
      {/* Header */}
      <div className="page-header-slot flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <PageHeader icon={Users} title={terminology.entity.navLabel} subtitle={`Verwalten Sie Ihre ${terminology.entity.dataLabel}`}>
        <button
          type="button"
          onClick={() => setShowImport(true)}
          disabled={!canWrite}
          className="box-border inline-flex h-[38px] min-h-[38px] max-h-[38px] min-w-[38px] shrink-0 items-center justify-center gap-2 rounded-lg border border-primary-custom px-3 text-primary-custom transition hover:bg-primary-light-custom disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-0 sm:px-4"
          aria-label="Importieren"
          title={canWrite ? 'Importieren' : 'Nur-Lesen-Zugriff: Import nicht verfügbar'}
        >
          <Upload className="h-4 w-4" />
          <span className="hidden sm:inline">Importieren</span>
        </button>
        <ActionMenu
          ariaLabel="Export"
          title="Kunden exportieren"
          icon={<><Download className="h-4 w-4" /><span className="hidden sm:inline">Export</span></>}
          triggerClassName="action-menu-export-trigger"
          menuClassName="min-w-52"
        >
          <ActionMenuItem
            icon={<Download className="h-4 w-4" />}
            onClick={() => downloadCustomerCsv(filteredCustomers)}
            disabled={filteredCustomers.length === 0}
          >
            Als CSV exportieren
          </ActionMenuItem>
          <ActionMenuItem
            icon={<Download className="h-4 w-4" />}
            onClick={() => downloadCustomerPdf(filteredCustomers)}
            disabled={filteredCustomers.length === 0}
          >
            Als PDF exportieren
          </ActionMenuItem>
        </ActionMenu>
        <button
          onClick={() => handleOpenModal()}
          disabled={!canWrite}
          className="btn-primary box-border inline-flex h-[38px] min-h-[38px] max-h-[38px] min-w-[38px] shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-white transition-all duration-300 hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-0 sm:px-4"
          aria-label={terminology.entity.newLabel}
          title={canWrite ? terminology.entity.newLabel : 'Nur-Lesen-Zugriff: Anlegen nicht verfügbar'}
        >
          <Plus className="h-5 w-5" />
          <span className="hidden sm:inline">{terminology.entity.newLabel}</span>
        </button>
        </PageHeader>
      </div>

      {!canWrite && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Nur-Lesen-Zugriff</p>
          <p className="mt-1">Sie können Kundendaten ansehen, aber keine Kunden, Importe, Zusatzdaten oder Änderungen speichern.</p>
        </div>
      )}

      {/* Customer List */}
      <div className="overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <p className="text-sm text-gray-500">
            {filteredCustomers.length} {filteredCustomers.length === 1 ? terminology.entity.singular : terminology.entity.plural}
            {showArchived && <span className="ml-1">· Archiv inklusive</span>}
          </p>
          <label className="inline-flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-primary-custom focus:ring-primary-custom" />
            Archivierte anzeigen
          </label>
        </div>
        {/* Desktop Table View */}
        <div ref={tableRef} className="hidden w-full min-w-0 max-w-full overflow-x-auto tablet:block">
          <table className={`w-full ${showAddressColumn ? 'min-w-[980px]' : 'min-w-[780px]'}`}>
            <thead className="bg-gray-50">
              <tr>
                <SortableTableHeader label="Name" sortKey="name" activeKey={sortState.key} direction={sortState.direction} onSort={handleSort} className="px-5 py-3" />
                <SortableTableHeader label="Kunden-Nr." sortKey="customerNumber" activeKey={sortState.key} direction={sortState.direction} onSort={handleSort} className="w-32 px-4 py-3" />
                <SortableTableHeader label="E-Mail" sortKey="email" activeKey={sortState.key} direction={sortState.direction} onSort={handleSort} className="px-4 py-3" />
                <SortableTableHeader label="Telefon" sortKey="phone" activeKey={sortState.key} direction={sortState.direction} onSort={handleSort} className="px-4 py-3" />
                {showAddressColumn && <SortableTableHeader label="Adresse" sortKey="address" activeKey={sortState.key} direction={sortState.direction} onSort={handleSort} className="px-4 py-3" />}
                <th className="sticky right-0 z-20 w-14 bg-gray-50 px-2 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <span className="sr-only">Aktionen</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {filteredCustomers.map((customer) => (
                <tr key={customer.id} className="transition-colors hover:bg-gray-50">
                  <td className="max-w-[260px] px-5 py-3">
                    <button type="button" onClick={() => openCustomerPage(customer)} className="group flex min-w-0 items-start gap-2 text-left">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-custom/10 text-primary-custom">
                        <CustomerTypeIcon customerType={customer.customerType} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-gray-900 group-hover:text-primary-custom">{customer.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-gray-500">{customerTypeLabel(customer.customerType)}{customer.isActive === false ? ' · Archiviert' : ''}</span>
                        {(customer.taxId || customer.leitwegId) && <span className="mt-0.5 block truncate text-xs text-gray-500">{customer.taxId ? `USt-IdNr. ${customer.taxId}` : `Leitweg-ID ${customer.leitwegId}`}</span>}
                      </span>
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600 tabular-nums">{formatCustomerNumber(customer.customerNumber)}</td>
                  <td className="max-w-[220px] px-4 py-3 text-sm text-gray-700"><span className="block truncate">{customer.email || '–'}</span></td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{customer.phone || '–'}</td>
                  {showAddressColumn && <td className="max-w-[260px] px-4 py-3 text-sm text-gray-700"><span className="block truncate">{formatCustomerAddress(customer) || '–'}</span></td>}
                  <td className="sticky right-0 z-10 bg-white px-2 py-3 text-sm font-medium">
                    {renderCustomerActions(customer)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="tablet:hidden">
          {filteredCustomers.map((customer) => (
            <div key={customer.id} className="border-b border-gray-200 p-4 last:border-b-0">
              <div className="mb-3 flex items-start justify-between gap-3">
                <button type="button" onClick={() => openCustomerPage(customer)} className="group flex min-w-0 items-start gap-2 text-left">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-custom/10 text-primary-custom"><CustomerTypeIcon customerType={customer.customerType} /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-900 group-hover:text-primary-custom">{customer.name}</span>
                    <span className="block truncate text-xs text-gray-500">{customerTypeLabel(customer.customerType)} · {terminology.entity.numberShortLabel} {customer.customerNumber}</span>
                    {customer.isActive === false && <span className="block text-xs text-amber-600">Archiviert</span>}
                  </span>
                </button>
                {renderCustomerActions(customer)}
              </div>
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="flex min-w-0 items-center gap-2 text-gray-700"><Mail className="h-3.5 w-3.5 shrink-0 text-gray-400" /><span className="truncate">{customer.email || '–'}</span></div>
                <div className="flex min-w-0 items-center gap-2 text-gray-700"><Phone className="h-3.5 w-3.5 shrink-0 text-gray-400" /><span className="truncate">{customer.phone || '–'}</span></div>
                <div className="flex min-w-0 items-start gap-2 text-gray-600 sm:col-span-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" /><span className="break-words">{formatCustomerAddress(customer) || '–'}</span></div>
              </div>
            </div>
          ))}
        </div>

        {filteredCustomers.length === 0 && (
          <div className="p-8 text-center">
            <p className="text-gray-500">{searchTerm ? terminology.entity.noResults : showArchived ? `Keine ${terminology.entity.plural} gefunden.` : `Noch keine ${terminology.entity.plural} vorhanden.`}</p>
            {!searchTerm && canWrite && (
              <button type="button" onClick={() => handleOpenModal()} className="btn-primary mt-4 inline-flex min-h-9 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white">
                <Plus className="h-4 w-4" />
                {terminology.entity.newLabel}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      <ImportWizard
        resource="customers"
        isOpen={showImport && canWrite}
        onClose={() => setShowImport(false)}
        onImported={() => refreshCustomers(showArchived)}
      />

      {isModalOpen && (
        <DialogShell
          titleId="customer-dialog-title"
          icon={Users}
          title={editingCustomer ? terminology.entity.editLabel : terminology.entity.newLabel}
          description="Stammdaten, Kontakte und Konditionen verwalten."
          onClose={isSavingCustomer ? () => undefined : requestCloseModal}
          onSubmit={handleSubmit}
          size="wide"
          fitContent={!editingCustomer}
          zIndexClassName="z-[1000]"
          footer={(
            <>
              <button type="button" onClick={requestCloseModal} disabled={isSavingCustomer} className="min-h-12 flex-1 rounded-lg border border-gray-300 bg-white px-6 py-2 text-base font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none">Abbrechen</button>
              <button type="submit" disabled={isSavingCustomer} className="btn-primary min-h-12 flex-1 rounded-lg px-6 py-2 text-base font-semibold text-white transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none">{isSavingCustomer ? 'Speichern …' : editingCustomer ? 'Aktualisieren' : 'Erstellen'}</button>
            </>
          )}
        >
              <div className="space-y-4 pb-2">
              <div className="grid gap-3 tablet:grid-cols-[minmax(10rem,0.7fr)_minmax(0,1.3fr)]">
                <label className="block text-xs font-medium text-gray-700 sm:text-sm">
                  {terminology.entity.numberLabel}
                  <input
                    type="text"
                    value={formData.customerNumber}
                    disabled
                    className="form-input form-input-compact mt-1 w-full bg-gray-100 text-gray-600"
                  />
                </label>
                <fieldset>
                  <legend className="mb-1 text-xs font-medium text-gray-700 sm:text-sm">Kundenart</legend>
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Kundenart auswählen">
                    {(['person', 'organization'] as CustomerType[]).map(type => {
                      const selected = formData.customerType === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setFormData({ ...formData, customerType: type })}
                          className={`inline-flex h-[38px] min-h-[38px] max-h-[38px] items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ${selected ? 'border-primary-custom bg-primary-light-custom text-primary-custom' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
                        >
                          <CustomerTypeIcon customerType={type} className="h-4 w-4" />
                          {customerTypeLabel(type)}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 sm:text-sm">
                  {formData.customerType === 'organization' ? 'Name der Organisation' : 'Name'} *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="form-input form-input-compact w-full"
                />
              </div>
              <div className="grid gap-3 tablet:grid-cols-2">
                <label className="block min-w-0 text-xs font-medium text-gray-700 sm:text-sm">
                  E-Mail
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="form-input form-input-compact mt-1 w-full"
                    placeholder="optional"
                  />
                </label>
                <label className="block min-w-0 text-xs font-medium text-gray-700 sm:text-sm">
                  Telefon
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="form-input form-input-compact mt-1 w-full"
                  />
                </label>
              </div>
              <div className="grid gap-3 tablet:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
                <label className="block min-w-0 text-xs font-medium text-gray-700 sm:text-sm">
                  Adresse *
                  <input
                    type="text"
                    required
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="form-input form-input-compact mt-1 w-full"
                  />
                </label>
                <label className="block min-w-0 text-xs font-medium text-gray-700 sm:text-sm">
                  Adresszusatz
                  <input
                    type="text"
                    value={formData.addressSupplement}
                    onChange={(e) => setFormData({ ...formData, addressSupplement: e.target.value })}
                    className="form-input form-input-compact mt-1 w-full"
                    placeholder="z. B. 2. Stock"
                  />
                </label>
              </div>
              <div className="grid gap-3 tablet:grid-cols-[minmax(7rem,0.65fr)_minmax(0,1.35fr)_minmax(9rem,0.8fr)]">
                <label className="block min-w-0 text-xs font-medium text-gray-700 sm:text-sm">
                  PLZ *
                  <input
                    type="text"
                    required
                    value={formData.postalCode}
                    onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                    className="form-input form-input-compact mt-1 w-full"
                  />
                </label>
                <label className="block min-w-0 text-xs font-medium text-gray-700 sm:text-sm">
                  Stadt *
                  <input
                    type="text"
                    required
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="form-input form-input-compact mt-1 w-full"
                  />
                </label>
                <label className="block min-w-0 text-xs font-medium text-gray-700 sm:text-sm">
                  Land *
                  <input
                    type="text"
                    required
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    className="form-input form-input-compact mt-1 w-full"
                  />
                </label>
              </div>
              <div className="grid gap-3 tablet:grid-cols-2">
                <label className="block min-w-0 text-xs font-medium text-gray-700 sm:text-sm">
                  USt-IdNr.
                  <input
                    type="text"
                    value={formData.taxId}
                    onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
                    className="form-input form-input-compact mt-1 w-full"
                  />
                </label>
                <label className="block min-w-0 text-xs font-medium text-gray-700 sm:text-sm">
                  Leitweg-ID (XRechnung)
                  <input
                    type="text"
                    value={formData.leitwegId}
                    onChange={(e) => setFormData({ ...formData, leitwegId: e.target.value })}
                    placeholder="z. B. 991-12345-67"
                    className="form-input form-input-compact mt-1 w-full"
                  />
                </label>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 sm:text-sm">
                  Notizen
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  maxLength={5000}
                  rows={3}
                  className="form-input w-full resize-y"
                  placeholder="Interne Hinweise zum Kunden"
                />
              </div>

              {/* Additional Email Addresses */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-700">
                    Zusätzliche E-Mail-Adressen
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsAddingEmail(true)}
                    disabled={!canWrite}
                    className="flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Hinzufügen</span>
                  </button>
                </div>

                {/* Existing Additional Emails */}
                {additionalEmails.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {additionalEmails.map((email) => (
                      <div key={email.id} className="flex items-center space-x-2 p-2 bg-gray-50 rounded-lg">
                        <Mail className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {email.email}
                          </div>
                          {email.label && (
                            <div className="text-xs text-gray-500">{email.label}</div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveEmail(email.id)}
                          disabled={!canWrite}
                          className="p-1 text-red-500 hover:text-red-700 flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add New Email Form */}
                {isAddingEmail && (
                  <div className="p-3 border border-gray-200 rounded-lg bg-blue-50 space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        E-Mail-Adresse *
                      </label>
                      <input
                        type="email"
                        required
                        value={newEmailData.email}
                        onChange={(e) => setNewEmailData({ ...newEmailData, email: e.target.value })}
                        className="form-input form-input-compact"
                        placeholder="name@example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Bezeichnung (optional)
                      </label>
                      <input
                        type="text"
                        value={newEmailData.label}
                        onChange={(e) => setNewEmailData({ ...newEmailData, label: e.target.value })}
                        className="form-input form-input-compact"
                        placeholder="z.B. Buchhaltung, Geschäftsführung"
                      />
                    </div>
                    <div className="flex space-x-2">
                      <button
                        type="button"
                        onClick={handleAddEmail}
                        disabled={!canWrite}
                        className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Hinzufügen
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingEmail(false);
                          setNewEmailData({ email: '', label: '' });
                        }}
                        className="px-3 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors text-sm"
                      >
                        Abbrechen
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Customer-specific hourly rates */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-700">
                    {terminology.entity.specificLabel.charAt(0).toUpperCase() + terminology.entity.specificLabel.slice(1)} Stundensätze
                  </label>
                  <button
                    type="button"
                    onClick={handleOpenCreateHourlyRateModal}
                    disabled={!canWrite}
                    className="flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Hinzufügen</span>
                  </button>
                </div>
                
                {!editingCustomer && (
                  <p className="text-xs text-gray-500 mb-3">
                    Stundensätze werden beim Speichern des {terminology.entity.genitive} automatisch angelegt.
                  </p>
                )}

                {/* Existing Customer Hourly Rates */}
                {customerHourlyRates.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {customerHourlyRates.map((rate) => (
                      <div key={rate.id} className="flex items-center space-x-2 p-3 bg-gray-50 rounded-lg">
                        <Clock className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900">
                            {rate.name}
                            {rate.isDefault && <span className="ml-2 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs">Standard</span>}
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatCurrency(rate.rate != null ? Number(rate.rate) : 0, company?.locale || 'de-DE', company?.numberFormat, company?.currency)}/h • MwSt: {rate.taxRate != null ? rate.taxRate : 19}%
                            {rate.description && ` • ${rate.description}`}
                          </div>
                        </div>
                        <div className="flex space-x-1">
                          <button
                            type="button"
                            onClick={() => handleOpenHourlyRateModal(rate)}
                            disabled={!canWrite}
                            className="p-1 text-blue-600 hover:text-blue-800 flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Bearbeiten"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteHourlyRate(rate.id)}
                            disabled={!canWrite}
                            className="p-1 text-red-500 hover:text-red-700 flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Löschen"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}


                
                {customerHourlyRates.length === 0 && editingCustomer && (
                  <p className="text-xs text-gray-500 italic">
                    Keine {terminology.entity.specificLabel} Stundensätze konfiguriert. Es werden die Standard-Stundensätze verwendet.
                  </p>
                )}
              </div>

              {/* Customer-specific materials */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-700">
                    {terminology.entity.specificLabel.charAt(0).toUpperCase() + terminology.entity.specificLabel.slice(1)} Materialien
                  </label>
                  <button
                    type="button"
                    onClick={handleOpenCreateMaterialModal}
                    disabled={!canWrite}
                    className="flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Hinzufügen</span>
                  </button>
                </div>
                
                {!editingCustomer && (
                  <p className="text-xs text-gray-500 mb-3">
                    Materialien werden beim Speichern des {terminology.entity.genitive} automatisch angelegt.
                  </p>
                )}

                {/* Existing Customer Materials */}
                {customerMaterials.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {customerMaterials.map((material) => (
                      <div key={material.id} className="flex items-center space-x-2 p-3 bg-gray-50 rounded-lg">
                        <Package className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900">
                            {material.name}
                            {material.isDefault && <span className="ml-2 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs">Standard</span>}
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatCurrency(material.unitPrice != null ? Number(material.unitPrice) : 0, company?.locale || 'de-DE', company?.numberFormat, company?.currency)}/{material.unit} • MwSt: {material.taxRate != null ? material.taxRate : 19}%
                            {material.description && ` • ${material.description}`}
                          </div>
                        </div>
                        <div className="flex space-x-1">
                          <button
                            type="button"
                            onClick={() => handleOpenMaterialModal(material)}
                            disabled={!canWrite}
                            className="p-1 text-blue-600 hover:text-blue-800 flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Bearbeiten"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMaterial(material.id)}
                            disabled={!canWrite}
                            className="p-1 text-red-500 hover:text-red-700 flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Löschen"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}


                
                {customerMaterials.length === 0 && editingCustomer && (
                  <p className="text-xs text-gray-500 italic">
                    Keine {terminology.entity.specificLabel} Materialien konfiguriert. Es werden die Standard-Materialien verwendet.
                  </p>
                )}
              </div>

              </div>
        </DialogShell>
      )}

      <ConfirmationModal
        isOpen={showDiscardModal}
        onClose={() => setShowDiscardModal(false)}
        onConfirm={() => {
          setShowDiscardModal(false);
          handleCloseModal();
        }}
        title="Änderungen verwerfen?"
        message="Es gibt ungespeicherte Änderungen. Möchten Sie diese wirklich verwerfen?"
        confirmText="Änderungen verwerfen"
        cancelText="Weiter bearbeiten"
        isDestructive
      />

      <ConfirmationModal
        isOpen={deleteCustomerId !== null}
        onClose={() => setDeleteCustomerId(null)}
        onConfirm={confirmDeleteCustomer}
        title={`${terminology.entity.plural} archivieren?`}
        message={`Möchten Sie diesen ${terminology.entity.accusative} archivieren? Historische Dokumente bleiben erhalten.`}
        confirmText="Archivieren"
        cancelText="Abbrechen"
        isDestructive
      />

      {/* Hourly Rate Edit Modal */}
      {isHourlyRateModalOpen && editingHourlyRate && (
        <DialogShell
          titleId="hourly-rate-dialog-title"
          icon={Clock}
          title="Stundensatz bearbeiten"
          description="Pflegen Sie Bezeichnung, Preis und steuerliche Zuordnung."
          onClose={handleCloseHourlyRateModal}
          size="md"
          zIndexClassName="z-[1000]"
        >
            <HourlyRateEditForm
              rate={editingHourlyRate}
              currencySymbol={currencySymbol}
              locale={company.locale || 'de-DE'}
              numberFormat={company.numberFormat}
              onSave={(updatedData) => handleUpdateHourlyRate(editingHourlyRate.id, updatedData)}
              onCancel={handleCloseHourlyRateModal}
            />
        </DialogShell>
      )}

      {/* Material Edit Modal */}
      {isMaterialModalOpen && editingMaterial && (
        <DialogShell
          titleId="material-dialog-title"
          icon={Package}
          title="Material bearbeiten"
          description="Pflegen Sie Bezeichnung, Preis, Einheit und Steuer."
          onClose={handleCloseMaterialModal}
          size="md"
          zIndexClassName="z-[1000]"
        >
            <MaterialEditForm
              material={editingMaterial}
              currencySymbol={currencySymbol}
              locale={company.locale || 'de-DE'}
              numberFormat={company.numberFormat}
              onSave={(updatedData) => handleUpdateMaterial(editingMaterial.id, updatedData)}
              onCancel={handleCloseMaterialModal}
            />
        </DialogShell>
      )}

      {/* Create Hourly Rate Modal */}
      {isCreateHourlyRateModalOpen && (
        <div className="dialog-overlay fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Neuer Stundensatz
              </h3>
              <button
                onClick={handleCloseCreateHourlyRateModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="w-full space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={newHourlyRateData.name}
                    onChange={(e) => setNewHourlyRateData({ ...newHourlyRateData, name: e.target.value })}
            className="form-input form-input-compact text-sm"
                    placeholder="z.B. Standard, Anfahrt, Überstunden"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Stundensatz ({currencySymbol}) *
                  </label>
                  <LocalizedNumberInput
                    step="0.01"
                    min="0"
                    value={newHourlyRateData.rate}
                    locale={company.locale}
                    numberFormat={company.numberFormat}
                    onValueChange={(value) => setNewHourlyRateData({ ...newHourlyRateData, rate: value === '' ? 0 : value })}
            className="form-input form-input-compact text-sm"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Beschreibung
                </label>
                <textarea
                  value={newHourlyRateData.description}
                  onChange={(e) => setNewHourlyRateData({ ...newHourlyRateData, description: e.target.value })}
          className="form-input text-sm"
                  placeholder="Optionale Beschreibung..."
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    MwSt. (%)
                  </label>
                  <select
                    value={newHourlyRateData.taxRate}
                    onChange={(e) => setNewHourlyRateData({ ...newHourlyRateData, taxRate: parseFloat(e.target.value) })}
          className="form-input form-input-compact text-sm"
                  >
                    <option value={0}>0%</option>
                    <option value={7}>7%</option>
                    <option value={19}>19%</option>
                  </select>
                </div>
                <div className="flex items-center pt-6">
                  <input
                    type="checkbox"
                    id="createRateDefault"
                    checked={newHourlyRateData.isDefault}
                    onChange={(e) => setNewHourlyRateData({ ...newHourlyRateData, isDefault: e.target.checked })}
                    className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-primary-custom rounded"
                  />
                  <label htmlFor="createRateDefault" className="ml-2 text-sm text-gray-700">
                    Als Standard markieren
                  </label>
                </div>
              </div>
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={handleCreateHourlyRate}
                  className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                >
                  Erstellen
                </button>
                <button
                  type="button"
                  onClick={handleCloseCreateHourlyRateModal}
                  className="px-3 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors text-sm"
                >
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Material Modal */}
      {isCreateMaterialModalOpen && (
        <div className="dialog-overlay fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Neues Material
              </h3>
              <button
                onClick={handleCloseCreateMaterialModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="w-full space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={newMaterialData.name}
                    onChange={(e) => setNewMaterialData({ ...newMaterialData, name: e.target.value })}
          className="form-input form-input-compact text-sm"
                    placeholder="z.B. Kleinmaterial, Kabel, Schrauben"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Preis ({currencySymbol}) *
                  </label>
                  <LocalizedNumberInput
                    step="0.01"
                    min="0"
                    value={newMaterialData.unitPrice}
                    locale={company.locale}
                    numberFormat={company.numberFormat}
                    onValueChange={(value) => setNewMaterialData({ ...newMaterialData, unitPrice: value === '' ? 0 : value })}
                    className="form-input form-input-compact text-sm"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Beschreibung
                </label>
                <textarea
                  value={newMaterialData.description}
                  onChange={(e) => setNewMaterialData({ ...newMaterialData, description: e.target.value })}
          className="form-input text-sm"
                  placeholder="Optionale Beschreibung..."
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Einheit
                  </label>
                  <input
                    type="text"
                    value={newMaterialData.unit}
                    onChange={(e) => setNewMaterialData({ ...newMaterialData, unit: e.target.value })}
          className="form-input form-input-compact text-sm"
                    placeholder="z.B. Stück, Meter, kg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    MwSt. (%)
                  </label>
                  <select
                    value={newMaterialData.taxRate}
                    onChange={(e) => setNewMaterialData({ ...newMaterialData, taxRate: parseFloat(e.target.value) })}
          className="form-input form-input-compact text-sm"
                  >
                    <option value={0}>0%</option>
                    <option value={7}>7%</option>
                    <option value={19}>19%</option>
                  </select>
                </div>
                <div className="flex items-center pt-6">
                  <input
                    type="checkbox"
                    id="createMaterialDefault"
                    checked={newMaterialData.isDefault}
                    onChange={(e) => setNewMaterialData({ ...newMaterialData, isDefault: e.target.checked })}
                    className="h-4 w-4 text-green-600 border-gray-300 focus:ring-green-500 rounded"
                  />
                  <label htmlFor="createMaterialDefault" className="ml-2 text-sm text-gray-700">
                    Als Standard markieren
                  </label>
                </div>
              </div>
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={handleCreateMaterial}
                  className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                >
                  Erstellen
                </button>
                <button
                  type="button"
                  onClick={handleCloseCreateMaterialModal}
                  className="px-3 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors text-sm"
                >
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// HourlyRateEditForm component for inline editing
interface HourlyRateEditFormProps {
  rate: HourlyRate;
  currencySymbol: string;
  locale: string;
  numberFormat?: import('../types').NumberFormat;
  onSave: (data: Partial<HourlyRate>) => void;
  onCancel: () => void;
}

function HourlyRateEditForm({ rate, currencySymbol, locale, numberFormat, onSave, onCancel }: HourlyRateEditFormProps) {
  const { notify } = useFeedback();
  const [formData, setFormData] = useState({
    name: rate.name,
    description: rate.description || '',
    rate: rate.rate,
    taxRate: rate.taxRate != null ? rate.taxRate : 19,
    isDefault: rate.isDefault || false
  });

  const handleSave = () => {
    if (!formData.name || formData.rate <= 0) {
      notify({ variant: 'warning', message: 'Bitte geben Sie mindestens einen Namen und einen gültigen Stundensatz ein.' });
      return;
    }
    onSave(formData);
  };

  return (
    <div className="w-full space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Name *
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="form-input form-input-compact text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Stundensatz ({currencySymbol}) *
          </label>
          <LocalizedNumberInput
            step="0.01"
            min="0"
            value={formData.rate}
            locale={locale}
            numberFormat={numberFormat}
            onValueChange={(value) => setFormData({ ...formData, rate: value === '' ? 0 : value })}
                    className="form-input form-input-compact text-sm"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Beschreibung
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="form-input text-sm"
          rows={2}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            MwSt. (%)
          </label>
          <select
            value={formData.taxRate}
            onChange={(e) => setFormData({ ...formData, taxRate: parseFloat(e.target.value) })}
          className="form-input form-input-compact text-sm"
          >
            <option value={0}>0%</option>
            <option value={7}>7%</option>
            <option value={19}>19%</option>
          </select>
        </div>
        <div className="flex items-center pt-6">
          <input
            type="checkbox"
            id={`editRateDefault-${rate.id}`}
            checked={formData.isDefault}
            onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
            className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-primary-custom rounded"
          />
          <label htmlFor={`editRateDefault-${rate.id}`} className="ml-2 text-sm text-gray-700">
            Als Standard markieren
          </label>
        </div>
      </div>
      <div className="flex space-x-2">
        <button
          type="button"
          onClick={handleSave}
          className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
        >
          Speichern
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors text-sm"
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}

// MaterialEditForm component for inline editing
interface MaterialEditFormProps {
  material: MaterialTemplate;
  currencySymbol: string;
  locale: string;
  numberFormat?: import('../types').NumberFormat;
  onSave: (data: Partial<MaterialTemplate>) => void;
  onCancel: () => void;
}

function MaterialEditForm({ material, currencySymbol, locale, numberFormat, onSave, onCancel }: MaterialEditFormProps) {
  const { notify } = useFeedback();
  const [formData, setFormData] = useState({
    name: material.name,
    description: material.description || '',
    unitPrice: material.unitPrice,
    unit: material.unit,
    taxRate: material.taxRate != null ? material.taxRate : 19,
    isDefault: material.isDefault || false
  });

  const handleSave = () => {
    if (!formData.name || formData.unitPrice <= 0) {
      notify({ variant: 'warning', message: 'Bitte geben Sie mindestens einen Namen und einen gültigen Preis ein.' });
      return;
    }
    onSave(formData);
  };

  return (
    <div className="w-full space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Name *
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="form-input form-input-compact text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Preis ({currencySymbol}) *
          </label>
          <LocalizedNumberInput
            step="0.01"
            min="0"
            value={formData.unitPrice}
            locale={locale}
            numberFormat={numberFormat}
            onValueChange={(value) => setFormData({ ...formData, unitPrice: value === '' ? 0 : value })}
                    className="form-input form-input-compact text-sm"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Beschreibung
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="form-input text-sm"
          rows={2}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Einheit
          </label>
          <input
            type="text"
            value={formData.unit}
            onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
          className="form-input form-input-compact text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            MwSt. (%)
          </label>
          <select
            value={formData.taxRate}
            onChange={(e) => setFormData({ ...formData, taxRate: parseFloat(e.target.value) })}
          className="form-input form-input-compact text-sm"
          >
            <option value={0}>0%</option>
            <option value={7}>7%</option>
            <option value={19}>19%</option>
          </select>
        </div>
        <div className="flex items-center pt-6">
          <input
            type="checkbox"
            id={`editMaterialDefault-${material.id}`}
            checked={formData.isDefault}
            onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
            className="h-4 w-4 text-green-600 border-gray-300 focus:ring-green-500 rounded"
          />
          <label htmlFor={`editMaterialDefault-${material.id}`} className="ml-2 text-sm text-gray-700">
            Als Standard markieren
          </label>
        </div>
      </div>
      <div className="flex space-x-2">
        <button
          type="button"
          onClick={handleSave}
          className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
        >
          Speichern
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors text-sm"
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}
