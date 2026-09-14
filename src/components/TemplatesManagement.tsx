import { Dispatch, FormEvent, KeyboardEvent as ReactKeyboardEvent, SetStateAction, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Copy, Edit2, FileCheck, FileText, LayoutTemplate, Maximize2, Palette, Plus, RotateCcw, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { useCompany } from '../context/CompanyContext';
import { defaultDocumentTemplates } from '../context/CompanyProvider';
import {
  DocumentHeaderAlignment,
  DocumentLayout,
  DocumentLogoMode,
  Company,
  DocumentTableStyle,
  DocumentTemplate,
  DocumentTemplateType,
  DocumentTextTemplate,
  ReminderTemplateTexts,
  TerminologyProfile,
} from '../types';
import { getDocumentTemplateFallback, ResolvedDocumentTemplate } from '../utils/documentTemplateProfiles';
import {
  defaultDocumentTextTemplates,
  documentTextTemplateTypes,
  getDocumentTemplateTextMode,
  resolveDocumentTextTemplate,
} from '../utils/documentTextTemplates';
import { getTerminology } from '../utils/terminology';
import { ThemeTabBar } from './ThemeTabBar';
import { useFeedback } from '../context/FeedbackContext';
import { TemplatePdfPreview } from './templates/TemplatePdfPreview';
import { restoreDefaultTemplates } from '../utils/templateDefaults';
import { ActionMenu, ActionMenuItem } from './ActionMenu';

type TemplateTab = 'text' | DocumentTemplateType;

const templateTabs: Array<{ id: TemplateTab; label: string; icon: typeof FileText }> = [
  { id: 'invoice', label: 'Rechnungen', icon: FileText },
  { id: 'quote', label: 'Angebote', icon: FileCheck },
  { id: 'orderConfirmation', label: 'Bestätigungen', icon: FileCheck },
  { id: 'reminder', label: 'Mahnungen', icon: FileText },
  { id: 'text', label: 'Textvorlagen', icon: Copy },
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
  reminderTexts: ReminderTemplateTexts;
  textMode: 'global' | 'custom';
  layout: DocumentLayout;
  accentColor: string;
  logoMode: DocumentLogoMode;
  headerAlignment: DocumentHeaderAlignment;
  tableStyle: DocumentTableStyle;
  showPaymentInformation: boolean;
  showFooter: boolean;
}

const emptyForm: TemplateFormState = {
  name: '',
  description: '',
  subject: '',
  introText: '',
  closingText: '',
  paymentTerms: '',
  reminderTexts: {},
  textMode: 'global',
  layout: 'classic',
  accentColor: '#2563eb',
  logoMode: 'company',
  headerAlignment: 'split',
  tableStyle: 'light',
  showPaymentInformation: true,
  showFooter: true,
};

function getLayoutDefinition(layout: DocumentLayout): LayoutDefinition {
  return layoutOptions.find(option => option.id === layout) || layoutOptions[0];
}

function getEmptyForm(documentType: DocumentTemplateType, company: Company): TemplateFormState {
  const fallback = getDocumentTemplateFallback(documentType);
  const layout = getLayoutDefinition(fallback.layout);
  const textDefaults = resolveDocumentTextTemplate(company, documentType);
  return {
    ...emptyForm,
    subject: textDefaults.subject || '',
    introText: textDefaults.introText || '',
    closingText: textDefaults.closingText || '',
    paymentTerms: textDefaults.paymentTerms || '',
    reminderTexts: { ...textDefaults.reminderTexts },
    layout: fallback.layout,
    accentColor: fallback.accentColor,
    logoMode: fallback.logoMode,
    headerAlignment: layout.defaultHeaderAlignment,
    tableStyle: layout.defaultTableStyle,
  };
}

function templateToForm(template: DocumentTemplate, company: Company): TemplateFormState {
  const fallback = getDocumentTemplateFallback(template.documentType);
  const layout = getLayoutDefinition(template.layout || fallback.layout);
  const textDefaults = resolveDocumentTextTemplate(company, template.documentType);
  const textMode = getDocumentTemplateTextMode(company, template);
  const savedHeaderAlignment = template.headerAlignment || fallback.headerAlignment;
  const savedTableStyle = template.tableStyle || fallback.tableStyle;
  return {
    name: template.name,
    description: template.description || '',
    subject: textMode === 'custom' ? (template.subject ?? textDefaults.subject ?? '') : (textDefaults.subject || ''),
    introText: textMode === 'custom' ? (template.introText ?? textDefaults.introText ?? '') : (textDefaults.introText || ''),
    closingText: textMode === 'custom' ? (template.closingText ?? textDefaults.closingText ?? '') : (textDefaults.closingText || ''),
    paymentTerms: textMode === 'custom' ? (template.paymentTerms ?? textDefaults.paymentTerms ?? '') : (textDefaults.paymentTerms || ''),
    reminderTexts: textMode === 'custom'
      ? { ...textDefaults.reminderTexts, ...template.reminderTexts }
      : { ...textDefaults.reminderTexts },
    textMode,
    layout: template.layout || fallback.layout,
    accentColor: template.accentColor || fallback.accentColor,
    logoMode: template.logoMode || fallback.logoMode,
    headerAlignment: layout.headerAlignments.includes(savedHeaderAlignment) ? savedHeaderAlignment : layout.defaultHeaderAlignment,
    tableStyle: layout.tableStyles.includes(savedTableStyle) ? savedTableStyle : layout.defaultTableStyle,
    showPaymentInformation: template.showPaymentInformation ?? true,
    showFooter: template.showFooter ?? true,
  };
}

function getTemplateTabs(terminologyProfile?: TerminologyProfile) {
  const terminology = getTerminology(terminologyProfile);
  return templateTabs.map(tab => tab.id === 'orderConfirmation'
    ? { ...tab, label: terminology.work.confirmationPluralLabel }
    : tab);
}

function getTemplateTypeLabel(type: DocumentTemplateType, terminologyProfile?: TerminologyProfile) {
  if (type === 'reminder') return 'Mahnungen';
  return getTemplateTabs(terminologyProfile).find(tab => tab.id === type)?.label || 'Dokument';
}

function normaliseTemplate(template: DocumentTemplate, company: Company): ResolvedDocumentTemplate {
  const fallback = getDocumentTemplateFallback(template.documentType);
  const textDefaults = resolveDocumentTextTemplate(company, template.documentType);
  const textMode = getDocumentTemplateTextMode(company, template);
  return {
    ...fallback,
    ...template,
    textMode,
    subject: textMode === 'custom' ? (template.subject ?? textDefaults.subject) : textDefaults.subject,
    introText: textMode === 'custom' ? (template.introText ?? textDefaults.introText) : textDefaults.introText,
    closingText: textMode === 'custom' ? (template.closingText ?? textDefaults.closingText) : textDefaults.closingText,
    paymentTerms: textMode === 'custom' ? (template.paymentTerms ?? textDefaults.paymentTerms) : textDefaults.paymentTerms,
    reminderTexts: textMode === 'custom'
      ? { ...textDefaults.reminderTexts, ...template.reminderTexts }
      : textDefaults.reminderTexts,
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
  company: Company;
  companyName: string;
  logo?: string | null;
  terminologyProfile?: TerminologyProfile;
  large?: boolean;
}

function TemplateMiniature({ template, company, companyName, logo, terminologyProfile, large = false }: TemplatePreviewProps) {
  const resolved = normaliseTemplate(template, company);
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
        ['Offener Rechnungsbetrag', '—'],
        ['Mahngebühr', '—'],
        ['Zahlungsfrist', '—'],
      ]
    : template.documentType === 'orderConfirmation'
      ? [
        ['Design Discovery', '—'],
        ['Interface Design', '—'],
        ['Website Design', '—'],
      ]
    : resolved.layout === 'modern'
      ? [
          ['Monatlicher Support', '—'],
          ['Konzeption & Beratung', '—'],
          ['Zusatzaufwand', '—'],
        ]
      : resolved.layout === 'editorial'
        ? [
            ['Projektphase: Konzeption', '—'],
            ['Umsetzung & Abstimmung', '—'],
            ['Übergabe & Dokumentation', '—'],
          ]
      : [
          ['Beratung und Analyse', '—'],
          ['Leistungserbringung', '—'],
          ['Dokumentation', '—'],
        ];
  const sampleIntro = resolved.introText || 'Vielen Dank für Ihre Anfrage. Hiermit berechnen wir Ihnen folgende Leistungen:';
  const sampleReminderText = resolved.reminderTexts?.stage1 || 'Bitte begleichen Sie den offenen Betrag innerhalb von 7 Tagen.';
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
            <div>USt-ID: aus Firmeneinstellungen</div>
            <div>Kontakt: aus Firmeneinstellungen</div>
          </div>
        </div>

        <div className="mt-[9%] flex min-h-0 flex-1 flex-col">
          <div className={`font-bold ${isEditorial ? 'uppercase tracking-[0.15em]' : ''}`} style={{ color: resolved.accentColor, fontSize: large ? 14 : 7.2 }}>{documentTitle === 'MAHNUNG' ? 'Zahlung offen' : documentTitle.charAt(0) + documentTitle.slice(1).toLowerCase()}</div>
          <p className="mt-1 max-w-[90%] leading-tight" style={{ color: mutedText, maxHeight: large ? undefined : 22, overflow: 'hidden' }}>{sampleIntro}</p>

          {template.documentType === 'reminder' && (
            <div className="mt-3 rounded-sm px-2 py-1.5" style={{ backgroundColor: `${resolved.accentColor}18`, borderLeft: `2px solid ${resolved.accentColor}` }}>
              <div className="font-bold" style={{ color: resolved.accentColor }}>1. Mahnung · Beispiel</div>
              <div style={{ color: mutedText }}>{sampleReminderText}</div>
            </div>
          )}

          <div className="mt-4 overflow-hidden" style={{ border: isEditorial ? `1px solid ${resolved.accentColor}80` : `1px solid ${resolved.accentColor}35`, borderRadius: isEditorial ? 0 : 3 }}>
            <div className="grid grid-cols-[1fr_auto] gap-1 px-2 py-1 font-bold leading-tight" style={{ backgroundColor: tableColor, color: tableTextColor }}>
              <span>Leistung</span>
              <span>Gesamt</span>
            </div>
            {sampleRows.map(([description, amount], index) => (
              <div key={description} className="grid grid-cols-[1fr_auto] gap-1 px-2 py-1.5 leading-tight" style={{ borderBottom: `1px solid ${isEditorial ? `${resolved.accentColor}35` : '#e5e7eb'}`, backgroundColor: !isEditorial && index % 2 === 1 ? '#fafbfc' : 'transparent' }}>
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
            <div>Zahlungsdaten aus den Firmeneinstellungen</div>
          </div>
        )}

        {resolved.showFooter && (
          <div className="mt-auto border-t pt-2" style={{ borderColor: `${resolved.accentColor}55`, color: mutedText }}>
            <div className="flex justify-between gap-2"><span>{companyName || 'Ihr Firmenname'}</span><span>Firmendaten aus Einstellungen</span><span>Seite 1</span></div>
            <div className="mt-1">Adresse und Kontakt aus den Firmeneinstellungen</div>
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
  company: Company;
  logo?: string | null;
  terminologyProfile?: TerminologyProfile;
  isSaving: boolean;
  isDirty: boolean;
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
  company,
  logo,
  terminologyProfile,
  isSaving,
  isDirty,
  error,
  onClose,
  onReset,
  onSave,
}: TemplateEditorOverlayProps) {
  const terminology = getTerminology(terminologyProfile);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const errorId = useId();
  const [editorTab, setEditorTab] = useState<'design' | 'content'>('design');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ logo: true, color: true, layout: true, details: true, content: true });
  const toggleSection = (section: string) => setOpenSections(previous => ({ ...previous, [section]: !previous[section] }));

  useEffect(() => {
    const initialFocus = dialogRef.current?.querySelector<HTMLElement>('[data-editor-initial-focus]');
    initialFocus?.focus();
  }, []);

  useEffect(() => {
    if (isSaving) dialogRef.current?.focus();
  }, [isSaving]);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isSaving) {
      if (event.key === 'Escape' || event.key === 'Tab') event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;

    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )).filter(element => !element.matches(':disabled') && element.getClientRects().length > 0);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (document.activeElement === dialogRef.current) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const previewTemplate: DocumentTemplate = {
    id: editingTemplate?.id || 'template-preview',
    documentType: activeTab,
    name: formData.name || 'Neue Vorlage',
    description: formData.description,
    subject: formData.subject,
    introText: formData.introText,
    closingText: formData.closingText,
    paymentTerms: formData.paymentTerms,
    reminderTexts: formData.reminderTexts,
    textMode: formData.textMode,
    layout: formData.layout,
    accentColor: formData.accentColor,
    logoMode: formData.logoMode,
    headerAlignment: formData.headerAlignment,
    tableStyle: formData.tableStyle,
    showPaymentInformation: formData.showPaymentInformation,
    showFooter: formData.showFooter,
  };

  const setValue = <K extends keyof TemplateFormState>(key: K, value: TemplateFormState[K]) => {
    setFormData(previous => ({ ...previous, [key]: value }));
  };

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleDialogKeyDown} className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 p-2 sm:p-4">
      <form noValidate onSubmit={onSave} aria-busy={isSaving} className="template-editor-shell form-consistent-fields flex h-[min(94dvh,900px)] max-h-[calc(100dvh-1rem)] w-full max-w-[1320px] flex-col overflow-hidden rounded-2xl shadow-2xl">
        <div className="template-editor-header flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <button type="button" onClick={onClose} disabled={isSaving} data-editor-initial-focus className="inline-flex items-center gap-2 rounded-lg p-2 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50">
            <ArrowLeft className="h-4 w-4" />
            Zurück
          </button>
          <h2 id={titleId} className="min-w-0 flex-1 text-sm font-semibold text-gray-900">{editingTemplate ? 'Vorlage bearbeiten' : 'Neue Vorlage'}</h2>
          <button type="button" onClick={onClose} disabled={isSaving} className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50" aria-label="Editor schließen">
            <X className="h-4 w-4" />
          </button>
        </div>
        <fieldset disabled={isSaving} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <aside className="template-editor-sidebar z-10 flex w-full shrink-0 flex-col p-4 backdrop-blur lg:min-h-0 lg:w-[370px] lg:overflow-hidden lg:rounded-r-2xl lg:shadow-xl">
          <div className="template-editor-tabs grid grid-cols-2 rounded-xl p-1 text-sm font-medium">
            <button type="button" onClick={() => setEditorTab('design')} aria-pressed={editorTab === 'design'} className={`rounded-lg px-3 py-2 transition ${editorTab === 'design' ? 'template-editor-tab-active shadow-sm' : 'text-gray-500'}`}>Design</button>
            <button type="button" onClick={() => setEditorTab('content')} aria-pressed={editorTab === 'content'} className={`rounded-lg px-3 py-2 transition ${editorTab === 'content' ? 'template-editor-tab-active shadow-sm' : 'text-gray-500'}`}>Inhalt</button>
          </div>

          <div className="mt-4 space-y-4 pr-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <label className="template-editor-section block rounded-xl border p-3 text-xs font-medium text-gray-600">Name *
              <input name="templateName" value={formData.name} onChange={event => setValue('name', event.target.value)} aria-required="true" aria-invalid={Boolean(error) && !formData.name.trim()} aria-describedby={error && !formData.name.trim() ? errorId : undefined} required className="form-input form-input-compact mt-1 text-sm font-normal" />
            </label>
            {editorTab === 'design' ? (
              <>
                <section className="template-editor-section rounded-xl border p-3">
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

                <section className="template-editor-section rounded-xl border p-3">
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

                <section className="template-editor-section rounded-xl border p-3">
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

                <section className="template-editor-section rounded-xl border p-3">
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
              <section className="template-editor-section space-y-4 rounded-xl border p-3">
                <button type="button" onClick={() => toggleSection('content')} className="flex w-full items-center justify-between text-left">
                  <h3 className="text-sm font-semibold text-gray-900">Vorlageninhalt</h3>
                  <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${openSections.content ? '' : '-rotate-90'}`} />
                </button>
                {openSections.content && <div>
                  <p className="mt-1 text-xs text-gray-500">Die PDF-Vorlage nutzt standardmäßig die passenden Texte aus den Textvorlagen. Für diese Vorlage können Sie sie bei Bedarf überschreiben.</p>
                  <div className="mt-4 space-y-4">
                    <div className="template-editor-text-source rounded-lg border p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-xs font-semibold text-gray-900">Textquelle</div>
                          <p className="mt-1 text-xs text-gray-500">Standardtexte gelten für alle {getTemplateTypeLabel(activeTab, terminologyProfile)}.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setValue('textMode', formData.textMode === 'custom' ? 'global' : 'custom')}
                          aria-pressed={formData.textMode === 'custom'}
                          className={`inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${formData.textMode === 'custom' ? 'border-primary-custom bg-primary-custom/10 text-primary-custom' : 'border-gray-200 text-gray-600 hover:border-primary-custom hover:text-primary-custom'}`}
                        >
                          {formData.textMode === 'custom' ? 'Eigene Texte aktiv' : 'Eigene Texte verwenden'}
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-gray-500">
                        {formData.textMode === 'custom' ? 'Diese Texte gelten nur für diese PDF-Vorlage.' : 'Zum Bearbeiten eigene Texte aktivieren.'}
                      </p>
                    </div>
                    <label className="block text-xs font-medium text-gray-600">Vorlagenbeschreibung<input value={formData.description} onChange={event => setValue('description', event.target.value)} className="form-input form-input-compact mt-1 text-sm font-normal" /></label>
                    <label className="block text-xs font-medium text-gray-600">Betreff<input disabled={formData.textMode === 'global'} value={formData.subject} onChange={event => setValue('subject', event.target.value)} className="form-input form-input-compact mt-1 text-sm font-normal" /></label>
                    {activeTab !== 'reminder' ? (
                      <>
                        <label className="block text-xs font-medium text-gray-600">Einleitung<textarea disabled={formData.textMode === 'global'} value={formData.introText} onChange={event => setValue('introText', event.target.value)} rows={3} className="form-input mt-1 min-h-[5.5rem] resize-y text-sm font-normal" /></label>
                        <label className="block text-xs font-medium text-gray-600">Abschlusstext<textarea disabled={formData.textMode === 'global'} value={formData.closingText} onChange={event => setValue('closingText', event.target.value)} rows={3} className="form-input mt-1 min-h-[5.5rem] resize-y text-sm font-normal" /></label>
                        <label className="block text-xs font-medium text-gray-600">Zahlungs-/Gültigkeitshinweis<textarea disabled={formData.textMode === 'global'} value={formData.paymentTerms} onChange={event => setValue('paymentTerms', event.target.value)} rows={3} className="form-input mt-1 min-h-[5.5rem] resize-y text-sm font-normal" /></label>
                      </>
                    ) : (
                      <div className="space-y-3 border-t border-gray-200 pt-3">
                        <div className="text-xs font-semibold text-gray-900">Mahntexte</div>
                        {([1, 2, 3] as const).map(stage => (
                          <label key={stage} className="block text-xs font-medium text-gray-600">{stage}. Mahnung<textarea disabled={formData.textMode === 'global'} value={formData.reminderTexts[`stage${stage}`] || ''} onChange={event => setFormData(previous => ({ ...previous, reminderTexts: { ...previous.reminderTexts, [`stage${stage}`]: event.target.value } }))} rows={3} className="form-input mt-1 min-h-[5.5rem] resize-y text-sm font-normal" /></label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>}
              </section>
            )}
          </div>
        </aside>

        <main className="template-editor-main relative flex min-h-[480px] min-w-0 flex-1 flex-col overflow-hidden lg:min-h-0">
          <div className="flex items-center justify-between px-5 py-4 lg:pl-14">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-gray-500">Designvorschau</div>
              <h3 className="mt-1 text-lg font-semibold text-gray-900">{formData.name || 'Neue Vorlage'}</h3>
            </div>
            <div className="template-editor-preview-label rounded-full px-3 py-1 text-xs text-gray-500">Beispieldaten</div>
          </div>
          <div className="flex flex-1 items-start justify-center overflow-auto px-4 pb-8 pt-2 sm:px-8">
            <TemplatePdfPreview template={previewTemplate} company={company} large />
          </div>
        </main>
        </div>
        <div className="template-editor-footer flex shrink-0 flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0 space-y-1">
            <p className="text-xs text-gray-500" role="status">{isSaving ? 'Vorlage wird gespeichert …' : isDirty ? 'Ungespeicherte Änderungen' : 'Keine ungespeicherten Änderungen'}</p>
            {error && <div id={errorId} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</div>}
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:ml-auto sm:w-auto">
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Abbrechen</button>
              <button type="button" onClick={onReset} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Änderungen zurücksetzen</button>
            </div>
            <button type="submit" disabled={isSaving} className="rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white shadow-sm hover:brightness-90 disabled:opacity-50">{isSaving ? 'Speichert...' : 'Vorlage speichern'}</button>
          </div>
        </div>
        </fieldset>
      </form>
    </div>
  );
}

interface TextTemplateFormState {
  subject: string;
  introText: string;
  closingText: string;
  paymentTerms: string;
  reminderTexts: ReminderTemplateTexts;
}

const emptyTextForm: TextTemplateFormState = {
  subject: '',
  introText: '',
  closingText: '',
  paymentTerms: '',
  reminderTexts: {},
};

function textTemplateToForm(template: DocumentTextTemplate): TextTemplateFormState {
  return {
    subject: template.subject || '',
    introText: template.introText || '',
    closingText: template.closingText || '',
    paymentTerms: template.paymentTerms || '',
    reminderTexts: { ...template.reminderTexts },
  };
}

interface TextTemplateEditorOverlayProps {
  documentType: DocumentTemplateType;
  formData: TextTemplateFormState;
  setFormData: Dispatch<SetStateAction<TextTemplateFormState>>;
  terminologyProfile?: TerminologyProfile;
  isSaving: boolean;
  isDirty: boolean;
  error: string | null;
  onClose: () => void;
  onReset: () => void;
  onSave: (event: FormEvent) => Promise<void>;
}

function TextTemplateEditorOverlay({
  documentType,
  formData,
  setFormData,
  terminologyProfile,
  isSaving,
  isDirty,
  error,
  onClose,
  onReset,
  onSave,
}: TextTemplateEditorOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const label = getTemplateTypeLabel(documentType, terminologyProfile);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('[data-text-editor-initial-focus]')?.focus();
  }, []);

  useEffect(() => {
    if (isSaving) dialogRef.current?.focus();
  }, [isSaving]);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !isSaving) {
      event.preventDefault();
      onClose();
    }
  };

  const setValue = <K extends keyof TextTemplateFormState>(key: K, value: TextTemplateFormState[K]) => {
    setFormData(previous => ({ ...previous, [key]: value }));
  };

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleDialogKeyDown} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }} className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 p-2 sm:p-4">
      <form noValidate onSubmit={onSave} aria-busy={isSaving} className="template-editor-shell form-consistent-fields flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl shadow-2xl">
        <div className="template-editor-header flex shrink-0 items-start gap-3 border-b px-4 py-4 sm:px-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-custom/10 text-primary-custom"><FileText className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold text-gray-900">{label} – Standardtexte</h2>
            <p className="mt-1 text-sm text-gray-500">Diese Texte gelten für alle {label.toLowerCase()}. Einzelne PDF-Vorlagen können davon abweichen.</p>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving} className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50" aria-label="Texteditor schließen"><X className="h-5 w-5" /></button>
        </div>

        <fieldset disabled={isSaving} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <section className="template-editor-section rounded-xl border p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Texte bearbeiten</h3>
                <p className="mt-1 text-xs text-gray-500">Platzhalter wie {'{invoiceNumber}'} bleiben beim Erstellen automatisch erhalten.</p>
              </div>
              <span className="rounded-full bg-primary-custom/10 px-2.5 py-1 text-xs font-medium text-primary-custom">Eine Vorlage</span>
            </div>
            <div className="space-y-4">
              <label className="block text-sm font-medium text-gray-700">Betreff<input data-text-editor-initial-focus value={formData.subject} onChange={event => setValue('subject', event.target.value)} className="form-input form-input-compact mt-1" /></label>
              {documentType !== 'reminder' ? (
                <>
                  <label className="block text-sm font-medium text-gray-700">Einleitung<textarea value={formData.introText} onChange={event => setValue('introText', event.target.value)} rows={4} className="form-input mt-1 min-h-[7rem] resize-y" /></label>
                  <label className="block text-sm font-medium text-gray-700">Abschlusstext<textarea value={formData.closingText} onChange={event => setValue('closingText', event.target.value)} rows={4} className="form-input mt-1 min-h-[7rem] resize-y" /></label>
                  <label className="block text-sm font-medium text-gray-700">Zahlungs-/Gültigkeitshinweis<textarea value={formData.paymentTerms} onChange={event => setValue('paymentTerms', event.target.value)} rows={4} className="form-input mt-1 min-h-[7rem] resize-y" /></label>
                </>
              ) : (
                <div className="space-y-4 border-t border-gray-200 pt-4">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900">Texte der Mahnstufen</h4>
                    <p className="mt-1 text-xs text-gray-500">Diese drei Texte werden automatisch für die jeweilige Mahnstufe verwendet.</p>
                  </div>
                  {([1, 2, 3] as const).map(stage => (
                    <label key={stage} className="block text-sm font-medium text-gray-700">{stage}. Mahnung<textarea value={formData.reminderTexts[`stage${stage}`] || ''} onChange={event => setFormData(previous => ({ ...previous, reminderTexts: { ...previous.reminderTexts, [`stage${stage}`]: event.target.value } }))} rows={4} className="form-input mt-1 min-h-[7rem] resize-y" /></label>
                  ))}
                </div>
              )}
            </div>
          </section>
        </fieldset>

        <div className="template-editor-footer flex shrink-0 flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0 space-y-1">
            <p className="text-xs text-gray-500" role="status">{isSaving ? 'Textvorlage wird gespeichert …' : isDirty ? 'Ungespeicherte Änderungen' : 'Keine ungespeicherten Änderungen'}</p>
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</div>}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Abbrechen</button>
            <button type="button" onClick={onReset} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Zurücksetzen</button>
            <button type="submit" disabled={isSaving} className="rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white shadow-sm hover:brightness-90 disabled:opacity-50">{isSaving ? 'Speichert...' : 'Textvorlage speichern'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

interface TextTemplateTableProps {
  templates: DocumentTextTemplate[];
  terminologyProfile?: TerminologyProfile;
  onEdit: (template: DocumentTextTemplate, trigger: HTMLButtonElement) => void;
}

function TextTemplateTable({ templates, terminologyProfile, onEdit }: TextTemplateTableProps) {
  return (
    <div className="template-text-table-wrap overflow-x-auto rounded-xl border">
      <table className="template-text-table w-full min-w-[680px] text-left text-sm">
        <thead>
          <tr className="border-b text-xs uppercase tracking-wide text-gray-500">
            <th scope="col" className="px-4 py-3 font-medium">Dokumentart</th>
            <th scope="col" className="px-4 py-3 font-medium">Verwendung</th>
            <th scope="col" className="px-4 py-3 font-medium">Inhalt</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Aktion</th>
          </tr>
        </thead>
        <tbody>
          {templates.map(template => {
            const label = getTemplateTypeLabel(template.documentType, terminologyProfile);
            const content = template.documentType === 'reminder'
              ? '3 Mahnstufen'
              : [template.subject, template.introText, template.closingText, template.paymentTerms].filter(value => value?.trim()).length + ' Textfelder';
            return (
              <tr key={template.id} className="border-b last:border-b-0">
                <th scope="row" className="px-4 py-4 font-semibold text-gray-900">
                  <div>{label}</div>
                  <div className="mt-1 text-xs font-normal text-gray-500">{template.name}</div>
                </th>
                <td className="px-4 py-4 text-gray-600">Eine Vorlage für alle {label.toLowerCase()}</td>
                <td className="max-w-[360px] truncate px-4 py-4 text-gray-600" title={template.subject || undefined}>{content}</td>
                <td className="px-4 py-4 text-right">
                  <button type="button" onClick={event => onEdit(template, event.currentTarget)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-primary-custom hover:text-primary-custom"><Edit2 className="h-4 w-4" /> Bearbeiten</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TemplatesManagement() {
  const { confirm } = useFeedback();
  const {
    company,
    updateCompany,
    documentTemplates,
    addDocumentTemplate,
    updateDocumentTemplate,
    deleteDocumentTemplate,
  } = useCompany();
  const terminology = getTerminology(company?.terminologyProfile);
  const tabs = getTemplateTabs(company?.terminologyProfile);
  const [activeTab, setActiveTab] = useState<TemplateTab>('invoice');
  const [editingTemplate, setEditingTemplate] = useState<DocumentTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editorDocumentType, setEditorDocumentType] = useState<DocumentTemplateType | null>(null);
  const [formData, setFormData] = useState<TemplateFormState>(emptyForm);
  const [editorInitialFormData, setEditorInitialFormData] = useState<TemplateFormState>(emptyForm);
  const [editingTextTemplate, setEditingTextTemplate] = useState<DocumentTextTemplate | null>(null);
  const [textFormData, setTextFormData] = useState<TextTemplateFormState>(emptyTextForm);
  const [textEditorInitialFormData, setTextEditorInitialFormData] = useState<TextTemplateFormState>(emptyTextForm);
  const [selectedPreview, setSelectedPreview] = useState<DocumentTemplate | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const previewTitleId = useId();
  const previewDialogRef = useRef<HTMLDivElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const textEditorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const saveInFlightRef = useRef(false);
  const isEditorDirty = Boolean(editingTemplate || isCreating) && JSON.stringify(formData) !== JSON.stringify(editorInitialFormData);
  const isTextEditorDirty = Boolean(editingTextTemplate) && JSON.stringify(textFormData) !== JSON.stringify(textEditorInitialFormData);
  const isAnyEditorDirty = isEditorDirty || isTextEditorDirty;

  useEffect(() => {
    if (!isAnyEditorDirty && !isSaving) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isAnyEditorDirty, isSaving]);

  const sourceTemplates = useMemo(
    () => documentTemplates.length > 0 ? documentTemplates : defaultDocumentTemplates,
    [documentTemplates],
  );
  const templates = useMemo(() => activeTab === 'text'
    ? []
    : sourceTemplates.filter(template => template.documentType === activeTab), [activeTab, sourceTemplates]);
  const textTemplates = useMemo(
    () => documentTextTemplateTypes.map(type => resolveDocumentTextTemplate(company, type)),
    [company],
  );

  useEffect(() => {
    if (!editingTemplate) {
      if (!isCreating) {
        setFormData(emptyForm);
        setEditorInitialFormData(emptyForm);
      }
      return;
    }
    const nextFormData = templateToForm(editingTemplate, company);
    setFormData(nextFormData);
    setEditorInitialFormData(nextFormData);
  }, [company, editingTemplate, isCreating]);

  useEffect(() => {
    if (!selectedPreview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedPreview(null);
    };
    window.addEventListener('keydown', onKeyDown);
    previewDialogRef.current?.querySelector<HTMLElement>('[data-preview-close]')?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedPreview]);

  const closePreview = () => {
    setSelectedPreview(null);
    setPreviewExpanded(false);
  };

  const openCreate = (documentType: DocumentTemplateType) => {
    setEditingTextTemplate(null);
    setEditingTemplate(null);
    const nextFormData = getEmptyForm(documentType, company);
    setFormData(nextFormData);
    setEditorInitialFormData(nextFormData);
    setEditorDocumentType(documentType);
    setIsCreating(true);
    setError(null);
  };

  const openEdit = (template: DocumentTemplate) => {
    setEditingTextTemplate(null);
    const nextFormData = templateToForm(template, company);
    setIsCreating(false);
    setEditingTemplate(template);
    setEditorDocumentType(template.documentType);
    setFormData(nextFormData);
    setEditorInitialFormData(nextFormData);
    setError(null);
  };

  const openEditText = (template: DocumentTextTemplate) => {
    const nextFormData = textTemplateToForm(template);
    setEditingTemplate(null);
    setIsCreating(false);
    setEditorDocumentType(null);
    setEditingTextTemplate(template);
    setTextFormData(nextFormData);
    setTextEditorInitialFormData(nextFormData);
    setError(null);
  };

  const confirmEditorAction: typeof confirm = async options => {
    const previousFocus = document.activeElement;
    const confirmed = await confirm(options);
    window.requestAnimationFrame(() => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    });
    return confirmed;
  };

  const closeEditor = async (skipConfirmation = false) => {
    if (saveInFlightRef.current && !skipConfirmation) return;
    if (!skipConfirmation && isEditorDirty) {
      const confirmed = await confirmEditorAction({
        title: 'Ungespeicherte Änderungen',
        message: 'Ungespeicherte Änderungen wirklich verwerfen?',
        confirmText: 'Verwerfen',
        isDestructive: true,
      });
      if (!confirmed) return;
    }
    const trigger = editorTriggerRef.current;
    setEditingTemplate(null);
    setIsCreating(false);
    setEditorDocumentType(null);
    setFormData(emptyForm);
    setEditorInitialFormData(emptyForm);
    setError(null);
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  };

  const closeTextEditor = async (skipConfirmation = false) => {
    if (saveInFlightRef.current && !skipConfirmation) return;
    if (!skipConfirmation && isTextEditorDirty) {
      const confirmed = await confirmEditorAction({
        title: 'Ungespeicherte Änderungen',
        message: 'Ungespeicherte Änderungen wirklich verwerfen?',
        confirmText: 'Verwerfen',
        isDestructive: true,
      });
      if (!confirmed) return;
    }
    const trigger = textEditorTriggerRef.current;
    setEditingTextTemplate(null);
    setTextFormData(emptyTextForm);
    setTextEditorInitialFormData(emptyTextForm);
    setError(null);
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  };

  const resetEditorChanges = async () => {
    if (saveInFlightRef.current) return;
    if (isEditorDirty) {
      const confirmed = await confirmEditorAction({
        title: 'Änderungen zurücksetzen',
        message: 'Alle ungespeicherten Änderungen wirklich zurücksetzen?',
        confirmText: 'Zurücksetzen',
        isDestructive: true,
      });
      if (!confirmed) return;
    }
    setFormData(editorInitialFormData);
    setError(null);
  };

  const resetTextEditorChanges = async () => {
    if (saveInFlightRef.current) return;
    if (isTextEditorDirty) {
      const confirmed = await confirmEditorAction({
        title: 'Änderungen zurücksetzen',
        message: 'Alle ungespeicherten Änderungen wirklich zurücksetzen?',
        confirmText: 'Zurücksetzen',
        isDestructive: true,
      });
      if (!confirmed) return;
    }
    setTextFormData(textEditorInitialFormData);
    setError(null);
  };

  const handleTemplateTabChange = async (tab: TemplateTab) => {
    if (tab === activeTab || saveInFlightRef.current) return;
    if (isAnyEditorDirty) {
      const confirmed = await confirmEditorAction({
        title: 'Ungespeicherte Änderungen',
        message: 'Ungespeicherte Änderungen wirklich verwerfen?',
        confirmText: 'Verwerfen',
        isDestructive: true,
      });
      if (!confirmed) return;
    }
    setActiveTab(tab);
    if (editingTemplate || isCreating) await closeEditor(true);
    if (editingTextTemplate) await closeTextEditor(true);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (saveInFlightRef.current) return;
    if (!formData.name.trim()) {
      setError('Bitte vergeben Sie einen Namen für die Vorlage.');
      event.currentTarget.querySelector<HTMLInputElement>('input[name="templateName"]')?.focus();
      return;
    }

    const documentType = editorDocumentType || 'invoice';
    const documentTypeTemplates = documentTemplates.filter(template => template.documentType === documentType);
    const usesCustomText = formData.textMode === 'custom';
    const templateData: Omit<DocumentTemplate, 'id' | 'createdAt' | 'updatedAt'> = {
      documentType,
      name: formData.name.trim(),
      description: formData.description.trim(),
      textMode: formData.textMode,
      subject: usesCustomText ? formData.subject.trim() : undefined,
      introText: usesCustomText ? formData.introText.trim() : undefined,
      closingText: usesCustomText ? formData.closingText.trim() : undefined,
      paymentTerms: usesCustomText ? formData.paymentTerms.trim() : undefined,
      reminderTexts: usesCustomText && documentType === 'reminder'
        ? Object.fromEntries(Object.entries(formData.reminderTexts).map(([key, value]) => [key, value?.trim()]))
        : undefined,
      layout: formData.layout,
      accentColor: formData.accentColor,
      logoMode: formData.logoMode,
      headerAlignment: formData.headerAlignment,
      tableStyle: formData.tableStyle,
      showPaymentInformation: formData.showPaymentInformation,
      showFooter: formData.showFooter,
      isDefault: editingTemplate ? editingTemplate.isDefault : documentTypeTemplates.length === 0,
    };

    try {
      saveInFlightRef.current = true;
      setIsSaving(true);
      setError(null);
      if (editingTemplate) {
        await updateDocumentTemplate(editingTemplate.id, templateData);
      } else {
        await addDocumentTemplate(templateData);
      }
      await closeEditor(true);
    } catch {
      setError('Die Vorlage konnte nicht gespeichert werden.');
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  };

  const handleSaveText = async (event: FormEvent) => {
    event.preventDefault();
    if (saveInFlightRef.current || !editingTextTemplate) return;

    const now = new Date();
    const updatedTextTemplates = documentTextTemplateTypes.map(type => {
      const existing = company.documentTextTemplates?.find(template => template.documentType === type);
      const resolved = resolveDocumentTextTemplate(company, type);
      if (type !== editingTextTemplate.documentType) {
        return existing || resolved;
      }

      return {
        ...(existing || resolved),
        id: existing?.id || resolved.id,
        documentType: type,
        name: existing?.name || resolved.name,
        subject: textFormData.subject.trim(),
        introText: textFormData.introText.trim(),
        closingText: textFormData.closingText.trim(),
        paymentTerms: textFormData.paymentTerms.trim(),
        reminderTexts: { ...textFormData.reminderTexts },
        updatedAt: now,
      };
    });

    try {
      saveInFlightRef.current = true;
      setIsSaving(true);
      setError(null);
      await updateCompany({ documentTextTemplates: updatedTextTemplates });
      await closeTextEditor(true);
    } catch {
      setError('Die Textvorlage konnte nicht gespeichert werden.');
    } finally {
      saveInFlightRef.current = false;
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
    const confirmed = await confirm({
      title: 'Vorlage löschen',
      message: `Vorlage „${template.name}“ wirklich löschen?`,
      confirmText: 'Löschen',
      isDestructive: true,
    });
    if (!confirmed) return;
    try {
      await deleteDocumentTemplate(template.id);
    } catch {
      setError('Die Vorlage konnte nicht gelöscht werden.');
    }
  };

  const handleRestoreDefaults = async () => {
    const confirmed = await confirm({
      title: 'Standardvorlagen wiederherstellen',
      message: 'Die mitgelieferten PDF- und Textvorlagen werden auf ihre Ausgangswerte zurückgesetzt; gelöschte Standardvorlagen kommen zurück. Eigene Vorlagen und die Wahl der Standardvorlage bleiben erhalten.',
      confirmText: 'Standards wiederherstellen',
      isDestructive: true,
    });
    if (!confirmed) return;
    try {
      await updateCompany({
        documentTemplates: restoreDefaultTemplates(company.documentTemplates || [], defaultDocumentTemplates, true),
        documentTextTemplates: restoreDefaultTemplates(company.documentTextTemplates || [], defaultDocumentTextTemplates, false),
      });
      setError(null);
    } catch {
      setError('Die Standardvorlagen konnten nicht wiederhergestellt werden.');
    }
  };

  return (
    <div className="page-root space-y-8">
      <PageHeader
        icon={Copy}
        title="Vorlagen"
        subtitle="PDF-Layouts und Textbausteine zentral verwalten"
      >
        <ActionMenu
          variant="primary"
          ariaLabel="PDF-Vorlage hinzufügen"
          title="PDF-Vorlage hinzufügen"
          triggerClassName="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-white sm:px-4"
          icon={<><Plus className="h-4 w-4" /><span className="hidden sm:inline">PDF-Vorlage hinzufügen</span></>}
        >
          <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">PDF-Vorlage für</div>
          <ActionMenuItem icon={<FileText className="h-4 w-4" />} onClick={() => openCreate('invoice')}>Rechnung</ActionMenuItem>
          <ActionMenuItem icon={<FileCheck className="h-4 w-4" />} onClick={() => openCreate('quote')}>Angebot</ActionMenuItem>
          <ActionMenuItem icon={<FileCheck className="h-4 w-4" />} onClick={() => openCreate('orderConfirmation')}>{terminology.work.confirmationLabel}</ActionMenuItem>
          <ActionMenuItem icon={<FileText className="h-4 w-4" />} onClick={() => openCreate('reminder')}>Mahnung</ActionMenuItem>
          <div className="my-1 border-t border-gray-200" role="separator" />
          <ActionMenuItem icon={<RotateCcw className="h-4 w-4" />} onClick={() => { void handleRestoreDefaults(); }}>Standardvorlagen wiederherstellen</ActionMenuItem>
        </ActionMenu>
      </PageHeader>

      <div className="theme-tab-group">
        <ThemeTabBar
          className="theme-tab-bar-attached w-full"
          ariaLabel="Vorlagenbereiche"
          activeTab={activeTab}
          onChange={handleTemplateTabChange}
          tabs={tabs}
        />

        <div className="theme-tab-panel space-y-6">
          {error && <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Hinweis ausblenden"><X className="h-4 w-4" /></button></div>}

          {activeTab !== 'text' && <section className="rounded-xl border border-gray-200 bg-white p-4 lg:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">PDF-Header Layout</h2>
                <p className="mt-1 max-w-2xl text-sm text-gray-500">Zweizeilige Darstellung der Firmendaten im PDF-Header. Ermöglicht eine strukturiertere Darstellung im PDF-Kopfbereich.</p>
              </div>
              <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={company.companyHeaderTwoLine || false}
                  onChange={event => { void updateCompany({ companyHeaderTwoLine: event.target.checked }); }}
                  className="sr-only peer"
                />
                <span className="h-6 w-11 rounded-full bg-gray-200 transition peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-custom/20 peer-checked:bg-primary-custom peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-['']" />
              </label>
            </div>
            {company.companyHeaderTwoLine && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="block text-xs font-medium text-gray-600">Erste Zeile
                  <input defaultValue={company.companyHeaderLine1 || ''} onBlur={event => { void updateCompany({ companyHeaderLine1: event.target.value }); }} className="form-input form-input-compact mt-1 text-sm font-normal" placeholder="z. B. Firmenname / Service" />
                </label>
                <label className="block text-xs font-medium text-gray-600">Zweite Zeile
                  <input defaultValue={company.companyHeaderLine2 || ''} onBlur={event => { void updateCompany({ companyHeaderLine2: event.target.value }); }} className="form-input form-input-compact mt-1 text-sm font-normal" placeholder="z. B. Inhaber, Adresse" />
                </label>
              </div>
            )}
          </section>}

          {activeTab === 'text' ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Textvorlagen</h2>
                  <p className="mt-1 text-sm text-gray-500">Betreff, Einleitung, Abschluss und Zahlungshinweise je Dokumentart verwalten.</p>
                </div>
              </div>

              <TextTemplateTable
                templates={textTemplates}
                terminologyProfile={company.terminologyProfile}
                onEdit={(item, trigger) => { textEditorTriggerRef.current = trigger; openEditText(item); }}
              />
              <p className="text-xs text-gray-500">{textTemplates.length} Vorlagen</p>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                {templates.map(template => (
                  <article key={template.id} className={`template-card relative rounded-xl border bg-white shadow-sm ${template.isDefault ? 'border-primary-custom' : 'border-gray-200'}`}>
                    {template.isDefault && <span className="absolute left-1/2 top-0 z-10 inline-flex -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary-custom bg-white px-3 py-1 text-xs font-medium text-primary-custom">Standard</span>}
                    <button type="button" onClick={() => setSelectedPreview(template)} className="template-card-preview-surface group relative block min-h-[520px] w-full overflow-hidden rounded-t-xl p-[2.5%]" aria-label={`${template.name} in großer Vorschau öffnen`}>
                      <div className="mx-auto w-full space-y-2">
                        <TemplateMiniature template={template} company={company} companyName={company.name} logo={company.logo} terminologyProfile={company.terminologyProfile} />
                      </div>
                      <span className="absolute bottom-6 right-6 inline-flex items-center gap-1 rounded-md bg-white/95 px-2 py-1 text-xs font-medium text-gray-700 opacity-0 shadow transition group-hover:opacity-100">
                        <Maximize2 className="h-3 w-3" /> Große Vorschau
                      </span>
                    </button>
                    <div className="p-3">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <div className="w-full min-w-0">
                          <h3 className="truncate text-center font-semibold text-gray-900">{template.name}</h3>
                        </div>
                        <div className="template-card-actions flex shrink-0 items-center gap-1">
                          <button type="button" onClick={event => { editorTriggerRef.current = event.currentTarget; openEdit(template); }} className="inline-flex h-8 w-8 min-h-0 min-w-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-primary-custom" aria-label={`${template.name} bearbeiten`}>
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => handleDelete(template)} className="inline-flex h-8 w-8 min-h-0 min-w-0 items-center justify-center rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600" aria-label={`${template.name} löschen`}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        <button type="button" onClick={() => handleSetDefault(template)} disabled={template.isDefault} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-primary-custom bg-white px-3 py-1.5 text-xs font-medium text-primary-custom transition-colors hover:bg-primary-light-custom disabled:cursor-default disabled:opacity-100" aria-label={template.isDefault ? `${template.name} ist Standard` : `${template.name} als Standard festlegen`}>
                          {template.isDefault ? <><Check className="h-4 w-4" />Standard</> : 'Als Standard'}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              {templates.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                  Noch keine Vorlagen vorhanden. Legen Sie über „Vorlage hinzufügen“ die erste Layoutvorlage an.
                </div>
              )}

            </>
          )}
        </div>
      </div>

      {(isCreating || editingTemplate) && editorDocumentType && (
        <TemplateEditorOverlay
          activeTab={editorDocumentType}
          editingTemplate={editingTemplate}
          formData={formData}
          setFormData={setFormData}
          company={company}
          logo={company.logo}
          terminologyProfile={company.terminologyProfile}
          isSaving={isSaving}
          isDirty={isEditorDirty}
          error={error}
          onClose={() => { void closeEditor(); }}
          onReset={() => { void resetEditorChanges(); }}
          onSave={handleSave}
        />
      )}

      {editingTextTemplate && (
        <TextTemplateEditorOverlay
          documentType={editingTextTemplate.documentType}
          formData={textFormData}
          setFormData={setTextFormData}
          terminologyProfile={company.terminologyProfile}
          isSaving={isSaving}
          isDirty={isTextEditorDirty}
          error={error}
          onClose={() => { void closeTextEditor(); }}
          onReset={() => { void resetTextEditorChanges(); }}
          onSave={handleSaveText}
        />
      )}

      {selectedPreview && (
        <div
          className={`dialog-overlay fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-gray-950/60 ${previewExpanded ? '' : 'sm:p-4'}`}
          onMouseDown={event => { if (event.target === event.currentTarget) closePreview(); }}
        >
          <div
            ref={previewDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={previewTitleId}
            className={`min-h-0 w-full overflow-hidden bg-white shadow-2xl ${previewExpanded
              ? 'h-[100dvh] max-w-none rounded-none'
              : 'h-[100dvh] max-w-4xl rounded-none sm:h-[calc(100dvh-2rem)] sm:rounded-2xl'}`}
            onMouseDown={event => event.stopPropagation()}
          >
            <TemplatePdfPreview
              template={selectedPreview}
              company={company}
              dialog={{
                titleId: previewTitleId,
                expanded: previewExpanded,
                onToggleExpanded: () => setPreviewExpanded(value => !value),
                onClose: closePreview,
                onEdit: () => {
                  closePreview();
                  openEdit(selectedPreview);
                },
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
