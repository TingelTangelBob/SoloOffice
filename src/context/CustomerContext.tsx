import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Customer, HourlyRate, MaterialTemplate } from '../types';
import { apiService } from '../services/api';
import { generateUUID } from '../utils/uuid';
import logger from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

interface CustomerContextType {
  customers: Customer[];
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>;
  addCustomer: (customer: Omit<Customer, 'id' | 'customerNumber' | 'createdAt'>) => Promise<Customer>;
  updateCustomer: (id: string, customer: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  refreshCustomers: () => Promise<void>;
  getCustomerById: (id: string) => Customer | undefined;
}

// ============================================================================
// Context
// ============================================================================

const CustomerContext = createContext<CustomerContextType | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

interface CustomerProviderProps {
  children: ReactNode;
  initialCustomers?: Customer[];
}

export function CustomerProvider({ children, initialCustomers = [] }: CustomerProviderProps) {
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);

  const getCustomerById = useCallback((id: string): Customer | undefined => {
    return customers.find(c => c.id === id);
  }, [customers]);

  const addCustomer = useCallback(async (customerData: Omit<Customer, 'id' | 'customerNumber' | 'createdAt'>): Promise<Customer> => {
    try {
      const newCustomer = await apiService.createCustomer(customerData);
      setCustomers(prev => [...prev, newCustomer]);
      return newCustomer;
    } catch (error) {
      logger.error('Error adding customer:', error);
      // Fallback: Generate customer number locally
      const existingNumbers = customers.map(c => parseInt(c.customerNumber)).filter(n => !isNaN(n));
      const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
      const customerNumber = String(nextNumber).padStart(4, '0');

      const newCustomer: Customer = {
        ...customerData,
        id: generateUUID(),
        customerNumber,
        createdAt: new Date(),
      };
      setCustomers(prev => [...prev, newCustomer]);
      return newCustomer;
    }
  }, [customers]);

  const updateCustomer = useCallback(async (id: string, customerData: Partial<Customer>): Promise<void> => {
    try {
      const updatedCustomer = await apiService.updateCustomer(id, customerData);
      setCustomers(prev => prev.map(customer =>
        customer.id === id ? updatedCustomer : customer
      ));
    } catch (error) {
      logger.error('Error updating customer:', error);
      // Fallback: Update locally
      setCustomers(prev => prev.map(customer =>
        customer.id === id ? { ...customer, ...customerData } : customer
      ));
    }
  }, []);

  const deleteCustomer = useCallback(async (id: string): Promise<void> => {
    try {
      await apiService.deleteCustomer(id);
      setCustomers(prev => prev.filter(customer => customer.id !== id));
    } catch (error) {
      logger.error('Error deleting customer:', error);
      // Fallback: Delete locally
      setCustomers(prev => prev.filter(customer => customer.id !== id));
    }
  }, []);

  const refreshCustomers = useCallback(async (): Promise<void> => {
    try {
      const customersData = await apiService.getCustomers();
      setCustomers(customersData);
    } catch (error) {
      logger.error('Error refreshing customers:', error);
    }
  }, []);

  const value: CustomerContextType = {
    customers,
    setCustomers,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    refreshCustomers,
    getCustomerById,
  };

  return (
    <CustomerContext.Provider value={value}>
      {children}
    </CustomerContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useCustomers(): CustomerContextType {
  const context = useContext(CustomerContext);
  if (context === undefined) {
    throw new Error('useCustomers must be used within a CustomerProvider');
  }
  return context;
}

// ============================================================================
// Customer Rate/Material Utilities
// ============================================================================

export function getHourlyRatesForCustomer(
  customers: Customer[],
  hourlyRates: HourlyRate[],
  customerId?: string
): HourlyRate[] {
  if (!customerId) {
    return hourlyRates;
  }

  const customer = customers.find(c => c.id === customerId);

  // If customer has specific hourly rates, return only those
  if (customer?.hourlyRates && customer.hourlyRates.length > 0) {
    return customer.hourlyRates;
  }

  return hourlyRates;
}

export function getMaterialTemplatesForCustomer(
  customers: Customer[],
  materialTemplates: MaterialTemplate[],
  customerId?: string
): MaterialTemplate[] {
  if (!customerId) {
    return materialTemplates;
  }

  const customer = customers.find(c => c.id === customerId);

  // If customer has specific materials, return only those
  if (customer?.materials && customer.materials.length > 0) {
    return customer.materials;
  }

  return materialTemplates;
}

interface CombinedRate extends HourlyRate {
  displayName: string;
  isGeneral: boolean;
  isCustomerSpecific: boolean;
}

interface CombinedMaterial extends MaterialTemplate {
  displayName: string;
  isGeneral: boolean;
  isCustomerSpecific: boolean;
}

export function getCombinedHourlyRatesForCustomer(
  customers: Customer[],
  hourlyRates: HourlyRate[],
  showCombinedDropdowns: boolean,
  customerId: string | undefined,
  specificLabel: string
): CombinedRate[] {
  // If combined dropdowns are disabled, return the original behavior
  if (!showCombinedDropdowns) {
    const originalRates = getHourlyRatesForCustomer(customers, hourlyRates, customerId);
    const customer = customerId ? customers.find(c => c.id === customerId) : undefined;
    return originalRates.map(rate => ({
      ...rate,
      displayName: rate.name,
      isGeneral: !customerId || !customer?.hourlyRates?.some(hr => hr.id === rate.id),
      isCustomerSpecific: !!(customerId && customer?.hourlyRates?.some(hr => hr.id === rate.id)),
    }));
  }

  const rates: CombinedRate[] = [];

  // Add general rates with marking
  hourlyRates.forEach(rate => {
    rates.push({
      ...rate,
      displayName: `${rate.name} (Allgemein)`,
      isGeneral: true,
      isCustomerSpecific: false,
    });
  });

  // Add customer-specific rates with marking
  if (customerId) {
    const customer = customers.find(c => c.id === customerId);
    if (customer?.hourlyRates && customer.hourlyRates.length > 0) {
      customer.hourlyRates.forEach(rate => {
        rates.push({
          ...rate,
          displayName: `${rate.name} (${specificLabel})`,
          isGeneral: false,
          isCustomerSpecific: true,
        });
      });
    }
  }

  return rates;
}

export function getCombinedMaterialTemplatesForCustomer(
  customers: Customer[],
  materialTemplates: MaterialTemplate[],
  showCombinedDropdowns: boolean,
  customerId: string | undefined,
  specificLabel: string
): CombinedMaterial[] {
  // If combined dropdowns are disabled, return the original behavior
  if (!showCombinedDropdowns) {
    const originalMaterials = getMaterialTemplatesForCustomer(customers, materialTemplates, customerId);
    const customer = customerId ? customers.find(c => c.id === customerId) : undefined;
    return originalMaterials.map(material => ({
      ...material,
      displayName: material.name,
      isGeneral: !customerId || !customer?.materials?.some(m => m.id === material.id),
      isCustomerSpecific: !!(customerId && customer?.materials?.some(m => m.id === material.id)),
    }));
  }

  const materials: CombinedMaterial[] = [];

  // Add general materials with marking
  materialTemplates.forEach(material => {
    materials.push({
      ...material,
      displayName: `${material.name} (Allgemein)`,
      isGeneral: true,
      isCustomerSpecific: false,
    });
  });

  // Add customer-specific materials with marking
  if (customerId) {
    const customer = customers.find(c => c.id === customerId);
    if (customer?.materials && customer.materials.length > 0) {
      customer.materials.forEach(material => {
        materials.push({
          ...material,
          displayName: `${material.name} (${specificLabel})`,
          isGeneral: false,
          isCustomerSpecific: true,
        });
      });
    }
  }

  return materials;
}

