import type { HelpCategory, HelpCategoryId } from './types.js';

export const HELP_CATEGORIES: HelpCategory[] = [
  { id: 'erste-schritte', title: 'Erste Schritte', description: 'Einrichten und die erste Rechnung schreiben.', icon: 'Rocket' },
  { id: 'kunden-angebote', title: 'Kunden und Angebote', description: 'Kunden verwalten, Angebote erstellen und in Rechnungen übernehmen.', icon: 'Users' },
  { id: 'auftraege-kalender', title: 'Aufträge und Kalender', description: 'Arbeit planen, Termine eintragen und abrechnen.', icon: 'CalendarDays' },
  { id: 'rechnungen', title: 'Rechnungen', description: 'Rechnungen schreiben, versenden, korrigieren und als E-Rechnung ausgeben.', icon: 'FileText' },
  { id: 'mahnungen-zahlungen', title: 'Mahnungen und Zahlungen', description: 'Zahlungseingänge erfassen und überfällige Rechnungen nachfassen.', icon: 'Wallet' },
  { id: 'belege-ausgaben', title: 'Belege und Ausgaben', description: 'Belege ablegen, Ausgaben erfassen und Eingangsrechnungen prüfen.', icon: 'Receipt' },
  { id: 'steuern', title: 'Steuern und EÜR', description: 'Einnahmen und Ausgaben, Umsatzsteuer und Unterlagen für die Steuer.', icon: 'Calculator' },
  { id: 'daten-import', title: 'Datenübernahme und Import', description: 'Kunden und Rechnungen aus anderen Programmen oder Dateien übernehmen.', icon: 'Upload' },
  { id: 'einstellungen-konto', title: 'Einstellungen und Konto', description: 'Firmendaten, Module, Benutzer und Sicherung.', icon: 'Settings' },
  { id: 'begriffe', title: 'Begriffe erklärt', description: 'Fachwörter rund um Rechnung und Buchführung in einfachen Worten.', icon: 'BookOpen' },
];

export function getCategory(id: string): HelpCategory | undefined {
  return HELP_CATEGORIES.find(category => category.id === id);
}

export const HELP_CATEGORY_IDS: HelpCategoryId[] = HELP_CATEGORIES.map(category => category.id);
