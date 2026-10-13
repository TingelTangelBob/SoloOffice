import React, { useEffect, useMemo, useState } from 'react';
import logger from '../utils/logger';
import { Settings as SettingsIcon } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { defaultCompany } from '../context/CompanyProvider';
import { PageHeader } from './PageHeader';
import { isDemoMode, resetDemoData, seedDemoData } from '../services/demoApi';
import { getTerminology } from '../utils/terminology';
import { useFeedback } from '../context/FeedbackContext';
import { validateInvoiceNumberPattern } from '../utils/invoiceNumberPattern';
import { trackTelemetry } from '../services/telemetry';
import { updateFavicon } from '../utils/faviconUtils';
import { ExtensionsSettings } from './ExtensionsSettings';
import { TaxProfileSettings } from './TaxProfileSettings';
import { TAX_TEXTS } from '../../backend/shared/taxTexts.js';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { COMPANY_SETTINGS_GUARD_ID } from '../utils/navigationGuard';
import {
  SETTINGS_AREA_DEFINITIONS,
  changedFields,
  dirtySettingsAreas,
  findSettingsSection,
  normalizeSettingsArea,
  settingsSectionElementId,
  type SettingsArea,
} from '../utils/settingsNavigation';
import type { SettingsSearchResult } from '../utils/settingsSearch';
import { SettingsNav } from './settings/SettingsNav';
import { SettingsSaveBar, type SettingsSaveMessage } from './settings/SettingsUi';
import { DEFAULT_CREDIT_NOTE_NUMBER_PATTERN, DEFAULT_INVOICE_NUMBER_PATTERN } from './settings/settingsStyles';
import { CompanyArea } from './settings/CompanyArea';
import { InvoicingArea } from './settings/InvoicingArea';
import { WorkspaceArea } from './settings/WorkspaceArea';
import { AppearanceArea } from './settings/AppearanceArea';
import { SystemArea } from './settings/SystemArea';

/** Bereiche, die das gemeinsame Firmenformular bearbeiten. */
const COMPANY_FORM_AREAS: ReadonlySet<SettingsArea> = new Set(['general', 'invoices', 'app', 'appearance']);

interface SettingsProps {
  initialTab?: SettingsArea;
  settingsTab?: SettingsArea;
  /** Abschnitt innerhalb des Bereichs, z. B. aus `#settings/invoices/nummernkreise`. */
  section?: string;
  embedded?: boolean;
  onNavigate?: (page: string, filter?: string, searchTerm?: string) => void;
}

export function Settings({ initialTab = 'general', settingsTab, section, embedded = false, onNavigate }: SettingsProps) {
  const { confirm } = useFeedback();
  const { company, updateCompany } = useCompany();
  const [formData, setFormData] = useState(company);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<SettingsSaveMessage | null>(null);
  const [localArea, setLocalArea] = useState<SettingsArea>(normalizeSettingsArea(settingsTab || initialTab));
  const [localSection, setLocalSection] = useState<{ id: string; nonce: number } | null>(null);
  const routedArea = normalizeSettingsArea(settingsTab || initialTab);
  // Eingebettet ohne URL-Steuerung führt die Komponente den Bereich selbst.
  const activeArea = onNavigate && !embedded ? routedArea : localArea;
  const terminology = getTerminology(formData.terminologyProfile);
  const changed = useMemo(() => changedFields(company, formData), [company, formData]);
  const hasUnsavedChanges = changed.length > 0;
  const dirtyAreas = useMemo(() => dirtySettingsAreas(company, formData), [company, formData]);
  const dirtyAreaSet = useMemo(() => new Set(dirtyAreas), [dirtyAreas]);
  const normalizedReceiptLabel = formData.receiptLabel?.trim() || '';
  const receiptLabelError = normalizedReceiptLabel.length === 0
    ? 'Bitte eine Bezeichnung für den Belegbereich eingeben.'
    : normalizedReceiptLabel.length > 40
      ? 'Die Bezeichnung darf höchstens 40 Zeichen enthalten.'
      : '';
  const invoiceNumberPatternError = validateInvoiceNumberPattern(formData.invoiceNumberPattern || DEFAULT_INVOICE_NUMBER_PATTERN);
  const creditNoteNumberPatternError = validateInvoiceNumberPattern(formData.creditNoteNumberPattern || DEFAULT_CREDIT_NOTE_NUMBER_PATTERN);

  useUnsavedChangesGuard({
    id: COMPANY_SETTINGS_GUARD_ID,
    isDirty: hasUnsavedChanges,
    message: 'Die Einstellungen enthalten ungespeicherte Änderungen. Möchten Sie diese verwerfen?',
  });

  useEffect(() => {
    setFormData(company);
  }, [company]);

  // Erfolgsmeldungen verschwinden von selbst, Fehler bleiben stehen.
  useEffect(() => {
    if (feedback?.type !== 'success') return;
    const timer = window.setTimeout(() => setFeedback(null), 4000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  // Alte Lesezeichen mit `?settingsTab=` bleiben gültig und zeigen den aktuellen Bereich.
  useEffect(() => {
    if (embedded) return;
    const url = new URL(window.location.href);
    if (url.hash.slice(1).split('/')[0] !== 'settings') return;
    if (url.searchParams.get('settingsTab') !== activeArea) {
      url.searchParams.set('settingsTab', activeArea);
      window.history.replaceState(window.history.state, '', url);
    }
  }, [activeArea, embedded]);

  // Abschnitt aus Suche oder Deep-Link anspringen und kurz hervorheben.
  const targetSection = localSection?.id ?? section;
  useEffect(() => {
    if (!findSettingsSection(activeArea, targetSection)) return;
    const element = document.getElementById(settingsSectionElementId(targetSection!));
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    element.classList.add('settings-card-highlight');
    const timer = window.setTimeout(() => element.classList.remove('settings-card-highlight'), 1600);
    return () => {
      window.clearTimeout(timer);
      element.classList.remove('settings-card-highlight');
    };
  }, [activeArea, targetSection, localSection?.nonce]);

  const selectArea = (area: SettingsArea, sectionId?: string) => {
    if (onNavigate && !embedded) {
      if (area === activeArea && sectionId) {
        setLocalSection({ id: sectionId, nonce: Date.now() });
        return;
      }
      setLocalSection(null);
      onNavigate('settings', area, sectionId);
      return;
    }
    setLocalArea(area);
    setLocalSection(sectionId ? { id: sectionId, nonce: Date.now() } : null);
  };

  const selectSearchResult = (result: SettingsSearchResult) => selectArea(result.area, result.sectionId);

  const handleResetToDefaults = async () => {
    const confirmed = await confirm({
      title: 'Einstellungen zurücksetzen',
      message: 'Alle aktuellen Einstellungen im Formular auf die Standardwerte zurücksetzen? Die Änderung wird erst mit „Speichern“ übernommen.',
      confirmText: 'Zurücksetzen',
    });
    if (!confirmed) return;

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
    });
    setFeedback({ type: 'success', text: 'Standardwerte wurden im Formular gesetzt. Mit „Speichern“ übernehmen.' });
  };

  const handleDiscard = () => {
    setFormData(company);
    updateFavicon(company.icon ?? null);
    setFeedback(null);
  };

  const saveCompanySettings = async () => {
    if (isSaving) return;
    if (receiptLabelError) {
      setFeedback({ type: 'error', text: `${SETTINGS_AREA_DEFINITIONS.app.label}: ${receiptLabelError}` });
      return;
    }
    if (invoiceNumberPatternError || creditNoteNumberPatternError) {
      setFeedback({ type: 'error', text: `${SETTINGS_AREA_DEFINITIONS.invoices.label}: ${invoiceNumberPatternError || creditNoteNumberPatternError}` });
      return;
    }
    setIsSaving(true);

    try {
      const companySettings = { ...formData, receiptLabel: normalizedReceiptLabel };
      const terminologyProfileChanged = company.terminologyProfile !== formData.terminologyProfile;
      delete companySettings.invoiceTemplates;
      delete companySettings.documentTemplates;
      delete companySettings.documentTextTemplates;
      delete companySettings.remindersEnabled;
      delete companySettings.reminderDaysAfterDue;
      delete companySettings.reminderDaysBetween;
      delete companySettings.reminderFeeStage1;
      delete companySettings.reminderFeeStage2;
      delete companySettings.reminderFeeStage3;
      delete companySettings.reminderTextStage1;
      delete companySettings.reminderTextStage2;
      delete companySettings.reminderTextStage3;
      await updateCompany(companySettings);
      if (terminologyProfileChanged) trackTelemetry('terminology_used');
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

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void saveCompanySettings();
  };

  const reloadDemoData = () => {
    seedDemoData(formData.terminologyProfile);
    window.location.reload();
  };

  const deleteDemoData = async () => {
    const confirmed = await confirm({
      title: 'Demo-Daten löschen',
      message: 'Alle lokalen Demo-Daten wirklich löschen? Die Anwendung wird anschließend neu geladen.',
      confirmText: 'Löschen',
      isDestructive: true,
    });
    if (!confirmed) return;
    resetDemoData();
    window.location.reload();
  };

  const areaDefinition = SETTINGS_AREA_DEFINITIONS[activeArea];
  const areaProps = { formData, setFormData, terminology };
  const usesCompanyForm = COMPANY_FORM_AREAS.has(activeArea);
  const dirtyLabel = dirtyAreas.map(area => SETTINGS_AREA_DEFINITIONS[area].label).join(', ');
  const navigateTo = onNavigate ? (page: string) => onNavigate(page) : undefined;

  const companySaveBar = (
    <SettingsSaveBar
      dirty={hasUnsavedChanges}
      saving={isSaving}
      dirtyLabel={dirtyLabel}
      message={feedback}
      onDiscard={handleDiscard}
      onSave={usesCompanyForm ? undefined : () => void saveCompanySettings()}
    />
  );

  return (
    <div className="page-root flex flex-col gap-3">
      {!embedded && (
        <div className="page-header-slot">
          <PageHeader icon={SettingsIcon} title="Einstellungen" subtitle={`Verwalten Sie ${terminology.organization.dataLabel} und Anwendungseinstellungen`} />
        </div>
      )}

      <div className="settings-layout">
        <aside className="settings-layout-nav">
          <SettingsNav
            activeArea={activeArea}
            dirtyAreas={dirtyAreaSet}
            badges={{ taxes: TAX_TEXTS.badge }}
            onSelectArea={area => selectArea(area)}
            onSelectResult={selectSearchResult}
          />
        </aside>

        <section className="settings-layout-content" aria-labelledby="settings-area-title">
          <header className="settings-area-header">
            <h2 id="settings-area-title" className="text-xl font-semibold text-gray-900">{areaDefinition.label}</h2>
            <p className="mt-1 text-sm text-gray-600">{areaDefinition.description}</p>
          </header>

          {usesCompanyForm ? (
            <form onSubmit={handleSubmit} autoComplete="on" className="settings-form form-consistent-fields settings-area-body">
              {activeArea === 'general' && <CompanyArea {...areaProps} />}
              {activeArea === 'invoices' && <InvoicingArea {...areaProps} onNavigate={navigateTo} />}
              {activeArea === 'app' && (
                <WorkspaceArea
                  {...areaProps}
                  receiptLabelError={receiptLabelError}
                  isDemoMode={isDemoMode}
                  onNavigate={navigateTo}
                  onResetToDefaults={() => void handleResetToDefaults()}
                  onReloadDemoData={reloadDemoData}
                  onDeleteDemoData={() => void deleteDemoData()}
                />
              )}
              {activeArea === 'appearance' && <AppearanceArea {...areaProps} />}
              {companySaveBar}
            </form>
          ) : (
            <div className="settings-area-body">
              {activeArea === 'system' && <SystemArea isDemoMode={isDemoMode} onNavigate={navigateTo} />}
              {activeArea === 'extensions' && <ExtensionsSettings />}
              {activeArea === 'taxes' && <TaxProfileSettings onNavigate={onNavigate} />}
              {activeArea !== 'taxes' && companySaveBar}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
