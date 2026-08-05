import React, { useState, useEffect, useRef } from 'react';
import logger from '../utils/logger';
import { ArrowRight, Save, Building2, Mail, Globe, CreditCard, Upload, X, Palette, Briefcase, FileText, Plus, Trash2, Database, Clock, Package, Edit2, Settings as SettingsIcon, Home, Search, Calculator, BarChart3, Users } from 'lucide-react';
import { defaultCompany, useCompany } from '../context/CompanyContext';
import { ColorPicker } from './ColorPicker';
import { BackupManagement } from './BackupManagement';
import { EmailManagement } from './EmailManagement';
import { apiService } from '../services/api';
import { updateFavicon } from '../utils/faviconUtils';
import { YearlyInvoiceStartNumber, MaterialTemplate, HourlyRate, NumberFormat, DateFormat, TimeFormat, ThemeMode, TaxBusinessType, LegalForm, ImportResource } from '../types';
import { PageHeader } from './PageHeader';
import { isDemoMode, resetDemoData, seedDemoData } from '../services/demoApi';
import { formatCurrency, getCurrencySymbol } from '../utils/formatters';
import { getTerminology, terminologyProfiles } from '../utils/terminology';
import type { TerminologyDefinition } from '../utils/terminology';
import { LocalizedNumberInput } from './LocalizedNumberInput';
import { ImportWizard } from './ImportWizard';

type SettingsTab = 'app' | 'general' | 'invoices' | 'appearance' | 'system';

interface SettingsProps {
  initialTab?: SettingsTab;
  embedded?: boolean;
  onNavigate?: (page: string, filter?: string) => void;
}

const colorPresets = [
  { name: 'Klassisch Blau', primary: '#2563eb', secondary: '#64748b' },
  { name: 'Waldgrün', primary: '#15803d', secondary: '#475569' },
  { name: 'Violett', primary: '#7c3aed', secondary: '#64748b' },
  { name: 'Koralle', primary: '#ea580c', secondary: '#475569' },
] as const;

const reminderTemplates = {
  stage1: [
    { id: 'friendly', label: 'Freundliche Erinnerung', text: 'Wir möchten Sie freundlich daran erinnern, dass die Zahlung der unten aufgeführten Rechnung noch aussteht. Bitte begleichen Sie den offenen Betrag innerhalb der nächsten Tage.' },
    { id: 'short', label: 'Kurz und sachlich', text: 'Für die unten aufgeführte Rechnung konnten wir bisher keinen Zahlungseingang feststellen. Bitte prüfen Sie den Vorgang und überweisen Sie den offenen Betrag zeitnah.' },
    { id: 'service', label: 'Serviceorientiert', text: 'Vielleicht ist die Zahlung der unten aufgeführten Rechnung im Alltag untergegangen. Wir bitten Sie, den offenen Betrag zu prüfen und bei Gelegenheit zu begleichen. Falls Sie bereits gezahlt haben, betrachten Sie diese Nachricht bitte als gegenstandslos.' },
  ],
  stage2: [
    { id: 'clear', label: 'Deutliche Zahlungsaufforderung', text: 'Leider konnten wir trotz unserer Zahlungserinnerung noch keinen Zahlungseingang feststellen. Bitte begleichen Sie den offenen Betrag umgehend.' },
    { id: 'deadline', label: 'Mit Zahlungsfrist', text: 'Der offene Rechnungsbetrag ist weiterhin nicht bei uns eingegangen. Wir bitten Sie, die Zahlung innerhalb von sieben Tagen nach Erhalt dieser Mahnung vorzunehmen.' },
    { id: 'formal', label: 'Formell und sachlich', text: 'Hiermit mahnen wir die noch ausstehende Zahlung der unten aufgeführten Rechnung an. Bitte überweisen Sie den offenen Betrag unverzüglich unter Angabe der Rechnungsnummer.' },
  ],
  stage3: [
    { id: 'final', label: 'Letzte Mahnung', text: 'Dies ist unsere letzte Mahnung. Sollte der offene Rechnungsbetrag nicht umgehend bei uns eingehen, behalten wir uns weitere Schritte zur Durchsetzung unserer Forderung vor.' },
    { id: 'legal', label: 'Vor rechtlichen Schritten', text: 'Der offene Rechnungsbetrag ist trotz unserer bisherigen Mahnungen weiterhin nicht ausgeglichen. Bitte zahlen Sie innerhalb von sieben Tagen, um weitere Maßnahmen und zusätzliche Kosten zu vermeiden.' },
    { id: 'firm', label: 'Kurz und bestimmt', text: 'Wir fordern Sie letztmalig auf, den offenen Rechnungsbetrag unverzüglich zu begleichen. Nach fruchtlosem Ablauf der Zahlungsfrist werden wir die Forderung ohne weitere Ankündigung weiterverfolgen.' },
  ],
} as const;

type ReminderTemplateStage = keyof typeof reminderTemplates;

function getSelectedReminderTemplate(stage: ReminderTemplateStage, text?: string) {
  const normalizedText = text?.trim();
  if (!normalizedText) return undefined;
  const templates = reminderTemplates[stage] as ReadonlyArray<{ id: string; label: string; text: string }>;
  return templates.find(template => template.text.trim() === normalizedText);
}

function TerminologyPreview({ profile }: { profile: TerminologyDefinition }) {
  const preview = profile.preview || { accent: '#2563eb', secondary: '#64748b', accentSoft: '#dbeafe', accentWash: '#eff6ff' };
  const menuItems = [
    { label: 'Übersicht', icon: Home },
    { label: profile.work.navLabel, icon: Briefcase, active: true },
    { label: 'Rechnungen', icon: FileText },
    { label: 'Belege', icon: FileText },
    { label: 'Bank', icon: CreditCard },
    { label: 'Steuern', icon: Calculator },
    { label: 'Auswertungen', icon: BarChart3 },
    { label: profile.entity.navLabel, icon: Users, section: 'Verwalten' },
    { label: 'Leistungen', icon: Package },
    { label: 'Erweiterungen', icon: Palette },
    { label: 'Einstellungen', icon: SettingsIcon },
  ];

  return (
    <div
      className="terminology-preview mt-2 overflow-hidden rounded-lg border bg-white text-left shadow-sm"
      style={{ borderColor: preview.accentSoft }}
    >
      <div className="terminology-preview-header flex items-center gap-1.5 border-b px-2 py-1.5" style={{ backgroundColor: preview.accentWash, borderColor: preview.accentSoft }}>
        <span className="flex h-5 w-5 items-center justify-center rounded-md" style={{ backgroundColor: preview.accentSoft, color: preview.accent }}>
          <Building2 className="h-3 w-3" />
        </span>
        <span className="truncate text-[9px] font-bold tracking-wide text-gray-800">SoloOffice</span>
      </div>
      <div className="space-y-0.5 p-1.5">
        <div className="terminology-preview-search mb-1 flex items-center gap-1 rounded-md border border-gray-100 bg-gray-50 px-1.5 py-1 text-[8px] text-gray-400">
          <Search className="h-2.5 w-2.5 shrink-0" />
          <span>Suchen...</span>
        </div>
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <React.Fragment key={`${profile.id}-${item.label}`}>
              {item.section && (
                <div className="px-1 pb-0.5 pt-1.5 text-[7px] font-bold uppercase tracking-[0.12em]" style={{ color: preview.accent }}>
                  {item.section}
                </div>
              )}
              <div
                className={`flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[8px] font-medium ${item.active ? 'terminology-preview-active' : 'text-gray-700'}`}
                style={item.active ? { backgroundColor: preview.accentWash, color: preview.accent } : undefined}
              >
                <Icon className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function Settings({ initialTab = 'app', embedded = false, onNavigate }: SettingsProps) {
  const {
    company,
    updateCompany,
    hourlyRates,
    setHourlyRates,
    materialTemplates,
    setMaterialTemplates,
    addHourlyRate,
    updateHourlyRate,
    deleteHourlyRate,
    addMaterialTemplate,
    updateMaterialTemplate,
    deleteMaterialTemplate,
  } = useCompany();
  const [formData, setFormData] = useState(company);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [yearlyStartNumbers, setYearlyStartNumbers] = useState<YearlyInvoiceStartNumber[]>([]);
  const [newYear, setNewYear] = useState<number>(new Date().getFullYear());
  const [newStartNumber, setNewStartNumber] = useState<number>(1);
  const [showBackupManagement, setShowBackupManagement] = useState(false);
  const [showEmailManagement, setShowEmailManagement] = useState(false);
  
  const [editingMaterial, setEditingMaterial] = useState<MaterialTemplate | null>(null);
  const [isAddingMaterial, setIsAddingMaterial] = useState(false);
  
  const [editingRate, setEditingRate] = useState<HourlyRate | null>(null);
  const [isAddingRate, setIsAddingRate] = useState(false);
  const [importResource, setImportResource] = useState<ImportResource | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>('app');
  const terminologyScrollerRef = useRef<HTMLDivElement>(null);
  const terminologyDragRef = useRef({ active: false, startX: 0, startScrollLeft: 0, moved: false, pointerId: -1 });
  const [isDraggingTerminology, setIsDraggingTerminology] = useState(false);
  const currencySymbol = getCurrencySymbol(formData.locale || 'de-DE', formData.numberFormat, formData.currency);
  const terminology = getTerminology(formData.terminologyProfile);
  const hasUnsavedChanges = JSON.stringify(formData) !== JSON.stringify(company);
  const terminologyColorSource = formData.terminologyColorSource || 'profile';

  const handleTerminologyProfileSelect = (profile: typeof terminologyProfiles[number]) => {
    setFormData(previous => {
      const next = { ...previous, terminologyProfile: profile.id };
      if ((previous.terminologyColorSource || 'profile') === 'profile' && profile.preview) {
        next.primaryColor = profile.preview.accent;
        next.secondaryColor = profile.preview.secondary;
      }
      return next;
    });
  };

  const handleTerminologyColorSourceChange = (source: 'appearance' | 'profile') => {
    setFormData(previous => {
      const next = { ...previous, terminologyColorSource: source };
      if (source === 'profile') {
        const profile = terminologyProfiles.find(item => item.id === (previous.terminologyProfile || 'customers')) || terminologyProfiles[0];
        if (profile.preview) {
          next.primaryColor = profile.preview.accent;
          next.secondaryColor = profile.preview.secondary;
        }
      }
      return next;
    });
  };

  const handleTerminologyPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const scroller = terminologyScrollerRef.current;
    if (!scroller) return;

    terminologyDragRef.current = {
      active: true,
      startX: event.clientX,
      startScrollLeft: scroller.scrollLeft,
      moved: false,
      pointerId: event.pointerId,
    };
  };

  const handleTerminologyPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = terminologyDragRef.current;
    const scroller = terminologyScrollerRef.current;
    if (!drag.active || !scroller) return;

    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 8) {
      if (!drag.moved) {
        drag.moved = true;
        setIsDraggingTerminology(true);
        event.currentTarget.setPointerCapture(drag.pointerId);
      }
      event.preventDefault();
    }
    if (!drag.moved) return;
    scroller.scrollLeft = drag.startScrollLeft - delta;
  };

  const handleTerminologyPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = terminologyDragRef.current;
    drag.active = false;
    setIsDraggingTerminology(false);
    if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    }
  };

  const handleTerminologyClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!terminologyDragRef.current.moved) return;
    event.preventDefault();
    event.stopPropagation();
    terminologyDragRef.current.moved = false;
  };

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const handleResetToDefaults = () => {
    if (!window.confirm('Alle aktuellen Einstellungen im Formular auf die Standardwerte zurücksetzen? Die Änderung wird erst mit „Speichern“ übernommen.')) {
      return;
    }

    setFormData({
      ...defaultCompany,
      quotesEnabled: false,
      discountsEnabled: true,
      remindersEnabled: false,
      reminderDaysAfterDue: 7,
      reminderDaysBetween: 7,
      reminderFeeStage1: 0,
      reminderFeeStage2: 0,
      reminderFeeStage3: 0,
      reminderTextStage1: reminderTemplates.stage1[0].text,
      reminderTextStage2: reminderTemplates.stage2[0].text,
      reminderTextStage3: reminderTemplates.stage3[0].text,
    });
    setFeedback({ type: 'success', text: 'Standardeinstellungen wurden im Formular gesetzt. Mit „Speichern“ übernehmen.' });
  };

  useEffect(() => {
    setFormData(company);
  }, [company]);

  useEffect(() => {
    loadYearlyStartNumbers();
  }, []);

  const loadYearlyStartNumbers = async () => {
    try {
      const numbers = await apiService.getYearlyInvoiceStartNumbers();
      setYearlyStartNumbers(numbers);
    } catch (error) {
      logger.error('Error loading yearly start numbers:', { error: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleAddYearlyStartNumber = async () => {
    try {
      await apiService.createOrUpdateYearlyInvoiceStartNumber(newYear, newStartNumber);
      await loadYearlyStartNumbers();
      setNewYear(new Date().getFullYear() + 1);
      setNewStartNumber(1);
      setFeedback({ type: 'success', text: 'Jahresnummer wurde gespeichert.' });
    } catch (error) {
      logger.error('Error adding yearly start number:', { error: error instanceof Error ? error.message : String(error) });
      setFeedback({ type: 'error', text: 'Die Jahresnummer konnte nicht gespeichert werden.' });
    }
  };

  const handleDeleteYearlyStartNumber = async (year: number) => {
    try {
      await apiService.deleteYearlyInvoiceStartNumber(year);
      await loadYearlyStartNumbers();
      setFeedback({ type: 'success', text: 'Jahresnummer wurde gelöscht.' });
    } catch (error) {
      logger.error('Error deleting yearly start number:', { error: error instanceof Error ? error.message : String(error) });
      setFeedback({ type: 'error', text: 'Die Jahresnummer konnte nicht gelöscht werden.' });
    }
  };

  const handleSaveMaterial = async (material: Omit<MaterialTemplate, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      if (editingMaterial) {
        await updateMaterialTemplate(editingMaterial.id, material);
      } else {
        await addMaterialTemplate(material);
      }
      setEditingMaterial(null);
      setIsAddingMaterial(false);
      setFeedback({ type: 'success', text: 'Materialvorlage wurde gespeichert.' });
    } catch (error) {
      logger.error('Error saving material template:', { error: error instanceof Error ? error.message : String(error) });
      setFeedback({ type: 'error', text: 'Die Materialvorlage konnte nicht gespeichert werden.' });
    }
  };

  const handleDeleteMaterial = async (id: string) => {
    try {
      await deleteMaterialTemplate(id);
      setFeedback({ type: 'success', text: 'Materialvorlage wurde gelöscht.' });
    } catch (error) {
      logger.error('Error deleting material template:', { error: error instanceof Error ? error.message : String(error) });
      setFeedback({ type: 'error', text: 'Die Materialvorlage konnte nicht gelöscht werden.' });
    }
  };

  const handleSaveRate = async (rate: Omit<HourlyRate, 'id'>) => {
    try {
      if (editingRate) {
        await updateHourlyRate(editingRate.id, rate);
      } else {
        await addHourlyRate(rate);
      }
      setEditingRate(null);
      setIsAddingRate(false);
      setFeedback({ type: 'success', text: 'Stundensatz wurde gespeichert.' });
    } catch (error) {
      logger.error('Error saving hourly rate:', { error: error instanceof Error ? error.message : String(error) });
      setFeedback({ type: 'error', text: 'Der Stundensatz konnte nicht gespeichert werden.' });
    }
  };

  const handleDeleteRate = async (id: string) => {
    try {
      await deleteHourlyRate(id);
      setFeedback({ type: 'success', text: 'Stundensatz wurde gelöscht.' });
    } catch (error) {
      logger.error('Error deleting hourly rate:', { error: error instanceof Error ? error.message : String(error) });
      setFeedback({ type: 'error', text: 'Der Stundensatz konnte nicht gelöscht werden.' });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    
    try {
      const companySettings = { ...formData };
      delete companySettings.receiptLabel;
      const terminologyProfileChanged = company.terminologyProfile !== formData.terminologyProfile;
      delete companySettings.invoiceTemplates;
      delete companySettings.documentTemplates;
      await updateCompany(companySettings);
      if (isDemoMode && terminologyProfileChanged) {
        window.location.reload();
        return;
      }
      setFeedback({ type: 'success', text: 'Einstellungen wurden gespeichert.' });
    } catch (error) {
      logger.error('Error saving settings:', { error: error instanceof Error ? error.message : String(error) });
      setFeedback({ type: 'error', text: 'Die Einstellungen konnten nicht gespeichert werden.' });
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

  const selectedReminderTemplates = {
    stage1: getSelectedReminderTemplate('stage1', formData.reminderTextStage1),
    stage2: getSelectedReminderTemplate('stage2', formData.reminderTextStage2),
    stage3: getSelectedReminderTemplate('stage3', formData.reminderTextStage3),
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className={`${embedded ? 'hidden' : ''} order-1`}>
        <PageHeader icon={SettingsIcon} title="Einstellungen" subtitle={`Verwalten Sie ${terminology.organization.dataLabel} und Anwendungseinstellungen`} />
      </div>

      {isDemoMode && (
        <div className={`${embedded ? 'hidden' : ''} order-3 rounded-lg border border-blue-200 bg-blue-50 p-3`}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-blue-600" />
                <h3 className="text-sm font-semibold text-blue-900">Lokaler Demo-Modus</h3>
              </div>
              <p className="mt-1 text-xs text-blue-800">
                Testdaten und Änderungen werden nur in diesem Browser gespeichert.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => { seedDemoData(formData.terminologyProfile); window.location.reload(); }}
                className="px-3 py-2 text-sm font-medium text-blue-700 bg-white border border-blue-300 rounded-lg hover:bg-blue-100"
              >
                Testdaten neu laden
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Alle lokalen Demo-Daten wirklich löschen?')) {
                    resetDemoData();
                    window.location.reload();
                  }
                }}
                className="px-3 py-2 text-sm font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50"
              >
                Demo-Daten löschen
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`${embedded ? 'hidden' : ''} order-2 sticky top-16 z-20 -mx-3 flex gap-1 overflow-x-auto border-b border-gray-200 bg-gray-50/95 p-1 shadow-sm backdrop-blur sm:-mx-4 sm:px-2 lg:-mx-6 lg:top-2 lg:mx-0 lg:rounded-xl lg:border lg:bg-white lg:p-1`}>
        <div className="flex gap-1 overflow-x-auto">
          {[
            { id: 'app' as const, label: 'App-Einstellungen' },
            { id: 'general' as const, label: 'Allgemein' },
            { id: 'invoices' as const, label: 'Rechnungen' },
            { id: 'appearance' as const, label: 'Darstellung' },
            { id: 'system' as const, label: 'E-Mail & Backup' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary-custom text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="order-4 space-y-8">
        {activeTab === 'app' && (
          <div className="space-y-8">
        {/* Terminology Settings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-start gap-4">
            <div>
              <div className="flex items-center gap-2">
                <SettingsIcon className="h-5 w-5 text-primary-custom" />
                <h3 className="text-lg font-semibold text-gray-900">Begriffe &amp; Fachsprache</h3>
              </div>
              <p className="mt-1 max-w-3xl text-sm text-gray-500">
                Wählen Sie die Begriffe, die in Navigation, Formularen und Hinweisen für Ihre Organisation verwendet werden. Die Datenstruktur bleibt unverändert.
              </p>
            </div>
          </div>

          <div
            ref={terminologyScrollerRef}
            onPointerDown={handleTerminologyPointerDown}
            onPointerMove={handleTerminologyPointerMove}
            onPointerUp={handleTerminologyPointerUp}
            onPointerCancel={handleTerminologyPointerUp}
            onClickCapture={handleTerminologyClickCapture}
            className={`mt-4 overflow-x-auto px-1 pb-2 pt-3 touch-pan-x ${isDraggingTerminology ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
          >
            <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:min-w-[920px] md:grid-cols-5 xl:min-w-0">
            {terminologyProfiles.map(profile => {
              const selected = (formData.terminologyProfile || 'customers') === profile.id;
              const preview = profile.preview;
              return (
                <button
                  key={profile.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => handleTerminologyProfileSelect(profile)}
                  className={`terminology-profile-card group relative flex h-full min-h-0 flex-col rounded-xl border p-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-md ${selected ? 'terminology-profile-card-selected' : ''}`}
                  style={{
                    borderColor: selected ? preview.accent : '#e5e7eb',
                    backgroundColor: selected ? preview.accentWash : '#f9fafb',
                    boxShadow: selected ? `0 0 0 3px ${preview.accentSoft}` : undefined,
                  }}
                >
                  {selected && (
                    <span
                      className="terminology-profile-selected-label absolute -top-2 left-1/2 z-10 -translate-x-1/2 rounded-full px-2 py-0.5 text-[9px] font-semibold"
                      style={{ backgroundColor: preview.accentSoft, color: preview.accent }}
                    >
                      Ausgewählt
                    </span>
                  )}
                  <span className="flex min-h-[2.75rem] items-start justify-center pt-1 text-center">
                    <span className="block text-sm font-semibold text-gray-900">{profile.label}</span>
                  </span>
                  <TerminologyPreview profile={profile} />
                </button>
              );
            })}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-start gap-3">
              <Palette className="mt-0.5 h-5 w-5 shrink-0 text-primary-custom" />
              <div>
                <h4 className="text-sm font-semibold text-gray-900">Farbschema für Fachbegriffe</h4>
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  Entscheiden Sie, ob die gewählte Fachsprache eigene App-Farben verwenden oder das Farbschema aus „Darstellung“ übernehmen soll.
                </p>
              </div>
            </div>
            <div className="mt-3 grid items-stretch gap-3 min-[480px]:grid-cols-2">
              <button
                type="button"
                onClick={() => handleTerminologyColorSourceChange('appearance')}
                className={`h-full min-h-0 rounded-lg border p-3 text-left transition ${terminologyColorSource === 'appearance'
                  ? 'border-primary-custom bg-primary-custom/10'
                  : 'border-gray-200 bg-white hover:border-primary-custom/50'}`}
              >
                <span className="block text-sm font-semibold text-gray-900">Aus Darstellung übernehmen</span>
                <span className="mt-1 block text-xs text-gray-500">Die Farben werden im Tab „Darstellung“ gepflegt.</span>
                <span className="mt-0 block h-7">
                  {terminologyColorSource === 'appearance' && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveTab('appearance');
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          setActiveTab('appearance');
                        }
                      }}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary-custom underline"
                    >
                      Darstellung öffnen <ArrowRight className="h-3 w-3" />
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleTerminologyColorSourceChange('profile')}
                className={`h-full min-h-0 rounded-lg border p-3 text-left transition ${terminologyColorSource === 'profile'
                  ? 'border-primary-custom bg-primary-custom/10'
                  : 'border-gray-200 bg-white hover:border-primary-custom/50'}`}
              >
                <span className="block text-sm font-semibold text-gray-900">Profilfarben verwenden</span>
                <span className="mt-1 block text-xs text-gray-500">Die Auswahl übernimmt die passende Akzent- und Sekundärfarbe.</span>
                <span className="mt-0 flex h-7 items-center gap-2" aria-hidden="true">
                  <span className="h-4 w-4 rounded-full" style={{ backgroundColor: terminologyProfiles.find(profile => profile.id === (formData.terminologyProfile || 'customers'))?.preview?.accent }} />
                  <span className="h-4 w-4 rounded-full" style={{ backgroundColor: terminologyProfiles.find(profile => profile.id === (formData.terminologyProfile || 'customers'))?.preview?.secondary }} />
                </span>
              </button>
            </div>
          </div>
        </div>

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
                  {terminology.work.managementLabel}
                </label>
                <p className="text-xs text-gray-500 mt-1">
                  Aktiviert das Tracking von {terminology.work.plural} und Arbeitszeiten
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
                  Ermöglicht Rabatte auf Positions- und Gesamt-Ebene in Rechnungen, Angeboten und {terminology.work.plural}
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
                      1. Mahnstufe ({currencySymbol})
                    </label>
                    <LocalizedNumberInput
                      min="0"
                      step="0.01"
                      value={formData.reminderFeeStage1 ?? 0}
                      locale={formData.locale || 'de-DE'}
                      numberFormat={formData.numberFormat}
                      onValueChange={(value) => setFormData(prev => ({ ...prev, reminderFeeStage1: value === '' ? 0 : value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      2. Mahnstufe ({currencySymbol})
                    </label>
                    <LocalizedNumberInput
                      min="0"
                      step="0.01"
                      value={formData.reminderFeeStage2 ?? 0}
                      locale={formData.locale || 'de-DE'}
                      numberFormat={formData.numberFormat}
                      onValueChange={(value) => setFormData(prev => ({ ...prev, reminderFeeStage2: value === '' ? 0 : value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      3. Mahnstufe ({currencySymbol})
                    </label>
                    <LocalizedNumberInput
                      min="0"
                      step="0.01"
                      value={formData.reminderFeeStage3 ?? 0}
                      locale={formData.locale || 'de-DE'}
                      numberFormat={formData.numberFormat}
                      onValueChange={(value) => setFormData(prev => ({ ...prev, reminderFeeStage3: value === '' ? 0 : value }))}
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
                    <select
                      value={selectedReminderTemplates.stage1?.id || ''}
                      onChange={(e) => {
                        const template = reminderTemplates.stage1.find(item => item.id === e.target.value);
                        if (template) setFormData(prev => ({ ...prev, reminderTextStage1: template.text }));
                      }}
                      className="w-full mb-2 px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                    >
                      <option value="">Vorlage auswählen...</option>
                      {reminderTemplates.stage1.map(template => (
                        <option key={template.id} value={template.id}>{template.label}</option>
                      ))}
                    </select>
                    <p className={`mb-2 text-xs ${selectedReminderTemplates.stage1 ? 'text-primary-custom' : 'text-gray-500'}`}>
                      {selectedReminderTemplates.stage1 ? `Ausgewählte Vorlage: ${selectedReminderTemplates.stage1.label}` : formData.reminderTextStage1?.trim() ? 'Individueller Mahntext (keine Vorlage)' : 'Keine Vorlage ausgewählt'}
                    </p>
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
                    <select
                      value={selectedReminderTemplates.stage2?.id || ''}
                      onChange={(e) => {
                        const template = reminderTemplates.stage2.find(item => item.id === e.target.value);
                        if (template) setFormData(prev => ({ ...prev, reminderTextStage2: template.text }));
                      }}
                      className="w-full mb-2 px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                    >
                      <option value="">Vorlage auswählen...</option>
                      {reminderTemplates.stage2.map(template => (
                        <option key={template.id} value={template.id}>{template.label}</option>
                      ))}
                    </select>
                    <p className={`mb-2 text-xs ${selectedReminderTemplates.stage2 ? 'text-primary-custom' : 'text-gray-500'}`}>
                      {selectedReminderTemplates.stage2 ? `Ausgewählte Vorlage: ${selectedReminderTemplates.stage2.label}` : formData.reminderTextStage2?.trim() ? 'Individueller Mahntext (keine Vorlage)' : 'Keine Vorlage ausgewählt'}
                    </p>
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
                    <select
                      value={selectedReminderTemplates.stage3?.id || ''}
                      onChange={(e) => {
                        const template = reminderTemplates.stage3.find(item => item.id === e.target.value);
                        if (template) setFormData(prev => ({ ...prev, reminderTextStage3: template.text }));
                      }}
                      className="w-full mb-2 px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                    >
                      <option value="">Vorlage auswählen...</option>
                      {reminderTemplates.stage3.map(template => (
                        <option key={template.id} value={template.id}>{template.label}</option>
                      ))}
                    </select>
                    <p className={`mb-2 text-xs ${selectedReminderTemplates.stage3 ? 'text-primary-custom' : 'text-gray-500'}`}>
                      {selectedReminderTemplates.stage3 ? `Ausgewählte Vorlage: ${selectedReminderTemplates.stage3.label}` : formData.reminderTextStage3?.trim() ? 'Individueller Mahntext (keine Vorlage)' : 'Keine Vorlage ausgewählt'}
                    </p>
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
        </div>
      )}

        {activeTab === 'general' && (
          <div className="space-y-8">
        <div className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-2">
        {/* Logo Upload */}
        <div className="h-full bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <Upload className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">{terminology.organization.logoLabel}</h3>
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
        <div className="h-full bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <Upload className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">{terminology.organization.iconLabel}</h3>
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

        </div>

        {onNavigate && (
          <div className="flex flex-col gap-4 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between lg:p-5">
            <div>
              <h3 className="text-base font-semibold text-blue-900">Dokumentvorlagen</h3>
              <p className="mt-1 text-sm text-blue-800">
                PDF-Layouts, Farben, Logos und Dokumenttexte werden separat in den Vorlagen verwaltet.
              </p>
            </div>
            <button type="button" onClick={() => onNavigate('templates')} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-800">
              Vorlagen öffnen
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Company Information */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <Building2 className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">{terminology.organization.dataLabel}</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {terminology.organization.nameLabel} *
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
                      Zweizeilige Darstellung der {terminology.organization.dataLabel} im PDF-Header
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
                        Erste Zeile (z. B. {terminology.organization.nameLabel}/Service)
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
                Steuernummer
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
          <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h4 className="font-medium text-blue-900">Steuerprofil</h4>
            <p className="mt-1 text-xs leading-5 text-blue-800">Betriebsart und Rechtsform werden in Prüfhinweisen und Exporten verwendet. Sie blenden keine Kernmenüpunkte aus.</p>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium text-blue-900">
                Betriebsart
                <select value={formData.taxBusinessType || 'commercial'} onChange={(event) => setFormData(prev => ({ ...prev, taxBusinessType: event.target.value as TaxBusinessType }))} className="mt-1 w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="freelance">Freiberuflich</option>
                  <option value="commercial">Gewerblich</option>
                  <option value="agriculture">Land- und Forstwirtschaft</option>
                  <option value="nonprofit">Gemeinnützig</option>
                  <option value="other">Sonstige</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-blue-900">
                Rechtsform
                <select value={formData.legalForm || 'other'} onChange={(event) => setFormData(prev => ({ ...prev, legalForm: event.target.value as LegalForm }))} className="mt-1 w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="sole_proprietorship">Einzelunternehmen</option>
                  <option value="partnership">Personengesellschaft</option>
                  <option value="gbr">GbR</option>
                  <option value="ug">UG (haftungsbeschränkt)</option>
                  <option value="gmbh">GmbH</option>
                  <option value="ag">AG</option>
                  <option value="eg">eG</option>
                  <option value="nonprofit">Verein / gemeinnützige Organisation</option>
                  <option value="other">Sonstige</option>
                </select>
              </label>
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
            <h4 className="font-medium text-blue-900 mb-2">💡 Verwaltung der Zahlungsdaten</h4>
            <p className="text-sm text-blue-800">
              Wählen Sie, ob der Kontoinhaber automatisch dem {terminology.organization.nameInDativeLabel} folgen oder unabhängig davon gepflegt werden soll.
            </p>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            {[
              { id: 'separate', title: 'Getrennt verwalten', text: `Kontoinhaber kann vom ${terminology.organization.nameInDativeLabel} abweichen.` },
              { id: 'company', title: `Mit ${terminology.organization.dataLabel} verknüpfen`, text: `Kontoinhaber wird aus dem ${terminology.organization.nameInDativeLabel} übernommen.` },
            ].map(option => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, paymentInformationMode: option.id as 'separate' | 'company' }))}
                className={`rounded-lg border p-3 text-left transition ${formData.paymentInformationMode === option.id
                  ? 'border-primary-custom bg-primary-custom/5 ring-1 ring-primary-custom/30'
                  : 'border-gray-200 hover:border-gray-300'}`}
              >
                <span className="block text-sm font-medium text-gray-900">{option.title}</span>
                <span className="mt-1 block text-xs text-gray-500">{option.text}</span>
              </button>
            ))}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Kontoinhaber
              </label>
              <input
                type="text"
                value={formData.paymentInformationMode === 'company'
                  ? formData.name
                  : (formData.paymentInformation?.accountHolder || formData.name)}
                onChange={(e) => setFormData(prev => ({ 
                  ...prev, 
                  paymentInformation: { 
                    ...prev.paymentInformation, 
                    accountHolder: e.target.value 
                  }
                }))}
                disabled={formData.paymentInformationMode === 'company'}
                placeholder={`${formData.name} (${terminology.organization.nameLabel} als Standard)`}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
              />
              <p className="text-xs text-gray-500 mt-1">
                {formData.paymentInformationMode === 'company'
                  ? `Der Kontoinhaber wird automatisch aus dem aktuellen ${terminology.organization.nameInDativeLabel} gebildet.`
                  : `Kann vom ${terminology.organization.nameInDativeLabel} abweichen (z. B. Geschäftsführer oder Inhaber).`}
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

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Zahlungsarten
              </label>
              <input
                type="text"
                value={(formData.paymentInformation?.paymentMethods || []).join(', ')}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  paymentInformation: {
                    ...prev.paymentInformation,
                    paymentMethods: e.target.value.split(',').map(method => method.trim()).filter(Boolean),
                  }
                }))}
                placeholder="z.B. Überweisung, PayPal, Barzahlung"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Mehrere Zahlungsarten durch Komma trennen.</p>
            </div>
          </div>
        </div>

          </div>
        )}

        {activeTab === 'invoices' && (
          <div className="space-y-8">
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fallback-Startnummer *
              </label>
              <input
                type="number"
                required
                min="1"
                max="999999"
                value={formData.invoiceStartNumber ?? 1}
                onChange={(e) => setFormData(prev => ({ ...prev, invoiceStartNumber: parseInt(e.target.value, 10) || 1 }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Wird verwendet, wenn für das Rechnungsjahr keine eigene Startnummer hinterlegt ist.</p>
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

        <div className="rounded-lg border border-primary-custom/30 bg-primary-custom/10 p-4">
          <h4 className="mb-1 text-sm font-semibold text-primary-custom">eRechnung</h4>
          <p className="text-sm text-primary-custom">
            ZUGFeRD und XRechnung stehen beim Export zur Verfügung. Prüfen Sie vor dem Versand Ihre {terminology.organization.dataLabel},
            Zahlungsinformationen und die Leitweg-ID des Empfängers.
          </p>
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
                  Wenn aktiviert, werden in den Dropdowns für Stundensätze und Materialien sowohl allgemeine als auch {terminology.entity.specificLabel} Einträge angezeigt. Dies ermöglicht eine bessere Übersicht aller verfügbaren Optionen.
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
                    Allgemeine und {terminology.entity.specificLabel} Daten in Dropdowns kombinieren
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
                <button type="button" onClick={() => setImportResource('hourlyRates')} className="mr-2 inline-flex items-center rounded-lg border border-primary-custom px-3 py-2 text-sm text-primary-custom hover:bg-primary-light-custom">
                  <Upload className="mr-2 h-4 w-4" /> Importieren
                </button>
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
                          {formatCurrency(rate.rate, formData.locale || 'de-DE', formData.numberFormat, formData.currency)} / Stunde
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
                <button type="button" onClick={() => setImportResource('materials')} className="mr-2 inline-flex items-center rounded-lg border border-primary-custom px-3 py-2 text-sm text-primary-custom hover:bg-primary-light-custom">
                  <Upload className="mr-2 h-4 w-4" /> Importieren
                </button>
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
                          {formatCurrency(template.unitPrice, formData.locale || 'de-DE', formData.numberFormat, formData.currency)} / {template.unit}
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

          </div>
        )}

        {activeTab === 'appearance' && (
          <div className="flex flex-col gap-8">
        {/* Color Settings */}
        <div className="order-3 bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
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

          <div className="mt-6">
            <h4 className="mb-2 text-sm font-medium text-gray-700">Vorlagen für das Farbschema</h4>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {colorPresets.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, primaryColor: preset.primary, secondaryColor: preset.secondary }))}
                  className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-left transition hover:border-primary-custom hover:shadow-sm"
                >
                  <span className="mb-2 block text-xs font-medium text-gray-700">{preset.name}</span>
                  <span className="flex gap-2">
                    <span className="h-6 w-6 rounded-full" style={{ backgroundColor: preset.primary }} />
                    <span className="h-6 w-6 rounded-full" style={{ backgroundColor: preset.secondary }} />
                  </span>
                </button>
              ))}
            </div>
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
              Diese Farben gelten nur für die App-Oberfläche. Dokumente und E-Mails behalten ihre eigene Darstellung.
            </p>
          </div>
        </div>

        {/* Locale Settings */}
        <div className="order-1 bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <Globe className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">Sprache und Formatierung</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sprache
              </label>
              <select
                value={formData.locale || 'de-DE'}
                onChange={(e) => setFormData(prev => ({ ...prev, locale: e.target.value as 'de-DE' | 'en-US' | 'fr-FR' | 'es-ES' }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="de-DE">Deutsch (Deutschland) - 1.234,56 {currencySymbol}</option>
                <option value="en-US">English (United States) - $1,234.56</option>
                <option value="fr-FR">Français (France) - 1 234,56 {currencySymbol}</option>
                <option value="es-ES">Español (España) - 1.234,56 {currencySymbol}</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Bestimmt die Sprache der Benutzeroberfläche
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Zahlenformat
              </label>
              <select
                value={formData.numberFormat || 'european'}
                onChange={(e) => setFormData(prev => ({ ...prev, numberFormat: e.target.value as NumberFormat }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="european">Europäisch – 1.234,56</option>
                <option value="american">Amerikanisch – 1,234.56</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Legt Dezimal- und Tausendertrennzeichen in der Anwendung fest
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Währung
              </label>
              <select
                value={formData.currency || 'EUR'}
                onChange={(e) => setFormData(prev => ({ ...prev, currency: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="EUR">Euro (EUR)</option>
                <option value="USD">US-Dollar (USD)</option>
                <option value="CHF">Schweizer Franken (CHF)</option>
                <option value="GBP">Pfund Sterling (GBP)</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">Wird in Beträgen, PDFs und eRechnungen verwendet.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Datumsformat
              </label>
              <select
                value={formData.dateFormat || 'DD.MM.YYYY'}
                onChange={(e) => setFormData(prev => ({ ...prev, dateFormat: e.target.value as DateFormat }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="DD.MM.YYYY">31.12.2025</option>
                <option value="DD/MM/YYYY">31/12/2025</option>
                <option value="MM/DD/YYYY">12/31/2025</option>
                <option value="YYYY-MM-DD">2025-12-31</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Zeitformat
              </label>
              <select
                value={formData.timeFormat || '24h'}
                onChange={(e) => setFormData(prev => ({ ...prev, timeFormat: e.target.value as TimeFormat }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="24h">24-Stunden-Format</option>
                <option value="12h">12-Stunden-Format</option>
              </select>
            </div>
          </div>
        </div>

        <div className="order-2 bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="mb-4 flex items-center">
            <Palette className="mr-2 h-5 w-5 text-primary-custom" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Dunkelmodus</h3>
              <p className="text-xs text-gray-500">Die Einstellung betrifft nur die App-Oberfläche.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {([
              { id: 'system', label: 'System', description: 'Betriebssystem übernehmen' },
              { id: 'light', label: 'Hell', description: 'Helles Design verwenden' },
              { id: 'dark', label: 'Dunkel', description: 'Dunkles Design verwenden' },
            ] as const).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, themeMode: mode.id as ThemeMode }))}
                className={`rounded-lg border p-3 text-left transition ${formData.themeMode === mode.id
                  ? 'border-primary-custom bg-primary-custom/10 text-primary-custom'
                  : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-primary-custom'}`}
              >
                <span className="block text-sm font-medium">{mode.label}</span>
                <span className="mt-1 block text-xs opacity-80">{mode.description}</span>
              </button>
            ))}
          </div>
        </div>

          </div>
        )}

        {activeTab === 'system' && (
          <div className="space-y-8">
        {/* E-Mail-Verwaltung */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <Mail className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">E-Mail-Verwaltung</h3>
          </div>
          
          <div className="space-y-4">
            <div className="guidance-panel border-l-4 border-l-green-500 p-4">
              <h4 className="font-medium text-green-900 mb-2">E-Mail-Historie und SMTP-Konfiguration</h4>
              <p className="text-sm text-green-800 mb-4">
                Verwalten Sie alle gesendeten E-Mails, konfigurieren Sie SMTP-Einstellungen und 
                senden Sie Test-E-Mails. Die E-Mail-Historie wird automatisch für Audit-Zwecke gespeichert.
              </p>
              <button
                type="button"
                onClick={() => setShowEmailManagement(true)}
                disabled={isDemoMode}
                className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-all duration-300 hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Mail className="h-4 w-4 mr-2" />
                E-Mail-Verwaltung öffnen
              </button>
              {isDemoMode && <p className="text-xs text-green-800 mt-2">Im Demo-Modus ist die SMTP-Verwaltung deaktiviert.</p>}
            </div>
            
            <div className="guidance-panel border-l-4 border-l-amber-500 p-4">
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
            <div className="guidance-panel border-l-4 border-l-blue-500 p-4">
              <h4 className="font-medium text-blue-900 mb-2">Datensicherung</h4>
              <p className="text-sm text-blue-800 mb-4">
                Erstellen Sie regelmäßig Backups Ihrer Daten, um Datenverlust zu vermeiden.
                Ein Backup enthält {terminology.entity.plural}, Rechnungen, {terminology.work.plural} und Einstellungen; SMTP-Passwörter werden aus Sicherheitsgründen nicht exportiert.
              </p>
              <button
                type="button"
                onClick={() => setShowBackupManagement(true)}
                disabled={isDemoMode}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all duration-300 hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Database className="h-4 w-4 mr-2" />
                Backup-Verwaltung öffnen
              </button>
              {isDemoMode && <p className="text-xs text-blue-800 mt-2">Im Demo-Modus ist die Backup-Verwaltung deaktiviert.</p>}
            </div>
            
            <div className="guidance-panel border-l-4 border-l-amber-500 p-4">
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

          </div>
        )}

        {/* Save Button */}
        <div className="sticky bottom-0 z-10 -mx-3 flex flex-col gap-3 border-t border-gray-200 bg-gray-50/95 px-3 py-4 backdrop-blur sm:-mx-4 sm:flex-row sm:items-center sm:justify-end sm:px-4 lg:-mx-6 lg:px-6">
          {feedback && (
            <div className={`text-sm sm:mr-auto ${feedback.type === 'success' ? 'text-green-700' : 'text-red-700'}`}>
              {feedback.text}
            </div>
          )}
          <button
            type="button"
            onClick={handleResetToDefaults}
            className="px-4 lg:px-6 py-2 rounded-xl border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-all duration-300"
          >
            Zurücksetzen
          </button>
          <button
            type="submit"
            disabled={isSaving || !hasUnsavedChanges}
            className="btn-primary text-white px-4 lg:px-6 py-2 rounded-xl hover:brightness-90 transition-all duration-300 hover:scale-105 flex items-center space-x-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
          >
            <Save className="h-4 w-4" />
            <span>{isSaving ? 'Speichert...' : 'Speichern'}</span>
          </button>
        </div>
      </form>

      {importResource && (
        <ImportWizard
          resource={importResource}
          isOpen={true}
          onClose={() => setImportResource(null)}
          onImported={async () => {
            if (importResource === 'hourlyRates') setHourlyRates(await apiService.getHourlyRates());
            if (importResource === 'materials') setMaterialTemplates(await apiService.getMaterialTemplates());
          }}
        />
      )}

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
          currencySymbol={currencySymbol}
          locale={formData.locale || 'de-DE'}
          numberFormat={formData.numberFormat}
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
          currencySymbol={currencySymbol}
          locale={formData.locale || 'de-DE'}
          numberFormat={formData.numberFormat}
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
  currencySymbol: string;
  locale: string;
  numberFormat?: NumberFormat;
  onSave: (rate: Omit<HourlyRate, 'id'>) => void;
  onClose: () => void;
}

function HourlyRateModal({ rate, currencySymbol, locale, numberFormat, onSave, onClose }: HourlyRateModalProps) {
  const [formData, setFormData] = useState({
    name: rate?.name || '',
    description: rate?.description || '',
    rate: rate?.rate || 0,
    taxRate: rate?.taxRate ?? 19,
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
              Stundensatz ({currencySymbol}) *
            </label>
            <LocalizedNumberInput
              required
              min="0"
              step="0.01"
              value={formData.rate}
              locale={locale}
              numberFormat={numberFormat}
              onValueChange={(value) => setFormData(prev => ({ ...prev, rate: value === '' ? 0 : value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0,00"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">MwSt.-Satz</label>
            <select
              value={formData.taxRate}
              onChange={(e) => setFormData(prev => ({ ...prev, taxRate: parseFloat(e.target.value) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={0}>0%</option>
              <option value={7}>7%</option>
              <option value={19}>19%</option>
            </select>
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
  currencySymbol: string;
  locale: string;
  numberFormat?: NumberFormat;
  onSave: (template: Omit<MaterialTemplate, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onClose: () => void;
}

function MaterialTemplateModal({ template, currencySymbol, locale, numberFormat, onSave, onClose }: MaterialTemplateModalProps) {
  const [formData, setFormData] = useState({
    name: template?.name || '',
    description: template?.description || '',
    unitPrice: template?.unitPrice || 0,
    unit: template?.unit || 'Stück',
    taxRate: template?.taxRate ?? 19,
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
                Preis ({currencySymbol}) *
              </label>
              <LocalizedNumberInput
                required
                min="0"
                step="0.01"
                value={formData.unitPrice}
                locale={locale}
                numberFormat={numberFormat}
                onValueChange={(value) => setFormData(prev => ({ ...prev, unitPrice: value === '' ? 0 : value }))}
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">MwSt.-Satz</label>
            <select
              value={formData.taxRate}
              onChange={(e) => setFormData(prev => ({ ...prev, taxRate: parseFloat(e.target.value) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={0}>0%</option>
              <option value={7}>7%</option>
              <option value={19}>19%</option>
            </select>
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
