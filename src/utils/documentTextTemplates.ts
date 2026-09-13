import type {
  Company,
  DocumentTemplate,
  DocumentTemplateType,
  DocumentTextTemplate,
  ReminderStage,
  ReminderTemplateTexts,
} from '../types';

export const documentTextTemplateTypes: DocumentTemplateType[] = [
  'invoice',
  'quote',
  'orderConfirmation',
  'reminder',
];

const defaultReminderTexts: ReminderTemplateTexts = {
  stage1: 'Vielleicht ist die Zahlung der unten aufgeführten Rechnung im Alltag untergegangen. Wir bitten Sie, den offenen Betrag zu prüfen und bei Gelegenheit zu begleichen.',
  stage2: 'Leider konnten wir trotz unserer Zahlungserinnerung noch keinen Zahlungseingang feststellen. Bitte begleichen Sie den offenen Betrag umgehend.',
  stage3: 'Dies ist unsere letzte Mahnung. Sollte der offene Rechnungsbetrag nicht umgehend eingehen, behalten wir uns weitere Schritte vor.',
};

export const defaultDocumentTextTemplates: DocumentTextTemplate[] = [
  {
    id: 'document-text-invoice',
    documentType: 'invoice',
    name: 'Rechnungstexte',
    subject: 'Rechnung {invoiceNumber}',
    introText: 'Für die von uns erbrachten Leistungen und Lieferungen berechnen wir Ihnen:',
    closingText: 'Vielen Dank für Ihr Vertrauen. Für Rückfragen zu dieser Rechnung sind wir gerne für Sie da.',
    paymentTerms: 'Bitte überweisen Sie den Rechnungsbetrag bis zum Fälligkeitsdatum unter Angabe der Rechnungsnummer.',
  },
  {
    id: 'document-text-quote',
    documentType: 'quote',
    name: 'Angebotstexte',
    subject: 'Ihr Angebot {quoteNumber}',
    introText: 'Vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:',
    closingText: 'Wir freuen uns auf Ihre Rückmeldung.',
    paymentTerms: 'Dieses Angebot ist 30 Tage gültig.',
  },
  {
    id: 'document-text-order-confirmation',
    documentType: 'orderConfirmation',
    name: 'Bestätigungstexte',
    subject: 'Auftragsbestätigung {jobNumber}',
    introText: 'Vielen Dank für Ihren Auftrag. Hiermit bestätigen wir die folgenden Leistungen:',
    closingText: 'Vielen Dank für Ihr Vertrauen.',
    paymentTerms: '',
  },
  {
    id: 'document-text-reminder',
    documentType: 'reminder',
    name: 'Mahntexte',
    subject: 'Mahnung zu Rechnung {invoiceNumber}',
    reminderTexts: defaultReminderTexts,
  },
];

function cloneTextTemplate(template: DocumentTextTemplate): DocumentTextTemplate {
  return {
    ...template,
    reminderTexts: template.reminderTexts ? { ...template.reminderTexts } : undefined,
  };
}

export function getDocumentTextTemplateDefaults(type: DocumentTemplateType): DocumentTextTemplate {
  const template = defaultDocumentTextTemplates.find(item => item.documentType === type) || defaultDocumentTextTemplates[0];
  return cloneTextTemplate(template);
}

function hasText(value?: string): boolean {
  return Boolean(value?.trim());
}

function legacyLayoutTemplate(company: Company, type: DocumentTemplateType): DocumentTemplate | undefined {
  const candidates = (company.documentTemplates || []).filter(template => template.documentType === type);
  return candidates.find(template => template.isDefault) || candidates[0];
}

/**
 * Returns the one shared text record for a document type. Older workspaces
 * only stored texts on PDF layouts or in the reminder settings; those values
 * are used as a migration-safe fallback until the shared record is saved.
 */
export function resolveDocumentTextTemplate(company: Company, type: DocumentTemplateType): DocumentTextTemplate {
  const defaults = getDocumentTextTemplateDefaults(type);
  const saved = company.documentTextTemplates?.find(template => template.documentType === type);
  const legacy = legacyLayoutTemplate(company, type);
  const legacyReminderTexts = type === 'reminder'
    ? {
        ...legacy?.reminderTexts,
        ...(hasText(company.reminderTextStage1) ? { stage1: company.reminderTextStage1 } : {}),
        ...(hasText(company.reminderTextStage2) ? { stage2: company.reminderTextStage2 } : {}),
        ...(hasText(company.reminderTextStage3) ? { stage3: company.reminderTextStage3 } : {}),
      }
    : undefined;

  const reminderTexts = type === 'reminder'
    ? {
        ...defaults.reminderTexts,
        ...legacyReminderTexts,
        ...saved?.reminderTexts,
      }
    : undefined;

  return {
    ...defaults,
    ...saved,
    id: saved?.id || defaults.id,
    name: saved?.name || defaults.name,
    subject: saved?.subject ?? legacy?.subject ?? defaults.subject,
    introText: saved?.introText ?? legacy?.introText ?? defaults.introText,
    closingText: saved?.closingText ?? legacy?.closingText ?? defaults.closingText,
    paymentTerms: saved?.paymentTerms ?? legacy?.paymentTerms ?? defaults.paymentTerms,
    reminderTexts,
  };
}

export function getReminderTextForStage(company: Company, stage: ReminderStage): string {
  const template = resolveDocumentTextTemplate(company, 'reminder');
  const stageKey = `stage${stage}` as keyof ReminderTemplateTexts;
  return template.reminderTexts?.[stageKey]?.trim() || '';
}

/**
 * Infer the mode for templates created before shared text templates existed.
 * Explicit values always win; default layouts use the shared text by default.
 */
export function getDocumentTemplateTextMode(company: Company, template: DocumentTemplate): 'global' | 'custom' {
  if (template.textMode) return template.textMode;
  if (template.isDefault) return 'global';

  const globalText = resolveDocumentTextTemplate(company, template.documentType);
  const textFields: Array<keyof Pick<DocumentTemplate, 'subject' | 'introText' | 'closingText' | 'paymentTerms'>> = [
    'subject',
    'introText',
    'closingText',
    'paymentTerms',
  ];
  const hasCustomText = textFields.some(field => {
    const templateValue = template[field]?.trim();
    const globalValue = globalText[field]?.trim();
    return hasText(templateValue) && templateValue !== globalValue;
  });

  if (template.documentType === 'reminder') {
    const templateReminderTexts = template.reminderTexts || {};
    const globalReminderTexts = globalText.reminderTexts || {};
    const hasCustomReminderText = (['stage1', 'stage2', 'stage3'] as const).some(stage => (
      hasText(templateReminderTexts[stage]) && templateReminderTexts[stage]?.trim() !== globalReminderTexts[stage]?.trim()
    ));
    if (hasCustomReminderText) return 'custom';
  }

  return hasCustomText ? 'custom' : 'global';
}
