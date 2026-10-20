import React, { useRef, useState } from 'react';
import { ArrowRight, BarChart3, Briefcase, Building2, Calculator, CreditCard, Database, FileText, Home, Languages, Package, Palette, RotateCcw, Rocket, Search, Settings as SettingsIcon, ToggleRight, Users } from 'lucide-react';
import { terminologyProfiles, type TerminologyDefinition } from '../../utils/terminology';
import { SettingsCard, SettingsField, SettingsToggleRow } from './SettingsUi';
import { settingsInputClass } from './settingsStyles';
import type { CompanySettingsAreaProps } from './settingsAreaProps';

function TerminologyPreview({ profile, receiptLabel, previewOverride }: { profile: TerminologyDefinition; receiptLabel: string; previewOverride?: NonNullable<TerminologyDefinition['preview']> }) {
  const preview = previewOverride || profile.preview || { accent: '#2563eb', secondary: '#64748b', accentSoft: '#dbeafe', accentWash: '#eff6ff' };
  const menuItems = [
    { label: 'Übersicht', icon: Home },
    { label: profile.work.navLabel, icon: Briefcase, active: true },
    { label: 'Rechnungen', icon: FileText },
    { label: receiptLabel, icon: FileText },
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

/** Waagerecht ziehbare Liste der Fachsprachen, ohne Klick nach dem Ziehen. */
function useDragScroll() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, startX: 0, startScrollLeft: 0, moved: false, pointerId: -1 });
  const [isDragging, setIsDragging] = useState(false);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    dragRef.current = { active: true, startX: event.clientX, startScrollLeft: scroller.scrollLeft, moved: false, pointerId: event.pointerId };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const scroller = scrollerRef.current;
    if (!drag.active || !scroller) return;
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 8) {
      if (!drag.moved) {
        drag.moved = true;
        setIsDragging(true);
        event.currentTarget.setPointerCapture(drag.pointerId);
      }
      event.preventDefault();
    }
    if (!drag.moved) return;
    scroller.scrollLeft = drag.startScrollLeft - delta;
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    drag.active = false;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(drag.pointerId)) event.currentTarget.releasePointerCapture(drag.pointerId);
  };

  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current.moved) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current.moved = false;
  };

  return {
    isDragging,
    scrollerProps: { ref: scrollerRef, onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClickCapture },
  };
}

interface WorkspaceAreaProps extends CompanySettingsAreaProps {
  receiptLabelError: string;
  isDemoMode: boolean;
  onNavigate?: (page: string) => void;
  onResetToDefaults: () => void;
  onReloadDemoData: () => void;
  onDeleteDemoData: () => void;
}

/** Bereich „Module & Begriffe“ (`#settings/app`, früher „Allgemein“). */
export function WorkspaceArea({
  formData,
  setFormData,
  terminology,
  receiptLabelError,
  isDemoMode,
  onNavigate,
  onResetToDefaults,
  onReloadDemoData,
  onDeleteDemoData,
}: WorkspaceAreaProps) {
  const { isDragging, scrollerProps } = useDragScroll();
  const terminologyColorSource = formData.terminologyColorSource || 'profile';
  const normalizedReceiptLabel = formData.receiptLabel?.trim() || '';
  const set = <K extends keyof typeof formData>(key: K, value: (typeof formData)[K]) => setFormData(previous => ({ ...previous, [key]: value }));

  const selectProfile = (profile: typeof terminologyProfiles[number]) => {
    setFormData(previous => {
      const next = { ...previous, terminologyProfile: profile.id };
      if ((previous.terminologyColorSource || 'profile') === 'profile' && profile.preview) {
        next.primaryColor = profile.preview.accent;
        next.secondaryColor = profile.preview.secondary;
      }
      return next;
    });
  };

  return (
    <>
      <SettingsCard
        sectionId="einrichtung"
        icon={Rocket}
        title="Ersteinrichtung"
        info="Der Einrichtungsassistent führt durch Firmendaten, Rechnungseinstellungen und Module."
        actions={(
          <button type="button" onClick={() => onNavigate?.('setup')} className="btn-secondary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium">
            Einrichtung öffnen
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      >
        {isDemoMode && (
          <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-gray-500" aria-hidden="true" />
                <p className="text-sm font-semibold text-gray-900">Lokaler Demo-Modus</p>
              </div>
              <p className="mt-1 text-xs text-gray-500">Testdaten und Änderungen werden nur in diesem Browser gespeichert.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={onReloadDemoData} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
                Testdaten neu laden
              </button>
              <button type="button" onClick={onDeleteDemoData} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:border-red-200 hover:bg-red-50">
                Demo-Daten löschen
              </button>
            </div>
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        sectionId="module"
        icon={ToggleRight}
        title="Module"
        info="Deaktivierte Module verschwinden aus der Navigation. Vorhandene Daten bleiben erhalten."
      >
        <div className="settings-row-list">
          <SettingsToggleRow
            label={terminology.work.managementLabel}
            info={`Erfassung von ${terminology.work.plural} und Arbeitszeiten.`}
            checked={formData.jobTrackingEnabled || false}
            onChange={checked => set('jobTrackingEnabled', checked)}
          />
          <SettingsToggleRow
            label="Reporting & Auswertungen"
            info="Rechnungsjournale, Statistiken und Auswertungen."
            checked={formData.reportingEnabled || false}
            onChange={checked => set('reportingEnabled', checked)}
          />
          <SettingsToggleRow
            label="Angebote"
            checked={formData.quotesEnabled || false}
            onChange={checked => set('quotesEnabled', checked)}
          />
          <SettingsToggleRow
            label="Rabatt-Funktion"
            info={`Rabatte auf Positions- und Gesamtebene in Rechnungen, Angeboten und ${terminology.work.plural}.`}
            checked={formData.discountsEnabled !== false}
            onChange={checked => set('discountsEnabled', checked)}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        sectionId="begriffe"
        icon={Languages}
        title="Begriffe & Fachsprache"
        info="Wählen Sie die Begriffe, die in Navigation, Formularen und Hinweisen für Ihre Organisation verwendet werden. Die Datenstruktur bleibt unverändert."
      >
        <div
          {...scrollerProps}
          className={`theme-scrollbar -mx-1 overflow-x-auto px-1 pb-2 pt-3 touch-pan-x ${isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
        >
          <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:min-w-[860px] md:grid-cols-5 xl:min-w-0">
            {terminologyProfiles.map(profile => {
              const selected = (formData.terminologyProfile || 'customers') === profile.id;
              const preview = terminologyColorSource === 'appearance'
                ? {
                    ...profile.preview,
                    accent: formData.primaryColor || '#2563eb',
                    secondary: formData.secondaryColor || '#64748b',
                    accentSoft: `color-mix(in srgb, ${formData.primaryColor || '#2563eb'} 20%, white)`,
                    accentWash: `color-mix(in srgb, ${formData.primaryColor || '#2563eb'} 8%, white)`,
                  }
                : profile.preview;
              return (
                <button
                  key={profile.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => selectProfile(profile)}
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
                  <TerminologyPreview profile={profile} receiptLabel={normalizedReceiptLabel || 'Belege'} previewOverride={preview} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-gray-200 pt-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <SettingsField
            id="receipt-label"
            label="Bezeichnung für den Belegbereich"
            info="Dieser Name erscheint in der Navigation und als Überschrift, zum Beispiel „Belege“, „Ausgabenbelege“ oder „Dokumente“."
            error={receiptLabelError || undefined}
            hint={`${(formData.receiptLabel ?? 'Belege').length} von 40 Zeichen`}
          >
            <input
              id="receipt-label"
              type="text"
              maxLength={40}
              value={formData.receiptLabel ?? 'Belege'}
              onChange={event => set('receiptLabel', event.target.value)}
              aria-invalid={Boolean(receiptLabelError)}
              aria-describedby="receipt-label-message"
              className={`${settingsInputClass} ${receiptLabelError ? 'border-red-300' : ''}`}
            />
          </SettingsField>
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 md:pt-7">
            <span>Vorschläge:</span>
            {['Belege', 'Dokumente', 'Ausgabenbelege', 'Einkauf'].map(option => (
              <button
                key={option}
                type="button"
                onClick={() => set('receiptLabel', option)}
                aria-pressed={normalizedReceiptLabel === option}
                className={`min-h-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:border-primary-custom hover:text-primary-custom ${normalizedReceiptLabel === option ? 'border-primary-custom text-primary-custom' : 'border-gray-300 bg-white text-gray-700'}`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        sectionId="standardwerte"
        icon={RotateCcw}
        title="Standardwerte"
        info="Setzt Darstellung, Formate, Module und Begriffe auf die Standardwerte. Firmendaten bleiben unverändert. Übernommen wird erst mit „Speichern“."
        actions={(
          <button type="button" onClick={onResetToDefaults} className="btn-secondary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Zurücksetzen
          </button>
        )}
      />
    </>
  );
}
