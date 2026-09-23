const NUMBER_TOKEN_PATTERN = /\{N{1,8}\}/g;
const ALLOWED_NUMBER_TOKEN_PATTERN = /\{(?:YYYY|YY|MM|N{1,8})\}/g;

export function numberPatternError(pattern) {
  const value = String(pattern || '').trim();
  if (!value || value.length > 50) return 'Das Nummernmuster muss 1 bis 50 Zeichen lang sein.';
  if ((value.match(NUMBER_TOKEN_PATTERN) || []).length !== 1) return 'Das Nummernmuster muss genau einen Zähler wie {NNN} enthalten.';
  if (/[{}\r\n\t]/.test(value.replace(ALLOWED_NUMBER_TOKEN_PATTERN, ''))) return 'Das Nummernmuster enthält einen unbekannten Platzhalter.';
  return null;
}

export function invoiceDateParts(value) {
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  return { year: Number(match[1]), month: match[2] };
}

export function formatNumberPattern(pattern, date, counter) {
  return pattern.trim()
    .replace(/\{YYYY\}/g, String(date.year))
    .replace(/\{YY\}/g, String(date.year).slice(-2))
    .replace(/\{MM\}/g, date.month)
    .replace(/\{(N{1,8})\}/g, (_token, width) => String(counter).padStart(width.length, '0'));
}

export function counterMatcher(pattern, date) {
  const tokenPattern = /\{(?:YYYY|YY|MM|N{1,8})\}/g;
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let source = '^';
  let cursor = 0;
  for (const match of pattern.matchAll(tokenPattern)) {
    source += escape(pattern.slice(cursor, match.index));
    if (/^\{N/.test(match[0])) source += '(\\d+)';
    else if (match[0] === '{YYYY}') source += String(date.year);
    else if (match[0] === '{YY}') source += String(date.year).slice(-2);
    else if (match[0] === '{MM}') source += date.month;
    cursor = match.index + match[0].length;
  }
  source += `${escape(pattern.slice(cursor))}$`;
  return new RegExp(source);
}

/**
 * Zähler aus Nummern, die nicht zum aktuellen Muster passen, etwa nach einem
 * Musterwechsel oder bei übernommenen Rechnungen. Jahreszahlen gehören nicht
 * zum Zähler („R20250042“ → 42, „17/2025“ → 17); unplausibel große Werte
 * werden ignoriert, damit eine fremde Nummer den Nummernkreis nicht sprengt.
 */
export function legacyCounter(number, year) {
  const groups = String(number || '').match(/\d+/g);
  if (!groups) return null;
  const yearText = String(year);
  let digits = groups[groups.length - 1];
  if (digits === yearText) {
    if (groups.length < 2) return null;
    digits = groups[groups.length - 2];
  } else if (digits.length > 4 && digits.startsWith(yearText)) {
    digits = digits.slice(4);
  }
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 999999 || String(value) === yearText) return null;
  return value;
}
