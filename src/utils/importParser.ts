import type { ImportResource, ImportRowResult } from '../types';
import {
  EUER_EXPENSE_CATEGORIES,
  detectDateOrder,
  detectNumberFormat,
  normaliseEuerCategory,
  normaliseKey,
  parseCustomerType,
  parseDate,
  parseEntryType,
  parseJobStatus,
  parseNumber,
  parsePaymentStatus,
  parseQuoteStatus,
  parseRepeatInterval,
  parseTime,
} from '../../backend/utils/importValues.js';
import { buildCsv, type CsvColumn } from './csvExport.js';
import { isZipArchive, readXlsx } from './xlsxReader.js';

export type ImportFieldType = 'text' | 'number' | 'date' | 'time' | 'enum';

export interface ImportFieldOption {
  value: string;
  label: string;
}

export interface ImportFieldDefinition {
  key: string;
  label: string;
  aliases: string[];
  required?: boolean;
  /** Bestimmt die Formaterkennung der Spalte; ohne Angabe wird Text übernommen. */
  type?: ImportFieldType;
  /** Auswahlwerte für Aufzählungen (Art, Kategorie, Status). */
  options?: ImportFieldOption[];
  /** Beispielwert für die herunterladbare Vorlage. */
  example?: string;
  /** Feld erscheint in der Vorlage. */
  template?: boolean;
  /** Ein fester Wert für alle Zeilen ist sinnvoll (z. B. Art oder Steuersatz). */
  constant?: boolean;
}

export interface ImportDefinition {
  resource: ImportResource;
  label: string;
  description: string;
  fields: ImportFieldDefinition[];
  requiredGroups?: Array<{ label: string; fields: string[] }>;
  /** Import kann fehlende Kunden anlegen. */
  canCreateCustomers?: boolean;
  /** Import kann Einnahmen offenen Rechnungen zuordnen. */
  canMatchInvoices?: boolean;
}

export type ImportCellValue = string | number;

export interface ParsedImportFile {
  fileName: string;
  format: 'csv' | 'tsv' | 'json' | 'xlsx';
  headers: string[];
  rows: Array<Record<string, ImportCellValue>>;
  /** Zeilennummer in der Originaldatei je Datenzeile. */
  rowNumbers?: number[];
  warnings: string[];
  encoding?: string;
  sheets?: string[];
  sheet?: string;
  /** SHA-256 der Datei, um wiederholte Importe zu erkennen. */
  hash?: string | null;
}

export type ImportMappingConfidence = 'exact' | 'likely' | 'weak' | 'ambiguous' | 'unmatched';

export interface ImportFieldMappingAnalysis {
  sourceHeader?: string;
  score: number;
  confidence: ImportMappingConfidence;
  alternatives: string[];
}

export interface ImportMappingAnalysis {
  mapping: Record<string, string>;
  fields: Record<string, ImportFieldMappingAnalysis>;
  warnings: string[];
}

export interface ImportResourceCandidate {
  resource: ImportResource;
  label: string;
  confidence: 'high' | 'medium' | 'low';
  score: number;
  reason: string;
  matchedColumns: string[];
  matchedRowCount: number;
  matchedRowNumbers: number[];
  unclearColumns: string[];
  /** Warnung, wenn dieselben Quellzeilen auch zu einer anderen Kategorie passen. */
  overlaps: ImportResource[];
  overlapRows: Partial<Record<ImportResource, number[]>>;
}

const entryTypeOptions: ImportFieldOption[] = [
  { value: 'income', label: 'Einnahme' },
  { value: 'expense', label: 'Ausgabe' },
];

const expenseCategoryLabels: Record<string, string> = {
  materials: 'Material und Waren',
  office: 'Bürobedarf',
  software: 'Software und Lizenzen',
  telecommunications: 'Telefon und Internet',
  travel: 'Reisekosten',
  vehicle: 'Fahrzeugkosten',
  marketing: 'Werbung und Marketing',
  professional_services: 'Fremdleistungen und Beratung',
  insurance: 'Versicherungen',
  bank_fees: 'Bankgebühren',
  other_expense: 'Sonstige Betriebsausgaben',
};

const categoryOptions: ImportFieldOption[] = EUER_EXPENSE_CATEGORIES.map(value => ({ value, label: expenseCategoryLabels[value] || value }));

const jobStatusOptions: ImportFieldOption[] = [
  { value: 'draft', label: 'Entwurf / geplant' },
  { value: 'in-progress', label: 'In Arbeit' },
  { value: 'completed', label: 'Erledigt / stattgefunden' },
  { value: 'invoiced', label: 'Abgerechnet' },
];

const quoteStatusOptions: ImportFieldOption[] = [
  { value: 'draft', label: 'Entwurf' },
  { value: 'sent', label: 'Versendet' },
  { value: 'accepted', label: 'Angenommen' },
  { value: 'rejected', label: 'Abgelehnt' },
  { value: 'expired', label: 'Abgelaufen' },
];

const paymentStatusOptions: ImportFieldOption[] = [
  { value: 'paid', label: 'Bezahlt' },
  { value: 'open', label: 'Offen' },
];

const customerTypeOptions: ImportFieldOption[] = [
  { value: 'person', label: 'Person' },
  { value: 'organization', label: 'Organisation' },
];

const repeatOptions: ImportFieldOption[] = [
  { value: 'einmalig', label: 'Keine Wiederholung' },
  { value: 'woechentlich', label: 'Wöchentlich' },
  { value: '14taegig', label: '14-tägig' },
  { value: 'monatlich', label: 'Monatlich' },
];

/** Ordnet einen Wert aus der Datei einer Auswahl zu (z. B. „Büro“ → Bürobedarf). */
const enumResolvers: Record<string, (value: string) => string | null> = {
  entryType: value => parseEntryType(value),
  category: value => normaliseEuerCategory(value),
  status: value => parseJobStatus(value),
  quoteStatus: value => parseQuoteStatus(value),
  paymentStatus: value => parsePaymentStatus(value),
  customerType: value => parseCustomerType(value),
  repeat: value => {
    const parsed = parseRepeatInterval(value);
    if (!parsed) return null;
    if (!parsed.intervalUnit) return 'einmalig';
    if (parsed.intervalUnit === 'month') return 'monatlich';
    return parsed.interval === 2 ? '14taegig' : 'woechentlich';
  },
};

function resolverKey(resource: ImportResource, fieldKey: string): string {
  if (fieldKey === 'status' && resource === 'quotes') return 'quoteStatus';
  if (fieldKey === 'status' && resource === 'invoices') return 'paymentStatus';
  return fieldKey;
}

/** Automatischer Vorschlag für einen Aufzählungswert oder `null`. */
export function suggestEnumValue(resource: ImportResource, fieldKey: string, raw: unknown): string | null {
  const resolver = enumResolvers[resolverKey(resource, fieldKey)];
  return resolver ? resolver(String(raw ?? '')) : null;
}

const customerIdAliases = ['customerId', 'customer_id', 'kundenId', 'kunden_id', 'schülerId', 'schuelerId', 'studentId', 'student_id', 'teilnehmerId'];
const customerNumberAliases = ['customerNumber', 'customer_number', 'customerNo', 'customer_no', 'kundennummer', 'kundennr', 'kundenNr', 'nummer', 'schülernummer', 'schuelernummer', 'studentNumber', 'student_number', 'teilnehmernummer'];
const customerNameAliases = ['customerName', 'customer_name', 'kundenname', 'kunde', 'customer', 'mandant', 'klient', 'patient', 'name', 'schüler', 'schueler', 'schülername', 'schuelername', 'student', 'studentName', 'student_name', 'teilnehmer', 'teilnehmername', 'teilnehmer_name'];
const customerEmailAliases = ['customerEmail', 'customer_email', 'kundenEmail', 'kundenmail', 'email', 'eMail', 'mail', 'schülerEmail', 'schuelerEmail', 'studentEmail', 'student_email', 'teilnehmerEmail'];

const commonCustomerFields: ImportFieldDefinition[] = [
  { key: 'customerId', label: 'Kunden-ID', aliases: customerIdAliases },
  { key: 'customerNumber', label: 'Kundennummer', aliases: customerNumberAliases },
  { key: 'customerName', label: 'Kundenname', aliases: customerNameAliases, example: 'Anna Muster', template: true },
  { key: 'customerEmail', label: 'Kunden-E-Mail', aliases: customerEmailAliases },
];

const quoteItemFields: ImportFieldDefinition[] = [
  { key: 'itemDescription', label: 'Positionsbeschreibung', aliases: ['itemDescription', 'item_description', 'position', 'positionsbeschreibung', 'leistungsbeschreibung', 'artikel', 'article', 'item', 'beschreibung'], example: 'Beratung', template: true },
  { key: 'itemQuantity', label: 'Positionsmenge', aliases: ['itemQuantity', 'item_quantity', 'positionsmenge', 'menge', 'quantity', 'anzahl'], type: 'number', example: '2', template: true },
  { key: 'itemUnitPrice', label: 'Positionspreis (netto)', aliases: ['itemUnitPrice', 'item_unit_price', 'positionspreis', 'einzelpreis', 'unitPrice', 'unit_price', 'preis', 'price'], type: 'number', example: '80,00', template: true },
  { key: 'itemTaxRate', label: 'Positions-MwSt.', aliases: ['itemTaxRate', 'item_tax_rate', 'positionTaxRate', 'steuersatz', 'mwst', 'ust', 'taxRate', 'tax_rate'], type: 'number', example: '19', template: true, constant: true },
  { key: 'items', label: 'Positionen als JSON', aliases: ['items', 'positionen', 'positions', 'lineItems', 'line_items'] },
];

export const importDefinitions: Record<ImportResource, ImportDefinition> = {
  customers: {
    resource: 'customers',
    label: 'Kunden',
    description: 'Kundenlisten aus Excel, CSV oder JSON übernehmen und bestehende Kunden automatisch erkennen.',
    requiredGroups: [{ label: 'Name', fields: ['name', 'firstName', 'lastName'] }],
    fields: [
      { key: 'customerId', label: 'Kunden-ID', aliases: customerIdAliases },
      { key: 'customerType', label: 'Kundenart', aliases: ['customerType', 'customer_type', 'customerKind', 'customer_kind', 'kundenart', 'kundentyp', 'type', 'typ'], type: 'enum', options: customerTypeOptions, constant: true },
      { key: 'customerNumber', label: 'Kundennummer', aliases: customerNumberAliases, example: '1001', template: true },
      { key: 'name', label: 'Name', aliases: ['name', 'customerName', 'customer_name', 'kundenname', 'kunde', 'customer', 'firma', 'schüler', 'schueler', 'schülername', 'schuelername', 'student', 'studentName', 'student_name', 'teilnehmer', 'teilnehmername', 'teilnehmer_name'], example: 'Anna Muster', template: true },
      { key: 'firstName', label: 'Vorname', aliases: ['firstName', 'first_name', 'vorname'] },
      { key: 'lastName', label: 'Nachname', aliases: ['lastName', 'last_name', 'nachname', 'familienname'] },
      { key: 'email', label: 'E-Mail', aliases: ['email', 'eMail', 'mail', 'emailAddress', 'email_address', 'schülerEmail', 'schuelerEmail', 'studentEmail', 'student_email', 'teilnehmerEmail'], example: 'anna@example.org', template: true },
      { key: 'additionalEmails', label: 'Weitere E-Mails', aliases: ['additionalEmails', 'additional_emails', 'weitereEmails', 'weitere_eMails', 'secondaryEmail'] },
      { key: 'address', label: 'Straße', aliases: ['address', 'adresse', 'street', 'strasse', 'straße', 'anschrift'], example: 'Musterweg 1', template: true },
      { key: 'houseNumber', label: 'Hausnummer', aliases: ['houseNumber', 'house_number', 'hausnummer', 'hausnr'] },
      { key: 'addressSupplement', label: 'Adresszusatz', aliases: ['addressSupplement', 'address_supplement', 'adresszusatz', 'zusatz'] },
      { key: 'postalCode', label: 'PLZ', aliases: ['postalCode', 'postal_code', 'postcode', 'zip', 'zipCode', 'plz'], example: '50667', template: true },
      { key: 'city', label: 'Ort', aliases: ['city', 'town', 'ort', 'stadt'], example: 'Köln', template: true },
      { key: 'country', label: 'Land', aliases: ['country', 'land', 'countryName'], constant: true },
      { key: 'taxId', label: 'Steuernummer / USt-IdNr.', aliases: ['taxId', 'tax_id', 'vatId', 'vat_id', 'ustId', 'ust_id', 'ustIdNr', 'steuerId', 'steuernummer'] },
      { key: 'leitwegId', label: 'Leitweg-ID', aliases: ['leitwegId', 'leitweg_id', 'leitweg', 'buyerReference', 'buyer_reference'] },
      { key: 'phone', label: 'Telefon', aliases: ['phone', 'telephone', 'tel', 'telefon', 'mobile', 'mobil', 'handy'], example: '0221 123456', template: true },
      { key: 'notes', label: 'Notizen', aliases: ['notes', 'note', 'notizen', 'bemerkung', 'anmerkung'] },
      { key: 'isActive', label: 'Aktiv', aliases: ['isActive', 'is_active', 'active', 'aktiv'] },
      { key: 'hourlyRates', label: 'Stundensätze als JSON', aliases: ['hourlyRates', 'hourly_rates', 'stundensaetze', 'stundensätze'] },
      { key: 'materials', label: 'Materialien als JSON', aliases: ['materials', 'materialien', 'material_templates'] },
    ],
  },
  jobs: {
    resource: 'jobs',
    label: 'Aufträge',
    description: 'Aufträge importieren und Kunden über ID, Kundennummer, E-Mail oder Namen zuordnen.',
    requiredGroups: [{ label: 'Kundenbezug', fields: ['customerId', 'customerNumber', 'customerName', 'customerEmail'] }],
    canCreateCustomers: true,
    fields: [
      { key: 'jobNumber', label: 'Auftragsnummer', aliases: ['jobNumber', 'job_number', 'orderNumber', 'order_number', 'auftragsnummer', 'auftragsnr'] },
      { key: 'externalJobNumber', label: 'Externe Auftragsnummer', aliases: ['externalJobNumber', 'external_job_number', 'externalNumber', 'extern', 'externeAuftragsnummer'] },
      ...commonCustomerFields,
      { key: 'customerAddress', label: 'Kundenadresse', aliases: ['customerAddress', 'customer_address', 'kundenadresse', 'schüleradresse', 'schueleradresse', 'studentAddress', 'student_address', 'teilnehmeradresse'] },
      { key: 'location', label: 'Ausführungsort', aliases: ['location', 'ausführungsort', 'ausfuehrungsort', 'executionLocation', 'einsatzort', 'raum'] },
      { key: 'title', label: 'Titel', aliases: ['title', 'jobTitle', 'job_title', 'auftrag', 'auftragtitel', 'bezeichnung', 'kurs', 'kursname', 'fach'], example: 'Mathematik', template: true, constant: true },
      { key: 'description', label: 'Beschreibung', aliases: ['description', 'details', 'beschreibung', 'leistungstext', 'inhalt', 'thema'] },
      { key: 'date', label: 'Datum', aliases: ['date', 'jobDate', 'job_date', 'datum', 'auftragsdatum', 'termin', 'kursdatum', 'unterrichtsdatum'], required: true, type: 'date', example: '15.09.2025', template: true },
      { key: 'startTime', label: 'Startzeit', aliases: ['startTime', 'start_time', 'beginn', 'start', 'von', 'uhrzeit'], type: 'time', example: '16:00', template: true },
      { key: 'endTime', label: 'Endzeit', aliases: ['endTime', 'end_time', 'ende', 'bis'], type: 'time', example: '17:00', template: true },
      { key: 'hoursWorked', label: 'Arbeitszeit (Stunden)', aliases: ['hoursWorked', 'hours_worked', 'hours', 'stunden', 'arbeitszeit', 'dauer', 'std'], type: 'number', example: '1,0', template: true },
      { key: 'hourlyRate', label: 'Stundensatz', aliases: ['hourlyRate', 'hourly_rate', 'rate', 'stundensatz', 'proStunde', 'preisProStunde', 'honorar', 'satz'], type: 'number', example: '25,00', template: true, constant: true },
      { key: 'taxRate', label: 'MwSt.-Satz', aliases: ['taxRate', 'tax_rate', 'mwst', 'ust', 'steuersatz'], type: 'number', constant: true },
      { key: 'hourlyRateId', label: 'Stundensatz-ID', aliases: ['hourlyRateId', 'hourly_rate_id', 'stundensatzId'] },
      { key: 'timeEntries', label: 'Zeitpositionen als JSON', aliases: ['timeEntries', 'time_entries', 'zeiten', 'zeitpositionen'] },
      { key: 'materials', label: 'Materialien als JSON', aliases: ['materials', 'materialien', 'materialItems', 'material_items'] },
      { key: 'status', label: 'Status', aliases: ['status', 'auftragsstatus', 'kursstatus'], type: 'enum', options: jobStatusOptions, example: 'abgerechnet', template: true, constant: true },
      { key: 'repeat', label: 'Wiederholung', aliases: ['repeat', 'wiederholung', 'rhythmus', 'turnus', 'intervall'], type: 'enum', options: repeatOptions, constant: true },
      { key: 'repeatUntil', label: 'Wiederholen bis', aliases: ['repeatUntil', 'repeat_until', 'wiederholenBis', 'serieBis', 'enddatum'], type: 'date', constant: true },
      { key: 'repeatCount', label: 'Anzahl Termine', aliases: ['repeatCount', 'repeat_count', 'anzahlTermine', 'termine'], type: 'number', constant: true },
      { key: 'notes', label: 'Notizen', aliases: ['notes', 'note', 'notizen', 'bemerkung', 'anmerkung'] },
      { key: 'priority', label: 'Priorität', aliases: ['priority', 'prioritaet', 'priorität', 'dringlichkeit'] },
    ],
  },
  quotes: {
    resource: 'quotes',
    label: 'Angebote',
    description: 'Angebote importieren. Mehrere Zeilen mit derselben Angebotsnummer werden zu einem Angebot mit mehreren Positionen gruppiert.',
    requiredGroups: [{ label: 'Kundenbezug', fields: ['customerId', 'customerNumber', 'customerName', 'customerEmail'] }],
    canCreateCustomers: true,
    fields: [
      { key: 'quoteNumber', label: 'Angebotsnummer', aliases: ['quoteNumber', 'quote_number', 'offerNumber', 'offer_number', 'angebotsnummer', 'angebotsnr'], example: 'AN-2025-001', template: true },
      ...commonCustomerFields,
      { key: 'issueDate', label: 'Ausstellungsdatum', aliases: ['issueDate', 'issue_date', 'offerDate', 'angebotsdatum', 'ausstellungsdatum', 'datum'], type: 'date', example: '01.09.2025', template: true },
      { key: 'validUntil', label: 'Gültig bis', aliases: ['validUntil', 'valid_until', 'expirationDate', 'gueltigBis', 'gültigBis', 'gueltig', 'gültig'], type: 'date' },
      { key: 'status', label: 'Status', aliases: ['status', 'angebotsstatus'], type: 'enum', options: quoteStatusOptions, constant: true },
      { key: 'notes', label: 'Notizen', aliases: ['notes', 'note', 'notizen', 'bemerkung', 'anmerkung'] },
      { key: 'globalDiscountType', label: 'Gesamtrabatt-Typ', aliases: ['globalDiscountType', 'global_discount_type', 'rabattTyp', 'rabattart'] },
      { key: 'globalDiscountValue', label: 'Gesamtrabatt-Wert', aliases: ['globalDiscountValue', 'global_discount_value', 'rabattWert', 'rabattwert'], type: 'number' },
      { key: 'globalDiscountAmount', label: 'Gesamtrabatt-Betrag', aliases: ['globalDiscountAmount', 'global_discount_amount', 'rabattBetrag', 'rabattbetrag'], type: 'number' },
      { key: 'subtotal', label: 'Nettosumme', aliases: ['subtotal', 'sub_total', 'netto', 'netAmount', 'net_amount', 'nettobetrag'], type: 'number' },
      { key: 'taxAmount', label: 'Steuerbetrag', aliases: ['taxAmount', 'tax_amount', 'vatAmount', 'vat_amount', 'steuerbetrag', 'mwstBetrag'], type: 'number' },
      { key: 'total', label: 'Gesamtsumme', aliases: ['total', 'grossAmount', 'gross_amount', 'brutto', 'gesamtbetrag', 'endbetrag'], type: 'number' },
      ...quoteItemFields,
    ],
  },
  positions: {
    resource: 'positions',
    label: 'Positionsvorlagen',
    description: 'Wiederverwendbare Rechnungspositionen mit Beschreibung, Einheit, Preis und Steuersatz importieren.',
    fields: [
      { key: 'name', label: 'Name', aliases: ['name', 'title', 'bezeichnung', 'position', 'beschreibung'], required: true, example: 'Beratung', template: true },
      { key: 'description', label: 'Beschreibung', aliases: ['description', 'details', 'beschreibung', 'beschreibungstext', 'leistungstext'], example: 'Beratung je Stunde', template: true },
      { key: 'unitPrice', label: 'Preis', aliases: ['unitPrice', 'unit_price', 'price', 'preis', 'einzelpreis', 'betrag'], required: true, type: 'number', example: '80,00', template: true },
      { key: 'unit', label: 'Einheit', aliases: ['unit', 'einheit', 'unitName'], example: 'Stunde', template: true, constant: true },
      { key: 'taxRate', label: 'MwSt.-Satz', aliases: ['taxRate', 'tax_rate', 'tax', 'mwst', 'ust', 'steuersatz'], type: 'number', example: '19', template: true, constant: true },
      { key: 'isDefault', label: 'Standard', aliases: ['isDefault', 'is_default', 'default', 'standard'] },
    ],
  },
  hourlyRates: {
    resource: 'hourlyRates',
    label: 'Stundensätze',
    description: 'Allgemeine Stundensätze mit Preis, Steuersatz und optionalem Standardkennzeichen übernehmen.',
    fields: [
      { key: 'name', label: 'Name', aliases: ['name', 'title', 'bezeichnung', 'stundensatz', 'rateName'], required: true, example: 'Einzelunterricht', template: true },
      { key: 'description', label: 'Beschreibung', aliases: ['description', 'details', 'beschreibung'] },
      { key: 'rate', label: 'Stundensatz', aliases: ['rate', 'hourlyRate', 'hourly_rate', 'preis', 'price', 'betrag', 'proStunde', 'honorar'], required: true, type: 'number', example: '25,00', template: true },
      { key: 'taxRate', label: 'MwSt.-Satz', aliases: ['taxRate', 'tax_rate', 'tax', 'mwst', 'ust', 'steuersatz'], type: 'number', example: '0', template: true, constant: true },
      { key: 'isDefault', label: 'Standard', aliases: ['isDefault', 'is_default', 'default', 'standard'] },
    ],
  },
  materials: {
    resource: 'materials',
    label: 'Materialien',
    description: 'Materialvorlagen mit Preis, Einheit, Steuersatz und optionalem Standardkennzeichen importieren.',
    fields: [
      { key: 'name', label: 'Name', aliases: ['name', 'title', 'bezeichnung', 'material', 'artikel'], required: true, example: 'Arbeitsheft', template: true },
      { key: 'description', label: 'Beschreibung', aliases: ['description', 'details', 'beschreibung'] },
      { key: 'unitPrice', label: 'Preis', aliases: ['unitPrice', 'unit_price', 'price', 'preis', 'einzelpreis', 'betrag'], required: true, type: 'number', example: '12,90', template: true },
      { key: 'unit', label: 'Einheit', aliases: ['unit', 'einheit', 'unitName'], example: 'Stück', template: true, constant: true },
      { key: 'taxRate', label: 'MwSt.-Satz', aliases: ['taxRate', 'tax_rate', 'tax', 'mwst', 'ust', 'steuersatz'], type: 'number', example: '7', template: true, constant: true },
      { key: 'isDefault', label: 'Standard', aliases: ['isDefault', 'is_default', 'default', 'standard'] },
    ],
  },
  euerEntries: {
    resource: 'euerEntries',
    label: 'Einnahmen und Ausgaben',
    description: 'Einnahmen und Ausgaben aus Excel- oder CSV-Tabellen in die EÜR übernehmen. Einnahmen zu vorhandenen Rechnungen werden als Zahlung dieser Rechnung gebucht.',
    requiredGroups: [{ label: 'Betrag', fields: ['amount', 'incomeAmount', 'expenseAmount', 'unitPrice'] }],
    canCreateCustomers: true,
    canMatchInvoices: true,
    fields: [
      { key: 'entryDate', label: 'Datum', aliases: ['entryDate', 'entry_date', 'date', 'datum', 'buchungsdatum', 'belegdatum', 'zahlungsdatum', 'valuta'], required: true, type: 'date', example: '15.09.2025', template: true },
      { key: 'entryType', label: 'Art (Einnahme/Ausgabe)', aliases: ['entryType', 'entry_type', 'art', 'typ', 'buchungsart', 'einnahmeAusgabe', 'kind'], type: 'enum', options: entryTypeOptions, example: 'Einnahme', template: true, constant: true },
      { key: 'description', label: 'Beschreibung', aliases: ['description', 'beschreibung', 'bezeichnung', 'text', 'verwendungszweck', 'zweck', 'buchungstext', 'leistung'], example: 'Unterricht', template: true, constant: true },
      { key: 'amount', label: 'Betrag (brutto)', aliases: ['amount', 'betrag', 'brutto', 'grossAmount', 'gross_amount', 'summe', 'gesamt', 'gesamtbetrag'], type: 'number', example: '25,00', template: true },
      { key: 'incomeAmount', label: 'Einnahme-Spalte', aliases: ['incomeAmount', 'income_amount', 'einnahme', 'einnahmen', 'eingang', 'einzahlung'], type: 'number' },
      { key: 'expenseAmount', label: 'Ausgabe-Spalte', aliases: ['expenseAmount', 'expense_amount', 'ausgabe', 'ausgaben', 'ausgang', 'auszahlung'], type: 'number' },
      { key: 'quantity', label: 'Menge / Stunden', aliases: ['quantity', 'menge', 'anzahl', 'stunden', 'std', 'einheiten', 'hours'], type: 'number' },
      { key: 'unitPrice', label: 'Einzelpreis / pro Stunde', aliases: ['unitPrice', 'unit_price', 'einzelpreis', 'preis', 'proStunde', 'preisProStunde', 'stundensatz', 'satz', 'honorar'], type: 'number' },
      { key: 'category', label: 'Kategorie (Ausgaben)', aliases: ['category', 'kategorie', 'ausgabenkategorie', 'kostenart', 'konto'], type: 'enum', options: categoryOptions, example: '', template: true, constant: true },
      { key: 'taxRate', label: 'MwSt.-Satz', aliases: ['taxRate', 'tax_rate', 'tax', 'mwst', 'ust', 'steuersatz', 'mwstSatz'], type: 'number', example: '0', template: true, constant: true },
      { key: 'customerName', label: 'Kundenname', aliases: customerNameAliases.filter(alias => alias !== 'name'), example: 'Anna Muster', template: true },
      { key: 'customerNumber', label: 'Kundennummer', aliases: customerNumberAliases.filter(alias => alias !== 'nummer') },
      { key: 'customerEmail', label: 'Kunden-E-Mail', aliases: customerEmailAliases.filter(alias => !['email', 'eMail', 'mail'].includes(alias)) },
      { key: 'invoiceNumber', label: 'Rechnungsnummer', aliases: ['invoiceNumber', 'invoice_number', 'rechnungsnummer', 'rechnungsnr', 'rechnungsNr', 're_nr', 'belegnummer', 'belegnr', 'rechnung'], example: '', template: true },
      { key: 'externalReference', label: 'Buchungs-ID', aliases: ['externalReference', 'external_reference', 'importId', 'import_id', 'buchungsId', 'transaktionsId', 'transactionId'] },
      { key: 'notes', label: 'Notizen', aliases: ['notes', 'note', 'notizen', 'bemerkung', 'anmerkung', 'kommentar'] },
    ],
  },
  invoicePayments: {
    resource: 'invoicePayments',
    label: 'Zahlungseingänge',
    description: 'Zahlungseingänge aus Excel-, CSV- oder JSON-Exporten bestehenden Rechnungen zuordnen und in die EÜR übernehmen.',
    requiredGroups: [
      { label: 'Rechnungsbezug', fields: ['invoiceId', 'invoiceNumber', 'customerId', 'customerNumber', 'customerName', 'customerEmail'] },
    ],
    fields: [
      { key: 'invoiceId', label: 'Rechnungs-ID', aliases: ['invoiceId', 'invoice_id', 'rechnungsId', 'rechnungs_id'] },
      { key: 'invoiceNumber', label: 'Rechnungsnummer', aliases: ['invoiceNumber', 'invoice_number', 'rechnungsnummer', 'rechnungsnr', 'rechnungsNr', 'belegnummer'], example: 'RE-2025-001', template: true },
      { key: 'customerId', label: 'Kunden-ID', aliases: customerIdAliases },
      { key: 'customerNumber', label: 'Kundennummer', aliases: customerNumberAliases },
      { key: 'customerName', label: 'Kundenname', aliases: customerNameAliases },
      { key: 'customerEmail', label: 'Kunden-E-Mail', aliases: [...customerEmailAliases, 'emailAddress', 'email_address'] },
      { key: 'serviceDate', label: 'Leistungsdatum', aliases: ['serviceDate', 'service_date', 'leistungsdatum', 'unterrichtsdatum', 'kursdatum', 'jobDate', 'job_date'], type: 'date' },
      { key: 'entryDate', label: 'Zahlungsdatum', aliases: ['entryDate', 'entry_date', 'paymentDate', 'payment_date', 'zahlungsdatum', 'buchungsdatum', 'belegdatum', 'date', 'datum'], required: true, type: 'date', example: '20.09.2025', template: true },
      { key: 'amount', label: 'Zahlungsbetrag', aliases: ['amount', 'paymentAmount', 'payment_amount', 'zahlungsbetrag', 'betrag', 'paidAmount', 'paid_amount', 'brutto', 'grossAmount', 'gross_amount'], required: true, type: 'number', example: '119,00', template: true },
      { key: 'externalReference', label: 'Externe Zahlungs-ID', aliases: ['externalReference', 'external_reference', 'externalPaymentId', 'external_payment_id', 'paymentId', 'payment_id', 'importId', 'import_id', 'importnummer'] },
      { key: 'notes', label: 'Notizen', aliases: ['notes', 'note', 'notizen', 'bemerkung', 'anmerkung', 'verwendungszweck', 'zweck'] },
    ],
  },
  invoices: {
    resource: 'invoices',
    label: 'Rechnungen (Altbestand)',
    description: 'Rechnungen aus einem anderen Programm oder aus Word/Excel mit ursprünglicher Nummer übernehmen. Zahlungen werden mit ihrem Zahlungsdatum gebucht, offene Beträge bleiben offen.',
    requiredGroups: [
      { label: 'Kundenbezug', fields: ['customerId', 'customerNumber', 'customerName', 'customerEmail'] },
      { label: 'Betrag', fields: ['total', 'netAmount', 'itemUnitPrice'] },
    ],
    canCreateCustomers: true,
    fields: [
      { key: 'invoiceNumber', label: 'Rechnungsnummer', aliases: ['invoiceNumber', 'invoice_number', 'rechnungsnummer', 'rechnungsnr', 'rechnungsNr', 're_nr', 'belegnummer', 'belegnr', 'rechnung', 'nummer'], required: true, example: '2024-017', template: true },
      { key: 'issueDate', label: 'Rechnungsdatum', aliases: ['issueDate', 'issue_date', 'rechnungsdatum', 'ausstellungsdatum', 'belegdatum', 'datum', 'date'], required: true, type: 'date', example: '01.03.2024', template: true },
      ...commonCustomerFields.map(field => (field.key === 'customerNumber' ? { ...field, aliases: field.aliases.filter(alias => alias !== 'nummer') } : field)),
      { key: 'dueDate', label: 'Fällig am', aliases: ['dueDate', 'due_date', 'faelligkeit', 'fälligkeit', 'faelligAm', 'fälligAm', 'zahlungsziel'], type: 'date' },
      { key: 'serviceDate', label: 'Leistungsdatum', aliases: ['serviceDate', 'service_date', 'leistungsdatum'], type: 'date' },
      { key: 'total', label: 'Rechnungsbetrag (brutto)', aliases: ['total', 'grossAmount', 'gross_amount', 'brutto', 'bruttobetrag', 'gesamtbetrag', 'endbetrag', 'rechnungsbetrag', 'betrag', 'amount'], type: 'number', example: '119,00', template: true },
      { key: 'netAmount', label: 'Nettobetrag', aliases: ['netAmount', 'net_amount', 'netto', 'nettobetrag', 'subtotal'], type: 'number' },
      { key: 'taxRate', label: 'MwSt.-Satz', aliases: ['taxRate', 'tax_rate', 'mwst', 'ust', 'steuersatz', 'mwstSatz'], type: 'number', example: '19', template: true, constant: true },
      { key: 'taxAmount', label: 'Steuerbetrag', aliases: ['taxAmount', 'tax_amount', 'steuerbetrag', 'mwstBetrag', 'ustBetrag'], type: 'number' },
      { key: 'itemDescription', label: 'Positionsbeschreibung', aliases: ['itemDescription', 'item_description', 'position', 'positionsbeschreibung', 'leistungsbeschreibung', 'artikel', 'leistung'] },
      { key: 'itemQuantity', label: 'Positionsmenge', aliases: ['itemQuantity', 'item_quantity', 'positionsmenge', 'menge', 'quantity', 'anzahl'], type: 'number' },
      { key: 'itemUnitPrice', label: 'Positionspreis (netto)', aliases: ['itemUnitPrice', 'item_unit_price', 'positionspreis', 'einzelpreis', 'unitPrice', 'unit_price'], type: 'number' },
      { key: 'itemTaxRate', label: 'Positions-MwSt.', aliases: ['itemTaxRate', 'item_tax_rate', 'positionTaxRate'], type: 'number' },
      { key: 'status', label: 'Zahlungsstatus', aliases: ['status', 'zahlungsstatus', 'paymentStatus', 'payment_status', 'bezahlt'], type: 'enum', options: paymentStatusOptions, example: 'bezahlt', template: true, constant: true },
      { key: 'paidDate', label: 'Bezahlt am', aliases: ['paidDate', 'paid_date', 'paymentDate', 'payment_date', 'zahlungsdatum', 'bezahltAm', 'zahlungseingang', 'eingangsdatum'], type: 'date', example: '10.03.2024', template: true },
      { key: 'paidAmount', label: 'Bezahlter Betrag', aliases: ['paidAmount', 'paid_amount', 'bezahlterBetrag', 'zahlungsbetrag', 'gezahlt'], type: 'number' },
      { key: 'notes', label: 'Notizen', aliases: ['notes', 'note', 'notizen', 'bemerkung', 'anmerkung'] },
    ],
  },
};

const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024;

function normaliseHeader(value: string): string {
  return normaliseKey(value);
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

/** Zeilen einer Textdatei samt Zeilennummer der jeweiligen Zeile in der Datei. */
function parseDelimited(text: string, delimiter: string): Array<{ lineNumber: number; values: string[] }> {
  const rows: Array<{ lineNumber: number; values: string[] }> = [];
  let currentRow: string[] = [];
  let currentValue = '';
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  const pushValue = () => {
    currentRow.push(currentValue.trim());
    currentValue = '';
  };
  const pushRow = () => {
    pushValue();
    if (currentRow.some(value => value !== '')) rows.push({ lineNumber: rowStartLine, values: currentRow });
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
      line += 1;
      rowStartLine = line;
    } else {
      if (character === '\n') line += 1;
      currentValue += character;
    }
  }
  if (currentValue !== '' || currentRow.length > 0) pushRow();
  return rows;
}

function uniqueHeaders(headers: string[]): string[] {
  const counts = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header.replace(/^\ufeff/, '').trim() || `Spalte ${index + 1}`;
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
  const preferredKeys = ['data', 'items', 'records', 'customers', 'jobs', 'quotes', 'positions', 'hourlyRates', 'materials', 'euerEntries', 'invoicePayments', 'invoices', 'payments', 'zahlungen', 'expenses', 'ausgaben', 'einnahmen'];
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
  const headers = Array.from(new Set(rows.flatMap(row => Object.keys(row))))
    .filter(header => header.trim() && rows.some(row => String(row[header] ?? '').trim() !== ''));
  return {
    headers,
    rows: rows.map(row => Object.fromEntries(headers.map(header => [header, row[header] || '']))),
  };
}

interface HeaderCandidate {
  fieldKey: string;
  header: string;
  score: number;
  exact: boolean;
}

function scoreHeader(header: string, field: ImportFieldDefinition): number {
  const normalizedHeader = normaliseHeader(header);
  if (!normalizedHeader) return 0;
  const aliases = Array.from(new Set([field.key, ...field.aliases].map(normaliseHeader).filter(Boolean)));
  const exact = aliases.find(alias => alias === normalizedHeader);
  if (exact) return 100 + exact.length;

  // Very short partial matches such as "id" or "art" are too unspecific for
  // an automatic mapping. They remain selectable manually in the wizard.
  if (normalizedHeader.length < 3) return 0;
  const partial = aliases
    .filter(alias => alias.length >= 3 && (normalizedHeader.includes(alias) || alias.includes(normalizedHeader)))
    .sort((left, right) => right.length - left.length)[0];
  return partial ? 60 + Math.min(partial.length, 30) : 0;
}

function buildHeaderCandidates(headers: string[], definition: ImportDefinition): HeaderCandidate[] {
  return definition.fields.flatMap(field => headers
    .map(header => {
      const normalizedHeader = normaliseHeader(header);
      const aliases = Array.from(new Set([field.key, ...field.aliases].map(normaliseHeader).filter(Boolean)));
      return {
        fieldKey: field.key,
        header,
        score: scoreHeader(header, field),
        exact: aliases.includes(normalizedHeader),
      };
    })
    .filter(candidate => candidate.score > 0));
}

export function getImportDefinition(resource: ImportResource): ImportDefinition {
  return importDefinitions[resource];
}

export function analyseHeaderMapping(headers: string[], definition: ImportDefinition): ImportMappingAnalysis {
  const candidates = buildHeaderCandidates(headers, definition);
  const candidatesByHeader = new Map<string, HeaderCandidate[]>();
  candidates.forEach(candidate => {
    const entries = candidatesByHeader.get(candidate.header) || [];
    entries.push(candidate);
    candidatesByHeader.set(candidate.header, entries);
  });

  // If one source column is an equally good match for multiple target fields,
  // leave it for manual selection instead of silently assigning it twice.
  const ambiguousHeaders = new Set<string>();
  const ambiguousFields = new Set<string>();
  candidatesByHeader.forEach(headerCandidates => {
    const highestScore = Math.max(...headerCandidates.map(candidate => candidate.score));
    const topCandidates = headerCandidates.filter(candidate => candidate.score === highestScore);
    if (topCandidates.length > 1) {
      ambiguousHeaders.add(topCandidates[0].header);
      topCandidates.forEach(candidate => ambiguousFields.add(candidate.fieldKey));
    }
  });

  const mapping: Record<string, string> = {};
  const usedHeaders = new Set<string>();
  candidates
    .sort((left, right) => right.score - left.score || Number(right.exact) - Number(left.exact))
    .forEach(candidate => {
      if (ambiguousHeaders.has(candidate.header) || mapping[candidate.fieldKey] || usedHeaders.has(candidate.header)) return;
      mapping[candidate.fieldKey] = candidate.header;
      usedHeaders.add(candidate.header);
    });

  const fields: Record<string, ImportFieldMappingAnalysis> = Object.fromEntries(definition.fields.map(field => {
    const fieldCandidates = candidates
      .filter(candidate => candidate.fieldKey === field.key)
      .sort((left, right) => right.score - left.score);
    const selectedHeader = mapping[field.key];
    const selectedCandidate = fieldCandidates.find(candidate => candidate.header === selectedHeader);
    const bestCandidate = fieldCandidates[0];
    const bestHeaderUsedElsewhere = Boolean(bestCandidate && !selectedCandidate && usedHeaders.has(bestCandidate.header));
    const confidence: ImportMappingConfidence = selectedCandidate
      ? selectedCandidate.exact ? 'exact' : selectedCandidate.score >= 75 ? 'likely' : 'weak'
      // Ein nur teilweise passender Spaltenname, der bereits exakt einem anderen
      // Feld zugeordnet ist, ist keine echte Mehrdeutigkeit.
      : (ambiguousFields.has(field.key) || (bestHeaderUsedElsewhere && bestCandidate.exact)) ? 'ambiguous' : 'unmatched';

    return [field.key, {
      sourceHeader: selectedHeader,
      score: selectedCandidate?.score || bestCandidate?.score || 0,
      confidence,
      alternatives: fieldCandidates
        .map(candidate => candidate.header)
        .filter(header => header !== selectedHeader)
        .slice(0, 3),
    } satisfies ImportFieldMappingAnalysis];
  }));

  const ambiguousLabels = definition.fields
    .filter(field => fields[field.key].confidence === 'ambiguous')
    .map(field => field.label);
  const missingRequiredLabels = definition.fields
    .filter(field => field.required && !mapping[field.key])
    .map(field => field.label);
  const missingRequiredGroups = (definition.requiredGroups || [])
    .filter(group => group.fields.every(fieldKey => !mapping[fieldKey]));
  const warnings: string[] = [];
  if (ambiguousLabels.length > 0) {
    warnings.push(`Bitte prüfen Sie die Zuordnung für: ${ambiguousLabels.join(', ')}.`);
  }
  if (missingRequiredLabels.length > 0) {
    warnings.push(`Pflichtspalten ohne eindeutige Zuordnung: ${missingRequiredLabels.join(', ')}.`);
  }
  if (missingRequiredGroups.length > 0) {
    warnings.push(`Mindestens eine Spalte aus dem Bereich ${missingRequiredGroups.map(group => group.label).join(', ')} muss zugeordnet werden.`);
  }

  return { mapping, fields, warnings };
}

export function autoMapHeaders(headers: string[], definition: ImportDefinition): Record<string, string> {
  return analyseHeaderMapping(headers, definition).mapping;
}

/** Deterministische Ressourcenvorschläge aus bestehenden Feldaliasen und Zeilenwerten. */
export function detectImportResources(parsed: ParsedImportFile): ImportResourceCandidate[] {
  const candidates = (Object.keys(importDefinitions) as ImportResource[]).map(resource => {
    const definition = getImportDefinition(resource);
    const analysis = analyseHeaderMapping(parsed.headers, definition);
    const matches = Object.entries(analysis.mapping).map(([key, header]) => ({
      key, header, field: definition.fields.find(field => field.key === key)!,
    }));
    const matchedColumns = [...new Set(matches.map(match => match.header))];
    const unclearColumns = parsed.headers.filter(header => !matchedColumns.includes(header));
    const linkedDateHeader = analysis.mapping.entryDate || '';
    const invoiceReferenceHeader = analysis.mapping.invoiceNumber || '';
    const paymentLinkedRow = (row: Record<string, ImportCellValue>) => resource === 'euerEntries'
      && Boolean(invoiceReferenceHeader && linkedDateHeader && /zahlung|payment/i.test(linkedDateHeader)
        && String(row[invoiceReferenceHeader] ?? '').trim() && String(row[linkedDateHeader] ?? '').trim());
    const eligibleRows = parsed.rows.filter(row => !paymentLinkedRow(row));
    const excludedPaymentRows = parsed.rows.length - eligibleRows.length;
    const requiredGroups = definition.requiredGroups || [];
    const requiredGroupHit = requiredGroups.length === 0 || requiredGroups.some(group => group.fields.some(key => analysis.mapping[key]));
    const rowEvidence = matches.filter(({ key }) => /date|amount|price|number|name|description|email|category|type|status|quantity|invoice|customer|title|rate|unit|address|city/i.test(key));
    const coherentRowIndexes = parsed.rows.map((row, index) => ({ row, index })).filter(({ row }) => !paymentLinkedRow(row) && rowEvidence.filter(({ header }) => String(row[header] ?? '').trim() !== '').length >= Math.min(2, Math.max(1, rowEvidence.length))).map(({ index }) => index);
    const coherentRows = coherentRowIndexes.map(index => parsed.rows[index]).filter(Boolean);
    const eligiblePopulation = eligibleRows.filter(row => Object.values(row).some(value => String(value ?? '').trim() !== ''));
    const coverage = eligiblePopulation.length ? coherentRows.length / eligiblePopulation.length : 0;
    const typedFields = matches.filter(({ field }) => field.type === 'date' || field.type === 'number' || field.type === 'time');
    const typedAnalysis = typedFields.map(({ header, field }) => analyseColumnFormat(parsed, header, field.type)).filter((format): format is ColumnFormat => Boolean(format));
    const typedTotal = typedAnalysis.reduce((sum, format) => sum + format.total, 0);
    const typedInvalid = typedAnalysis.reduce((sum, format) => sum + format.invalid, 0);
    const typedQuality = typedTotal ? (typedTotal - typedInvalid) / typedTotal : 1;
    let score = Math.min(60, matchedColumns.length * 18) + Math.round(coverage * 25) + (requiredGroupHit ? 15 : 0)
      + (typedTotal ? Math.round(typedQuality * 10) - Math.round((1 - typedQuality) * 20) : 0);
    let reason = matchedColumns.length
      ? `${matchedColumns.length} passende Spalten aus den Felddefinitionen; ${Math.round(coverage * 100)} % der relevanten Datenzeilen enthalten dazu passende Werte${typedTotal ? `, ${Math.round(typedQuality * 100)} % der Datums- und Zahlenwerte sind lesbar` : ''}${excludedPaymentRows ? ` ${excludedPaymentRows} mit Rechnungsbezug und Zahlungsdatum verknüpfte Zeilen sind hier ausgeschlossen.` : ''}.`
      : 'Keine passende Spaltenstruktur erkannt.';

    const accepted = matchedColumns.length >= 2 && requiredGroupHit && coverage >= 0.35 && score >= 45;
    return {
      resource, label: definition.label, confidence: score >= 75 ? 'high' as const : score >= 58 ? 'medium' as const : 'low' as const,
      score, reason, matchedColumns, unclearColumns, accepted,
      matchedRowCount: coherentRowIndexes.length,
      matchedRowNumbers: coherentRowIndexes.map(index => parsed.rowNumbers?.[index] ?? index + 2),
    };
  }).filter(candidate => candidate.accepted).sort((a, b) => b.score - a.score || (a.resource < b.resource ? -1 : a.resource > b.resource ? 1 : 0));

  const moneyResources = new Set<ImportResource>(['euerEntries', 'invoicePayments', 'invoices']);
  return candidates.map(candidate => {
    const overlapRows: Partial<Record<ImportResource, number[]>> = {};
    const overlaps = candidates.filter(other => other.resource !== candidate.resource).map(other => {
        const sharedRows = candidate.matchedRowNumbers.filter(rowNumber => other.matchedRowNumbers.includes(rowNumber));
        const sharedColumns = candidate.matchedColumns.filter(header => other.matchedColumns.includes(header)).length;
        const relevant = sharedRows.length > 0 && (sharedColumns >= 2 || (moneyResources.has(candidate.resource) && moneyResources.has(other.resource) && sharedColumns > 0));
        overlapRows[other.resource] = sharedRows;
        return relevant ? other.resource : null;
      }).filter((resource): resource is ImportResource => Boolean(resource));
    return { ...candidate, overlaps, overlapRows };
  });
}

// ---------------------------------------------------------------------------
// Spaltenformate, feste Werte und Werte-Zuordnung
// ---------------------------------------------------------------------------

export interface ColumnFormat {
  decimal?: ',' | '.';
  order?: 'dmy' | 'mdy';
  /** Kurze Beschreibung für die Oberfläche, z. B. „Zahl 1.234,56“. */
  label: string;
  invalid: number;
  total: number;
}

function columnValues(parsedFile: ParsedImportFile, header: string): ImportCellValue[] {
  return parsedFile.rows
    .map(row => row[header])
    .filter(value => value !== undefined && value !== null && String(value).trim() !== '');
}

/** Erkennt das Format einer zugeordneten Spalte und zählt nicht lesbare Werte. */
export function analyseColumnFormat(parsedFile: ParsedImportFile, header: string, type: ImportFieldType | undefined): ColumnFormat | null {
  if (type !== 'number' && type !== 'date' && type !== 'time') return null;
  const values = columnValues(parsedFile, header);
  if (type === 'number') {
    const { decimal, evidence } = detectNumberFormat(values);
    const invalid = values.filter(value => parseNumber(value, { decimal }) === null).length;
    const onlyNumbers = values.every(value => typeof value === 'number');
    return { decimal, label: onlyNumbers ? 'Zahlen' : evidence > 0 ? `Zahlen im Format ${decimal === ',' ? '1.234,56' : '1,234.56'}` : 'Ganze Zahlen', invalid, total: values.length };
  }
  if (type === 'date') {
    const order = detectDateOrder(values);
    const invalid = values.filter(value => parseDate(value, { order }) === null).length;
    const iso = values.every(value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)));
    return { order, label: iso ? 'Datumswerte' : order === 'mdy' ? 'Datum MM/TT/JJJJ' : 'Datum TT.MM.JJJJ', invalid, total: values.length };
  }
  const invalid = values.filter(value => parseTime(value) === null).length;
  return { label: 'Uhrzeit HH:MM', invalid, total: values.length };
}

/** Unterschiedliche Werte einer Spalte für die Werte-Zuordnung (höchstens `limit`). */
export function distinctColumnValues(parsedFile: ParsedImportFile, header: string, limit = 40): Array<{ value: string; count: number }> {
  const counts = new Map<string, { value: string; count: number }>();
  for (const value of columnValues(parsedFile, header)) {
    const display = String(value).trim();
    const key = normaliseKey(display) || display;
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { value: display, count: 1 });
  }
  return [...counts.values()].sort((left, right) => right.count - left.count).slice(0, limit);
}

export function valueMappingKey(value: unknown): string {
  return normaliseKey(value) || String(value ?? '').trim();
}

export interface ImportMappingOptions {
  definition?: ImportDefinition;
  /** Feste Werte für Felder ohne Spalte bzw. leere Zellen. */
  constants?: Record<string, string>;
  /** Eigene Werte → Auswahlwert, je Feld (z. B. Kategorie „Fahrt“ → travel). */
  valueMappings?: Record<string, Record<string, string>>;
}

function normaliseCell(field: ImportFieldDefinition | undefined, value: ImportCellValue, format: ColumnFormat | null): ImportCellValue {
  if (!field?.type || field.type === 'text' || field.type === 'enum') return typeof value === 'string' ? value.trim() : value;
  if (field.type === 'number') {
    const parsed = parseNumber(value, { decimal: format?.decimal });
    return parsed === null ? String(value).trim() : parsed;
  }
  if (field.type === 'date') {
    const parsed = parseDate(value, { order: format?.order });
    return parsed === null ? String(value).trim() : parsed;
  }
  const parsed = parseTime(value);
  return parsed === null ? String(value).trim() : parsed;
}

/**
 * Überträgt die Zeilen unter den Zielfeldnamen. Mit Felddefinition werden
 * Zahlen und Datumswerte je Spalte einheitlich gelesen, Aufzählungen über die
 * Werte-Zuordnung übersetzt und feste Werte für leere Felder eingesetzt.
 */
export function mapImportRows(parsedFile: ParsedImportFile, mapping: Record<string, string>, options: ImportMappingOptions = {}): Array<Record<string, unknown>> {
  const fields = new Map((options.definition?.fields || []).map(field => [field.key, field]));
  const formats = new Map<string, ColumnFormat | null>();
  if (options.definition) {
    Object.entries(mapping).forEach(([targetField, sourceHeader]) => {
      if (sourceHeader) formats.set(targetField, analyseColumnFormat(parsedFile, sourceHeader, fields.get(targetField)?.type));
    });
  }
  const constants = Object.entries(options.constants || {}).filter(([, value]) => String(value ?? '').trim() !== '');
  return parsedFile.rows.map((row, index) => {
    const mappedRow: Record<string, unknown> = { _rowNumber: parsedFile.rowNumbers?.[index] ?? index + 2 };
    Object.entries(mapping).forEach(([targetField, sourceHeader]) => {
      if (!sourceHeader) return;
      const value = row[sourceHeader];
      if (value === undefined || value === null || String(value).trim() === '') return;
      const field = fields.get(targetField);
      if (field?.type === 'enum') {
        const mapped = options.valueMappings?.[targetField]?.[valueMappingKey(value)];
        mappedRow[targetField] = mapped || String(value).trim();
        return;
      }
      mappedRow[targetField] = options.definition ? normaliseCell(field, value, formats.get(targetField) ?? null) : (typeof value === 'string' ? value.trim() : value);
    });
    for (const [targetField, constant] of constants) {
      if (mappedRow[targetField] !== undefined) continue;
      const field = fields.get(targetField);
      mappedRow[targetField] = field ? normaliseCell(field, constant, field.type === 'number' ? { decimal: ',', label: '', invalid: 0, total: 0 } : null) : constant;
    }
    return mappedRow;
  });
}

// ---------------------------------------------------------------------------
// Datei lesen
// ---------------------------------------------------------------------------

function decodeText(buffer: ArrayBuffer): { text: string; encoding: string } {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8' };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
  } catch {
    // Deutsches Excel speichert „CSV (Trennzeichen-getrennt)“ in Windows-1252.
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'Windows-1252' };
  }
}

async function sha256(buffer: ArrayBuffer): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

const SUMMARY_ROW = /^(summe|gesamt|gesamtsumme|zwischensumme|total|subtotal|saldo|übertrag|uebertrag)\b/i;

/**
 * Wählt die Kopfzeile (erste Zeile mit mindestens zwei befüllten Zellen unter
 * den ersten 20 Zeilen), entfernt leere Spalten und erkennt Summenzeilen.
 */
function tableFromMatrix(matrix: Array<{ rowNumber: number; cells: Array<ImportCellValue | null> }>, warnings: string[]) {
  const filled = (cells: Array<ImportCellValue | null>) => cells.filter(cell => cell !== null && cell !== undefined && String(cell).trim() !== '').length;
  let headerIndex = matrix.slice(0, 20).findIndex(row => filled(row.cells) >= 2);
  if (headerIndex < 0) headerIndex = 0;
  const headerRow = matrix[headerIndex];
  if (!headerRow || matrix.length <= headerIndex + 1) throw new Error('Die Datei benötigt eine Kopfzeile und mindestens eine Datenzeile.');
  if (headerIndex > 0) warnings.push(`Die Kopfzeile wurde in Zeile ${headerRow.rowNumber} erkannt; darüber liegende Zeilen werden nicht importiert.`);
  let sourceRows = matrix.slice(headerIndex + 1);
  const summaryRows = sourceRows.filter(row => {
    const first = row.cells.find(cell => cell !== null && cell !== undefined && String(cell).trim() !== '');
    return typeof first === 'string' && SUMMARY_ROW.test(first.trim());
  });
  if (summaryRows.length > 0) {
    sourceRows = sourceRows.filter(row => !summaryRows.includes(row));
    warnings.push(`${summaryRows.length === 1 ? 'Eine Summenzeile' : `${summaryRows.length} Summenzeilen`} (Zeile ${summaryRows.map(row => row.rowNumber).join(', ')}) ${summaryRows.length === 1 ? 'wird' : 'werden'} nicht importiert.`);
  }
  const hasValue = (index: number) => sourceRows.some(row => {
    const cell = row.cells[index];
    return cell !== null && cell !== undefined && String(cell).trim() !== '';
  });
  const usableIndexes = headerRow.cells
    .map((header, index) => ({ header: String(header ?? '').replace(/^\ufeff/, '').trim(), index }))
    .filter(({ header, index }) => header && hasValue(index))
    .map(({ index }) => index);
  if (usableIndexes.length === 0) throw new Error('Die Datei enthält keine benannten und befüllten Spalten.');
  const headers = uniqueHeaders(usableIndexes.map(index => String(headerRow.cells[index] ?? '')));
  const rows = sourceRows.map(row => Object.fromEntries(headers.map((header, index) => {
    const cell = row.cells[usableIndexes[index]];
    return [header, cell === null || cell === undefined ? '' : cell];
  })) as Record<string, ImportCellValue>);
  return { headers, rows, rowNumbers: sourceRows.map(row => row.rowNumber) };
}

export interface ParseImportOptions {
  /** Tabellenblatt einer Excel-Datei; ohne Angabe das erste mit Daten. */
  sheet?: string;
}

export async function parseImportFile(file: File, options: ParseImportOptions = {}): Promise<ParsedImportFile> {
  if (file.size > MAX_IMPORT_FILE_SIZE) {
    throw new Error('Die Importdatei darf höchstens 10 MB groß sein.');
  }
  const lowerName = file.name.toLocaleLowerCase('de-DE');
  if (lowerName.endsWith('.xls') || lowerName.endsWith('.ods') || lowerName.endsWith('.numbers')) {
    throw new Error('Dieses Tabellenformat wird nicht direkt gelesen. Bitte in Excel oder Numbers als .xlsx oder CSV (UTF-8) speichern.');
  }
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength === 0) throw new Error('Die Importdatei ist leer.');
  const hash = await sha256(buffer);
  const bytes = new Uint8Array(buffer);

  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xlsm') || isZipArchive(bytes)) {
    const sheets = await readXlsx(bytes);
    const withData = sheets.filter(sheet => sheet.rows.length > 1);
    const selected = sheets.find(sheet => sheet.name === options.sheet) || withData[0] || sheets[0];
    const warnings: string[] = [];
    const table = tableFromMatrix(selected.rows.map(row => ({ rowNumber: row.rowNumber, cells: row.cells })), warnings);
    return {
      fileName: file.name,
      format: 'xlsx',
      ...table,
      warnings,
      sheets: sheets.map(sheet => sheet.name),
      sheet: selected.name,
      hash,
    };
  }

  const { text, encoding } = decodeText(buffer);
  if (!text.trim()) throw new Error('Die Importdatei ist leer.');
  const encodingWarnings = encoding === 'Windows-1252' ? ['Die Datei ist nicht in UTF-8 gespeichert; Umlaute wurden als Windows-Zeichensatz (Excel) gelesen.'] : [];

  if (lowerName.endsWith('.json')) {
    try {
      const parsed = parseJson(text);
      return { fileName: file.name, format: 'json', ...parsed, warnings: encodingWarnings, encoding, hash };
    } catch {
      throw new Error('Die JSON-Datei konnte nicht gelesen werden.');
    }
  }

  const delimiter = detectDelimiter(text);
  const matrix = parseDelimited(text, delimiter).map(row => ({ rowNumber: row.lineNumber, cells: row.values as Array<ImportCellValue | null> }));
  if (matrix.length < 2) throw new Error('Die Datei benötigt eine Kopfzeile und mindestens eine Datenzeile.');
  const warnings = [...encodingWarnings];
  if (delimiter === '|') warnings.push('Das Trennzeichen „|“ wurde automatisch erkannt.');
  const table = tableFromMatrix(matrix, warnings);
  return {
    fileName: file.name,
    format: delimiter === '\t' ? 'tsv' : 'csv',
    headers: table.headers,
    rows: table.rows as Array<Record<string, string>>,
    rowNumbers: table.rowNumbers,
    warnings,
    encoding,
    hash,
  };
}

// ---------------------------------------------------------------------------
// Vorlagen und Fehlerlisten
// ---------------------------------------------------------------------------

/** CSV-Vorlage mit den wichtigsten Spalten und einer Beispielzeile. */
export function buildImportTemplate(definition: ImportDefinition): string {
  const fields = definition.fields.filter(field => field.required || field.template);
  const example = Object.fromEntries(fields.map(field => [field.key, field.example ?? '']));
  return buildCsv([example], fields.map(field => ({ header: field.label, value: (row: Record<string, string>) => row[field.key] })));
}

/**
 * Zeilen mit Fehlern, Warnungen oder Duplikaten in ihrer ursprünglichen Form
 * samt Hinweis. Die Datei kann korrigiert und erneut importiert werden.
 */
export function buildIssueList(parsedFile: ParsedImportFile, rows: ImportRowResult[], statuses: string[] = ['error', 'warning', 'duplicate']): string {
  const byNumber = new Map<number, Record<string, ImportCellValue>>();
  parsedFile.rows.forEach((row, index) => byNumber.set(parsedFile.rowNumbers?.[index] ?? index + 2, row));
  const statusLabels: Record<string, string> = { error: 'Fehler', warning: 'Warnung', duplicate: 'Duplikat', valid: 'Bereit', update: 'Aktualisierung', imported: 'Importiert' };
  const issues = rows.filter(row => statuses.includes(row.status));
  const columns: CsvColumn<ImportRowResult>[] = [
    { header: 'Zeile', value: row => row.rowNumber },
    { header: 'Status', value: row => statusLabels[row.status] || row.status },
    { header: 'Hinweis', value: row => row.message },
    ...parsedFile.headers.map(header => ({ header, value: (row: ImportRowResult) => byNumber.get(row.rowNumber)?.[header] ?? '' })),
  ];
  return buildCsv(issues, columns);
}

/** Vergleichsschlüssel der Spaltenüberschriften, um frühere Zuordnungen wiederzufinden. */
export function headerSignature(headers: string[]): string {
  return headers.map(normaliseKey).filter(Boolean).sort().join('|');
}
