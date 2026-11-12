export interface InlineSegment {
  text: string;
  bold: boolean;
}

/**
 * Zerlegt Fließtext an `**fett**`. Eine nicht geschlossene Auszeichnung bleibt
 * als Text erhalten, damit nichts verschwindet.
 */
export function parseInline(text: string): InlineSegment[] {
  const parts = text.split('**');
  if (parts.length % 2 === 0) return [{ text, bold: false }];
  return parts
    .map((part, index) => ({ text: part, bold: index % 2 === 1 }))
    .filter(segment => segment.text.length > 0);
}

/** Text ohne Auszeichnung, für Suche und Vorschau. */
export function stripInline(text: string): string {
  return text.split('**').join('');
}
