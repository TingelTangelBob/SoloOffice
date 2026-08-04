import { Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Bell, Building2, ChevronDown, Copy, Edit2, FileCheck, FileText, LayoutTemplate, Maximize2, Package, Palette, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { defaultDocumentTemplates, useCompany } from '../context/CompanyContext';
import {
  DocumentHeaderAlignment,
  DocumentLayout,
  DocumentLogoMode,
  DocumentTableStyle,
  DocumentTemplate,
  DocumentTemplateType,
  TerminologyProfile,
} from '../types';
import { getDocumentTemplateFallback, ResolvedDocumentTemplate } from '../utils/documentTemplateProfiles';
import { getTerminology } from '../utils/terminology';

type TemplateTab = 'general' | 'positions' | DocumentTemplateType;

interface TemplatesManagementProps {
  onNavigate?: (page: string, filter?: string) => void;
}

const templateTabs: Array<{ id: TemplateTab; label: string; icon: typeof FileText }> = [
  { id: 'general', label: 'Dokumentdesign', icon: Copy },
  { id: 'invoice', label: 'Rechnungen', icon: FileText },
  { id: 'quote', label: 'Angebote', icon: FileCheck },
  { id: 'reminder', label: 'Mahnungen', icon: Bell },
  { id: 'orderConfirmation', label: 'Bestätigungen', icon: FileCheck },
  { id: 'positions', label: 'Positionen', icon: Package },
];

interface LayoutDefinition {
  id: DocumentLayout;
  label: string;
  description: string;
  defaultAccentColor: string;
  defaultHeaderAlignment: DocumentHeaderAlignment;
  defaultTableStyle: DocumentTableStyle;
  headerAlignments: DocumentHeaderAlignment[];
  tableStyles: DocumentTableStyle[];
}

const layoutOptions: LayoutDefinition[] = [
  { id: 'classic', label: 'Klassisch', description: 'Adressblock, Metadaten und helle Tabelle', defaultAccentColor: '#2563eb', defaultHeaderAlignment: 'split', defaultTableStyle: 'light', headerAlignments: ['split', 'left'], tableStyles: ['light', 'accent'] },
  { id: 'minimal', label: 'Minimal', description: 'Klare Linien, dunkle Tabelle und viel Weißraum', defaultAccentColor: '#111827', defaultHeaderAlignment: 'split', defaultTableStyle: 'dark', headerAlignments: ['split', 'left', 'center'], tableStyles: ['dark', 'light'] },
  { id: 'editorial', label: 'Editorial', description: 'Zentriertes Branding mit warmem Akzent', defaultAccentColor: '#b0894f', defaultHeaderAlignment: 'center', defaultTableStyle: 'accent', headerAlignments: ['center', 'left'], tableStyles: ['accent', 'light'] },
  { id: 'modern', label: 'Modern', description: 'Farbkante, klare Informationshierarchie und starke Akzente', defaultAccentColor: '#0f766e', defaultHeaderAlignment: 'split', defaultTableStyle: 'accent', headerAlignments: ['split', 'left'], tableStyles: ['accent', 'light', 'dark'] },
  { id: 'compact', label: 'Kompakt', description: 'Dichtes Layout für kurze Rechnungen und Angebote', defaultAccentColor: '#475569', defaultHeaderAlignment: 'left', defaultTableStyle: 'light', headerAlignments: ['left', 'split'], tableStyles: ['light', 'dark'] },
  { id: 'split', label: 'Split', description: 'Vertikale Markenleiste mit getrennten Bereichen', defaultAccentColor: '#7c3aed', defaultHeaderAlignment: 'left', defaultTableStyle: 'accent', headerAlignments: ['left', 'split'], tableStyles: ['accent', 'light'] },
  { id: 'bold', label: 'Bold', description: 'Markanter Farbkopf und kontrastreiche Tabelle', defaultAccentColor: '#dc2626', defaultHeaderAlignment: 'left', defaultTableStyle: 'dark', headerAlignments: ['left', 'split'], tableStyles: ['dark', 'accent'] },
  { id: 'air', label: 'Air', description: 'Sehr luftiges Layout mit feinen Linien', defaultAccentColor: '#0891b2', defaultHeaderAlignment: 'center', defaultTableStyle: 'light', headerAlignments: ['center', 'left'], tableStyles: ['light', 'accent'] },
  { id: 'frame', label: 'Frame', description: 'Gerahmtes Dokument mit ruhigem, strukturiertem Aufbau', defaultAccentColor: '#334155', defaultHeaderAlignment: 'split', defaultTableStyle: 'light', headerAlignments: ['split', 'center'], tableStyles: ['light', 'accent'] },
];

const templateColorPresets = [
  { name: 'Schwarz', color: '#1f2937' },
  { name: 'Blau', color: '#2563eb' },
  { name: 'Smaragd', color: '#15803d' },
  { name: 'Violett', color: '#7c3aed' },
  { name: 'Koralle', color: '#ea580c' },
  { name: 'Gold', color: '#b0894f' },
] as const;

interface TemplateFormState {
  name: string;
  description: string;
  subject: string;
  introText: string;
  closingText: string;
  paymentTerms: string;
  layout: DocumentLayout;
  accentColor: string;
  logoMode: DocumentLogoMode;
  headerAlignment: DocumentHeaderAlignment;
  tableStyle: DocumentTableStyle;
  showPaymentInformation: boolean;
  showFooter: boolean;
  reminderTexts: {
    stage1: string;
    stage2: string;
    stage3: string;
  };
}

const emptyForm: TemplateFormState = {
  name: '',
  description: '',
  subject: '',
  introText: '',
  closingText: '',
  paymentTerms: '',
  layout: 'classic',
  accentColor: '#2563eb',
  logoMode: 'company',
  headerAlignment: 'split',
  tableStyle: 'light',
  showPaymentInformation: true,
  showFooter: true,
  reminderTexts: { stage1: '', stage2: '', stage3: '' },
};

function getLayoutDefinition(layout: DocumentLayout): LayoutDefinition {
  return layoutOptions.find(option => option.id === layout) || layoutOptions[0];
}

function getEmptyForm(documentType: DocumentTemplateType): TemplateFormState {
  const fallback = getDocumentTemplateFallback(documentType);
  const layout = getLayoutDefinition(fallback.layout);
  return {
    ...emptyForm,
    layout: fallback.layout,
    accentColor: fallback.accentColor,
    logoMode: fallback.logoMode,
    headerAlignment: layout.defaultHeaderAlignment,
    tableStyle: layout.defaultTableStyle,
  };
}

function templateToForm(template: DocumentTemplate): TemplateFormState {
  const fallback = getDocumentTemplateFallback(template.documentType);
  const layout = getLayoutDefinition(template.layout || fallback.layout);
  const reminderTexts = template.reminderTexts || {};
  const savedHeaderAlignment = template.headerAlignment || fallback.headerAlignment;
  const savedTableStyle = template.tableStyle || fallback.tableStyle;
  return {
    name: template.name,
    description: template.description || '',
    subject: template.subject || '',
    introText: template.introText || '',
    closingText: template.closingText || '',
    paymentTerms: template.paymentTerms || '',
    layout: template.layout || fallback.layout,
    accentColor: template.accentColor || fallback.accentColor,
    logoMode: template.logoMode || fallback.logoMode,
    headerAlignment: layout.headerAlignments.includes(savedHeaderAlignment) ? savedHeaderAlignment : layout.defaultHeaderAlignment,
    tableStyle: layout.tableStyles.includes(savedTableStyle) ? savedTableStyle : layout.defaultTableStyle,
    showPaymentInformation: template.showPaymentInformation ?? true,
    showFooter: template.showFooter ?? true,
    reminderTexts: {
      stage1: reminderTexts.stage1 || template.introText || '',
      stage2: reminderTexts.stage2 || template.introText || '',
      stage3: reminderTexts.stage3 || template.introText || '',
    },
  };
}

function getTemplateTabs(terminologyProfile?: TerminologyProfile) {
  const terminology = getTerminology(terminologyProfile);
  return templateTabs.map(tab => tab.id === 'orderConfirmation'
    ? { ...tab, label: terminology.work.confirmationPluralLabel }
    : tab);
}

function getTemplateTypeLabel(type: DocumentTemplateType, terminologyProfile?: TerminologyProfile) {
  return getTemplateTabs(terminologyProfile).find(tab => tab.id === type)?.label || 'Dokument';
}

function normaliseTemplate(template: DocumentTemplate): ResolvedDocumentTemplate {
  const fallback = getDocumentTemplateFallback(template.documentType);
  return {
    ...fallback,
    ...template,
    layout: template.layout || fallback.layout,
    accentColor: template.accentColor || fallback.accentColor,
    logoMode: template.logoMode || fallback.logoMode,
    headerAlignment: template.headerAlignment || fallback.headerAlignment,
    tableStyle: template.tableStyle || fallback.tableStyle,
    showPaymentInformation: template.showPaymentInformation ?? fallback.showPaymentInformation,
    showFooter: template.showFooter ?? fallback.showFooter,
  };
}

interface TemplatePreviewProps {
  template: DocumentTemplate;
  companyName: string;
  logo?: string | null;
  terminologyProfile?: TerminologyProfile;
  large?: boolean;
}

function TemplatePreview({ template, companyName, logo, terminologyProfile, large = false }: TemplatePreviewProps) {
  const resolved = normaliseTemplate(template);
  const terminology = getTerminology(terminologyProfile);
  const isEditorial = resolved.layout === 'editorial';
  const isMinimal = resolved.layout === 'minimal' || resolved.layout === 'compact' || resolved.layout === 'air';
  const isModern = resolved.layout === 'modern';
  const isBold = resolved.layout === 'bold';
  const isSplit = resolved.layout === 'split';
  const isCompact = resolved.layout === 'compact';
  const isAir = resolved.layout === 'air';
  const isFrame = resolved.layout === 'frame';
  const isDark = resolved.tableStyle === 'dark';
  const isAccent = resolved.tableStyle === 'accent';
  const baseFontSize = large ? (resolved.layout === 'compact' ? 8 : 9) : (resolved.layout === 'compact' ? 4.8 : 5.2);
  const tableColor = isDark ? '#1f2937' : isAccent ? resolved.accentColor : isEditorial ? 'transparent' : '#eef1f5';
  const tableTextColor = isDark || isAccent ? '#ffffff' : '#374151';
  const logoVisible = resolved.logoMode === 'company';
  const documentTitle = template.documentType === 'quote'
    ? 'ANGEBOT'
    : template.documentType === 'reminder'
      ? 'MAHNUNG'
      : template.documentType === 'orderConfirmation'
        ? terminology.work.confirmationLabel.toUpperCase()
        : 'RECHNUNG';
  const sampleRows = template.documentType === 'reminder'
    ? [
        ['Offener Rechnungsbetrag', '2.142,00 €'],
        ['Mahngebühr', '5,00 €'],
        ['Zahlungsfrist', '7 Tage'],
      ]
    : template.documentType === 'orderConfirmation'
      ? [
          ['Design Discovery', '4.320,00 €'],
          ['Interface Design', '9.360,00 €'],
          ['Website Design', '540,00 €'],
        ]
      : [
          ['Design Discovery', '4.320,00 €'],
          ['Interface Design', '9.360,00 €'],
          ['Website Design', '540,00 €'],
        ];
  const sampleIntro = resolved.introText || 'Vielen Dank für Ihre Anfrage. Hiermit berechnen wir Ihnen folgende Leistungen:';
  const pageBackground = isEditorial ? '#fbf8f5' : isAir ? '#fbfdfe' : '#ffffff';
  const documentText = isEditorial ? '#4a3d35' : '#27303d';
  const mutedText = isEditorial ? '#806f63' : '#6b7280';
  const brandMark = logoVisible && logo ? (
    <img src={logo} alt="" className="max-w-full object-contain object-left" style={{ width: large ? 118 : 66, height: large ? 30 : 18 }} />
  ) : (
    <span className="font-semibold tracking-wide" style={{ color: resolved.accentColor, fontSize: large ? 14 : 7 }}>{companyName}</span>
  );

  return (
    <div
      className={`relative mx-auto overflow-hidden rounded-sm border text-left shadow-sm ${large ? 'w-[330px] sm:w-[480px]' : 'w-full'}`}
      style={{ aspectRatio: '0.707', backgroundColor: pageBackground, color: documentText, borderColor: isFrame ? resolved.accentColor : '#d1d5db', borderWidth: isFrame ? 2 : 1, fontFamily: isEditorial || isAir ? 'Georgia, serif' : 'Arial, sans-serif' }}
    >
      {(isModern || isBold) && <div className="absolute inset-x-0 top-0 h-[3%]" style={{ backgroundColor: resolved.accentColor }} />}
      <div className={`absolute inset-x-[9%] ${isCompact ? 'top-[4%] bottom-[4%]' : 'top-[6%] bottom-[6%]'} flex flex-col overflow-hidden ${isSplit ? 'border-l-4 pl-[5%]' : ''}`} style={{ fontSize: baseFontSize, borderColor: isSplit ? resolved.accentColor : undefined }}>
        <div className={`flex items-start gap-4 ${resolved.headerAlignment === 'center' ? 'justify-center text-center' : 'justify-between'} ${isBold ? 'border-b-2 pb-2' : ''}`} style={{ borderColor: isBold ? resolved.accentColor : undefined }}>
          <div className={resolved.headerAlignment === 'center' ? 'w-full' : 'min-w-0'}>
            <div className={resolved.headerAlignment === 'center' ? 'flex justify-center' : ''}>{brandMark}</div>
            {!isMinimal && <div className="mt-1 h-1 rounded-full" style={{ backgroundColor: resolved.accentColor, width: large ? 72 : 38 }} />}
          </div>
          <div className={`${resolved.headerAlignment === 'center' ? 'hidden' : 'text-right'} shrink-0`}>
            <div className="font-bold tracking-wide" style={{ color: resolved.accentColor, fontSize: large ? 12 : 6.2 }}>{documentTitle}</div>
            <div className="mt-1 space-y-0.5" style={{ color: mutedText, fontSize: large ? 7 : 4.2 }}>
              <div>Nr. 12345</div>
              <div>20. Februar 2030</div>
              <div>Fällig am 06. März 2030</div>
            </div>
          </div>
        </div>

        <div className={`mt-[10%] flex items-start justify-between gap-5 ${isMinimal ? 'border-t pt-3' : ''}`} style={{ borderColor: isMinimal ? resolved.accentColor : '#e5e7eb' }}>
          <div className="min-w-0">
            <div className="font-semibold" style={{ fontSize: large ? 10 : 5.8 }}>Rechnung an</div>
            <div className="mt-1 font-semibold">Vincent Vogelstetter</div>
            <div style={{ color: mutedText }}>Jede Straße 123</div>
            <div style={{ color: mutedText }}>12345 Jede Stadt</div>
          </div>
          <div className="text-right" style={{ color: mutedText }}>
            <div className="font-semibold" style={{ color: documentText }}>{terminology.entity.numberShortLabel} 12345</div>
            <div>USt-ID: DE987654321</div>
            <div>Anspruch: Robin Richter</div>
          </div>
        </div>

        <div className="mt-[9%] flex min-h-0 flex-1 flex-col">
          <div className={`font-bold ${isEditorial ? 'uppercase tracking-[0.15em]' : ''}`} style={{ color: resolved.accentColor, fontSize: large ? 14 : 7.2 }}>{documentTitle === 'MAHNUNG' ? 'Zahlung offen' : documentTitle.charAt(0) + documentTitle.slice(1).toLowerCase()}</div>
          <p className="mt-2 max-w-[90%] leading-relaxed" style={{ color: mutedText }}>{sampleIntro}</p>

          {template.documentType === 'reminder' && (
            <div className="mt-3 rounded-sm px-2 py-1.5" style={{ backgroundColor: `${resolved.accentColor}18`, borderLeft: `2px solid ${resolved.accentColor}` }}>
              <div className="font-bold" style={{ color: resolved.accentColor }}>1. Mahnung · Beispiel</div>
              <div style={{ color: mutedText }}>Bitte begleichen Sie den offenen Betrag innerhalb von 7 Tagen.</div>
            </div>
          )}

          <div className="mt-4 overflow-hidden" style={{ border: isEditorial ? `1px solid ${resolved.accentColor}80` : `1px solid ${resolved.accentColor}35`, borderRadius: isEditorial ? 0 : 3 }}>
            <div className="grid grid-cols-[1fr_auto] gap-2 px-2 py-1.5 font-bold" style={{ backgroundColor: tableColor, color: tableTextColor }}>
              <span>Leistung</span>
              <span>Gesamt</span>
            </div>
            {sampleRows.map(([description, amount], index) => (
              <div key={description} className="grid grid-cols-[1fr_auto] gap-2 px-2 py-2" style={{ borderBottom: `1px solid ${isEditorial ? `${resolved.accentColor}35` : '#e5e7eb'}`, backgroundColor: !isEditorial && index % 2 === 1 ? '#fafbfc' : 'transparent' }}>
                <span className="truncate">{description}</span>
                <span className="whitespace-nowrap">{amount}</span>
              </div>
            ))}
          </div>

          <div className="ml-auto mt-3 w-[43%] space-y-1.5 text-right">
            <div className="flex justify-between gap-2" style={{ color: mutedText }}><span>Netto</span><span>14.220,00 €</span></div>
            <div className="flex justify-between gap-2" style={{ color: mutedText }}><span>MwSt. 19 %</span><span>2.701,80 €</span></div>
            <div className="flex justify-between gap-2 border-t pt-1 font-bold" style={{ borderColor: resolved.accentColor, color: resolved.accentColor }}><span>Gesamt</span><span>16.921,80 €</span></div>
          </div>
        </div>

        {resolved.showPaymentInformation && (
          <div className="mt-3 max-w-[80%]" style={{ color: mutedText }}>
            <div className="font-bold" style={{ color: documentText }}>Zahlungsinformationen</div>
            <div>Bitte überweisen Sie den Betrag unter Angabe der Rechnungsnummer.</div>
            <div>IBAN DE89 3704 0044 0532 0130 00 · BIC COBADEFFXXX</div>
          </div>
        )}

        {resolved.showFooter && (
          <div className="mt-auto border-t pt-2" style={{ borderColor: `${resolved.accentColor}55`, color: mutedText }}>
            <div className="flex justify-between gap-2"><span>{companyName}</span><span>info@meinefirma.de</span><span>Seite 1</span></div>
            <div className="mt-1">Musterstraße 123 · 10115 Berlin · www.meinefirma.de</div>
          </div>
        )}
      </div>
    </div>
  );
}

interface TemplateEditorOverlayProps {
  activeTab: DocumentTemplateType;
  editingTemplate: DocumentTemplate | null;
  formData: TemplateFormState;
  setFormData: Dispatch<SetStateAction<TemplateFormState>>;
  companyName: string;
  logo?: string | null;
  terminologyProfile?: TerminologyProfile;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onReset: () => void;
  onSave: (event: FormEvent) => Promise<void>;
}

function TemplateEditorOverlay({
  activeTab,
  editingTemplate,
  formData,
  setFormData,
  companyName,
  logo,
  terminologyProfile,
  isSaving,
  error,
  onClose,
  onReset,
  onSave,
}: TemplateEditorOverlayProps) {
  const terminology = getTerminology(terminologyProfile);
  const [editorTab, setEditorTab] = useState<'design' | 'content'>('design');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ logo: true, color: true, layout: true, details: true, content: true });
  const toggleSection = (section: string) => setOpenSections(previous => ({ ...previous, [section]: !previous[section] }));
  const previewTemplate: DocumentTemplate = {
    id: editingTemplate?.id || 'template-preview',
    documentType: activeTab,
    name: formData.name || 'Neue Vorlage',
    description: formData.description,
    subject: formData.subject,
    introText: formData.introText,
    closingText: formData.closingText,
    paymentTerms: formData.paymentTerms,
    layout: formData.layout,
    accentColor: formData.accentColor,
    logoMode: formData.logoMode,
    headerAlignment: formData.headerAlignment,
    tableStyle: formData.tableStyle,
    showPaymentInformation: formData.showPaymentInformation,
    showFooter: formData.showFooter,
    reminderTexts: formData.reminderTexts,
  };

  const setValue = <K extends keyof TemplateFormState>(key: K, value: TemplateFormState[K]) => {
    setFormData(previous => ({ ...previous, [key]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 p-2 sm:p-4">
      <form onSubmit={onSave} className="flex h-[min(94vh,900px)] w-full max-w-[1320px] flex-col overflow-hidden rounded-2xl bg-[#f4f2f0] shadow-2xl lg:flex-row">
        <aside className="z-10 flex w-full shrink-0 flex-col overflow-y-auto bg-white/95 p-4 backdrop-blur lg:-mr-8 lg:w-[370px] lg:rounded-r-2xl lg:shadow-xl">
          <div className="flex items-center justify-between">
            <button type="button" onClick={onClose} className="inline-flex items-center gap-2 rounded-lg p-2 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900">
              <ArrowLeft className="h-4 w-4" />
              Zurück
            </button>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900" aria-label="Editor schließen">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 rounded-xl bg-gray-100 p-1 text-sm font-medium">
            <button type="button" onClick={() => setEditorTab('design')} className={`rounded-lg px-3 py-2 transition ${editorTab === 'design' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Design</button>
            <button type="button" onClick={() => setEditorTab('content')} className={`rounded-lg px-3 py-2 transition ${editorTab === 'content' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Inhalt</button>
          </div>

          <div className="mt-4 flex-1 space-y-4">
            {editorTab === 'design' ? (
              <>
                <section className="rounded-xl border border-gray-200 bg-white p-3">
                  <button type="button" onClick={() => toggleSection('logo')} className="flex w-full items-center justify-between text-left">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><LayoutTemplate className="h-4 w-4 text-primary-custom" /> Logo</h3>
                    <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${openSections.logo ? '' : '-rotate-90'}`} />
                  </button>
                  {openSections.logo && <div className="mt-3">
                    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-center">
                      {formData.logoMode === 'company' && logo ? <img src={logo} alt={terminology.organization.logoLabel} className="mx-auto h-10 max-w-[180px] object-contain" /> : <div className="py-3 text-xs text-gray-500">Kein Logo ausgewählt</div>}
                    </div>
                    <select value={formData.logoMode} onChange={event => setValue('logoMode', event.target.value as DocumentLogoMode)} className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                      <option value="company">Standardlogo aus {terminology.organization.dataLabel}</option>
                      <option value="none">Ohne Logo</option>
                    </select>
                    {!logo && formData.logoMode === 'company' && <p className="mt-2 text-xs text-amber-700">Laden Sie zuerst unter {terminology.organization.dataLabel} ein {terminology.organization.logoLabel} hoch.</p>}
                  </div>}
                </section>

                <section className="rounded-xl border border-gray-200 bg-white p-3">
                  <button type="button" onClick={() => toggleSection('color')} className="flex w-full items-center justify-between text-left">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Palette className="h-4 w-4 text-primary-custom" /> Farbe</h3>
                    <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${openSections.color ? '' : '-rotate-90'}`} />
                  </button>
                  {openSections.color && <div className="mt-3 flex flex-wrap gap-2">
                    {templateColorPresets.map(preset => (
                      <button key={preset.color} type="button" onClick={() => setValue('accentColor', preset.color)} className={`h-7 w-7 min-h-0 min-w-0 shrink-0 rounded-full border-2 p-0 transition ${formData.accentColor === preset.color ? 'border-gray-900 ring-2 ring-offset-1 ring-primary-custom' : 'border-white shadow'}`} style={{ backgroundColor: preset.color }} aria-label={preset.name} />
                    ))}
                    <label className="relative block h-7 w-7 min-h-0 min-w-0 shrink-0 cursor-pointer overflow-hidden rounded-full border border-gray-300 bg-white" style={{ backgroundColor: formData.accentColor }} title="Eigene Farbe">
                      <input type="color" value={formData.accentColor} onChange={event => setValue('accentColor', event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Eigene Farbe auswählen" />
                    </label>
                    <p className="mt-2 w-full text-xs text-gray-500">Akzentfarbe: {formData.accentColor}</p>
                  </div>}
                </section>

                <section className="rounded-xl border border-gray-200 bg-white p-3">
                  <button type="button" onClick={() => toggleSection('layout')} className="flex w-full items-center justify-between text-left">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><SlidersHorizontal className="h-4 w-4 text-primary-custom" /> Layout</h3>
                    <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${openSections.layout ? '' : '-rotate-90'}`} />
                  </button>
                  {openSections.layout && <div className="mt-3 grid grid-cols-3 gap-2">
                    {layoutOptions.map(option => (
                      <button key={option.id} type="button" onClick={() => {
                        setFormData(previous => ({ ...previous, layout: option.id, accentColor: option.defaultAccentColor, headerAlignment: option.defaultHeaderAlignment, tableStyle: option.defaultTableStyle }));
                      }} className={`rounded-lg border p-1.5 text-left transition ${formData.layout === option.id ? 'border-primary-custom ring-1 ring-primary-custom' : 'border-gray-200 hover:border-gray-400'}`}>
                        <div className={`relative h-20 overflow-hidden rounded border ${option.id === 'editorial' || option.id === 'air' ? 'bg-[#fbf8f5]' : 'bg-white'}`}>
                          <div className="absolute inset-x-2 top-2 h-1 rounded" style={{ backgroundColor: formData.layout === option.id ? formData.accentColor : option.defaultAccentColor }} />
                          <div className="absolute inset-x-2 top-6 space-y-1"><div className="h-1 w-2/3 rounded bg-gray-300" /><div className="h-1 w-1/2 rounded bg-gray-200" /></div>
                          <div className={`absolute inset-x-2 bottom-3 h-6 ${option.id === 'frame' ? 'border' : ''} ${option.id === 'split' ? 'border-l-4' : ''}`} style={{ backgroundColor: option.id === 'bold' || option.id === 'minimal' ? '#1f2937' : option.id === 'editorial' || option.id === 'air' ? `${option.defaultAccentColor}25` : '#eef1f5', borderColor: option.defaultAccentColor }} />
                        </div>
                        <span className="mt-1 block text-center text-[11px] font-medium text-gray-700">{option.label}</span>
                      </button>
                    ))}
                  </div>}
                </section>

                <section className="rounded-xl border border-gray-200 bg-white p-3">
                  <button type="button" onClick={() => toggleSection('details')} className="flex w-full items-center justify-between text-left">
                    <h3 className="text-sm font-semibold text-gray-900">Kopf & Inhalt</h3>
                    <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${openSections.details ? '' : '-rotate-90'}`} />
                  </button>
                  {openSections.details && <div className="mt-3 grid grid-cols-1 gap-3">
                    <label className="text-xs font-medium text-gray-600">Ausrichtung
                      <select value={formData.headerAlignment} onChange={event => setValue('headerAlignment', event.target.value as DocumentHeaderAlignment)} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-normal">
                        {getLayoutDefinition(formData.layout).headerAlignments.map(alignment => <option key={alignment} value={alignment}>{alignment === 'split' ? 'Logo und Metadaten geteilt' : alignment === 'left' ? 'Linksbündig' : 'Zentriert'}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-gray-600">Tabellenstil
                      <select value={formData.tableStyle} onChange={event => setValue('tableStyle', event.target.value as DocumentTableStyle)} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-normal">
                        {getLayoutDefinition(formData.layout).tableStyles.map(style => <option key={style} value={style}>{style === 'light' ? 'Hell und dezent' : style === 'dark' ? 'Dunkle Kopfzeile' : 'Akzentfarbe'}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={formData.showPaymentInformation} onChange={event => setValue('showPaymentInformation', event.target.checked)} className="rounded border-gray-300 text-primary-custom focus:ring-primary-custom" /> Zahlungsinformationen anzeigen</label>
                    <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={formData.showFooter} onChange={event => setValue('showFooter', event.target.checked)} className="rounded border-gray-300 text-primary-custom focus:ring-primary-custom" /> Fußbereich anzeigen</label>
                  </div>}
                </section>
              </>
            ) : (
              <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-3">
                <button type="button" onClick={() => toggleSection('content')} className="flex w-full items-center justify-between text-left">
                  <h3 className="text-sm font-semibold text-gray-900">Vorlageninhalt</h3>
                  <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${openSections.content ? '' : '-rotate-90'}`} />
                </button>
                {openSections.content && <div>
                  <p className="mt-1 text-xs text-gray-500">Die Texte werden direkt im PDF verwendet und rechts sofort aktualisiert.</p>
                  <div className="mt-4 space-y-4">
                    <label className="block text-xs font-medium text-gray-600">Name *<input value={formData.name} onChange={event => setValue('name', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal" required /></label>
                    <label className="block text-xs font-medium text-gray-600">Kurzbeschreibung<input value={formData.description} onChange={event => setValue('description', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal" /></label>
                    <label className="block text-xs font-medium text-gray-600">Betreff<input value={formData.subject} onChange={event => setValue('subject', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal" /></label>
                    <label className="block text-xs font-medium text-gray-600">Einleitung<textarea value={formData.introText} onChange={event => setValue('introText', event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal" /></label>
                    <label className="block text-xs font-medium text-gray-600">Abschlusstext<textarea value={formData.closingText} onChange={event => setValue('closingText', event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal" /></label>
                    <label className="block text-xs font-medium text-gray-600">Zahlungs-/Gültigkeitshinweis<textarea value={formData.paymentTerms} onChange={event => setValue('paymentTerms', event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal" /></label>
                    {activeTab === 'reminder' && (
                      <div className="space-y-3 border-t border-gray-100 pt-3">
                        <div className="text-xs font-semibold text-gray-800">Drei Mahnstufen</div>
                        {([
                          ['stage1', '1. Mahnung'],
                          ['stage2', '2. Mahnung'],
                          ['stage3', '3. Mahnung / letzte Mahnung'],
                        ] as const).map(([stage, label]) => <label key={stage} className="block text-xs font-medium text-gray-600">{label}<textarea value={formData.reminderTexts[stage]} onChange={event => setFormData(previous => ({ ...previous, reminderTexts: { ...previous.reminderTexts, [stage]: event.target.value } }))} rows={3} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal" /></label>)}
                      </div>
                    )}
                  </div>
                </div>}
              </section>
            )}
          </div>

          {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-200 pt-4">
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Abbrechen</button>
              <button type="button" onClick={onReset} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Änderungen zurücksetzen</button>
            </div>
            <button type="submit" disabled={isSaving} className="rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white shadow-sm hover:brightness-90 disabled:opacity-50">{isSaving ? 'Speichert...' : 'Vorlage speichern'}</button>
          </div>
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f4f2f0]">
          <div className="flex items-center justify-between px-5 py-4 lg:pl-14">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-gray-500">Live-Vorschau</div>
              <h2 className="mt-1 text-lg font-semibold text-gray-900">{formData.name || 'Neue Vorlage'}</h2>
            </div>
            <div className="rounded-full bg-white/70 px-3 py-1 text-xs text-gray-500">Beispieldaten</div>
          </div>
          <div className="flex flex-1 items-start justify-center overflow-auto px-4 pb-8 pt-2 sm:px-8">
            <TemplatePreview template={previewTemplate} companyName={companyName} logo={logo} terminologyProfile={terminologyProfile} large />
          </div>
        </main>
      </form>
    </div>
  );
}

export function TemplatesManagement({ onNavigate }: TemplatesManagementProps) {
  const {
    company,
    documentTemplates,
    hourlyRates,
    materialTemplates,
    addDocumentTemplate,
    updateDocumentTemplate,
    deleteDocumentTemplate,
  } = useCompany();
  const terminology = getTerminology(company?.terminologyProfile);
  const tabs = getTemplateTabs(company?.terminologyProfile);
  const [activeTab, setActiveTab] = useState<TemplateTab>('general');
  const [editingTemplate, setEditingTemplate] = useState<DocumentTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState<TemplateFormState>(emptyForm);
  const [selectedPreview, setSelectedPreview] = useState<DocumentTemplate | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const templates = useMemo(() => {
    if (activeTab === 'general' || activeTab === 'positions') return [];
    const source = documentTemplates.length > 0 ? documentTemplates : defaultDocumentTemplates;
    return source.filter(template => template.documentType === activeTab);
  }, [activeTab, documentTemplates]);

  useEffect(() => {
    if (!editingTemplate) {
      if (!isCreating) setFormData(emptyForm);
      return;
    }
    setFormData(templateToForm(editingTemplate));
  }, [editingTemplate, isCreating]);

  useEffect(() => {
    if (!selectedPreview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedPreview(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedPreview]);

  const openCreate = () => {
    setEditingTemplate(null);
    setFormData(getEmptyForm(activeTab as DocumentTemplateType));
    setIsCreating(true);
    setError(null);
  };

  const openEdit = (template: DocumentTemplate) => {
    setIsCreating(false);
    setEditingTemplate(template);
    setError(null);
  };

  const closeEditor = () => {
    setEditingTemplate(null);
    setIsCreating(false);
    setFormData(emptyForm);
    setError(null);
  };

  const resetEditorChanges = () => {
    setFormData(editingTemplate ? templateToForm(editingTemplate) : getEmptyForm(activeTab as DocumentTemplateType));
    setError(null);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!formData.name.trim()) {
      setError('Bitte vergeben Sie einen Namen für die Vorlage.');
      return;
    }

    const documentType = activeTab as DocumentTemplateType;
    const templateData: Omit<DocumentTemplate, 'id' | 'createdAt' | 'updatedAt'> = {
      documentType,
      name: formData.name.trim(),
      description: formData.description.trim(),
      subject: formData.subject.trim(),
      introText: formData.introText.trim(),
      closingText: formData.closingText.trim(),
      paymentTerms: formData.paymentTerms.trim(),
      layout: formData.layout,
      accentColor: formData.accentColor,
      logoMode: formData.logoMode,
      headerAlignment: formData.headerAlignment,
      tableStyle: formData.tableStyle,
      showPaymentInformation: formData.showPaymentInformation,
      showFooter: formData.showFooter,
      ...(documentType === 'reminder' ? { reminderTexts: formData.reminderTexts } : {}),
      isDefault: editingTemplate ? editingTemplate.isDefault : templates.length === 0,
    };

    try {
      setIsSaving(true);
      if (editingTemplate) {
        await updateDocumentTemplate(editingTemplate.id, templateData);
      } else {
        await addDocumentTemplate(templateData);
      }
      closeEditor();
    } catch {
      setError('Die Vorlage konnte nicht gespeichert werden.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetDefault = async (template: DocumentTemplate) => {
    try {
      await updateDocumentTemplate(template.id, { isDefault: true });
    } catch {
      setError('Die Standardvorlage konnte nicht geändert werden.');
    }
  };

  const handleDelete = async (template: DocumentTemplate) => {
    if (!window.confirm(`Vorlage „${template.name}“ wirklich löschen?`)) return;
    try {
      await deleteDocumentTemplate(template.id);
    } catch {
      setError('Die Vorlage konnte nicht gelöscht werden.');
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        icon={Copy}
        title="Vorlagen"
        subtitle="PDF-Layouts und Dokumentdesign zentral verwalten"
      />

      <div className="sticky top-16 z-20 -mx-3 flex gap-1 overflow-x-auto border-b border-gray-200 bg-gray-50/95 p-1 shadow-sm backdrop-blur sm:-mx-4 sm:px-2 lg:top-2 lg:mx-0 lg:rounded-xl lg:border lg:bg-white lg:p-1">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                closeEditor();
              }}
              className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${activeTab === tab.id
                ? 'bg-primary-custom text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'general' ? (
        <div className="space-y-6">
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm lg:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <LayoutTemplate className="h-5 w-5 text-primary-custom" />
                  <h2 className="text-lg font-semibold text-gray-900">Dokumentdesign</h2>
                </div>
                <p className="mt-2 max-w-2xl text-sm text-gray-600">
                  Hier verwalten Sie die Gestaltung der fertigen PDF-Dokumente. Wählen Sie oben den Dokumenttyp, um Layouts, Farben, Logos, Tabellen und Texte zu bearbeiten.
                </p>
              </div>
              <span className="inline-flex shrink-0 rounded-full bg-primary-custom/10 px-3 py-1 text-xs font-medium text-primary-custom">9 Layouts verfügbar</span>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              { value: '4', label: 'Dokumentarten', text: `Rechnungen, Angebote, Mahnungen und ${terminology.work.confirmationPluralLabel}` },
              { value: '3', label: 'Mahnstufen', text: 'Eine Mahnungsvorlage deckt alle drei Stufen ab' },
              { value: '1', label: 'Standardlogo', text: `Wird zentral in ${terminology.organization.dataLabel} gepflegt` },
            ].map(item => (
              <div key={item.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-2xl font-semibold text-primary-custom">{item.value}</p>
                <h3 className="mt-1 text-sm font-semibold text-gray-900">{item.label}</h3>
                <p className="mt-1 text-xs leading-5 text-gray-500">{item.text}</p>
              </div>
            ))}
          </div>

          <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 lg:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
                <div>
                  <h2 className="text-base font-semibold text-blue-900">{terminology.organization.dataLabel}</h2>
                  <p className="mt-1 text-sm text-blue-800">
                  {terminology.organization.dataLabel}, Standardlogo, Kontakt- und Zahlungsinformationen werden zentral in den Einstellungen verwaltet.
                  </p>
                </div>
              </div>
              {onNavigate && (
                <button type="button" onClick={() => onNavigate('settings', 'general')} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-800">
                  {terminology.organization.dataLabel} öffnen
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </section>
        </div>
      ) : activeTab === 'positions' ? (
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-4 lg:p-6">
            <h2 className="text-lg font-semibold text-gray-900">Positionsvorlagen</h2>
            <p className="mt-1 text-sm text-gray-500">
              Stundensätze und Materialien bleiben eigene Vorlagenarten, weil sie direkt in Rechnungspositionen verwendet werden.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="font-semibold text-gray-900">Stundensätze</h3>
              <p className="mt-2 text-2xl font-semibold text-primary-custom">{hourlyRates.length}</p>
              <p className="text-sm text-gray-500">allgemeine Vorlagen</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="font-semibold text-gray-900">Materialien</h3>
              <p className="mt-2 text-2xl font-semibold text-primary-custom">{materialTemplates.length}</p>
              <p className="text-sm text-gray-500">allgemeine Vorlagen</p>
            </div>
          </div>
          {onNavigate && (
            <button type="button" onClick={() => onNavigate('settings', 'invoices')} className="rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white hover:brightness-90">
              Positionsvorlagen in Rechnungen öffnen
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between lg:p-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{getTemplateTypeLabel(activeTab as DocumentTemplateType, company?.terminologyProfile)}</h2>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">
                Diese Vorlagen steuern das fertige PDF-Layout. Texte, Logo, Akzentfarbe, Tabelle und Fußbereich werden gemeinsam gespeichert.
                {activeTab === 'reminder' && ' Jede Mahnungsvorlage enthält alle drei Mahnstufen.'}
              </p>
            </div>
            <button type="button" onClick={openCreate} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white hover:brightness-90">
              <Plus className="h-4 w-4" />
              Vorlage hinzufügen
            </button>
          </div>

          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {templates.map(template => (
              <article key={template.id} className={`relative overflow-hidden rounded-xl border bg-white shadow-sm ${template.isDefault ? 'border-primary-custom' : 'border-gray-200'}`}>
                {template.isDefault && <span className="absolute left-1/2 top-2 z-10 inline-flex -translate-x-1/2 rounded-full border border-primary-custom bg-white px-3 py-1 text-xs font-medium text-primary-custom">Standard</span>}
                <button type="button" onClick={() => setSelectedPreview(template)} className="group relative block w-full bg-gray-50 p-4" aria-label={`${template.name} in großer Vorschau öffnen`}>
                  <TemplatePreview template={template} companyName={company.name} logo={company.logo} terminologyProfile={company.terminologyProfile} />
                  <span className="absolute bottom-6 right-6 inline-flex items-center gap-1 rounded-md bg-white/95 px-2 py-1 text-xs font-medium text-gray-700 opacity-0 shadow transition group-hover:opacity-100">
                    <Maximize2 className="h-3 w-3" /> Große Vorschau
                  </span>
                </button>
                <div className="p-4">
                  <div className="flex min-h-10 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-left font-semibold text-gray-900">{template.name}</h3>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" onClick={() => openEdit(template)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-primary-custom" aria-label={`${template.name} bearbeiten`}>
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => handleDelete(template)} className="rounded-lg p-2 text-gray-500 hover:bg-red-50 hover:text-red-600" aria-label={`${template.name} löschen`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-3 min-h-10 text-sm text-gray-600">{template.description || 'Keine Beschreibung hinterlegt.'}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-gray-500">
                    <span className="rounded-full bg-gray-100 px-2 py-1">{layoutOptions.find(option => option.id === (template.layout || 'classic'))?.label || 'Klassisch'}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-1">{template.logoMode === 'none' ? 'Ohne Logo' : terminology.organization.logoLabel}</span>
                    {activeTab === 'reminder' && <span className="rounded-full bg-gray-100 px-2 py-1">Mahnstufen 1–3</span>}
                  </div>
                  <button type="button" onClick={() => handleSetDefault(template)} disabled={template.isDefault} className="mt-4 text-sm font-medium text-primary-custom disabled:cursor-default disabled:opacity-50">
                    {template.isDefault ? 'Aktive Standardvorlage' : 'Als Standard auswählen'}
                  </button>
                </div>
              </article>
            ))}
          </div>

          {templates.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
              Noch keine Vorlagen vorhanden. Legen Sie die erste Layoutvorlage an.
            </div>
          )}

          {(isCreating || editingTemplate) && (
            <TemplateEditorOverlay
              activeTab={activeTab as DocumentTemplateType}
              editingTemplate={editingTemplate}
              formData={formData}
              setFormData={setFormData}
              companyName={company.name}
              logo={company.logo}
              terminologyProfile={company.terminologyProfile}
              isSaving={isSaving}
              error={error}
              onClose={closeEditor}
              onReset={resetEditorChanges}
              onSave={handleSave}
            />
          )}

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            Eigene Layouts basieren auf neun professionellen Grundlayouts. So bleiben PDFs technisch stabil, während Branding, Logo, Farben, Tabelle und Informationsblöcke angepasst werden können.
          </div>
        </div>
      )}

      {selectedPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 p-4" onMouseDown={() => setSelectedPreview(null)}>
          <div role="dialog" aria-modal="true" aria-label={`${selectedPreview.name} Vorschau`} className="relative max-h-[95vh] max-w-[95vw] overflow-auto rounded-2xl bg-gray-100 p-5 shadow-2xl" onMouseDown={event => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{selectedPreview.name}</h2>
                <p className="text-sm text-gray-500">Beispielhafte PDF-Vorschau mit den aktuellen Layoutmerkmalen</p>
              </div>
              <button type="button" onClick={() => setSelectedPreview(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-gray-600 shadow hover:bg-gray-50 hover:text-gray-900" aria-label="Vorschau schließen">
                <X className="h-5 w-5" />
              </button>
            </div>
            <TemplatePreview template={selectedPreview} companyName={company.name} logo={company.logo} terminologyProfile={company.terminologyProfile} large />
          </div>
        </div>
      )}
    </div>
  );
}
