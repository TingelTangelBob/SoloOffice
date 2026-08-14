const COUNTER_TOKEN = /\{N{1,8}\}/g;
const ALLOWED_TOKEN = /\{(?:YYYY|YY|MM|N{1,8})\}/g;

export function validateInvoiceNumberPattern(pattern: string): string | null {
  const value = pattern.trim();
  if (!value || value.length > 50) return 'Das Muster muss 1 bis 50 Zeichen lang sein.';
  if ((value.match(COUNTER_TOKEN) || []).length !== 1) return 'Das Muster muss genau einen Nummernplatzhalter wie {NNN} enthalten.';
  if (value.replace(ALLOWED_TOKEN, '').includes('{') || value.replace(ALLOWED_TOKEN, '').includes('}')) {
    return 'Das Muster enthält einen unbekannten Platzhalter.';
  }
  if (/[\r\n\t]/.test(value)) return 'Das Muster darf keine Steuerzeichen enthalten.';
  return null;
}

export function formatInvoiceNumberPattern(pattern: string, date: Date, counter: number): string {
  return pattern.trim()
    .replace(/\{YYYY\}/g, String(date.getFullYear()))
    .replace(/\{YY\}/g, String(date.getFullYear()).slice(-2))
    .replace(/\{MM\}/g, String(date.getMonth() + 1).padStart(2, '0'))
    .replace(/\{(N{1,8})\}/g, (_token, width: string) => String(counter).padStart(width.length, '0'));
}
