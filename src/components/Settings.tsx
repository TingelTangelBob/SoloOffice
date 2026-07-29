import React, { useState, useEffect } from 'react';
import logger from '../utils/logger';
import { Save, Building2, Mail, Globe, CreditCard, Upload, X, Palette, Briefcase, FileText, Plus, Trash2, Database, Clock, Package, Edit2 } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { ColorPicker } from './ColorPicker';
import { BackupManagement } from './BackupManagement';
import { EmailManagement } from './EmailManagement';
import { apiService } from '../services/api';
import { updateFavicon, updatePageTitle } from '../utils/faviconUtils';
import { YearlyInvoiceStartNumber, MaterialTemplate, HourlyRate } from '../types';

export function Settings() {
  const { company, updateCompany } = useCompany();
  const [formData, setFormData] = useState(company);
  const [isSaving, setIsSaving] = useState(false);
  const [yearlyStartNumbers, setYearlyStartNumbers] = useState<YearlyInvoiceStartNumber[]>([]);
  const [newYear, setNewYear] = useState<number>(new Date().getFullYear());
  const [newStartNumber, setNewStartNumber] = useState<number>(1);
  const [showBackupManagement, setShowBackupManagement] = useState(false);
  const [showEmailManagement, setShowEmailManagement] = useState(false);
  
  // Material Templates State
  const [materialTemplates, setMaterialTemplates] = useState<MaterialTemplate[]>([]);
  const [editingMaterial, setEditingMaterial] = useState<MaterialTemplate | null>(null);
  const [isAddingMaterial, setIsAddingMaterial] = useState(false);
  
  // Hourly Rates State
  const [hourlyRates, setHourlyRates] = useState<HourlyRate[]>([]);
  const [editingRate, setEditingRate] = useState<HourlyRate | null>(null);
  const [isAddingRate, setIsAddingRate] = useState(false);

  useEffect(() => {
    setFormData(company);
  }, [company]);

  useEffect(() => {
    loadYearlyStartNumbers();
    loadMaterialTemplates();
    loadHourlyRates();
  }, []);

  const loadYearlyStartNumbers = async () => {
    try {
      const numbers = await apiService.getYearlyInvoiceStartNumbers();
      setYearlyStartNumbers(numbers);
    } catch (error) {
      logger.error('Error loading yearly start numbers:', error);
    }
  };

  const handleAddYearlyStartNumber = async () => {
    try {
      await apiService.createOrUpdateYearlyInvoiceStartNumber(newYear, newStartNumber);
      await loadYearlyStartNumbers();
      setNewYear(new Date().getFullYear() + 1);
      setNewStartNumber(1);
    } catch (error) {
      logger.error('Error adding yearly start number:', error);
    }
  };

  const handleDeleteYearlyStartNumber = async (year: number) => {
    try {
      await apiService.deleteYearlyInvoiceStartNumber(year);
      await loadYearlyStartNumbers();
    } catch (error) {
      logger.error('Error deleting yearly start number:', error);
    }
  };

  // Material Templates Functions
  const loadMaterialTemplates = async () => {
    try {
      const templates = await apiService.getMaterialTemplates();
      setMaterialTemplates(templates);
    } catch (error) {
      logger.error('Error loading material templates:', error);
    }
  };

  const handleSaveMaterial = async (material: Omit<MaterialTemplate, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      if (editingMaterial) {
        await apiService.updateMaterialTemplate(editingMaterial.id, material);
      } else {
        await apiService.createMaterialTemplate(material);
      }
      await loadMaterialTemplates();
      setEditingMaterial(null);
      setIsAddingMaterial(false);
    } catch (error) {
      logger.error('Error saving material template:', error);
    }
  };

  const handleDeleteMaterial = async (id: string) => {
    try {
      await apiService.deleteMaterialTemplate(id);
      await loadMaterialTemplates();
    } catch (error) {
      logger.error('Error deleting material template:', error);
    }
  };

  // Hourly Rates Functions
  const loadHourlyRates = async () => {
    try {
      const rates = await apiService.getHourlyRates();
      setHourlyRates(rates);
    } catch (error) {
      logger.error('Error loading hourly rates:', error);
    }
  };

  const handleSaveRate = async (rate: Omit<HourlyRate, 'id'>) => {
    try {
      if (editingRate) {
        await apiService.updateHourlyRate(editingRate.id, rate);
      } else {
        await apiService.createHourlyRate(rate);
      }
      await loadHourlyRates();
      setEditingRate(null);
      setIsAddingRate(false);
    } catch (error) {
      logger.error('Error saving hourly rate:', error);
    }
  };

  const handleDeleteRate = async (id: string) => {
    try {
      await apiService.deleteHourlyRate(id);
      await loadHourlyRates();
    } catch (error) {
      logger.error('Error deleting hourly rate:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    
    try {
      await updateCompany(formData);
      
      // Update CSS custom properties
      const root = document.documentElement;
      if (formData.primaryColor) {
        root.style.setProperty('--color-primary', formData.primaryColor);
      }
      if (formData.secondaryColor) {
        root.style.setProperty('--color-secondary', formData.secondaryColor);
      }
      
      // Update page title if company name changed
      if (formData.name && formData.name !== company.name) {
        updatePageTitle(formData.name);
      }
    } catch (error) {
      logger.error('Error saving settings:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setFormData(prev => ({
          ...prev,
          logo: e.target?.result as string
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLogoRemove = () => {
    setFormData(prev => ({ ...prev, logo: null }));
  };

  const handleIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const iconUrl = e.target?.result as string;
        setFormData(prev => ({
          ...prev,
          icon: iconUrl
        }));
        // Update favicon immediately for instant feedback
        updateFavicon(iconUrl);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleIconRemove = () => {
    setFormData(prev => ({ ...prev, icon: null }));
    // Update favicon immediately to remove the custom icon
    updateFavicon(null);
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Handle file upload logic here
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-3 sm:p-4 lg:p-6">
      {/* Header */}
      <div className="mb-4 lg:mb-6">
        <h1 className="text-xl lg:text-2xl font-bold text-gray-900">Einstellungen</h1>
        <p className="text-sm lg:text-base text-gray-600 mt-1">Verwalten Sie Ihre Firmendaten und Anwendungseinstellungen</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Module Settings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <Briefcase className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">Module</h3>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Auftragsmanagement
                </label>
                <p className="text-xs text-gray-500 mt-1">
                  Aktiviert das Tracking von Aufträgen und Arbeitszeiten
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.jobTrackingEnabled || false}
                  onChange={(e) => setFormData(prev => ({ ...prev, jobTrackingEnabled: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-custom/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-custom"></div>
              </label>
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Reporting & Auswertungen
                </label>
                <p className="text-xs text-gray-500 mt-1">
                  Aktiviert Rechnungsjournale, Statistiken und Auswertungen
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.reportingEnabled || false}
                  onChange={(e) => setFormData(prev => ({ ...prev, reportingEnabled: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-custom/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-custom"></div>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Angebote
                </label>
                <p className="text-xs text-gray-500 mt-1">
                  Aktiviert die Erstellung und Verwaltung von Angeboten
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.quotesEnabled || false}
                  onChange={(e) => setFormData(prev => ({ ...prev, quotesEnabled: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-custom/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-custom"></div>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Rabatt-Funktion
                </label>
                <p className="text-xs text-gray-500 mt-1">
                  Ermöglicht Rabatte auf Positions- und Gesamt-Ebene in Rechnungen, Angeboten und Aufträgen
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.discountsEnabled !== false}
                  onChange={(e) => setFormData(prev => ({ ...prev, discountsEnabled: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-custom/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-custom"></div>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Kleinunternehmerregelung (§ 19 UStG)
                </label>
                <p className="text-xs text-gray-500 mt-1">
                  Deaktiviert alle MwSt.-Berechnungen und zeigt entsprechende Klausel auf Rechnungen an
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.isSmallBusiness || false}
                  onChange={(e) => setFormData(prev => ({ ...prev, isSmallBusiness: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-custom/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-custom"></div>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Zahlungserinnerungen (Mahnwesen)
                </label>
                <p className="text-xs text-gray-500 mt-1">
                  Aktiviert das Mahnwesen mit konfigurierbaren Mahnstufen und Mahngebühren
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.remindersEnabled || false}
                  onChange={(e) => setFormData(prev => ({ ...prev, remindersEnabled: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-custom/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-custom"></div>
              </label>
            </div>
          </div>
        </div>

        {/* Reminder Settings - Only show if enabled */}
        {formData.remindersEnabled && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
            <div className="flex items-center mb-4">
              <Clock className="h-5 w-5 text-primary-custom mr-2" />
              <h3 className="text-lg font-semibold text-gray-900">Zahlungserinnerungen Konfiguration</h3>
            </div>
            
            <div className="space-y-6">
              {/* Timing Configuration */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Tage nach Fälligkeit bis zur 1. Mahnung
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.reminderDaysAfterDue ?? 7}
                    onChange={(e) => {
                      const value = e.target.value === '' ? 0 : parseInt(e.target.value, 10);
                      setFormData(prev => ({ ...prev, reminderDaysAfterDue: isNaN(value) ? 0 : value }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">0 = sofort nach Fälligkeit mahnbar</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Tage zwischen Mahnstufen
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.reminderDaysBetween ?? 7}
                    onChange={(e) => {
                      const value = e.target.value === '' ? 0 : parseInt(e.target.value, 10);
                      setFormData(prev => ({ ...prev, reminderDaysBetween: isNaN(value) ? 0 : value }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">0 = sofort nach letzter Mahnung erneut mahnbar</p>
                </div>
              </div>

              {/* Fee Configuration */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Mahngebühren</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      1. Mahnstufe (€)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.reminderFeeStage1 ?? 0}
                      onChange={(e) => {
                        const value = e.target.value === '' ? 0 : parseFloat(e.target.value);
                        setFormData(prev => ({ ...prev, reminderFeeStage1: isNaN(value) ? 0 : value }));
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      2. Mahnstufe (€)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.reminderFeeStage2 ?? 0}
                      onChange={(e) => {
                        const value = e.target.value === '' ? 0 : parseFloat(e.target.value);
                        setFormData(prev => ({ ...prev, reminderFeeStage2: isNaN(value) ? 0 : value }));
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      3. Mahnstufe (€)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.reminderFeeStage3 ?? 0}
                      onChange={(e) => {
                        const value = e.target.value === '' ? 0 : parseFloat(e.target.value);
                        setFormData(prev => ({ ...prev, reminderFeeStage3: isNaN(value) ? 0 : value }));
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">Geben Sie 0 ein, wenn keine Mahngebühren erhoben werden sollen</p>
              </div>

              {/* Reminder Texts */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Mahntexte</h4>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      1. Mahnung (freundlich)
                    </label>
                    <textarea
                      value={formData.reminderTextStage1 || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, reminderTextStage1: e.target.value }))}
                      rows={4}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                      placeholder="Freundliche Zahlungserinnerung..."
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      2. Mahnung (bestimmt)
                    </label>
                    <textarea
                      value={formData.reminderTextStage2 || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, reminderTextStage2: e.target.value }))}
                      rows={4}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                      placeholder="Bestimmte Zahlungsaufforderung..."
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      3. Mahnung (letzte Mahnung)
                    </label>
                    <textarea
                      value={formData.reminderTextStage3 || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, reminderTextStage3: e.target.value }))}
                      rows={4}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                      placeholder="Letzte Mahnung vor rechtlichen Schritten..."
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Logo Upload */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <Upload className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">Firmenlogo</h3>
          </div>
          
          <div className="space-y-4">
            {formData.logo ? (
              <div className="relative inline-block">
                <img
                  src={formData.logo}
                  alt="Company Logo"
                  className="h-20 lg:h-24 object-contain border border-gray-200 rounded-lg"
                />
                <button
                  type="button"
                  onClick={handleLogoRemove}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-600">Kein Logo hochgeladen</p>
              </div>
            )}
            
            <div>
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
                id="logo-upload"
              />
              <label
                htmlFor="logo-upload"
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 cursor-pointer"
              >
                <Upload className="h-4 w-4 mr-2" />
                Logo hochladen
              </label>
              <p className="text-xs text-gray-500 mt-1">
                Unterstützte Formate: JPG, PNG, GIF. Maximale Größe: 2MB
              </p>
            </div>
          </div>
        </div>

        {/* Icon Upload */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <Upload className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">Firmen-Icon</h3>
          </div>
          
          <div className="space-y-4">
            {formData.icon ? (
              <div className="relative inline-block">
                <img
                  src={formData.icon}
                  alt="Company Icon"
                  className="h-16 w-16 lg:h-20 lg:w-20 object-contain border border-gray-200 rounded-lg"
                />
                <button
                  type="button"
                  onClick={handleIconRemove}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-600">Kein Icon hochgeladen</p>
              </div>
            )}
            
            <div>
              <input
                type="file"
                accept="image/*"
                onChange={handleIconUpload}
                className="hidden"
                id="icon-upload"
              />
              <label
                htmlFor="icon-upload"
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 cursor-pointer"
              >
                <Upload className="h-4 w-4 mr-2" />
                Icon hochladen
              </label>
              <p className="text-xs text-gray-500 mt-1">
                Unterstützte Formate: JPG, PNG, GIF. Empfohlen: 64x64px oder 128x128px. Maximale Größe: 1MB
              </p>
            </div>
          </div>
        </div>

        {/* Company Information */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <Building2 className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">Firmendaten</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Firmenname *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            {/* Company Header Layout Options */}
            <div className="md:col-span-2">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <h4 className="font-medium text-blue-900 mb-2">📄 PDF-Header Layout</h4>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <label className="text-sm font-medium text-blue-800">
                      Zweizeilige Darstellung der Firmeninformationen im PDF-Header
                    </label>
                    <p className="text-xs text-blue-600 mt-1">
                      Ermöglicht eine strukturiertere Darstellung im PDF-Kopfbereich
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.companyHeaderTwoLine || false}
                      onChange={(e) => setFormData(prev => ({ ...prev, companyHeaderTwoLine: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-custom/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-custom"></div>
                  </label>
                </div>
                
                {formData.companyHeaderTwoLine && (
                  <div className="space-y-3 ml-0 mt-4">
                    <div>
                      <label className="block text-sm font-medium text-blue-700 mb-1">
                        Erste Zeile (z.B. Firmenbezeichnung/Service)
                      </label>
                      <input
                        type="text"
                        value={formData.companyHeaderLine1 || ''}
                        onChange={(e) => setFormData(prev => ({ ...prev, companyHeaderLine1: e.target.value }))}
                        placeholder="z.B. Musterfirma Service & Beratung GmbH"
                        className="w-full px-3 py-2 border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-blue-700 mb-1">
                        Zweite Zeile (z.B. Inhaber, Adresse)
                      </label>
                      <input
                        type="text"
                        value={formData.companyHeaderLine2 || ''}
                        onChange={(e) => setFormData(prev => ({ ...prev, companyHeaderLine2: e.target.value }))}
                        placeholder="z.B. Max Mustermann, Musterstraße 123, 12345 Musterstadt"
                        className="w-full px-3 py-2 border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <p className="text-xs text-blue-600">
                      Diese Einstellung beeinflusst nur die Darstellung im PDF-Sender-Bereich. 
                      Lassen Sie die Felder leer, um die automatische Generierung zu verwenden.
                    </p>
                  </div>
                )}
              </div>
            </div>
            
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Adresse *
              </label>
              <input
                type="text"
                required
                value={formData.address}
                onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Postleitzahl *
              </label>
              <input
                type="text"
                required
                value={formData.postalCode}
                onChange={(e) => setFormData(prev => ({ ...prev, postalCode: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Land *
              </label>
              <input
                type="text"
                required
                value={formData.country}
                onChange={(e) => setFormData(prev => ({ ...prev, country: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                USt-IdNr. *
              </label>
              <input
                type="text"
                required
                value={formData.taxId}
                onChange={(e) => setFormData(prev => ({ ...prev, taxId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="z.B. DE123456789"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Steuer-ID
              </label>
              <input
                type="text"
                value={formData.taxIdentificationNumber || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, taxIdentificationNumber: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="z.B. 123/456/78910"
              />
            </div>
          </div>
        </div>

        {/* Contact Information */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <Mail className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">Kontaktdaten</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                E-Mail *
              </label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Telefon *
              </label>
              <input
                type="tel"
                required
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Website
              </label>
              <input
                type="text"
                value={formData.website || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, website: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Payment Information - Enhanced Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <CreditCard className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">Zahlungsinformationen</h3>
          </div>
          
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h4 className="font-medium text-blue-900 mb-2">💡 Getrennte Verwaltung</h4>
            <p className="text-sm text-blue-800">
              Zahlungsinformationen werden jetzt getrennt von den allgemeinen Firmendaten verwaltet. 
              So können Kontoinhaber und Bankdaten unabhängig vom Firmennamen konfiguriert werden.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Kontoinhaber
              </label>
              <input
                type="text"
                value={formData.paymentInformation?.accountHolder || formData.name}
                onChange={(e) => setFormData(prev => ({ 
                  ...prev, 
                  paymentInformation: { 
                    ...prev.paymentInformation, 
                    accountHolder: e.target.value 
                  }
                }))}
                placeholder={`${formData.name} (Firmenname als Standard)`}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Kann unterschiedlich zum Firmennamen sein (z.B. Geschäftsführer, Inhaber)
              </p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                IBAN *
              </label>
              <input
                type="text"
                value={formData.paymentInformation?.bankAccount || formData.bankAccount || ''}
                onChange={(e) => setFormData(prev => ({ 
                  ...prev, 
                  paymentInformation: { 
                    ...prev.paymentInformation, 
                    bankAccount: e.target.value 
                  }
                }))}
                placeholder="DE89 3704 0044 0532 0130 00"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                BIC
              </label>
              <input
                type="text"
                value={formData.paymentInformation?.bic || formData.bic || ''}
                onChange={(e) => setFormData(prev => ({ 
                  ...prev, 
                  paymentInformation: { 
                    ...prev.paymentInformation, 
                    bic: e.target.value 
                  }
                }))}
                placeholder="COBADEFFXXX"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Bankname
              </label>
              <input
                type="text"
                value={formData.paymentInformation?.bankName || ''}
                onChange={(e) => setFormData(prev => ({ 
                  ...prev, 
                  paymentInformation: { 
                    ...prev.paymentInformation, 
                    bankName: e.target.value 
                  }
                }))}
                placeholder="z.B. Commerzbank AG"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Zusätzliche Zahlungsbedingungen
              </label>
              <textarea
                value={formData.paymentInformation?.paymentTerms || ''}
                onChange={(e) => setFormData(prev => ({ 
                  ...prev, 
                  paymentInformation: { 
                    ...prev.paymentInformation, 
                    paymentTerms: e.target.value 
                  }
                }))}
                placeholder="z.B. Bei Zahlungsrückstand werden Verzugszinsen berechnet"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
              />
              <p className="text-xs text-gray-500 mt-1">
                Diese Bedingungen werden in Rechnungen und Angeboten angezeigt
              </p>
            </div>
          </div>
        </div>

        {/* Invoice Settings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <FileText className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">Rechnungseinstellungen</h3>
          </div>
          
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h4 className="font-medium text-blue-900 mb-2">💡 Hinweis zur Start-Rechnungsnummer</h4>
            <p className="text-sm text-blue-800">
              Die Start-Rechnungsnummer wird nur bei neuen Systemen oder beim Jahreswechsel verwendet. 
              Wenn bereits Rechnungen existieren, wird immer von der höchsten vorhandenen Nummer weiter gezählt.
              Format: RE-{new Date().getFullYear()}-XXX (z.B. RE-{new Date().getFullYear()}-56)
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Standard-Zahlungsziel (Tage) *
              </label>
              <input
                type="number"
                required
                min="0"
                max="365"
                value={formData.defaultPaymentDays !== undefined ? formData.defaultPaymentDays : 30}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  setFormData(prev => ({ ...prev, defaultPaymentDays: isNaN(value) ? 30 : value }));
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Anzahl der Tage, nach denen eine Rechnung fällig wird. Bei 0 Tagen ist die Rechnung sofort fällig.
              </p>
            </div>
          </div>

          {/* Immediate Payment Clause Settings */}
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sofortzahlungsklausel (bei 0 Tagen Zahlungsziel)
            </label>
            <textarea
              value={formData.immediatePaymentClause || 'Rechnung ist per sofort fällig, ohne Abzug'}
              onChange={(e) => setFormData(prev => ({ ...prev, immediatePaymentClause: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              placeholder="Text, der bei sofortiger Zahlung in der Rechnung angezeigt wird"
            />
            <p className="text-xs text-gray-500 mt-1">
              Diese Klausel wird in Rechnungen mit 0 Tagen Zahlungsziel in den Zahlungsbedingungen angezeigt.
            </p>
          </div>
        </div>

        {/* Position Management */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <Package className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">Positionsverwaltung</h3>
          </div>
          
          {/* Combined Dropdowns Setting */}
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-blue-900 mb-2">
                  Erweiterte Dropdown-Anzeige
                </h4>
                <p className="text-sm text-blue-800 mb-3">
                  Wenn aktiviert, werden in den Dropdowns für Stundensätze und Materialien sowohl allgemeine als auch kundenspezifische Einträge angezeigt. Dies ermöglicht eine bessere Übersicht aller verfügbaren Optionen.
                </p>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="showCombinedDropdowns"
                    checked={formData.showCombinedDropdowns === true} // Default to false
                    onChange={(e) => setFormData(prev => ({ ...prev, showCombinedDropdowns: e.target.checked }))}
                    className="custom-checkbox"
                  />
                  <label htmlFor="showCombinedDropdowns" className="ml-2 text-sm font-medium text-blue-900">
                    Allgemeine und kundenspezifische Daten in Dropdowns kombinieren
                  </label>
                </div>
              </div>
            </div>
          </div>
          
          <div className="space-y-6">
            {/* Hourly Rates Management */}
            <div className="border-b border-gray-200 pb-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <Clock className="h-4 w-4 text-primary-custom mr-2" />
                  <h4 className="text-md font-semibold text-gray-800">Stundensätze</h4>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddingRate(true)}
                  className="inline-flex items-center px-3 py-2 bg-primary-custom text-white rounded-lg hover:brightness-90 transition-colors"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Stundensatz hinzufügen
                </button>
              </div>
              
              {/* Hourly Rates List */}
              <div className="space-y-3">
                {hourlyRates.map((rate) => (
                  <div key={rate.id} className={`p-3 rounded-lg border ${rate.isDefault ? 'border-primary-custom bg-primary-custom/5' : 'border-gray-200 bg-gray-50'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <h5 className="font-medium text-gray-900">{rate.name}</h5>
                          {rate.isDefault && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary-custom text-white">
                              Standard
                            </span>
                          )}
                        </div>
                        {rate.description && (
                          <p className="text-sm text-gray-600 mt-1">{rate.description}</p>
                        )}
                        <p className="text-sm font-semibold text-primary-custom mt-1">
                          {rate.rate.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} / Stunde
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => setEditingRate(rate)}
                          className="text-primary-custom hover:text-primary-custom/80 p-1"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRate(rate.id)}
                          className="text-red-600 hover:text-red-800 p-1"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Material Templates Management */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <Package className="h-4 w-4 text-primary-custom mr-2" />
                  <h4 className="text-md font-semibold text-gray-800">Materialvorlagen</h4>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddingMaterial(true)}
                  className="inline-flex items-center px-3 py-2 bg-primary-custom text-white rounded-lg hover:brightness-90 transition-colors"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Material hinzufügen
                </button>
              </div>
              
              {/* Material Templates List */}
              <div className="space-y-3">
                {materialTemplates.map((template) => (
                  <div key={template.id} className={`p-3 rounded-lg border ${template.isDefault ? 'border-primary-custom bg-primary-custom/5' : 'border-gray-200 bg-gray-50'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <h5 className="font-medium text-gray-900">{template.name}</h5>
                          {template.isDefault && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary-custom text-white">
                              Standard
                            </span>
                          )}
                        </div>
                        {template.description && (
                          <p className="text-sm text-gray-600 mt-1">{template.description}</p>
                        )}
                        <p className="text-sm font-semibold text-primary-custom mt-1">
                          {template.unitPrice.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} / {template.unit}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => setEditingMaterial(template)}
                          className="text-primary-custom hover:text-primary-custom/80 p-1"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMaterial(template.id)}
                          className="text-red-600 hover:text-red-800 p-1"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Yearly Invoice Start Numbers */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <FileText className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">Rechnungsnummern</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Jährliche Start-Rechnungsnummern
              </label>
              
              {/* Existing yearly start numbers */}
              <div className="space-y-3 mb-4">
                {yearlyStartNumbers.map((entry) => (
                  <div key={entry.year} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-4">
                      <span className="font-medium text-gray-900">{entry.year}</span>
                      <span className="text-gray-600">startet bei {entry.start_number}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteYearlyStartNumber(entry.year)}
                      className="text-red-600 hover:text-red-800 p-1"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add new yearly start number */}
              <div className="flex items-end space-x-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Jahr</label>
                  <input
                    type="number"
                    min="2000"
                    max="2100"
                    value={newYear}
                    onChange={(e) => setNewYear(parseInt(e.target.value) || new Date().getFullYear())}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Start-Nummer</label>
                  <input
                    type="number"
                    min="1"
                    max="9999"
                    value={newStartNumber}
                    onChange={(e) => setNewStartNumber(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddYearlyStartNumber}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              
              <p className="text-xs text-gray-500 mt-2">
                Definieren Sie spezifische Start-Nummern für bestimmte Jahre. Alle anderen Jahre beginnen automatisch bei 001.
              </p>
            </div>
          </div>
        </div>

        {/* Color Settings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <Palette className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">Farbschema</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ColorPicker
              label="Primärfarbe"
              value={formData.primaryColor || '#2563eb'}
              onChange={(color) => setFormData(prev => ({ ...prev, primaryColor: color }))}
              defaultColor="#2563eb"
            />
            <ColorPicker
              label="Sekundärfarbe"
              value={formData.secondaryColor || '#64748b'}
              onChange={(color) => setFormData(prev => ({ ...prev, secondaryColor: color }))}
              defaultColor="#64748b"
            />
          </div>
          
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Vorschau</h4>
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                className="px-4 py-2 rounded-lg text-white font-medium"
                style={{ backgroundColor: formData.primaryColor || '#2563eb' }}
              >
                Primäre Aktion
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg text-white font-medium"
                style={{ backgroundColor: formData.secondaryColor || '#64748b' }}
              >
                Sekundäre Aktion
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Diese Farben werden in der gesamten Anwendung, in PDFs und E-Mails verwendet.
            </p>
          </div>
        </div>

        {/* Locale Settings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <Globe className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">Sprache und Formatierung</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Locale (Zahlenformat)
              </label>
              <select
                value={formData.locale || 'de-DE'}
                onChange={(e) => setFormData(prev => ({ ...prev, locale: e.target.value as 'de-DE' | 'en-US' | 'fr-FR' | 'es-ES' }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="de-DE">Deutsch (Deutschland) - 1.234,56 €</option>
                <option value="en-US">English (United States) - $1,234.56</option>
                <option value="fr-FR">Français (France) - 1 234,56 €</option>
                <option value="es-ES">Español (España) - 1.234,56 €</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Bestimmt das Format für Zahlen und Währungen
              </p>
            </div>
          </div>
        </div>

        {/* eRechnung Settings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <Globe className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">eRechnung Einstellungen</h3>
          </div>
          
          <div className="space-y-4">
            <div className="bg-primary-custom/10 border border-primary-custom/30 rounded-lg p-4">
              <h4 className="font-medium text-primary-custom mb-2">Unterstützte Formate</h4>
              <ul className="text-sm text-primary-custom space-y-1">
                <li>• <strong>PDF:</strong> Standard PDF-Format für beste Kompatibilität</li>
                <li>• <strong>XRechnung:</strong> Strukturierte XML-Rechnung</li>
              </ul>
            </div>
            
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h4 className="font-medium text-yellow-900 mb-2">Hinweise</h4>
              <p className="text-sm text-yellow-800">
                Die eRechnung wird ab dem 1. Januar 2025 für alle B2B-Transaktionen in Deutschland Pflicht. 
                Stellen Sie sicher, dass Ihre Firmendaten vollständig und korrekt sind.
              </p>
            </div>
          </div>
        </div>

        {/* E-Mail-Verwaltung */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <Mail className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">E-Mail-Verwaltung</h3>
          </div>
          
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h4 className="font-medium text-green-900 mb-2">E-Mail-Historie und SMTP-Konfiguration</h4>
              <p className="text-sm text-green-800 mb-4">
                Verwalten Sie alle gesendeten E-Mails, konfigurieren Sie SMTP-Einstellungen und 
                senden Sie Test-E-Mails. Die E-Mail-Historie wird automatisch für Audit-Zwecke gespeichert.
              </p>
              <button
                type="button"
                onClick={() => setShowEmailManagement(true)}
                className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-all duration-300 hover:scale-105"
              >
                <Mail className="h-4 w-4 mr-2" />
                E-Mail-Verwaltung öffnen
              </button>
            </div>
            
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h4 className="font-medium text-yellow-900 mb-2">Features</h4>
              <ul className="text-sm text-yellow-800 space-y-1">
                <li>• Alle gesendeten E-Mails werden automatisch archiviert</li>
                <li>• SMTP-Konfiguration überschreibt Backend-Einstellungen</li>
                <li>• Test-E-Mail-Funktion zur Konfigurationsprüfung</li>
                <li>• E-Mail-Historie ist nicht löschbar (Audit-Logs)</li>
                <li>• Detaillierte Statistiken und Fehlerprotokollierung</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Backup und Wiederherstellung */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <Database className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">Daten-Backup und Wiederherstellung</h3>
          </div>
          
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 mb-2">Datensicherung</h4>
              <p className="text-sm text-blue-800 mb-4">
                Erstellen Sie regelmäßig Backups Ihrer Daten, um Datenverlust zu vermeiden. 
                Ein Backup enthält alle Kunden, Rechnungen, Aufträge und Einstellungen.
              </p>
              <button
                type="button"
                onClick={() => setShowBackupManagement(true)}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all duration-300 hover:scale-105"
              >
                <Database className="h-4 w-4 mr-2" />
                Backup-Verwaltung öffnen
              </button>
            </div>
            
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h4 className="font-medium text-amber-900 mb-2">Wichtige Hinweise</h4>
              <ul className="text-sm text-amber-800 space-y-1">
                <li>• Erstellen Sie vor wichtigen Änderungen immer ein Backup</li>
                <li>• Bewahren Sie Backups an einem sicheren Ort auf</li>
                <li>• Testen Sie regelmäßig die Wiederherstellung</li>
                <li>• Backup-Dateien sind im JSON-Format gespeichert</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="btn-primary text-white px-4 lg:px-6 py-2 rounded-xl hover:brightness-90 transition-all duration-300 hover:scale-105 flex items-center space-x-2 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            <span>{isSaving ? 'Speichert...' : 'Speichern'}</span>
          </button>
        </div>
      </form>

      {/* Email Management Modal */}
      {showEmailManagement && (
        <EmailManagement onClose={() => setShowEmailManagement(false)} />
      )}

      {/* Backup Management Modal */}
      {showBackupManagement && (
        <BackupManagement onClose={() => setShowBackupManagement(false)} />
      )}

      {/* Hourly Rate Modal */}
      {(isAddingRate || editingRate) && (
        <HourlyRateModal
          rate={editingRate}
          onSave={handleSaveRate}
          onClose={() => {
            setIsAddingRate(false);
            setEditingRate(null);
          }}
        />
      )}

      {/* Material Template Modal */}
      {(isAddingMaterial || editingMaterial) && (
        <MaterialTemplateModal
          template={editingMaterial}
          onSave={handleSaveMaterial}
          onClose={() => {
            setIsAddingMaterial(false);
            setEditingMaterial(null);
          }}
        />
      )}
    </div>
  );
}

// Hourly Rate Modal Component
interface HourlyRateModalProps {
  rate: HourlyRate | null;
  onSave: (rate: Omit<HourlyRate, 'id'>) => void;
  onClose: () => void;
}

function HourlyRateModal({ rate, onSave, onClose }: HourlyRateModalProps) {
  const [formData, setFormData] = useState({
    name: rate?.name || '',
    description: rate?.description || '',
    rate: rate?.rate || 0,
    isDefault: rate?.isDefault || false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.name && formData.rate > 0) {
      onSave(formData);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">
            {rate ? 'Stundensatz bearbeiten' : 'Neuer Stundensatz'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="z.B. Standard-Stundensatz"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Beschreibung
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optionale Beschreibung"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Stundensatz (€) *
            </label>
            <input
              type="number"
              required
              min="0"
              step="0.01"
              value={formData.rate}
              onChange={(e) => setFormData(prev => ({ ...prev, rate: parseFloat(e.target.value) || 0 }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0,00"
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="isDefaultRate"
              checked={formData.isDefault}
              onChange={(e) => setFormData(prev => ({ ...prev, isDefault: e.target.checked }))}
              className="custom-checkbox"
            />
            <label htmlFor="isDefaultRate" className="ml-2 text-sm text-gray-700">
              Als Standard-Stundensatz festlegen
            </label>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-all duration-300"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-custom text-white rounded-xl hover:brightness-90 transition-all duration-300 hover:scale-105"
            >
              Speichern
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Material Template Modal Component
interface MaterialTemplateModalProps {
  template: MaterialTemplate | null;
  onSave: (template: Omit<MaterialTemplate, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onClose: () => void;
}

function MaterialTemplateModal({ template, onSave, onClose }: MaterialTemplateModalProps) {
  const [formData, setFormData] = useState({
    name: template?.name || '',
    description: template?.description || '',
    unitPrice: template?.unitPrice || 0,
    unit: template?.unit || 'Stück',
    isDefault: template?.isDefault || false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.name && formData.unitPrice > 0) {
      onSave(formData);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">
            {template ? 'Materialvorlage bearbeiten' : 'Neue Materialvorlage'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="z.B. Schrauben M8"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Beschreibung
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optionale Beschreibung"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Preis (€) *
              </label>
              <input
                type="number"
                required
                min="0"
                step="0.01"
                value={formData.unitPrice}
                onChange={(e) => setFormData(prev => ({ ...prev, unitPrice: parseFloat(e.target.value) || 0 }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0,00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Einheit
              </label>
              <input
                type="text"
                value={formData.unit}
                onChange={(e) => setFormData(prev => ({ ...prev, unit: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Stück"
              />
            </div>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="isDefaultMaterial"
              checked={formData.isDefault}
              onChange={(e) => setFormData(prev => ({ ...prev, isDefault: e.target.checked }))}
              className="custom-checkbox"
            />
            <label htmlFor="isDefaultMaterial" className="ml-2 text-sm text-gray-700">
              Als Standard-Materialvorlage festlegen
            </label>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-all duration-300"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-custom text-white rounded-xl hover:brightness-90 transition-all duration-300 hover:scale-105"
            >
              Speichern
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
