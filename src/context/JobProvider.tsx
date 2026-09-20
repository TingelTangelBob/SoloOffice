import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { JobEntry } from '../types';
import { apiService } from '../services/api';
import logger from '../utils/logger';
import { JobContext, type JobContextType } from './JobContext';

// ============================================================================
// Provider
// ============================================================================

interface JobProviderProps {
  children: ReactNode;
  initialJobEntries?: JobEntry[];
}

export function JobProvider({ children, initialJobEntries = [] }: JobProviderProps) {
  const [jobEntries, setJobEntries] = useState<JobEntry[]>(initialJobEntries);

  const getJobEntryById = useCallback((id: string): JobEntry | undefined => {
    return jobEntries.find(j => j.id === id);
  }, [jobEntries]);

  const addJobEntry = useCallback(async (jobEntryData: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<JobEntry> => {
    try {
      const newJobEntry = await apiService.createJobEntry(jobEntryData);
      setJobEntries(prev => [...prev, newJobEntry]);
      return newJobEntry;
    } catch (error) {
      logger.error('Error adding job entry:', error);
      throw error;
    }
  }, []);

  const updateJobEntry = useCallback(async (id: string, jobEntryData: Partial<JobEntry>): Promise<void> => {
    try {
      const updatedJobEntry = await apiService.updateJobEntry(id, jobEntryData);
      setJobEntries(prev => prev.map(job =>
        job.id === id ? updatedJobEntry : job
      ));
    } catch (error) {
      logger.error('Error updating job entry:', error);
      throw error;
    }
  }, []);

  const updateJobStatuses = useCallback(async (ids: string[], status: JobEntry['status']): Promise<void> => {
    try {
      const response = await apiService.updateJobStatuses(ids, status);
      const updatedIds = new Set(response.updatedIds);
      setJobEntries(prev => prev.map(job => updatedIds.has(job.id)
        ? { ...job, status, updatedAt: response.updatedAt ? new Date(response.updatedAt) : job.updatedAt }
        : job));
    } catch (error) {
      logger.error('Error updating job statuses:', error);
      throw error;
    }
  }, []);

  const deleteJobEntry = useCallback(async (id: string): Promise<void> => {
    try {
      await apiService.deleteJobEntry(id);
      setJobEntries(prev => prev.filter(job => job.id !== id));
    } catch (error) {
      logger.error('Error deleting job entry:', error);
      throw error;
    }
  }, []);

  const deleteJobEntries = useCallback(async (ids: string[]): Promise<string[]> => {
    try {
      const response = await apiService.deleteJobEntries(ids);
      const deletedIds = response.deletedIds || [];
      const deletedIdSet = new Set(deletedIds);
      setJobEntries(prev => prev.filter(job => !deletedIdSet.has(job.id)));
      return deletedIds;
    } catch (error) {
      logger.error('Error deleting job entries in bulk:', error);
      throw error;
    }
  }, []);

  const refreshJobEntries = useCallback(async (): Promise<void> => {
    try {
      const jobEntriesData = await apiService.getJobEntries();
      setJobEntries(jobEntriesData);
    } catch (error) {
      logger.error('Error refreshing job entries:', error);
      throw error;
    }
  }, []);

  const addJobSignature = useCallback(async (id: string, signatureData: string, customerName: string): Promise<void> => {
    try {
      const response = await apiService.addJobSignature(id, signatureData, customerName);
      setJobEntries(prev => prev.map(job =>
        job.id === id ? response.job : job
      ));
    } catch (error) {
      logger.error('Error adding job signature:', error);
      throw error;
    }
  }, []);

  const value: JobContextType = {
    jobEntries,
    setJobEntries,
    addJobEntry,
    updateJobEntry,
    updateJobStatuses,
    deleteJobEntry,
    deleteJobEntries,
    refreshJobEntries,
    addJobSignature,
    getJobEntryById,
  };

  return (
    <JobContext.Provider value={value}>
      {children}
    </JobContext.Provider>
  );
}
