import type { TerminologyProfile } from '../types';

export interface TerminologyDefinition {
  id: TerminologyProfile;
  label: string;
  description: string;
  preview?: {
    accent: string;
    secondary: string;
    accentSoft: string;
    accentWash: string;
  };
  entity: {
    navLabel: string;
    singular: string;
    plural: string;
    genitive: string;
    accusative: string;
    dative: string;
    numberLabel: string;
    numberShortLabel: string;
    managementLabel: string;
    dataLabel: string;
    newLabel: string;
    editLabel: string;
    deleteLabel: string;
    searchPlaceholder: string;
    noResults: string;
    createLabel: string;
    specificLabel: string;
    specificOptionLabel: string;
    addressLabel: string;
    signatureLabel: string;
    emailMissingMessage: string;
  };
  work: {
    navLabel: string;
    singular: string;
    plural: string;
    numberLabel: string;
    numberShortLabel: string;
    managementLabel: string;
    searchPlaceholder: string;
    noResults: string;
    newLabel: string;
    editLabel: string;
    deleteLabel: string;
    descriptionLabel: string;
    confirmationLabel: string;
    confirmationPluralLabel: string;
  };
  organization: {
    dataLabel: string;
    nameLabel: string;
    nameInDativeLabel: string;
    logoLabel: string;
    iconLabel: string;
  };
}

const profileDefinitions: Record<TerminologyProfile, TerminologyDefinition> = {
  customers: {
    id: 'customers',
    label: 'Kunden',
    description: 'Klassische Kunden- und Auftraggeberbeziehungen',
    entity: {
      navLabel: 'Kunden', singular: 'Kunde', plural: 'Kunden', genitive: 'Kunden', accusative: 'Kunden', dative: 'Kunden', numberLabel: 'Kundennummer', numberShortLabel: 'Kunden-Nr.',
      managementLabel: 'Kundenverwaltung', dataLabel: 'Kundendaten', newLabel: 'Neuer Kunde', editLabel: 'Kunde bearbeiten', deleteLabel: 'Kunden löschen',
      searchPlaceholder: 'Kunden suchen...', noResults: 'Keine Kunden gefunden', createLabel: 'Kunde erstellen', specificLabel: 'kundenspezifische', specificOptionLabel: 'Kundenspezifisch', addressLabel: 'Kundenanschrift', signatureLabel: 'Kundenunterschrift',
      emailMissingMessage: 'Kunde hat keine E-Mail-Adresse hinterlegt.',
    },
    work: {
      navLabel: 'Aufträge', singular: 'Auftrag', plural: 'Aufträge', numberLabel: 'Auftragsnummer', numberShortLabel: 'Auftrags-Nr.', managementLabel: 'Auftragsmanagement',
      searchPlaceholder: 'Aufträge suchen...', noResults: 'Keine Aufträge gefunden', newLabel: 'Neuer Auftrag', editLabel: 'Auftrag bearbeiten', deleteLabel: 'Auftrag löschen',
      descriptionLabel: 'Auftragsbeschreibung', confirmationLabel: 'Auftragsbestätigung', confirmationPluralLabel: 'Auftragsbestätigungen',
    },
    organization: { dataLabel: 'Firmendaten', nameLabel: 'Firmenname', nameInDativeLabel: 'Firmennamen', logoLabel: 'Firmenlogo', iconLabel: 'Firmen-Icon' },
  },
  mandants: {
    id: 'mandants',
    label: 'Mandanten',
    description: 'Mandantenverwaltung für Kanzleien und beratende Berufe',
    entity: {
      navLabel: 'Mandanten', singular: 'Mandant', plural: 'Mandanten', genitive: 'Mandanten', accusative: 'Mandanten', dative: 'Mandanten', numberLabel: 'Mandantennummer', numberShortLabel: 'Mandanten-Nr.',
      managementLabel: 'Mandantenverwaltung', dataLabel: 'Mandantendaten', newLabel: 'Neuer Mandant', editLabel: 'Mandant bearbeiten', deleteLabel: 'Mandanten löschen',
      searchPlaceholder: 'Mandanten suchen...', noResults: 'Keine Mandanten gefunden', createLabel: 'Mandant erstellen', specificLabel: 'mandantenspezifische', specificOptionLabel: 'Mandantenspezifisch', addressLabel: 'Mandantenanschrift', signatureLabel: 'Mandantenunterschrift',
      emailMissingMessage: 'Mandant hat keine E-Mail-Adresse hinterlegt.',
    },
    work: {
      navLabel: 'Mandate', singular: 'Mandat', plural: 'Mandate', numberLabel: 'Mandatsnummer', numberShortLabel: 'Mandats-Nr.', managementLabel: 'Mandatsverwaltung',
      searchPlaceholder: 'Mandate suchen...', noResults: 'Keine Mandate gefunden', newLabel: 'Neues Mandat', editLabel: 'Mandat bearbeiten', deleteLabel: 'Mandat löschen',
      descriptionLabel: 'Mandatsbeschreibung', confirmationLabel: 'Mandatsbestätigung', confirmationPluralLabel: 'Mandatsbestätigungen',
    },
    organization: { dataLabel: 'Kanzleidaten', nameLabel: 'Kanzleiname', nameInDativeLabel: 'Kanzleinamen', logoLabel: 'Kanzleilogo', iconLabel: 'Kanzlei-Icon' },
  },
  patients: {
    id: 'patients',
    label: 'Patienten',
    description: 'Patienten- und Behandlungsverwaltung für Praxen',
    entity: {
      navLabel: 'Patienten', singular: 'Patient', plural: 'Patienten', genitive: 'Patienten', accusative: 'Patienten', dative: 'Patienten', numberLabel: 'Patientennummer', numberShortLabel: 'Patienten-Nr.',
      managementLabel: 'Patientenverwaltung', dataLabel: 'Patientendaten', newLabel: 'Neuer Patient', editLabel: 'Patient bearbeiten', deleteLabel: 'Patienten löschen',
      searchPlaceholder: 'Patienten suchen...', noResults: 'Keine Patienten gefunden', createLabel: 'Patient erstellen', specificLabel: 'patientenspezifische', specificOptionLabel: 'Patientenspezifisch', addressLabel: 'Patientenanschrift', signatureLabel: 'Patientenunterschrift',
      emailMissingMessage: 'Patient hat keine E-Mail-Adresse hinterlegt.',
    },
    work: {
      navLabel: 'Behandlungen', singular: 'Behandlung', plural: 'Behandlungen', numberLabel: 'Behandlungsnummer', numberShortLabel: 'Behandlungs-Nr.', managementLabel: 'Behandlungsverwaltung',
      searchPlaceholder: 'Behandlungen suchen...', noResults: 'Keine Behandlungen gefunden', newLabel: 'Neue Behandlung', editLabel: 'Behandlung bearbeiten', deleteLabel: 'Behandlung löschen',
      descriptionLabel: 'Behandlungsbeschreibung', confirmationLabel: 'Behandlungsbestätigung', confirmationPluralLabel: 'Behandlungsbestätigungen',
    },
    organization: { dataLabel: 'Praxisdaten', nameLabel: 'Praxisname', nameInDativeLabel: 'Praxisnamen', logoLabel: 'Praxislogo', iconLabel: 'Praxis-Icon' },
  },
  students: {
    id: 'students',
    label: 'Schüler / Träger',
    description: 'Schüler-, Kurs- und Trägerverwaltung für Bildungseinrichtungen',
    entity: {
      navLabel: 'Schüler / Träger', singular: 'Schüler / Träger', plural: 'Schüler / Träger', genitive: 'Schüler-/Träger', accusative: 'Schüler / Träger', dative: 'Schüler / Träger', numberLabel: 'Schüler-/Trägernummer', numberShortLabel: 'Schüler-/Träger-Nr.',
      managementLabel: 'Schüler-/Trägerverwaltung', dataLabel: 'Schüler-/Trägerdaten', newLabel: 'Neuer Schüler / neuer Träger', editLabel: 'Schüler / Träger bearbeiten', deleteLabel: 'Schüler / Träger löschen',
      searchPlaceholder: 'Schüler / Träger suchen...', noResults: 'Keine Schüler oder Träger gefunden', createLabel: 'Schüler / Träger erstellen', specificLabel: 'schüler-/trägerspezifische', specificOptionLabel: 'Schüler-/Trägerspezifisch', addressLabel: 'Anschrift', signatureLabel: 'Unterschrift',
      emailMissingMessage: 'Für diesen Schüler bzw. Träger ist keine E-Mail-Adresse hinterlegt.',
    },
    work: {
      navLabel: 'Unterricht / Kurse', singular: 'Unterricht / Kurs', plural: 'Unterricht / Kurse', numberLabel: 'Kursnummer', numberShortLabel: 'Kurs-Nr.', managementLabel: 'Unterrichtsverwaltung',
      searchPlaceholder: 'Unterricht und Kurse suchen...', noResults: 'Kein Unterricht und keine Kurse gefunden', newLabel: 'Neuer Kurs', editLabel: 'Unterricht / Kurs bearbeiten', deleteLabel: 'Unterricht / Kurs löschen',
      descriptionLabel: 'Unterrichts-/Kursbeschreibung', confirmationLabel: 'Kursbestätigung', confirmationPluralLabel: 'Kursbestätigungen',
    },
    organization: { dataLabel: 'Einrichtungsdaten', nameLabel: 'Einrichtungsname', nameInDativeLabel: 'Einrichtungsnamen', logoLabel: 'Einrichtungslogo', iconLabel: 'Einrichtungs-Icon' },
  },
  clients: {
    id: 'clients',
    label: 'Klienten',
    description: 'Klienten- und Beratungsverwaltung für soziale und beratende Angebote',
    entity: {
      navLabel: 'Klienten', singular: 'Klient', plural: 'Klienten', genitive: 'Klienten', accusative: 'Klienten', dative: 'Klienten', numberLabel: 'Klientennummer', numberShortLabel: 'Klienten-Nr.',
      managementLabel: 'Klientenverwaltung', dataLabel: 'Klientendaten', newLabel: 'Neuer Klient', editLabel: 'Klient bearbeiten', deleteLabel: 'Klienten löschen',
      searchPlaceholder: 'Klienten suchen...', noResults: 'Keine Klienten gefunden', createLabel: 'Klient erstellen', specificLabel: 'klientenspezifische', specificOptionLabel: 'Klientenspezifisch', addressLabel: 'Klientenanschrift', signatureLabel: 'Klientenunterschrift',
      emailMissingMessage: 'Klient hat keine E-Mail-Adresse hinterlegt.',
    },
    work: {
      navLabel: 'Beratungen', singular: 'Beratung', plural: 'Beratungen', numberLabel: 'Beratungsnummer', numberShortLabel: 'Beratungs-Nr.', managementLabel: 'Beratungsverwaltung',
      searchPlaceholder: 'Beratungen suchen...', noResults: 'Keine Beratungen gefunden', newLabel: 'Neue Beratung', editLabel: 'Beratung bearbeiten', deleteLabel: 'Beratung löschen',
      descriptionLabel: 'Beratungsbeschreibung', confirmationLabel: 'Beratungsbestätigung', confirmationPluralLabel: 'Beratungsbestätigungen',
    },
    organization: { dataLabel: 'Meine Daten', nameLabel: 'Mein Name', nameInDativeLabel: 'eigenen Namen', logoLabel: 'Mein Logo', iconLabel: 'Mein Icon' },
  },
};

const profilePreviewColors: Record<TerminologyProfile, NonNullable<TerminologyDefinition['preview']>> = {
  customers: { accent: '#2563eb', secondary: '#64748b', accentSoft: '#dbeafe', accentWash: '#eff6ff' },
  mandants: { accent: '#7c3aed', secondary: '#6d5bbd', accentSoft: '#ede9fe', accentWash: '#f5f3ff' },
  patients: { accent: '#0f9f9a', secondary: '#4b7f7b', accentSoft: '#ccfbf1', accentWash: '#f0fdfa' },
  students: { accent: '#f97316', secondary: '#b45309', accentSoft: '#ffedd5', accentWash: '#fff7ed' },
  clients: { accent: '#db3764', secondary: '#9f365c', accentSoft: '#fce7f3', accentWash: '#fff1f2' },
};

export const terminologyProfiles = Object.values(profileDefinitions).map(profile => ({
  ...profile,
  preview: profilePreviewColors[profile.id],
}));

export function getTerminology(profile?: string | null): TerminologyDefinition {
  if (profile && profile in profileDefinitions) {
    return profileDefinitions[profile as TerminologyProfile];
  }
  return profileDefinitions.customers;
}
