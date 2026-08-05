import type { ImportResource } from '../types';

export interface ImportFieldDefinition {
  key: string;
  label: string;
  aliases: string[];
  required?: boolean;
}

export interface ImportDefinition {
  resource: ImportResource;
  label: string;
  description: string;
  fields: ImportFieldDefinition[];
}

export interface ParsedImportFile {
  fileName: string;
  format: 'csv' | 'tsv' | 'json';
  headers: string[];
  rows: Array<Record<string, string>>;
  warnings: string[];
}

const commonCustomerFields: ImportFieldDefinition[] = [
  { key: 'customerId', label: 'Kunden-ID', aliases: ['customerId', 'customer_id', 'kundenId', 'kunden_id'] },
  { key: 'customerNumber', label: 'Kundennummer', aliases: ['customerNumber', 'customer_number', 'customerNo', 'customer_no', 'kundennummer', 'kundennr', 'kundenNr', 'nummer'] },
  { key: 'customerName', label: 'Kundenname', aliases: ['customerName', 'customer_name', 'kundenname', 'kunde', 'customer', 'mandant', 'name'] },
  { key: 'customerEmail', label: 'Kunden-E-Mail', aliases: ['customerEmail', 'customer_email', 'kundenEmail', 'kundenmail', 'email', 'eMail'] },
];

const quoteItemFields: ImportFieldDefinition[] = [
  { key: 'itemDescription', label: 'Positionsbeschreibung', aliases: ['itemDescription', 'item_description', 'position', 'positionsbeschreibung', 'leistungsbeschreibung', 'artikel', 'article', 'item', 'beschreibung'] },
  { key: 'itemQuantity', label: 'Positionsmenge', aliases: ['itemQuantity', 'item_quantity', 'positionsmenge', 'menge', 'quantity', 'anzahl'] },
  { key: 'itemUnitPrice', label: 'Positionspreis', aliases: ['itemUnitPrice', 'item_unit_price', 'positionspreis', 'einzelpreis', 'unitPrice', 'unit_price', 'preis', 'price'] },
  { key: 'itemTaxRate', label: 'Positions-MwSt.', aliases: ['itemTaxRate', 'item_tax_rate', 'positionTaxRate', 'steuersatz', 'mwst', 'ust', 'taxRate', 'tax_rate'] },
  { key: 'items', label: 'Positionen als JSON', aliases: ['items', 'positionen', 'positions', 'lineItems', 'line_items'] },
];

export const importDefinitions: Record<ImportResource, ImportDefinition> = {
  customers: {
    resource: 'customers',
    label: 'Kunden',
    description: 'Kundenlisten aus CSV, TSV oder JSON übernehmen und bestehende Kunden automatisch erkennen.',
    fields: [
      { key: 'customerNumber', label: 'Kundennummer', aliases: ['customerNumber', 'customer_number', 'customerNo', 'customer_no', 'kundennummer', 'kundennr', 'kundenNr', 'nummer'] },
      { key: 'name', label: 'Name', aliases: ['name', 'customerName', 'customer_name', 'kundenname', 'kunde', 'customer'], required: true },
      { key: 'email', label: 'E-Mail', aliases: ['email', 'eMail', 'mail', 'emailAddress', 'email_address'] },
      { key: 'additionalEmails', label: 'Weitere E-Mails', aliases: ['additionalEmails', 'additional_emails', 'weitereEmails', 'weitere_eMails', 'secondaryEmail'] },
      { key: 'address', label: 'Adresse', aliases: ['address', 'adresse', 'street', 'strasse', 'straße'] },
      { key: 'addressSupplement', label: 'Adresszusatz', aliases: ['addressSupplement', 'address_supplement', 'adresszusatz', 'zusatz'] },
      { key: 'postalCode', label: 'PLZ', aliases: ['postalCode', 'postal_code', 'postcode', 'zip', 'zipCode', 'plz'] },
      { key: 'city', label: 'Ort', aliases: ['city', 'town', 'ort', 'stadt'] },
      { key: 'country', label: 'Land', aliases: ['country', 'land', 'countryName'] },
      { key: 'taxId', label: 'Steuer-ID / USt-IdNr.', aliases: ['taxId', 'tax_id', 'vatId', 'vat_id', 'ustId', 'ust_id', 'ustIdNr', 'steuerId'] },
      { key: 'phone', label: 'Telefon', aliases: ['phone', 'telephone', 'tel', 'telefon', 'mobile', 'mobil'] },
    ],
  },
  jobs: {
    resource: 'jobs',
    label: 'Aufträge',
    description: 'Aufträge importieren und Kunden über ID, Kundennummer, E-Mail oder Namen zuordnen.',
    fields: [
      { key: 'jobNumber', label: 'Auftragsnummer', aliases: ['jobNumber', 'job_number', 'orderNumber', 'order_number', 'auftragsnummer', 'auftragsnr'] },
      { key: 'externalJobNumber', label: 'Externe Auftragsnummer', aliases: ['externalJobNumber', 'external_job_number', 'externalNumber', 'extern', 'externeAuftragsnummer'] },
      ...commonCustomerFields,
      { key: 'customerAddress', label: 'Kundenadresse', aliases: ['customerAddress', 'customer_address', 'kundenadresse'] },
      { key: 'title', label: 'Titel', aliases: ['title', 'jobTitle', 'job_title', 'auftrag', 'auftragtitel', 'bezeichnung'], required: true },
      { key: 'description', label: 'Beschreibung', aliases: ['description', 'details', 'beschreibung', 'leistungstext'] },
      { key: 'date', label: 'Datum', aliases: ['date', 'jobDate', 'job_date', 'datum', 'auftragsdatum'] },
      { key: 'startTime', label: 'Startzeit', aliases: ['startTime', 'start_time', 'beginn', 'start', 'von'] },
      { key: 'endTime', label: 'Endzeit', aliases: ['endTime', 'end_time', 'ende', 'bis'] },
      { key: 'hoursWorked', label: 'Arbeitszeit (Stunden)', aliases: ['hoursWorked', 'hours_worked', 'hours', 'stunden', 'arbeitszeit'] },
      { key: 'hourlyRate', label: 'Stundensatz', aliases: ['hourlyRate', 'hourly_rate', 'rate', 'stundensatz'] },
      { key: 'hourlyRateId', label: 'Stundensatz-ID', aliases: ['hourlyRateId', 'hourly_rate_id', 'stundensatzId'] },
      { key: 'timeEntries', label: 'Zeitpositionen als JSON', aliases: ['timeEntries', 'time_entries', 'zeiten', 'zeitpositionen'] },
      { key: 'materials', label: 'Materialien als JSON', aliases: ['materials', 'materialien', 'materialItems', 'material_items'] },
      { key: 'status', label: 'Status', aliases: ['status', 'auftragsstatus'] },
      { key: 'notes', label: 'Notizen', aliases: ['notes', 'note', 'notizen', 'bemerkung', 'anmerkung'] },
      { key: 'priority', label: 'Priorität', aliases: ['priority', 'prioritaet', 'priorität', 'dringlichkeit'] },
    ],
  },
  quotes: {
    resource: 'quotes',
    label: 'Angebote',
    description: 'Angebote importieren. Mehrere Zeilen mit derselben Angebotsnummer werden zu einem Angebot mit mehreren Positionen gruppiert.',
    fields: [
      { key: 'quoteNumber', label: 'Angebotsnummer', aliases: ['quoteNumber', 'quote_number', 'offerNumber', 'offer_number', 'angebotsnummer', 'angebotsnr'] },
      ...commonCustomerFields,
      { key: 'issueDate', label: 'Ausstellungsdatum', aliases: ['issueDate', 'issue_date', 'offerDate', 'angebotsdatum', 'ausstellungsdatum', 'datum'] },
      { key: 'validUntil', label: 'Gültig bis', aliases: ['validUntil', 'valid_until', 'expirationDate', 'gueltigBis', 'gültigBis', 'gueltig', 'gültig'] },
      { key: 'status', label: 'Status', aliases: ['status', 'angebotsstatus'] },
      { key: 'notes', label: 'Notizen', aliases: ['notes', 'note', 'notizen', 'bemerkung', 'anmerkung'] },
      { key: 'globalDiscountType', label: 'Gesamtrabatt-Typ', aliases: ['globalDiscountType', 'global_discount_type', 'rabattTyp', 'rabattart'] },
      { key: 'globalDiscountValue', label: 'Gesamtrabatt-Wert', aliases: ['globalDiscountValue', 'global_discount_value', 'rabattWert', 'rabattwert'] },
      { key: 'globalDiscountAmount', label: 'Gesamtrabatt-Betrag', aliases: ['globalDiscountAmount', 'global_discount_amount', 'rabattBetrag', 'rabattbetrag'] },
      { key: 'subtotal', label: 'Nettosumme', aliases: ['subtotal', 'sub_total', 'netto', 'netAmount', 'net_amount', 'nettobetrag'] },
      { key: 'taxAmount', label: 'Steuerbetrag', aliases: ['taxAmount', 'tax_amount', 'vatAmount', 'vat_amount', 'steuerbetrag', 'mwstBetrag'] },
      { key: 'total', label: 'Gesamtsumme', aliases: ['total', 'grossAmount', 'gross_amount', 'brutto', 'gesamtbetrag', 'endbetrag'] },
      ...quoteItemFields,
    ],
  },
  positions: {
    resource: 'positions',
    label: 'Positionsvorlagen',
    description: 'Wiederverwendbare Rechnungspositionen mit Beschreibung, Einheit, Preis und Steuersatz importieren.',
    fields: [
      { key: 'name', label: 'Name', aliases: ['name', 'title', 'bezeichnung', 'position', 'beschreibung'], required: true },
      { key: 'description', label: 'Beschreibung', aliases: ['description', 'details', 'beschreibungstext', 'leistungstext'] },
      { key: 'unitPrice', label: 'Preis', aliases: ['unitPrice', 'unit_price', 'price', 'preis', 'einzelpreis', 'betrag'], required: true },
      { key: 'unit', label: 'Einheit', aliases: ['unit', 'einheit', 'unitName'] },
      { key: 'taxRate', label: 'MwSt.-Satz', aliases: ['taxRate', 'tax_rate', 'tax', 'mwst', 'ust', 'steuersatz'] },
      { key: 'isDefault', label: 'Standard', aliases: ['isDefault', 'is_default', 'default', 'standard'] },
    ],
  },
  hourlyRates: {
    resource: 'hourlyRates',
    label: 'Stundensätze',
    description: 'Allgemeine Stundensätze mit Preis, Steuersatz und optionalem Standardkennzeichen übernehmen.',
    fields: [
      { key: 'name', label: 'Name', aliases: ['name', 'title', 'bezeichnung', 'stundensatz', 'rateName'], required: true },
      { key: 'description', label: 'Beschreibung', aliases: ['description', 'details', 'beschreibung'] },
      { key: 'rate', label: 'Stundensatz', aliases: ['rate', 'hourlyRate', 'hourly_rate', 'preis', 'price', 'betrag'], required: true },
      { key: 'taxRate', label: 'MwSt.-Satz', aliases: ['taxRate', 'tax_rate', 'tax', 'mwst', 'ust', 'steuersatz'] },
      { key: 'isDefault', label: 'Standard', aliases: ['isDefault', 'is_default', 'default', 'standard'] },
    ],
  },
  materials: {
    resource: 'materials',
    label: 'Materialien',
    description: 'Materialvorlagen mit Preis, Einheit, Steuersatz und optionalem Standardkennzeichen importieren.',
    fields: [
      { key: 'name', label: 'Name', aliases: ['name', 'title', 'bezeichnung', 'material', 'artikel'], required: true },
      { key: 'description', label: 'Beschreibung', aliases: ['description', 'details', 'beschreibung'] },
      { key: 'unitPrice', label: 'Preis', aliases: ['unitPrice', 'unit_price', 'price', 'preis', 'einzelpreis', 'betrag'], required: true },
      { key: 'unit', label: 'Einheit', aliases: ['unit', 'einheit', 'unitName'] },
      { key: 'taxRate', label: 'MwSt.-Satz', aliases: ['taxRate', 'tax_rate', 'tax', 'mwst', 'ust', 'steuersatz'] },
      { key: 'isDefault', label: 'Standard', aliases: ['isDefault', 'is_default', 'default', 'standard'] },
    ],
  },
};

const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024;

function normaliseHeader(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('de-DE')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 6).join('\n');
  const candidates = [';', '\t', ',', '|'];
  const counts = candidates.map(delimiter => {
    let count = 0;
    let inQuotes = false;
    for (let index = 0; index < sample.length; index += 1) {
      const character = sample[index];
      if (character === '"') inQuotes = !inQuotes;
      if (!inQuotes && character === delimiter) count += 1;
    }
    return { delimiter, count };
  });
  return counts.sort((left, right) => right.count - left.count)[0]?.delimiter || ';';
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = '';
  let inQuotes = false;

  const pushValue = () => {
    currentRow.push(currentValue.trim());
    currentValue = '';
  };
  const pushRow = () => {
    pushValue();
    if (currentRow.some(value => value !== '')) rows.push(currentRow);
    currentRow = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];
    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentValue += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && character === delimiter) {
      pushValue();
    } else if (!inQuotes && (character === '\n' || character === '\r')) {
      if (character === '\r' && nextCharacter === '\n') index += 1;
      pushRow();
    } else {
      currentValue += character;
    }
  }
  if (currentValue !== '' || currentRow.length > 0) pushRow();
  return rows;
}

function uniqueHeaders(headers: string[]): string[] {
  const counts = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header.replace(/^\uFEFF/, '').trim() || `Spalte ${index + 1}`;
    const count = (counts.get(base) || 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function flattenJsonValue(value: unknown, prefix = '', output: Record<string, string> = {}): Record<string, string> {
  if (value === null || value === undefined) {
    if (prefix) output[prefix] = '';
    return output;
  }
  if (Array.isArray(value)) {
    if (prefix) output[prefix] = JSON.stringify(value);
    return output;
  }
  if (typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
      flattenJsonValue(nestedValue, prefix ? `${prefix}.${key}` : key, output);
    });
    return output;
  }
  if (prefix) output[prefix] = String(value);
  return output;
}

function extractJsonRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [{ value }];

  const object = value as Record<string, unknown>;
  const preferredKeys = ['data', 'items', 'records', 'customers', 'jobs', 'quotes', 'positions', 'hourlyRates', 'materials'];
  for (const key of preferredKeys) {
    if (Array.isArray(object[key])) return object[key] as unknown[];
  }
  const nestedArray = Object.values(object).find(candidate => Array.isArray(candidate));
  return Array.isArray(nestedArray) ? nestedArray : [value];
}

function parseJson(text: string): { headers: string[]; rows: Array<Record<string, string>> } {
  const parsed = JSON.parse(text) as unknown;
  const rows = extractJsonRows(parsed).map((row, index) => {
    if (row && typeof row === 'object') return flattenJsonValue(row);
    return { value: String(row ?? ''), row: String(index + 1) };
  });
  const headers = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
  return {
    headers,
    rows: rows.map(row => Object.fromEntries(headers.map(header => [header, row[header] || '']))),
  };
}

function scoreHeader(header: string, field: ImportFieldDefinition): number {
  const normalizedHeader = normaliseHeader(header);
  if (!normalizedHeader) return 0;
  const aliases = [field.key, ...field.aliases].map(normaliseHeader).filter(Boolean);
  const exact = aliases.find(alias => alias === normalizedHeader);
  if (exact) return 100 + exact.length;
  const partial = aliases.find(alias => normalizedHeader.includes(alias) || alias.includes(normalizedHeader));
  return partial ? 50 + Math.min(partial.length, 30) : 0;
}

export function getImportDefinition(resource: ImportResource): ImportDefinition {
  return importDefinitions[resource];
}

export function autoMapHeaders(headers: string[], definition: ImportDefinition): Record<string, string> {
  const candidates = definition.fields
    .flatMap(field => headers.map(header => ({ field, header, score: scoreHeader(header, field) })))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  const mapping: Record<string, string> = {};
  const usedHeaders = new Set<string>();
  candidates.forEach(candidate => {
    if (mapping[candidate.field.key] || usedHeaders.has(candidate.header)) return;
    mapping[candidate.field.key] = candidate.header;
    usedHeaders.add(candidate.header);
  });
  return mapping;
}

export function mapImportRows(parsedFile: ParsedImportFile, mapping: Record<string, string>): Array<Record<string, unknown>> {
  return parsedFile.rows.map((row, index) => {
    const mappedRow: Record<string, unknown> = { _rowNumber: index + 2 };
    Object.entries(mapping).forEach(([targetField, sourceHeader]) => {
      if (!sourceHeader) return;
      const value = row[sourceHeader];
      if (value !== undefined && value.trim() !== '') mappedRow[targetField] = value.trim();
    });
    return mappedRow;
  });
}

export async function parseImportFile(file: File): Promise<ParsedImportFile> {
  if (file.size > MAX_IMPORT_FILE_SIZE) {
    throw new Error('Die Importdatei darf höchstens 10 MB groß sein.');
  }
  const text = await file.text();
  if (!text.trim()) throw new Error('Die Importdatei ist leer.');

  const lowerName = file.name.toLocaleLowerCase('de-DE');
  if (lowerName.endsWith('.json')) {
    try {
      const parsed = parseJson(text);
      return { fileName: file.name, format: 'json', ...parsed, warnings: [] };
    } catch {
      throw new Error('Die JSON-Datei konnte nicht gelesen werden.');
    }
  }

  const delimiter = detectDelimiter(text);
  const matrix = parseDelimited(text, delimiter);
  if (matrix.length < 2) throw new Error('Die Datei benötigt eine Kopfzeile und mindestens eine Datenzeile.');
  const headers = uniqueHeaders(matrix[0]);
  const rows = matrix.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
  return {
    fileName: file.name,
    format: delimiter === '\t' ? 'tsv' : 'csv',
    headers,
    rows,
    warnings: delimiter === '|' ? ['Das Trennzeichen „|“ wurde automatisch erkannt.'] : [],
  };
}
