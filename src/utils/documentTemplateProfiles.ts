import {
  Company,
  DocumentDesignId,
  DocumentFontFamily,
  DocumentLayout,
  DocumentLogoMode,
  DocumentTemplate,
  DocumentTemplateType,
  ReminderStage,
} from '../types';
import { getDocumentTemplateTextMode, resolveDocumentTextTemplate } from './documentTextTemplates';

/**
 * Gemeinsames Erscheinungsbild aller PDF-Dokumente. Rechnungen, Angebote,
 * Bestätigungen und Mahnungen teilen sich ein Design; nur die Texte bleiben je
 * Dokumentart getrennt.
 */
export interface DocumentDesign {
  layout: DocumentDesignId;
  accentColor: string;
  fontFamily: DocumentFontFamily;
  logoMode: DocumentLogoMode;
  showPaymentInformation: boolean;
  showFooter: boolean;
}

export interface ResolvedDocumentTemplate extends Omit<DocumentTemplate, keyof DocumentDesign>, DocumentDesign {}

export const documentDesignIds: DocumentDesignId[] = ['classic', 'modern', 'minimal', 'elegant', 'bold'];

/** Schrift, die ein Design mitbringt, solange keine andere gewählt wurde. */
export const designDefaultFonts: Record<DocumentDesignId, DocumentFontFamily> = {
  classic: 'helvetica',
  modern: 'helvetica',
  minimal: 'helvetica',
  elegant: 'times',
  bold: 'helvetica',
};

export const defaultDocumentDesign: DocumentDesign = {
  layout: 'classic',
  accentColor: '#2563eb',
  fontFamily: 'helvetica',
  logoMode: 'company',
  showPaymentInformation: true,
  showFooter: true,
};

const legacyLayoutMap: Record<DocumentLayout, DocumentDesignId> = {
  classic: 'classic',
  modern: 'modern',
  minimal: 'minimal',
  elegant: 'elegant',
  bold: 'bold',
  editorial: 'elegant',
  compact: 'minimal',
  air: 'minimal',
  split: 'modern',
  frame: 'classic',
};

const fontFamilies: DocumentFontFamily[] = ['helvetica', 'times', 'courier'];

function isHexColor(value: string | undefined): value is string {
  return Boolean(value && /^#[0-9a-f]{6}$/i.test(value));
}

export function normalizeDocumentLayout(layout: DocumentLayout | undefined): DocumentDesignId {
  return (layout && legacyLayoutMap[layout]) || defaultDocumentDesign.layout;
}

function selectTemplate(templates: DocumentTemplate[], documentType: DocumentTemplateType): DocumentTemplate | undefined {
  const candidates = templates.filter(template => template.documentType === documentType);
  return candidates.find(template => template.isDefault) || candidates[0];
}

/** Liest das Design einer Vorlage und ergänzt fehlende oder ungültige Werte. */
export function documentDesignFromTemplate(template: Partial<DocumentTemplate> | undefined): DocumentDesign {
  const layout = normalizeDocumentLayout(template?.layout);
  return {
    layout,
    accentColor: isHexColor(template?.accentColor) ? template.accentColor : defaultDocumentDesign.accentColor,
    fontFamily: template?.fontFamily && fontFamilies.includes(template.fontFamily)
      ? template.fontFamily
      : designDefaultFonts[layout],
    logoMode: template?.logoMode === 'none' ? 'none' : 'company',
    showPaymentInformation: template?.showPaymentInformation ?? true,
    showFooter: template?.showFooter ?? true,
  };
}

/**
 * Das gemeinsame Design steht an der Standardvorlage für Rechnungen. Ältere
 * Daten mit abweichenden Layouts je Dokumentart erscheinen damit einheitlich.
 */
export function getDocumentDesign(company: Pick<Company, 'documentTemplates'>): DocumentDesign {
  return documentDesignFromTemplate(selectTemplate(company.documentTemplates || [], 'invoice'));
}

/**
 * Schreibt das Design in die Standardvorlage jeder Dokumentart. Fehlt für eine
 * Dokumentart eine Vorlage, wird die mitgelieferte Standardvorlage ergänzt.
 * Texte und weitere Vorlagen bleiben unverändert.
 */
export function applyDocumentDesign(
  templates: DocumentTemplate[],
  defaults: DocumentTemplate[],
  design: DocumentDesign,
): DocumentTemplate[] {
  const now = new Date();
  const designFields: Partial<DocumentTemplate> = {
    layout: design.layout,
    accentColor: design.accentColor,
    fontFamily: design.fontFamily,
    logoMode: design.logoMode,
    showPaymentInformation: design.showPaymentInformation,
    showFooter: design.showFooter,
  };
  const types: DocumentTemplateType[] = ['invoice', 'quote', 'orderConfirmation', 'reminder'];
  const result = templates.map(template => ({ ...template }));

  for (const type of types) {
    const selected = selectTemplate(result, type);
    if (selected) {
      Object.assign(selected, designFields, { isDefault: true, updatedAt: now });
      continue;
    }
    const fallback = defaults.find(template => template.documentType === type && template.isDefault)
      || defaults.find(template => template.documentType === type);
    if (fallback) result.push({ ...fallback, ...designFields, isDefault: true, updatedAt: now });
  }
  return result;
}

export function resolveDocumentTemplate(
  company: Company,
  documentType: DocumentTemplateType,
): ResolvedDocumentTemplate {
  const selected = selectTemplate(company.documentTemplates || [], documentType);
  const textDefaults = resolveDocumentTextTemplate(company, documentType);
  const textMode = selected ? getDocumentTemplateTextMode(company, selected) : 'global';
  const isCustom = textMode === 'custom';

  return {
    ...selected,
    id: selected?.id || `${documentType}-default`,
    documentType,
    name: selected?.name || 'Standardlayout',
    ...getDocumentDesign(company),
    textMode,
    subject: isCustom ? (selected?.subject ?? textDefaults.subject) : textDefaults.subject,
    introText: isCustom ? (selected?.introText ?? textDefaults.introText) : textDefaults.introText,
    closingText: isCustom ? (selected?.closingText ?? textDefaults.closingText) : textDefaults.closingText,
    paymentTerms: isCustom ? (selected?.paymentTerms ?? textDefaults.paymentTerms) : textDefaults.paymentTerms,
    reminderTexts: isCustom
      ? { ...textDefaults.reminderTexts, ...selected?.reminderTexts }
      : textDefaults.reminderTexts,
  };
}

export function getReminderTemplateText(
  template: ResolvedDocumentTemplate,
  stage: ReminderStage,
  fallbackText: string,
): string {
  const stageKey = `stage${stage}` as keyof NonNullable<ResolvedDocumentTemplate['reminderTexts']>;
  return fallbackText.trim() || template.reminderTexts?.[stageKey]?.trim() || template.introText?.trim() || '';
}
