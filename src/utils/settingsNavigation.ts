/**
 * Informationsarchitektur der Einstellungen.
 *
 * Die Bereichs-IDs sind die bisherigen Reiter-IDs und Teil der URL
 * (`#settings/<bereich>` bzw. `?settingsTab=<bereich>`). Sie dürfen sich nicht
 * ändern, damit alte Lesezeichen und Verweise aus anderen Seiten weiter
 * funktionieren. Bezeichnung, Gruppe und Reihenfolge sind frei.
 */
export const SETTINGS_AREAS = ['app', 'general', 'invoices', 'appearance', 'system', 'extensions', 'taxes'] as const;
export type SettingsArea = typeof SETTINGS_AREAS[number];

/** Ohne gültigen Bereich öffnen die Einstellungen die Firmendaten. */
export const DEFAULT_SETTINGS_AREA: SettingsArea = 'general';

export interface SettingsSectionDefinition {
  id: string;
  title: string;
  /** Zusätzliche Suchbegriffe, kleingeschrieben. */
  keywords: string[];
}

export interface SettingsAreaDefinition {
  id: SettingsArea;
  label: string;
  description: string;
  sections: SettingsSectionDefinition[];
}

export interface SettingsGroupDefinition {
  id: string;
  label: string;
  areas: SettingsArea[];
}

export const SETTINGS_AREA_DEFINITIONS: Record<SettingsArea, SettingsAreaDefinition> = {
  general: {
    id: 'general',
    label: 'Firmendaten',
    description: 'Name, Anschrift, steuerliche Angaben und Kontakt – so erscheinen Sie auf Ihren Dokumenten.',
    sections: [
      { id: 'stammdaten', title: 'Stammdaten', keywords: ['firma', 'firmenname', 'name', 'adresse', 'anschrift', 'straße', 'postleitzahl', 'plz', 'stadt', 'ort', 'land'] },
      { id: 'steuerangaben', title: 'Steuerliche Angaben', keywords: ['ust-idnr', 'umsatzsteuer-id', 'steuernummer', 'betriebsart', 'rechtsform', 'kleinunternehmer', '§ 19', 'ustg', 'gmbh', 'einzelunternehmen'] },
      { id: 'kontakt', title: 'Kontaktdaten', keywords: ['e-mail', 'email', 'telefon', 'website', 'internet'] },
      { id: 'logo', title: 'Logo & Icon', keywords: ['logo', 'icon', 'favicon', 'bild', 'hochladen'] },
    ],
  },
  invoices: {
    id: 'invoices',
    label: 'Rechnungen & Zahlung',
    description: 'Bankverbindung, Zahlungsbedingungen und Nummernkreise für Rechnungen und Gutschriften.',
    sections: [
      { id: 'bankverbindung', title: 'Bankverbindung', keywords: ['iban', 'bic', 'bank', 'bankname', 'kontoinhaber', 'konto', 'zahlungsinformationen'] },
      { id: 'zahlungsbedingungen', title: 'Zahlungsbedingungen', keywords: ['zahlungsziel', 'fällig', 'sofortzahlung', 'klausel', 'zahlungsarten', 'paypal', 'überweisung', 'verzugszinsen'] },
      { id: 'nummernkreise', title: 'Nummernkreise', keywords: ['rechnungsnummer', 'gutschrift', 'muster', 'startnummer', 'jahr', 'fortlaufend', 'zähler', 'nummer'] },
      { id: 'erechnung', title: 'eRechnung & Vorlagen', keywords: ['erechnung', 'e-rechnung', 'zugferd', 'xrechnung', 'leitweg', 'vorlagen', 'pdf', 'layout', 'dokumentvorlagen'] },
    ],
  },
  app: {
    id: 'app',
    label: 'Module & Begriffe',
    description: 'Welche Bereiche SoloOffice zeigt und welche Begriffe es für Ihre Arbeit verwendet.',
    sections: [
      { id: 'einrichtung', title: 'Ersteinrichtung', keywords: ['allgemein', 'einrichtung', 'assistent', 'demo', 'testdaten'] },
      { id: 'module', title: 'Module', keywords: ['allgemein', 'aufträge', 'kurse', 'reporting', 'auswertungen', 'angebote', 'rabatt', 'funktionen'] },
      { id: 'begriffe', title: 'Begriffe & Fachsprache', keywords: ['terminologie', 'fachsprache', 'branche', 'belege', 'belegbereich', 'bezeichnung', 'kunden', 'teilnehmer'] },
      { id: 'standardwerte', title: 'Standardwerte', keywords: ['zurücksetzen', 'standard', 'reset'] },
    ],
  },
  extensions: {
    id: 'extensions',
    label: 'Erweiterungen',
    description: 'Zusätzliche Bereiche für dieses Unternehmen aktivieren.',
    sections: [
      { id: 'verfuegbar', title: 'Verfügbare Erweiterungen', keywords: ['erweiterung', 'aktivieren', 'steuern', 'abgaben', 'module'] },
    ],
  },
  taxes: {
    id: 'taxes',
    label: 'Steuern & Abgaben',
    description: 'Freiwilliges Steuerprofil als Grundlage für unverbindliche Schätzungen.',
    sections: [
      { id: 'steuerprofil', title: 'Steuerprofil', keywords: ['steuerjahr', 'umsatzsteuer', 'voranmeldung', 'krankenversicherung', 'rentenversicherung', 'kirchensteuer', 'vorauszahlung', 'gewerbesteuer', 'hebesatz', 'kammer', 'ksk', 'bundesland', 'kinder'] },
    ],
  },
  appearance: {
    id: 'appearance',
    label: 'Darstellung & Sprache',
    description: 'Sprache, Formate, Farben und das Erscheinungsbild der App-Oberfläche.',
    sections: [
      { id: 'sprache', title: 'Sprache & Formate', keywords: ['sprache', 'zahlenformat', 'währung', 'euro', 'datum', 'datumsformat', 'zeitformat', 'zeitzone', 'locale'] },
      { id: 'erscheinungsbild', title: 'Erscheinungsbild', keywords: ['dunkel', 'hell', 'dark mode', 'dunkelmodus', 'theme', 'animationen', 'bewegung'] },
      { id: 'farbschema', title: 'Farbschema', keywords: ['farbe', 'farben', 'primärfarbe', 'sekundärfarbe', 'akzent'] },
    ],
  },
  system: {
    id: 'system',
    label: 'E-Mail & Backup',
    description: 'E-Mail-Versand, Datensicherung und Datenübernahme.',
    sections: [
      { id: 'email', title: 'E-Mail-Versand', keywords: ['smtp', 'mail', 'postausgang', 'benachrichtigungen', 'absender', 'testmail', 'test-e-mail', 'kopie', 'passwort', 'versand'] },
      { id: 'sicherung', title: 'Datensicherung', keywords: ['backup', 'sicherung', 'zip', 'json', 'wiederherstellen', 'export'] },
      { id: 'datenuebernahme', title: 'Datenübernahme', keywords: ['import', 'übernahme', 'migration', 'csv'] },
    ],
  },
};

export const SETTINGS_GROUPS: SettingsGroupDefinition[] = [
  { id: 'company', label: 'Unternehmen', areas: ['general', 'invoices'] },
  { id: 'work', label: 'Arbeitsweise', areas: ['app', 'extensions', 'taxes'] },
  { id: 'interface', label: 'Oberfläche', areas: ['appearance'] },
  { id: 'system', label: 'System', areas: ['system'] },
];

export function isSettingsArea(value: unknown): value is SettingsArea {
  return typeof value === 'string' && (SETTINGS_AREAS as readonly string[]).includes(value);
}

export function normalizeSettingsArea(value: unknown): SettingsArea {
  return isSettingsArea(value) ? value : DEFAULT_SETTINGS_AREA;
}

/** Bereiche in der Reihenfolge der Seitennavigation. */
export function orderedSettingsAreas(): SettingsArea[] {
  return SETTINGS_GROUPS.flatMap(group => group.areas);
}

export function findSettingsSection(area: SettingsArea, sectionId: string | undefined): SettingsSectionDefinition | undefined {
  if (!sectionId) return undefined;
  return SETTINGS_AREA_DEFINITIONS[area].sections.find(section => section.id === sectionId);
}

/** DOM-ID eines Abschnitts, Ziel für Suche und Deep-Links. */
export function settingsSectionElementId(sectionId: string): string {
  return `settings-section-${sectionId}`;
}

/**
 * Welche Firmenfelder in welchem Bereich bearbeitet werden. Grundlage für die
 * Markierung „ungespeichert“ in der Navigation und in der Speicherleiste.
 */
const COMPANY_FIELD_AREAS: Record<string, SettingsArea> = {
  name: 'general',
  address: 'general',
  postalCode: 'general',
  city: 'general',
  country: 'general',
  taxId: 'general',
  taxIdentificationNumber: 'general',
  taxBusinessType: 'general',
  legalForm: 'general',
  isSmallBusiness: 'general',
  email: 'general',
  phone: 'general',
  website: 'general',
  logo: 'general',
  icon: 'general',
  paymentInformation: 'invoices',
  paymentInformationMode: 'invoices',
  bankAccount: 'invoices',
  bic: 'invoices',
  defaultPaymentDays: 'invoices',
  immediatePaymentClause: 'invoices',
  invoiceStartNumber: 'invoices',
  invoiceNumberPattern: 'invoices',
  creditNoteNumberPattern: 'invoices',
  terminologyProfile: 'app',
  receiptLabel: 'app',
  jobTrackingEnabled: 'app',
  reportingEnabled: 'app',
  quotesEnabled: 'app',
  discountsEnabled: 'app',
  terminologyColorSource: 'appearance',
  primaryColor: 'appearance',
  secondaryColor: 'appearance',
  themeMode: 'appearance',
  locale: 'appearance',
  numberFormat: 'appearance',
  currency: 'appearance',
  dateFormat: 'appearance',
  timeFormat: 'appearance',
  timeZone: 'appearance',
};

export function settingsAreaForCompanyField(field: string): SettingsArea | undefined {
  return COMPANY_FIELD_AREAS[field];
}

/** Feldnamen, deren Wert sich zwischen gespeichertem und bearbeitetem Stand unterscheidet. */
export function changedFields(saved: object, edited: object): string[] {
  const savedRecord = saved as Record<string, unknown>;
  const editedRecord = edited as Record<string, unknown>;
  const keys = new Set([...Object.keys(savedRecord), ...Object.keys(editedRecord)]);
  return [...keys].filter(key => JSON.stringify(savedRecord[key] ?? null) !== JSON.stringify(editedRecord[key] ?? null));
}

/** Bereiche mit ungespeicherten Änderungen, in Navigationsreihenfolge. */
export function dirtySettingsAreas(saved: object, edited: object): SettingsArea[] {
  const areas = new Set<SettingsArea>();
  for (const field of changedFields(saved, edited)) {
    const area = settingsAreaForCompanyField(field);
    if (area) areas.add(area);
  }
  return orderedSettingsAreas().filter(area => areas.has(area));
}
