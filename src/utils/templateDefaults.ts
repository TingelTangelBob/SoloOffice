import type { DocumentTemplateType, ReminderTemplateTexts } from '../types';

interface RestorableTemplate {
  id: string;
  documentType: DocumentTemplateType;
  isDefault?: boolean;
  reminderTexts?: ReminderTemplateTexts;
}

function cloneTemplate<T extends RestorableTemplate>(template: T): T {
  return {
    ...template,
    reminderTexts: template.reminderTexts ? { ...template.reminderTexts } : undefined,
  };
}

/**
 * Setzt nur die mitgelieferten Vorlagen zurück: Einträge mit einer Standard-ID
 * werden durch die Ausgangswerte ersetzt, fehlende Standards wieder angelegt,
 * eigene Vorlagen bleiben unverändert und an ihrer Position.
 *
 * Mit `trackDefaultFlag` bleibt außerdem die Wahl der Standardvorlage je
 * Dokumentart erhalten; nur wenn danach für eine Dokumentart keine Vorlage
 * mehr markiert wäre, wird die erste dieses Typs zum Standard.
 */
export function restoreDefaultTemplates<T extends RestorableTemplate>(
  current: T[],
  defaults: T[],
  trackDefaultFlag: boolean,
): T[] {
  const defaultById = new Map(defaults.map(template => [template.id, template]));
  const restored = current.map(template => {
    const fallback = defaultById.get(template.id);
    if (!fallback) return template;
    const next = cloneTemplate(fallback);
    return trackDefaultFlag ? { ...next, isDefault: Boolean(template.isDefault) } : next;
  });
  const missing = defaults
    .filter(template => !current.some(existing => existing.id === template.id))
    .map(template => {
      const next = cloneTemplate(template);
      return trackDefaultFlag ? { ...next, isDefault: false } : next;
    });
  const result = [...restored, ...missing];
  if (trackDefaultFlag) {
    const types = [...new Set(result.map(template => template.documentType))];
    for (const type of types) {
      if (result.some(template => template.documentType === type && template.isDefault)) continue;
      const first = result.find(template => template.documentType === type);
      if (first) first.isDefault = true;
    }
  }
  return result;
}
