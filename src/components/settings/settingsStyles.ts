export const DEFAULT_INVOICE_NUMBER_PATTERN = 'RE-{YYYY}-{NNN}';
export const DEFAULT_CREDIT_NOTE_NUMBER_PATTERN = 'GS-{YYYY}-{NNN}';

/** Eingabefelder der Einstellungen; Höhe kommt aus `form-consistent-fields`. */
export const settingsInputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-custom disabled:cursor-not-allowed disabled:bg-gray-100';

/** Auswahlkarte (Radio-artig) im Stil der Fachsprachen-Auswahl. */
export function choiceCardClass(selected: boolean): string {
  return `settings-choice h-full min-h-0 rounded-lg border p-3 text-left transition ${selected
    ? 'settings-choice-selected border-primary-custom bg-primary-custom/10'
    : 'border-gray-200 bg-white hover:border-primary-custom/50'}`;
}
