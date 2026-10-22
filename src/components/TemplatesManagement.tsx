import { Dispatch, FormEvent, KeyboardEvent as ReactKeyboardEvent, SetStateAction, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Copy, Edit2, FileText, LayoutTemplate, Loader2, Palette, RotateCcw, SlidersHorizontal, Type, X } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { useCompany } from '../context/CompanyContext';
import { defaultDocumentTemplates } from '../context/CompanyProvider';
import {
  DocumentDesignId,
  DocumentFontFamily,
  DocumentTemplateType,
  DocumentTextTemplate,
  ReminderTemplateTexts,
  TerminologyProfile,
} from '../types';
import {
  applyDocumentDesign,
  defaultDocumentDesign,
  designDefaultFonts,
  getDocumentDesign,
  type DocumentDesign,
} from '../utils/documentTemplateProfiles';
import {
  documentTextTemplateTypes,
  resolveDocumentTextTemplate,
} from '../utils/documentTextTemplates';
import { getTerminology } from '../utils/terminology';
import { ThemeTabBar } from './ThemeTabBar';
import { useFeedback } from '../context/FeedbackContext';
import { TemplateDocumentPreview } from './templates/TemplatePdfPreview';
import { documentTextResetPatch, documentTextSavePatch } from '../utils/documentTemplateWrites';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { choiceCardClass } from './settings/settingsStyles';

type TemplateTab = 'design' | 'text';
type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const templateTabs: Array<{ id: TemplateTab; label: string; icon: typeof FileText }> = [
  { id: 'design', label: 'PDF-Design', icon: LayoutTemplate },
  { id: 'text', label: 'Textvorlagen', icon: Copy },
];

const designOptions: Array<{ id: DocumentDesignId; label: string; description: string }> = [
  { id: 'classic', label: 'Klassisch', description: 'Geschäftsbrief mit Logo rechts und heller Tabelle' },
  { id: 'modern', label: 'Modern', description: 'Farbband, großer Titel und farbige Tabelle' },
  { id: 'minimal', label: 'Minimal', description: 'Feine Linien und viel Weißraum' },
  { id: 'elegant', label: 'Elegant', description: 'Zentrierter Briefkopf und Serifenschrift' },
  { id: 'bold', label: 'Markant', description: 'Farbkante und kräftiger Titel' },
];

const colorPresets = [
  { name: 'Blau', color: '#2563eb' },
  { name: 'Petrol', color: '#0e7490' },
  { name: 'Smaragd', color: '#15803d' },
  { name: 'Violett', color: '#7c3aed' },
  { name: 'Koralle', color: '#ea580c' },
  { name: 'Rot', color: '#dc2626' },
  { name: 'Gold', color: '#b0894f' },
  { name: 'Graphit', color: '#1f2937' },
] as const;

const fontOptions: Array<{ id: DocumentFontFamily; label: string; hint: string; css: string }> = [
  { id: 'helvetica', label: 'Helvetica', hint: 'Serifenlos, sachlich', css: 'Helvetica, Arial, sans-serif' },
  { id: 'times', label: 'Times', hint: 'Mit Serifen, klassisch', css: '"Times New Roman", Times, serif' },
  { id: 'courier', label: 'Courier', hint: 'Schreibmaschine', css: '"Courier New", Courier, monospace' },
];

const DESIGN_SAVE_DELAY_MS = 450;
const TOOLBAR_COLLAPSE_STEPS = 6;
const TOOLBAR_TRIGGER = 'action-menu-export-trigger min-h-10 min-w-10 max-w-full shrink-0';

function getTemplateTypeLabel(type: DocumentTemplateType, terminologyProfile?: TerminologyProfile) {
  const terminology = getTerminology(terminologyProfile);
  switch (type) {
    case 'invoice': return 'Rechnungen';
    case 'quote': return 'Angebote';
    case 'orderConfirmation': return terminology.work.confirmationPluralLabel;
    case 'reminder': return 'Mahnungen';
  }
  return 'Dokumente';
}

function sameDesign(a: DocumentDesign, b: DocumentDesign): boolean {
  return a.layout === b.layout
    && a.accentColor.toLowerCase() === b.accentColor.toLowerCase()
    && a.fontFamily === b.fontFamily
    && a.logoMode === b.logoMode
    && a.showPaymentInformation === b.showPaymentInformation
    && a.showFooter === b.showFooter;
}

/**
 * Kleine Skizze des Briefkopfs je Design. Die Seite bleibt bewusst weiß –
 * sie steht für das Papier, nicht für die App-Oberfläche.
 */
function DesignThumbnail({ design, accent }: { design: DocumentDesignId; accent: string }) {
  const line = 'absolute h-[3px] rounded-full';
  const lineStyle = { backgroundColor: '#d1d5db' };
  return (
    <span aria-hidden="true" className="relative block h-[72px] w-full overflow-hidden rounded-md max-sm:h-[56px]" style={{ backgroundColor: '#ffffff', boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / 0.08)' }}>
      {design === 'classic' && (
        <>
          <span className="absolute right-2 top-2 h-[6px] w-7 rounded-sm" style={{ backgroundColor: accent }} />
          <span className={`${line} left-2 top-[22px] w-10`} style={lineStyle} />
          <span className={`${line} left-2 top-[28px] w-8`} style={lineStyle} />
          <span className={`${line} right-2 top-[22px] w-7`} style={lineStyle} />
          <span className="absolute left-2 top-[38px] h-[4px] w-9 rounded-full" style={{ backgroundColor: '#374151' }} />
          <span className="absolute inset-x-2 top-[48px] h-[6px] rounded-sm" style={{ backgroundColor: '#e5e7eb' }} />
          <span className="absolute inset-x-2 top-[58px] h-px" style={{ backgroundColor: '#e5e7eb' }} />
        </>
      )}
      {design === 'modern' && (
        <>
          <span className="absolute inset-x-0 top-0 h-[4px]" style={{ backgroundColor: accent }} />
          <span className="absolute left-2 top-[10px] h-[5px] w-8 rounded-sm" style={{ backgroundColor: '#374151' }} />
          <span className="absolute right-2 top-[9px] h-[7px] w-10 rounded-sm" style={{ backgroundColor: accent }} />
          <span className={`${line} left-2 top-[26px] w-10`} style={lineStyle} />
          <span className={`${line} right-2 top-[26px] w-7`} style={lineStyle} />
          <span className="absolute inset-x-2 top-[42px] h-[7px] rounded-sm" style={{ backgroundColor: accent }} />
          <span className="absolute inset-x-2 top-[53px] h-[5px] rounded-sm" style={{ backgroundColor: `${accent}1f` }} />
        </>
      )}
      {design === 'minimal' && (
        <>
          <span className="absolute left-2 top-[9px] h-[4px] w-8 rounded-full" style={{ backgroundColor: '#1f2937' }} />
          <span className={`${line} right-2 top-[8px] w-6`} style={lineStyle} />
          <span className={`${line} right-2 top-[13px] w-5`} style={lineStyle} />
          <span className={`${line} left-2 top-[24px] w-10`} style={lineStyle} />
          <span className="absolute left-2 top-[36px] h-[7px] w-14 rounded-sm" style={{ backgroundColor: '#374151' }} />
          <span className="absolute left-2 top-[45px] h-[3px] w-6 rounded-full" style={{ backgroundColor: accent }} />
          <span className="absolute inset-x-2 top-[56px] h-px" style={{ backgroundColor: '#374151' }} />
          <span className="absolute inset-x-2 top-[63px] h-px" style={{ backgroundColor: '#e5e7eb' }} />
        </>
      )}
      {design === 'elegant' && (
        <>
          <span className="absolute left-1/2 top-[7px] h-[6px] w-14 -translate-x-1/2 rounded-sm" style={{ backgroundColor: accent }} />
          <span className="absolute inset-x-2 top-[19px] h-px" style={{ backgroundColor: accent }} />
          <span className="absolute inset-x-2 top-[21px] h-px" style={{ backgroundColor: accent }} />
          <span className={`${line} left-2 top-[29px] w-10`} style={lineStyle} />
          <span className="absolute left-2 top-[40px] h-[4px] w-12 rounded-full" style={{ backgroundColor: accent }} />
          <span className="absolute inset-x-2 top-[52px] h-px" style={{ backgroundColor: accent }} />
          <span className="absolute inset-x-2 top-[60px] h-px" style={{ backgroundColor: accent }} />
        </>
      )}
      {design === 'bold' && (
        <>
          <span className="absolute inset-y-0 left-0 w-[5px]" style={{ backgroundColor: accent }} />
          <span className="absolute left-3 top-[8px] h-[10px] w-14 rounded-sm" style={{ backgroundColor: '#111827' }} />
          <span className="absolute left-3 top-[21px] h-[3px] w-7 rounded-full" style={{ backgroundColor: accent }} />
          <span className="absolute right-2 top-[9px] h-[5px] w-6 rounded-sm" style={{ backgroundColor: '#9ca3af' }} />
          <span className={`${line} left-3 top-[32px] w-9`} style={lineStyle} />
          <span className="absolute left-3 right-2 top-[44px] h-[7px] rounded-sm" style={{ backgroundColor: '#111827' }} />
          <span className="absolute left-3 right-2 top-[57px] h-px" style={{ backgroundColor: '#e5e7eb' }} />
        </>
      )}
    </span>
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
            <p className="mt-1 text-sm text-gray-500">Diese Texte gelten für alle {label}. Platzhalter wie Rechnungsnummer oder Kundenname werden beim Erstellen ersetzt.</p>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving} className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50" aria-label="Texteditor schließen"><X className="h-5 w-5" /></button>
        </div>

        {/* Gescrollt wird ein normales Element: Ein <fieldset> als Scrollbereich
            wird in Chromium nicht zuverlässig begrenzt, sodass untere Felder
            hinter dem Fuß verschwanden. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          <fieldset disabled={isSaving} className="min-w-0">
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
          </fieldset>
        </div>

        <div className="template-editor-footer flex shrink-0 flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0 space-y-1">
            <p className="text-xs text-gray-500" role="status">{isSaving ? 'Textvorlage wird gespeichert …' : isDirty ? 'Ungespeicherte Änderungen' : 'Keine ungespeicherten Änderungen'}</p>
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</div>}
            <button type="button" onClick={onReset} disabled={isSaving} className="self-start rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50">Zurücksetzen</button>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Abbrechen</button>
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
    <div className="template-text-table-wrap overflow-hidden rounded-xl border">
      <table className="template-text-table w-full table-fixed text-left text-sm">
        <thead>
          <tr className="border-b text-xs uppercase tracking-wide text-gray-500">
            <th scope="col" className="w-[38%] px-3 py-3 font-medium sm:w-[30%] sm:px-4">Dokumentart</th>
            <th scope="col" className="px-3 py-3 font-medium sm:px-4">Inhalt</th>
            <th scope="col" className="w-14 px-2 py-3 sm:w-16"><span className="sr-only">Aktion</span></th>
          </tr>
        </thead>
        <tbody>
          {templates.map(template => {
            const label = getTemplateTypeLabel(template.documentType, terminologyProfile);
            const summary = template.documentType === 'reminder'
              ? '3 Mahnstufen'
              : `${[template.subject, template.introText, template.closingText, template.paymentTerms].filter(value => value?.trim()).length} Textfelder`;
            // Platzhalter wie {invoiceNumber} werden erst beim Erstellen ersetzt;
            // in der Übersicht stören sie nur und entfallen deshalb.
            const preview = (template.documentType === 'reminder'
              ? template.reminderTexts?.stage1 || template.subject
              : template.subject || template.introText)?.replace(/\{\w+\}/g, '').replace(/\s{2,}/g, ' ').trim();
            return (
              <tr key={template.id} className="border-b last:border-b-0">
                <th scope="row" lang="de" className="hyphens-auto break-words px-3 py-2.5 align-top font-semibold text-gray-900 sm:px-4">{label}</th>
                <td className="px-3 py-2.5 align-top text-gray-600 sm:px-4">
                  <span className="block truncate text-gray-800" title={preview}>{preview || '–'}</span>
                  <span className="mt-0.5 block text-xs text-gray-500">{summary}</span>
                </td>
                <td className="px-2 py-2.5 text-right align-middle">
                  <button
                    type="button"
                    onClick={event => onEdit(template, event.currentTarget)}
                    className="inline-flex h-10 w-10 min-h-0 min-w-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-primary-custom"
                    aria-label={`Texte für ${label} bearbeiten`}
                    title="Bearbeiten"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
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
  const { company, updateCompany, documentTemplates } = useCompany();
  const terminology = getTerminology(company?.terminologyProfile);
  const [activeTab, setActiveTab] = useState<TemplateTab>('design');
  const [editingTextTemplate, setEditingTextTemplate] = useState<DocumentTextTemplate | null>(null);
  const [textFormData, setTextFormData] = useState<TextTemplateFormState>(emptyTextForm);
  const [textEditorInitialFormData, setTextEditorInitialFormData] = useState<TextTemplateFormState>(emptyTextForm);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textEditorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const saveInFlightRef = useRef(false);
  const isTextEditorDirty = Boolean(editingTextTemplate) && JSON.stringify(textFormData) !== JSON.stringify(textEditorInitialFormData);

  const sourceTemplates = useMemo(
    () => documentTemplates.length > 0 ? documentTemplates : defaultDocumentTemplates,
    [documentTemplates],
  );
  const textTemplates = useMemo(
    () => documentTextTemplateTypes.map(type => resolveDocumentTextTemplate(company, type)),
    [company],
  );

  // ------------------------------------------------------------------ Design
  // Änderungen gelten sofort in der Vorschau und werden kurz danach für alle
  // Dokumentarten gespeichert. Bis dahin hält `draftDesign` den Stand.
  const savedDesign = useMemo(() => getDocumentDesign({ documentTemplates: sourceTemplates }), [sourceTemplates]);
  const [draftDesign, setDraftDesign] = useState<DocumentDesign | null>(null);
  const [designSaveState, setDesignSaveState] = useState<SaveState>('idle');
  const [previewType, setPreviewType] = useState<DocumentTemplateType>('invoice');
  const design = draftDesign ?? savedDesign;
  const latestDraftRef = useRef<DocumentDesign | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const designWriteRef = useRef<Promise<void> | null>(null);
  const customColorInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Wie weit die Leiste verdichtet ist, nach Wichtigkeit: zuerst die Texte
  // „Optionen“, Schrift und Farbe, dann deren Pfeile, zuletzt die Dokumentart.
  const [toolbarCollapse, setToolbarCollapse] = useState(0);
  const toolbarWidthRef = useRef(0);
  const toolbarContentKey = `${activeTab}|${previewType}|${design.accentColor}|${design.fontFamily}|${designSaveState === 'error'}`;
  const toolbarContentKeyRef = useRef(toolbarContentKey);
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    // Andere Beschriftungen: vor dem Zeichnen wieder mit allen Texten messen.
    if (toolbarContentKeyRef.current !== toolbarContentKey) {
      toolbarContentKeyRef.current = toolbarContentKey;
      if (toolbarCollapse > 0) {
        setToolbarCollapse(0);
        return;
      }
    }
    toolbarWidthRef.current = toolbar.clientWidth;
    if (toolbar.scrollWidth > toolbar.clientWidth + 1 && toolbarCollapse < TOOLBAR_COLLAPSE_STEPS) {
      setToolbarCollapse(toolbarCollapse + 1);
      return;
    }
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (toolbar.clientWidth === toolbarWidthRef.current) return;
      toolbarWidthRef.current = toolbar.clientWidth;
      // Breiter: von vorn messen; schmaler: weiter einklappen.
      setToolbarCollapse(previous => (toolbar.scrollWidth > toolbar.clientWidth + 1 ? Math.min(previous + 1, TOOLBAR_COLLAPSE_STEPS) : 0));
    });
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [toolbarCollapse, toolbarContentKey]);

  const flushDesign = useCallback(async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (designWriteRef.current) return designWriteRef.current;
    if (!latestDraftRef.current) return;
    const write = (async () => {
      setDesignSaveState('saving');
      try {
        while (latestDraftRef.current) {
          const next = latestDraftRef.current;
          await updateCompany(current => ({
            documentTemplates: applyDocumentDesign(current.documentTemplates || [], defaultDocumentTemplates, next),
          }));
          if (latestDraftRef.current === next) {
            latestDraftRef.current = null;
            setDraftDesign(null);
          }
        }
        setDesignSaveState('saved');
      } catch {
        setDesignSaveState('error');
      }
    })();
    designWriteRef.current = write;
    try { await write; } finally { designWriteRef.current = null; }
  }, [updateCompany]);

  // Beim Verlassen der Seite noch ausstehende Änderungen sofort speichern.
  useEffect(() => () => { void flushDesign(); }, [flushDesign]);

  const updateDesign = (patch: Partial<DocumentDesign>) => {
    const next = { ...design, ...patch };
    if (sameDesign(next, design)) return;
    latestDraftRef.current = next;
    setDraftDesign(next);
    setDesignSaveState('pending');
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => { void flushDesign(); }, DESIGN_SAVE_DELAY_MS);
  };

  const selectDesign = (layout: DocumentDesignId) => {
    // Eine selbst gewählte Schrift bleibt; sonst bringt das Design seine eigene mit.
    const keepsCustomFont = design.fontFamily !== designDefaultFonts[design.layout];
    updateDesign({ layout, fontFamily: keepsCustomFont ? design.fontFamily : designDefaultFonts[layout] });
  };

  const restoreDefaultDesign = async () => {
    const confirmed = await confirm({
      title: 'Standarddesign wiederherstellen',
      message: 'Design, Farbe, Schrift und Optionen werden für alle Dokumente auf „Klassisch“ in Blau zurückgesetzt. Ihre Texte bleiben unverändert.',
      confirmText: 'Zurücksetzen',
      isDestructive: true,
    });
    if (confirmed) updateDesign(defaultDocumentDesign);
  };

  const pendingDesign = designSaveState === 'pending' || designSaveState === 'saving';
  useEffect(() => {
    if (!pendingDesign && !isTextEditorDirty && !isSaving) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [pendingDesign, isTextEditorDirty, isSaving]);

  const previewCompany = useMemo(
    () => ({ ...company, documentTemplates: applyDocumentDesign(sourceTemplates, defaultDocumentTemplates, design) }),
    [company, sourceTemplates, design],
  );
  const previewTemplate = useMemo(() => {
    const candidates = previewCompany.documentTemplates.filter(template => template.documentType === previewType);
    return candidates.find(template => template.isDefault) || candidates[0];
  }, [previewCompany, previewType]);

  const previewTypes: Array<{ id: DocumentTemplateType; label: string }> = [
    { id: 'invoice', label: 'Rechnung' },
    { id: 'quote', label: 'Angebot' },
    { id: 'orderConfirmation', label: terminology.work.confirmationLabel },
    { id: 'reminder', label: 'Mahnung' },
  ];
  const activePreviewType = previewTypes.find(type => type.id === previewType) || previewTypes[0];
  const activeColor = colorPresets.find(preset => preset.color.toLowerCase() === design.accentColor.toLowerCase());
  const activeFont = fontOptions.find(option => option.id === design.fontFamily) || fontOptions[0];

  const openCustomColorPicker = () => {
    const input = customColorInputRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.click();
    }
  };

  // ------------------------------------------------------------------ Texte

  const openEditText = (template: DocumentTextTemplate) => {
    const nextFormData = textTemplateToForm(template);
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

  const handleSaveText = async (event: FormEvent) => {
    event.preventDefault();
    if (saveInFlightRef.current || !editingTextTemplate) return;

    const now = new Date();
    const editedType = editingTextTemplate.documentType;
    const fields = {
      subject: textFormData.subject.trim(),
      introText: textFormData.introText.trim(),
      closingText: textFormData.closingText.trim(),
      paymentTerms: textFormData.paymentTerms.trim(),
      reminderTexts: { ...textFormData.reminderTexts },
    };

    try {
      saveInFlightRef.current = true;
      setIsSaving(true);
      setError(null);
      await updateCompany(current => documentTextSavePatch(current, defaultDocumentTemplates, editedType, fields, now));
      await closeTextEditor(true);
    } catch {
      setError('Die Textvorlage konnte nicht gespeichert werden.');
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  };

  const handleRestoreTextDefaults = async () => {
    const confirmed = await confirm({
      title: 'Standardtexte wiederherstellen',
      message: 'Betreff, Einleitung, Abschluss, Zahlungshinweise und Mahntexte werden für alle Dokumentarten auf die mitgelieferten Texte zurückgesetzt.',
      confirmText: 'Standardtexte wiederherstellen',
      isDestructive: true,
    });
    if (!confirmed || saveInFlightRef.current) return;
    try {
      saveInFlightRef.current = true;
      setIsSaving(true);
      await updateCompany(current => documentTextResetPatch(current, defaultDocumentTemplates));
      setError(null);
    } catch {
      setError('Die Standardtexte konnten nicht wiederhergestellt werden.');
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  };

  const handleTemplateTabChange = async (tab: TemplateTab) => {
    if (tab === activeTab || saveInFlightRef.current) return;
    if (isTextEditorDirty) {
      const confirmed = await confirmEditorAction({
        title: 'Ungespeicherte Änderungen',
        message: 'Ungespeicherte Änderungen wirklich verwerfen?',
        confirmText: 'Verwerfen',
        isDestructive: true,
      });
      if (!confirmed) return;
    }
    setActiveTab(tab);
    if (editingTextTemplate) await closeTextEditor(true);
  };

  return (
    <div className="page-root space-y-8">
      <PageHeader
        icon={Copy}
        title="Vorlagen"
        subtitle="Ein Design für Rechnungen, Angebote, Bestätigungen und Mahnungen"
      />

      <div className="theme-tab-group">
        <ThemeTabBar
          className="theme-tab-bar-attached w-full"
          ariaLabel="Vorlagenbereiche"
          activeTab={activeTab}
          onChange={handleTemplateTabChange}
          tabs={templateTabs}
        />

        <div className="theme-tab-panel space-y-5">
          {error && <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Hinweis ausblenden"><X className="h-4 w-4" /></button></div>}

          {activeTab === 'design' ? (
            <>
              {/* Bewusst immer eine Zeile (Vorgabe): Auf schmalen Bildschirmen wird gewischt statt umbrochen. */}
              <div role="radiogroup" aria-label="PDF-Design" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5" style={{ scrollbarWidth: 'none' }}>
                {designOptions.map(option => {
                  const selected = design.layout === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      title={option.description}
                      onClick={() => selectDesign(option.id)}
                      className={`${choiceCardClass(selected)} flex min-w-[5.5rem] flex-1 flex-col gap-2 !p-2`}
                    >
                      <DesignThumbnail design={option.id} accent={design.accentColor} />
                      <span className="flex items-center justify-between gap-1 px-0.5">
                        <span className="truncate text-sm font-medium text-gray-900">{option.label}</span>
                        {selected && <Check className="h-4 w-4 shrink-0 text-primary-custom max-sm:hidden" aria-hidden="true" />}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Immer eine Zeile: Passen die Beschriftungen nicht, bleiben nur die Symbole. */}
              <div ref={toolbarRef} className="flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden">
                <ActionMenu
                  ariaLabel={`Dokumentart der Vorschau: ${activePreviewType.label}`}
                  title="Dokumentart der Vorschau"
                  menuClassName="min-w-56"
                  triggerClassName={TOOLBAR_TRIGGER}
                  align="start"
                  icon={(
                    <>
                      <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {toolbarCollapse < 5 && <span className="truncate">{activePreviewType.label}</span>}
                      {toolbarCollapse < 6 && <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    </>
                  )}
                >
                  <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Vorschau als</div>
                  {previewTypes.map(type => (
                    <ActionMenuItem
                      key={type.id}
                      role="menuitemradio"
                      aria-checked={previewType === type.id}
                      trailing={previewType === type.id ? <Check className="h-4 w-4 text-primary-custom" /> : undefined}
                      onClick={() => setPreviewType(type.id)}
                    >
                      {type.label}
                    </ActionMenuItem>
                  ))}
                </ActionMenu>
                <span className="mx-0.5 h-6 w-px shrink-0 bg-gray-200" aria-hidden="true" />
                <ActionMenu
                  ariaLabel={`Farbe: ${activeColor?.name || design.accentColor}`}
                  title="Akzentfarbe"
                  menuClassName="min-w-56"
                  triggerClassName={TOOLBAR_TRIGGER}
                  align="start"
                  icon={(
                    <>
                      <span className="h-4 w-4 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: design.accentColor }} aria-hidden="true" />
                      {toolbarCollapse < 3 && <span className="truncate">{activeColor?.name || 'Eigene Farbe'}</span>}
                      {toolbarCollapse < 4 && <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    </>
                  )}
                >
                  <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Akzentfarbe</div>
                  {colorPresets.map(preset => (
                    <ActionMenuItem
                      key={preset.color}
                      role="menuitemradio"
                      aria-checked={preset.color === activeColor?.color}
                      icon={<span className="block h-4 w-4 rounded-full border border-black/10" style={{ backgroundColor: preset.color }} />}
                      trailing={preset.color === activeColor?.color ? <Check className="h-4 w-4 text-primary-custom" /> : undefined}
                      onClick={() => updateDesign({ accentColor: preset.color })}
                    >
                      {preset.name}
                    </ActionMenuItem>
                  ))}
                  <div className="my-1 border-t border-gray-200" role="separator" />
                  <ActionMenuItem
                    icon={<Palette className="h-4 w-4" />}
                    trailing={!activeColor ? <span className="font-mono text-xs text-gray-500">{design.accentColor}</span> : undefined}
                    onClick={openCustomColorPicker}
                  >
                    Eigene Farbe …
                  </ActionMenuItem>
                </ActionMenu>
                <input
                  ref={customColorInputRef}
                  type="color"
                  value={design.accentColor}
                  onChange={event => updateDesign({ accentColor: event.target.value })}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                />

                <ActionMenu
                  ariaLabel={`Schrift: ${activeFont.label}`}
                  title="Schrift"
                  menuClassName="min-w-60"
                  triggerClassName={TOOLBAR_TRIGGER}
                  align="start"
                  icon={(
                    <>
                      <Type className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {toolbarCollapse < 2 && <span className="truncate" style={{ fontFamily: activeFont.css }}>{activeFont.label}</span>}
                      {toolbarCollapse < 4 && <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    </>
                  )}
                >
                  <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Schrift</div>
                  {fontOptions.map(option => (
                    <ActionMenuItem
                      key={option.id}
                      role="menuitemradio"
                      aria-checked={option.id === design.fontFamily}
                      multiline
                      trailing={option.id === design.fontFamily ? <Check className="h-4 w-4 text-primary-custom" /> : undefined}
                      onClick={() => updateDesign({ fontFamily: option.id })}
                    >
                      <span className="block text-sm text-gray-900" style={{ fontFamily: option.css }}>{option.label}</span>
                      <span className="block text-xs text-gray-600">{option.hint}</span>
                    </ActionMenuItem>
                  ))}
                </ActionMenu>

                <ActionMenu
                  ariaLabel="Weitere Optionen"
                  title="Weitere Optionen"
                  menuClassName="min-w-64"
                  closeOnClick={false}
                  triggerClassName={TOOLBAR_TRIGGER}
                  align="start"
                  icon={(
                    <>
                      <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {toolbarCollapse < 1 && <span>Optionen</span>}
                      {toolbarCollapse < 4 && <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    </>
                  )}
                >
                  <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Im Dokument anzeigen</div>
                  {([
                    { key: 'logo', label: 'Logo', checked: design.logoMode !== 'none', toggle: () => updateDesign({ logoMode: design.logoMode === 'none' ? 'company' : 'none' }) },
                    { key: 'payment', label: 'Zahlungsinformationen', checked: design.showPaymentInformation, toggle: () => updateDesign({ showPaymentInformation: !design.showPaymentInformation }) },
                    { key: 'footer', label: 'Fußzeile mit Firmendaten', checked: design.showFooter, toggle: () => updateDesign({ showFooter: !design.showFooter }) },
                  ]).map(option => (
                    <ActionMenuItem
                      key={option.key}
                      role="menuitemcheckbox"
                      aria-checked={option.checked}
                      icon={(
                        <span className={`flex h-4 w-4 items-center justify-center rounded border ${option.checked ? 'border-primary-custom bg-primary-custom text-white' : 'border-gray-300 bg-white'}`}>
                          {option.checked && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                      )}
                      onClick={option.toggle}
                    >
                      {option.label}
                    </ActionMenuItem>
                  ))}
                  {!company.logo && design.logoMode !== 'none' && (
                    <p className="px-3 pb-2 pt-1 text-xs text-gray-500">Noch kein {terminology.organization.logoLabel} hinterlegt. Ohne Logo steht der Name im Briefkopf.</p>
                  )}
                  <div className="my-1 border-t border-gray-200" role="separator" />
                  <ActionMenuItem icon={<RotateCcw className="h-4 w-4" />} onClick={() => { void restoreDefaultDesign(); }}>
                    Standarddesign wiederherstellen
                  </ActionMenuItem>
                </ActionMenu>

                {/* Gespeichert wird automatisch; sichtbar ist nur ein laufender
                    Speichervorgang oder ein Fehler. */}
                <span className="ml-auto flex min-w-0 shrink-0 items-center" role="status" aria-live="polite">
                  {pendingDesign && (
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" aria-label="Wird gespeichert" />
                  )}
                  {designSaveState === 'error' && (
                    <button type="button" onClick={() => { void flushDesign(); }} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50" title="Speichern fehlgeschlagen – erneut versuchen">
                      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {toolbarCollapse === 0 && <span>Nicht gespeichert – erneut versuchen</span>}
                    </button>
                  )}
                </span>
              </div>

              <div className="template-design-preview flex justify-center rounded-xl p-3 sm:p-6">
                {previewTemplate && <TemplateDocumentPreview template={previewTemplate} company={previewCompany} />}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Textvorlagen</h2>
                  <p className="mt-1 text-sm text-gray-500">Betreff, Einleitung, Abschluss und Zahlungshinweise je Dokumentart. Das PDF-Design gilt für alle gemeinsam.</p>
                </div>
                <button type="button" onClick={() => { void handleRestoreTextDefaults(); }} className={`${TOOLBAR_TRIGGER} shrink-0`}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Standardtexte wiederherstellen
                </button>
              </div>

              <TextTemplateTable
                templates={textTemplates}
                terminologyProfile={company.terminologyProfile}
                onEdit={(item, trigger) => { textEditorTriggerRef.current = trigger; openEditText(item); }}
              />
            </>
          )}
        </div>
      </div>

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
    </div>
  );
}
