import React, { useState } from 'react';
import logger from '../utils/logger';
import { Plus, Edit, Trash2, Search, Mail, Phone, MapPin, X, Clock, Package, Users } from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { Customer, CustomerEmail, HourlyRate, MaterialTemplate } from '../types';
import { apiService } from '../services/api';
import { findDuplicateCustomer, showDuplicateCustomerAlert, formatCustomerNumber } from '../utils/customerUtils';
import { PageHeader } from './PageHeader';

export function CustomerManagement() {
  const { customers, addCustomer, updateCustomer, deleteCustomer, refreshCustomers } = useCustomers();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [additionalEmails, setAdditionalEmails] = useState<CustomerEmail[]>([]);
  const [newEmailData, setNewEmailData] = useState({ email: '', label: '' });
  const [isAddingEmail, setIsAddingEmail] = useState(false);
  const [customerHourlyRates, setCustomerHourlyRates] = useState<HourlyRate[]>([]);
  const [isAddingHourlyRate, setIsAddingHourlyRate] = useState(false);
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
  const [isAddingMaterial, setIsAddingMaterial] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<MaterialTemplate | null>(null);
  const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false);
  const [isCreateMaterialModalOpen, setIsCreateMaterialModalOpen] = useState(false);
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
    email: '',
    address: '',
    addressSupplement: '',
    city: '',
    postalCode: '',
    country: 'Deutschland',
    taxId: '',
    phone: '',
  });

  const filteredCustomers = customers.filter(customer => {
    const customerName = customer.name || '';
    const customerEmail = customer.email || '';
    const searchTermLower = searchTerm.toLowerCase();
    
    return (
      customerName.toLowerCase().includes(searchTermLower) ||
      customerEmail.toLowerCase().includes(searchTermLower)
    );
  });

  const handleOpenModal = (customer?: Customer) => {
    if (customer) {
      setEditingCustomer(customer);
      setFormData({
        customerNumber: customer.customerNumber,
        name: customer.name,
        email: customer.email,
        address: customer.address,
        addressSupplement: customer.addressSupplement || '',
        city: customer.city,
        postalCode: customer.postalCode,
        country: customer.country,
        taxId: customer.taxId || '',
        phone: customer.phone || '',
      });
      setAdditionalEmails(customer.additionalEmails || []);
      setCustomerHourlyRates(customer.hourlyRates || []);
      setCustomerMaterials(customer.materials || []);
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
        email: '',
        address: '',
        addressSupplement: '',
        city: '',
        postalCode: '',
        country: 'Deutschland',
        taxId: '',
        phone: '',
      });
      setAdditionalEmails([]);
      setCustomerHourlyRates([]);
      setCustomerMaterials([]);
    }
    setNewEmailData({ email: '', label: '' });
    setIsAddingEmail(false);
    setIsAddingHourlyRate(false);
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
    setIsAddingMaterial(false);
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
  };

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check for duplicates
    const existingCustomer = findDuplicateCustomer(customers, formData, editingCustomer?.id);
    
    if (existingCustomer) {
      const shouldContinue = showDuplicateCustomerAlert(existingCustomer);
      if (!shouldContinue) {
        return; // Nur abbrechen wenn der Benutzer "Abbrechen" wählt
      }
    }
    
    try {
      if (editingCustomer) {
        await updateCustomer(editingCustomer.id, formData);
      } else {
        // Create new customer
        const newCustomer = await addCustomer(formData);
        
        // Add additional emails for new customer (only those that are temporary)
        const tempAdditionalEmails = additionalEmails.filter(email => email.id.startsWith('temp-'));
        for (const email of tempAdditionalEmails) {
          try {
            await apiService.addCustomerEmail(newCustomer.id, email.email, email.label);
          } catch (error) {
            logger.error('Error adding additional email:', error);
          }
        }

        // Add temporary hourly rates for new customer
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
          }
        }

        // Add temporary materials for new customer
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
          }
        }
      }
      handleCloseModal();
      
      // Refresh customers in case new emails/rates/materials were added
      if (!editingCustomer) {
        await refreshCustomers();
      }
    } catch (error) {
      logger.error('Error saving customer:', error);
      alert('Fehler beim Speichern des Kunden. Bitte versuchen Sie es erneut.');
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Möchten Sie diesen Kunden wirklich löschen?')) {
      try {
        await deleteCustomer(id);
      } catch (error) {
        logger.error('Error deleting customer:', error);
        // You might want to show an error message to the user here
      }
    }
  };

  const handleAddEmail = async () => {
    if (!newEmailData.email.trim()) {
      alert('Bitte geben Sie eine E-Mail-Adresse ein.');
      return;
    }

    // Check if email already exists
    if (additionalEmails.some(email => email.email === newEmailData.email.trim())) {
      alert('Diese E-Mail-Adresse wurde bereits hinzugefügt.');
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
        alert('Fehler beim Hinzufügen der E-Mail-Adresse.');
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
    if (editingCustomer && !emailId.startsWith('temp-')) {
      // Remove from backend if editing existing customer
      try {
        await apiService.deleteCustomerEmail(editingCustomer.id, emailId);
        setAdditionalEmails(additionalEmails.filter(email => email.id !== emailId));
      } catch (error) {
        logger.error('Error removing email:', error);
        alert('Fehler beim Entfernen der E-Mail-Adresse.');
      }
    } else {
      // Remove from local state
      setAdditionalEmails(additionalEmails.filter(email => email.id !== emailId));
    }
  };

  const handleCreateHourlyRate = async () => {
    if (!newHourlyRateData.name || newHourlyRateData.rate <= 0) {
      alert('Bitte geben Sie mindestens einen Namen und einen gültigen Stundensatz ein.');
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
        alert('Fehler beim Erstellen des Stundensatzes.');
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
    setEditingHourlyRate(rate);
    setIsHourlyRateModalOpen(true);
  };

  const handleCloseHourlyRateModal = () => {
    setIsHourlyRateModalOpen(false);
    setEditingHourlyRate(null);
  };

  const handleOpenCreateHourlyRateModal = () => {
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
        alert('Fehler beim Aktualisieren des Stundensatzes.');
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
    if (window.confirm('Möchten Sie diesen Stundensatz wirklich löschen?')) {
      if (editingCustomer && !rateId.startsWith('temp-')) {
        // Delete from backend if editing existing customer and not temporary
        try {
          await apiService.deleteCustomerHourlyRate(editingCustomer.id, rateId);
          setCustomerHourlyRates(customerHourlyRates.filter(rate => rate.id !== rateId));
          await refreshCustomers(); // Refresh AppContext
        } catch (error) {
          logger.error('Error deleting customer hourly rate:', error);
          alert('Fehler beim Löschen des Stundensatzes.');
        }
      } else {
        // Remove from local state (temporary or new customer)
        setCustomerHourlyRates(customerHourlyRates.filter(rate => rate.id !== rateId));
      }
    }
  };

  // Material handlers
  const handleCreateMaterial = async () => {
    if (!newMaterialData.name || newMaterialData.unitPrice <= 0) {
      alert('Bitte geben Sie mindestens einen Namen und einen gültigen Preis ein.');
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
        alert('Fehler beim Erstellen des Materials.');
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
    setEditingMaterial(material);
    setIsMaterialModalOpen(true);
  };

  const handleCloseMaterialModal = () => {
    setIsMaterialModalOpen(false);
    setEditingMaterial(null);
  };

  const handleOpenCreateMaterialModal = () => {
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
        alert('Fehler beim Aktualisieren des Materials.');
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
    if (window.confirm('Möchten Sie dieses Material wirklich löschen?')) {
      if (editingCustomer && !materialId.startsWith('temp-')) {
        // Delete from backend if editing existing customer and not temporary
        try {
          await apiService.deleteCustomerMaterial(editingCustomer.id, materialId);
          setCustomerMaterials(customerMaterials.filter(material => material.id !== materialId));
          await refreshCustomers(); // Refresh AppContext
        } catch (error) {
          logger.error('Error deleting customer material:', error);
          alert('Fehler beim Löschen des Materials.');
        }
      } else {
        // Remove from local state (temporary or new customer)
        setCustomerMaterials(customerMaterials.filter(material => material.id !== materialId));
      }
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <PageHeader icon={Users} title="Kunden" subtitle="Verwalten Sie Ihre Kundendaten">
        <button
          onClick={() => handleOpenModal()}
          className="btn-primary text-white px-4 py-2 rounded-xl flex items-center justify-center space-x-2 hover:brightness-90 transition-all duration-300 hover:scale-105"
        >
          <Plus className="h-5 w-5" />
          <span className="hidden sm:inline">Neuer Kunde</span>
          <span className="sm:hidden">Neu</span>
        </button>
        </PageHeader>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="relative">
          <Search className="h-5 w-5 absolute left-3 top-3 text-gray-400" />
          <input
            type="text"
            placeholder="Kunden suchen..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Customer List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        {/* Desktop Table View */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Kontakt
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Adresse
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Aktionen
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredCustomers.map((customer) => (
                <tr key={customer.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{customer.name}</div>
                    <div className="text-sm text-gray-500">Kunden-Nr: {formatCustomerNumber(customer.customerNumber)}</div>
                    {customer.taxId && (
                      <div className="text-sm text-gray-500">USt-IdNr: {customer.taxId}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2 text-sm text-gray-900">
                      <Mail className="h-4 w-4 text-gray-400" />
                      <span>{customer.email}</span>
                    </div>
                    {customer.phone && (
                      <div className="flex items-center space-x-2 text-sm text-gray-500">
                        <Phone className="h-4 w-4 text-gray-400" />
                        <span>{customer.phone}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2 text-sm text-gray-900">
                      <MapPin className="h-4 w-4 text-gray-400" />
                      <div>
                        <div>{customer.address}</div>
                        <div className="text-gray-500">{customer.postalCode} {customer.city}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleOpenModal(customer)}
                        className="text-primary-custom hover:text-primary-custom/80"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(customer.id)}
                        className="text-red-600 hover:text-red-900"
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

        {/* Mobile Card View */}
        <div className="lg:hidden">
          {filteredCustomers.map((customer) => (
            <div key={customer.id} className="p-4 border-b border-gray-200 last:border-b-0">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-gray-900">{customer.name}</h3>
                  <p className="text-xs text-gray-500">Kunden-Nr: {customer.customerNumber}</p>
                  {customer.taxId && (
                    <p className="text-xs text-gray-500">USt-IdNr: {customer.taxId}</p>
                  )}
                </div>
                <div className="flex space-x-2 ml-2">
                  <button
                    onClick={() => handleOpenModal(customer)}
                    className="text-primary-custom hover:text-primary-custom/80 p-1"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(customer.id)}
                    className="text-red-600 hover:text-red-900 p-1"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              <div className="space-y-1">
                <div className="flex items-center space-x-2 text-sm text-gray-900">
                  <Mail className="h-3 w-3 text-gray-400 flex-shrink-0" />
                  <span className="truncate">{customer.email}</span>
                </div>
                {customer.phone && (
                  <div className="flex items-center space-x-2 text-sm text-gray-600">
                    <Phone className="h-3 w-3 text-gray-400 flex-shrink-0" />
                    <span>{customer.phone}</span>
                  </div>
                )}
                <div className="flex items-start space-x-2 text-sm text-gray-600">
                  <MapPin className="h-3 w-3 text-gray-400 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="truncate">{customer.address}</div>
                    <div className="text-gray-500">{customer.postalCode} {customer.city}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filteredCustomers.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500">Keine Kunden gefunden</p>
          </div>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-4 lg:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {editingCustomer ? 'Kunde bearbeiten' : 'Neuer Kunde'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Kundennummer
                </label>
                <input
                  type="text"
                  value={formData.customerNumber}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  E-Mail
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Adresszusatz
                </label>
                <input
                  type="text"
                  value={formData.addressSupplement}
                  onChange={(e) => setFormData({ ...formData, addressSupplement: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="z.B. 2. Stock, Hintereingang"
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
                    value={formData.postalCode}
                    onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Stadt *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  value={formData.country}
                  onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  USt-IdNr.
                </label>
                <input
                  type="text"
                  value={formData.taxId}
                  onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Telefon
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800"
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
                          className="p-1 text-red-500 hover:text-red-700 flex-shrink-0"
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="z.B. Buchhaltung, Geschäftsführung"
                      />
                    </div>
                    <div className="flex space-x-2">
                      <button
                        type="button"
                        onClick={handleAddEmail}
                        className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
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
                    Kundenspezifische Stundensätze
                  </label>
                  <button
                    type="button"
                    onClick={handleOpenCreateHourlyRateModal}
                    className="flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Hinzufügen</span>
                  </button>
                </div>
                
                {!editingCustomer && (
                  <p className="text-xs text-gray-500 mb-3">
                    Stundensätze werden beim Speichern des Kunden automatisch angelegt.
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
                            {(rate.rate != null ? Number(rate.rate).toFixed(2) : '0.00')}€/h • MwSt: {rate.taxRate != null ? rate.taxRate : 19}%
                            {rate.description && ` • ${rate.description}`}
                          </div>
                        </div>
                        <div className="flex space-x-1">
                          <button
                            type="button"
                            onClick={() => handleOpenHourlyRateModal(rate)}
                            className="p-1 text-blue-600 hover:text-blue-800 flex-shrink-0"
                            title="Bearbeiten"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteHourlyRate(rate.id)}
                            className="p-1 text-red-500 hover:text-red-700 flex-shrink-0"
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
                    Keine kundenspezifischen Stundensätze konfiguriert. Es werden die Standard-Stundensätze verwendet.
                  </p>
                )}
              </div>

              {/* Customer-specific materials */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-700">
                    Kundenspezifische Materialien
                  </label>
                  <button
                    type="button"
                    onClick={handleOpenCreateMaterialModal}
                    className="flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Hinzufügen</span>
                  </button>
                </div>
                
                {!editingCustomer && (
                  <p className="text-xs text-gray-500 mb-3">
                    Materialien werden beim Speichern des Kunden automatisch angelegt.
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
                            {(material.unitPrice != null ? Number(material.unitPrice).toFixed(2) : '0.00')}€/{material.unit} • MwSt: {material.taxRate != null ? material.taxRate : 19}%
                            {material.description && ` • ${material.description}`}
                          </div>
                        </div>
                        <div className="flex space-x-1">
                          <button
                            type="button"
                            onClick={() => handleOpenMaterialModal(material)}
                            className="p-1 text-blue-600 hover:text-blue-800 flex-shrink-0"
                            title="Bearbeiten"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMaterial(material.id)}
                            className="p-1 text-red-500 hover:text-red-700 flex-shrink-0"
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
                    Keine kundenspezifischen Materialien konfiguriert. Es werden die Standard-Materialien verwendet.
                  </p>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <button
                  type="submit"
                  className="flex-1 btn-primary py-2 px-4 rounded-xl transition-all duration-300 hover:scale-105"
                >
                  {editingCustomer ? 'Aktualisieren' : 'Erstellen'}
                </button>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-xl hover:bg-gray-400 transition-all duration-300"
                >
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Hourly Rate Edit Modal */}
      {isHourlyRateModalOpen && editingHourlyRate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Stundensatz bearbeiten
              </h3>
              <button
                onClick={handleCloseHourlyRateModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <HourlyRateEditForm
              rate={editingHourlyRate}
              onSave={(updatedData) => handleUpdateHourlyRate(editingHourlyRate.id, updatedData)}
              onCancel={handleCloseHourlyRateModal}
            />
          </div>
        </div>
      )}

      {/* Material Edit Modal */}
      {isMaterialModalOpen && editingMaterial && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Material bearbeiten
              </h3>
              <button
                onClick={handleCloseMaterialModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <MaterialEditForm
              material={editingMaterial}
              onSave={(updatedData) => handleUpdateMaterial(editingMaterial.id, updatedData)}
              onCancel={handleCloseMaterialModal}
            />
          </div>
        </div>
      )}

      {/* Create Hourly Rate Modal */}
      {isCreateHourlyRateModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    placeholder="z.B. Standard, Anfahrt, Überstunden"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Stundensatz (€) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newHourlyRateData.rate}
                    onChange={(e) => setNewHourlyRateData({ ...newHourlyRateData, rate: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
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
                    className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500 rounded"
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
                    placeholder="z.B. Kleinmaterial, Kabel, Schrauben"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Preis (€) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newMaterialData.unitPrice}
                    onChange={(e) => setNewMaterialData({ ...newMaterialData, unitPrice: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
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
  onSave: (data: Partial<HourlyRate>) => void;
  onCancel: () => void;
}

function HourlyRateEditForm({ rate, onSave, onCancel }: HourlyRateEditFormProps) {
  const [formData, setFormData] = useState({
    name: rate.name,
    description: rate.description || '',
    rate: rate.rate,
    taxRate: rate.taxRate != null ? rate.taxRate : 19,
    isDefault: rate.isDefault || false
  });

  const handleSave = () => {
    if (!formData.name || formData.rate <= 0) {
      alert('Bitte geben Sie mindestens einen Namen und einen gültigen Stundensatz ein.');
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Stundensatz (€) *
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={formData.rate}
            onChange={(e) => setFormData({ ...formData, rate: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
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
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
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
            className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500 rounded"
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
  onSave: (data: Partial<MaterialTemplate>) => void;
  onCancel: () => void;
}

function MaterialEditForm({ material, onSave, onCancel }: MaterialEditFormProps) {
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
      alert('Bitte geben Sie mindestens einen Namen und einen gültigen Preis ein.');
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Preis (€) *
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={formData.unitPrice}
            onChange={(e) => setFormData({ ...formData, unitPrice: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
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
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            MwSt. (%)
          </label>
          <select
            value={formData.taxRate}
            onChange={(e) => setFormData({ ...formData, taxRate: parseFloat(e.target.value) })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
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
