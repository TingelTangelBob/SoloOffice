import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Customer } from '../types';
import { apiService } from '../services/api';
import logger from '../utils/logger';
import { CustomerContext, type CustomerContextType } from './CustomerContext';

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
      throw error;
    }
  }, []);

  const updateCustomer = useCallback(async (id: string, customerData: Partial<Customer>): Promise<void> => {
    try {
      const updatedCustomer = await apiService.updateCustomer(id, customerData);
      setCustomers(prev => prev.map(customer =>
        customer.id === id ? updatedCustomer : customer
      ));
    } catch (error) {
      logger.error('Error updating customer:', error);
      throw error;
    }
  }, []);

  const deleteCustomer = useCallback(async (id: string): Promise<void> => {
    try {
      await apiService.archiveCustomer(id);
      setCustomers(prev => prev.filter(customer => customer.id !== id));
    } catch (error) {
      logger.error('Error archiving customer:', error);
      throw error;
    }
  }, []);

  const archiveCustomer = useCallback(async (id: string): Promise<void> => {
    try {
      await apiService.archiveCustomer(id);
      setCustomers(prev => prev.filter(customer => customer.id !== id));
    } catch (error) {
      logger.error('Error archiving customer:', error);
      throw error;
    }
  }, []);

  const restoreCustomer = useCallback(async (id: string): Promise<void> => {
    try {
      await apiService.restoreCustomer(id);
      setCustomers(prev => prev.map(customer => customer.id === id ? { ...customer, isActive: true } : customer));
    } catch (error) {
      logger.error('Error restoring customer:', error);
      throw error;
    }
  }, []);

  const refreshCustomers = useCallback(async (includeArchived = false): Promise<void> => {
    try {
      const customersData = await apiService.getCustomers(includeArchived);
      setCustomers(customersData);
    } catch (error) {
      logger.error('Error refreshing customers:', error);
      throw error;
    }
  }, []);

  const value: CustomerContextType = {
    customers,
    setCustomers,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    archiveCustomer,
    restoreCustomer,
    refreshCustomers,
    getCustomerById,
  };

  return (
    <CustomerContext.Provider value={value}>
      {children}
    </CustomerContext.Provider>
  );
}
