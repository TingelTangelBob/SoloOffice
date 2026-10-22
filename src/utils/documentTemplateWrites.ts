import type { Company, DocumentTemplate, DocumentTemplateType, DocumentTextTemplate } from '../types';
import { defaultDocumentTextTemplates, documentTextTemplateTypes, resolveDocumentTextTemplate } from './documentTextTemplates.js';

export function globalTextTemplates(templates: DocumentTemplate[], types = documentTextTemplateTypes): DocumentTemplate[] {
  return templates.map(template => types.includes(template.documentType)
    ? { ...template, textMode: 'global' }
    : template);
}

export function documentTextSavePatch(
  company: Company,
  defaults: DocumentTemplate[],
  editedType: DocumentTemplateType,
  fields: Pick<DocumentTextTemplate, 'subject' | 'introText' | 'closingText' | 'paymentTerms' | 'reminderTexts'>,
  now: Date,
): Partial<Company> {
  return {
    documentTextTemplates: documentTextTemplateTypes.map(type => {
      const existing = company.documentTextTemplates?.find(template => template.documentType === type);
      const resolved = resolveDocumentTextTemplate(company, type);
      return type === editedType
        ? { ...(existing || resolved), ...fields, updatedAt: now }
        : existing || resolved;
    }),
    documentTemplates: globalTextTemplates(company.documentTemplates?.length ? company.documentTemplates : defaults, [editedType]),
  };
}

export function documentTextResetPatch(company: Company, defaults: DocumentTemplate[]): Partial<Company> {
  return {
    documentTextTemplates: defaultDocumentTextTemplates.map(template => ({
      ...template,
      id: company.documentTextTemplates?.find(current => current.documentType === template.documentType)?.id || template.id,
      reminderTexts: template.reminderTexts ? { ...template.reminderTexts } : undefined,
      updatedAt: new Date(),
    })),
    documentTemplates: globalTextTemplates(company.documentTemplates?.length ? company.documentTemplates : defaults),
  };
}
