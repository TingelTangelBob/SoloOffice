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
