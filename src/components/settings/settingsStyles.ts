export const DEFAULT_INVOICE_NUMBER_PATTERN = 'RE-{YYYY}-{NNN}';
export const DEFAULT_CREDIT_NOTE_NUMBER_PATTERN = 'GS-{YYYY}-{NNN}';

/** Eingabefelder der Einstellungen nutzen den gemeinsamen Feldstandard. */
export const settingsInputClass = 'form-input';

/** Auswahlkarte (Radio-artig) im Stil der Fachsprachen-Auswahl. */
export function choiceCardClass(selected: boolean): string {
  return `settings-choice h-full min-h-0 rounded-lg border p-3 text-left transition ${selected
    ? 'settings-choice-selected border-primary-custom bg-primary-custom/10'
    : 'border-gray-200 bg-white hover:border-primary-custom/50'}`;
}
