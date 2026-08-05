import {
  Company,
  DocumentHeaderAlignment,
  DocumentLayout,
  DocumentLogoMode,
  DocumentTableStyle,
  DocumentTemplate,
  DocumentTemplateType,
  ReminderStage,
} from '../types';

export interface ResolvedDocumentTemplate extends DocumentTemplate {
  layout: DocumentLayout;
  accentColor: string;
  logoMode: DocumentLogoMode;
  headerAlignment: DocumentHeaderAlignment;
  tableStyle: DocumentTableStyle;
  showPaymentInformation: boolean;
  showFooter: boolean;
}

const fallbackProfiles: Record<DocumentTemplateType, Omit<ResolvedDocumentTemplate, 'id' | 'documentType' | 'name'>> = {
  invoice: {
    description: 'Professionelles Rechnungs-Layout',
    layout: 'classic',
    accentColor: '#2563eb',
    logoMode: 'company',
    headerAlignment: 'split',
    tableStyle: 'light',
    showPaymentInformation: true,
    showFooter: true,
  },
  quote: {
    description: 'Professionelles Angebots-Layout',
    layout: 'minimal',
    accentColor: '#111827',
    logoMode: 'company',
    headerAlignment: 'split',
    tableStyle: 'dark',
    showPaymentInformation: true,
    showFooter: true,
  },
  reminder: {
    description: 'PDF-Layout für Mahnungen; Mahntexte werden in den App-Einstellungen gepflegt.',
    layout: 'editorial',
    accentColor: '#b0894f',
    logoMode: 'company',
    headerAlignment: 'center',
    tableStyle: 'accent',
    showPaymentInformation: true,
    showFooter: true,
  },
  orderConfirmation: {
    description: 'Layout für Bestätigungen',
    layout: 'classic',
    accentColor: '#2563eb',
    logoMode: 'company',
    headerAlignment: 'split',
    tableStyle: 'light',
    showPaymentInformation: true,
    showFooter: true,
  },
};

function isHexColor(value: string | undefined): value is string {
  return Boolean(value && /^#[0-9a-f]{6}$/i.test(value));
}

export function resolveDocumentTemplate(
  company: Company,
  documentType: DocumentTemplateType,
): ResolvedDocumentTemplate {
  const fallback = fallbackProfiles[documentType];
  const candidates = (company.documentTemplates || []).filter(template => template.documentType === documentType);
  const selected = candidates.find(template => template.isDefault) || candidates[0];
  const selectedFields: Partial<DocumentTemplate> = selected ? { ...selected } : {};
  delete selectedFields.id;
  delete selectedFields.documentType;
  delete selectedFields.name;

  return {
    id: selected?.id || `${documentType}-default`,
    documentType,
    name: selected?.name || 'Standardlayout',
    ...fallback,
    ...selectedFields,
    layout: selected?.layout || fallback.layout,
    accentColor: isHexColor(selected?.accentColor) ? selected.accentColor : fallback.accentColor,
    logoMode: selected?.logoMode || fallback.logoMode,
    headerAlignment: selected?.headerAlignment || fallback.headerAlignment,
    tableStyle: selected?.tableStyle || fallback.tableStyle,
    showPaymentInformation: selected?.showPaymentInformation ?? fallback.showPaymentInformation,
    showFooter: selected?.showFooter ?? fallback.showFooter,
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

export function getDocumentTemplateFallback(type: DocumentTemplateType): ResolvedDocumentTemplate {
  const fallback = fallbackProfiles[type];
  return {
    id: `${type}-default`,
    documentType: type,
    name: 'Standardlayout',
    ...fallback,
  };
}
