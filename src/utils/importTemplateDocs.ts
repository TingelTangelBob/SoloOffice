import type { ImportResource } from '../types';
import { importDefinitions, type ImportFieldDefinition, type ImportFieldType } from './importParser.js';

export type ImportColumnRequirement = 'required' | 'group' | 'optional';

export interface ImportTemplateColumnDoc {
  key: string;
  label: string;
  requirement: ImportColumnRequirement;
  /** Kurzlabel für die Oberfläche: „Pflicht“, „Eines aus …“ oder „Optional“. */
  requirementLabel: string;
  /** Lesbarer Formathinweis, z. B. „Datum (TT.MM.JJJJ)“. */
  typeLabel: string;
  /** Beispielwert aus der Felddefinition, sonst leer. */
  example: string;
  /** Spaltennamen, die automatisch erkannt werden (höchstens sechs). */
  recognisedHeaders: string[];
  helpText?: string;
  /** Labels der Auswahlwerte bei Aufzählungsfeldern. */
  options: string[];
  /** Feld steht in der herunterladbaren CSV-Vorlage. */
  inTemplate: boolean;
  /** Ein fester Wert für alle Zeilen ist möglich. */
  allowsConstant: boolean;
}

export interface ImportTemplateDoc {
  resource: ImportResource;
  label: string;
  description: string;
  requiredGroups: Array<{ label: string; fieldLabels: string[] }>;
  columns: ImportTemplateColumnDoc[];
}

/** Fachliche Reihenfolge der Kategorien: Stammdaten vor Belegen, Belege vor Geld. */
export const IMPORT_TEMPLATE_ORDER: ImportResource[] = [
  'customers', 'positions', 'hourlyRates', 'materials',
  'invoices', 'invoicePayments', 'euerEntries', 'jobs', 'quotes',
];

const typeLabels: Record<ImportFieldType, string> = {
  text: 'Text',
  number: 'Zahl',
  date: 'Datum (TT.MM.JJJJ)',
  time: 'Uhrzeit (HH:MM)',
  enum: 'Auswahl',
};

const requirementOrder: Record<ImportColumnRequirement, number> = { required: 0, group: 1, optional: 2 };

/** Erkannte Spaltennamen ohne Dubletten, in der Reihenfolge der Definition. */
function recognisedHeaders(field: ImportFieldDefinition): string[] {
  const seen = new Set<string>();
  const headers: string[] = [];
  for (const header of [field.key, ...field.aliases]) {
    const key = header.toLocaleLowerCase('de-DE');
    if (seen.has(key)) continue;
    seen.add(key);
    headers.push(header);
    if (headers.length === 6) break;
  }
  return headers;
}

export function getImportTemplateDoc(resource: ImportResource): ImportTemplateDoc {
  const definition = importDefinitions[resource];
  if (!definition) throw new Error(`Unbekannte Importkategorie: ${resource}`);
  const groups = definition.requiredGroups || [];
  const groupLabels = new Map<string, string>();
  for (const group of groups) {
    for (const fieldKey of group.fields) if (!groupLabels.has(fieldKey)) groupLabels.set(fieldKey, group.label);
  }

  // Pflichtspalten zuerst, dann Gruppenpflichten, dann optionale Spalten;
  // innerhalb einer Stufe bleibt die Reihenfolge der Felddefinition erhalten.
  const ordered = definition.fields
    .map((field, index) => ({
      field,
      index,
      requirement: (field.required ? 'required' : groupLabels.has(field.key) ? 'group' : 'optional') as ImportColumnRequirement,
    }))
    .sort((left, right) => requirementOrder[left.requirement] - requirementOrder[right.requirement] || left.index - right.index);

  return {
    resource,
    label: definition.label,
    description: definition.description,
    requiredGroups: groups.map(group => ({
      label: group.label,
      fieldLabels: group.fields
        .map(fieldKey => definition.fields.find(field => field.key === fieldKey)?.label)
        .filter((label): label is string => Boolean(label)),
    })),
    columns: ordered.map(({ field, requirement }) => ({
      key: field.key,
      label: field.label,
      requirement,
      requirementLabel: requirement === 'required'
        ? 'Pflicht'
        : requirement === 'group'
          ? `Eines aus „${groupLabels.get(field.key)}“`
          : 'Optional',
      typeLabel: typeLabels[field.type || 'text'],
      example: field.example || '',
      recognisedHeaders: recognisedHeaders(field),
      ...(field.key === 'courseName' && resource === 'invoices' ? { helpText: 'Optional: Wird „Kurse anlegen“ gewählt, dient diese Spalte als Kursname. Fehlt der Wert, wird die Positionsbeschreibung verwendet.' } : {}),
      options: (field.options || []).map(option => option.label),
      inTemplate: Boolean(field.required || field.template),
      allowsConstant: Boolean(field.constant),
    })),
  };
}

export function getImportTemplateDocs(resources: ImportResource[] = IMPORT_TEMPLATE_ORDER): ImportTemplateDoc[] {
  return resources.map(getImportTemplateDoc);
}
