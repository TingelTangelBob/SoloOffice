// Gemeinsame, browserfähige Werteerkennung für Importe. Server, Demo-Modus und
// Importassistent lesen Zahlen, Datumswerte und Aufzählungen damit identisch.
// Das Modul hat keine Abhängigkeiten und keine Seiteneffekte.

export function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

// Umlaute werden vor dem Entfernen der Akzente umgeschrieben, damit „Müller“
// und „Mueller“ sowie „Büro“ und „Buero“ denselben Schlüssel erhalten.
export function normaliseKey(value) {
  return text(value)
    .toLocaleLowerCase('de-DE')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Liefert den ersten befüllten Wert unter einem der Namen (exakt, dann normalisiert). */
export function pick(row, names) {
  if (!row || typeof row !== 'object') return undefined;
  const candidates = Array.isArray(names) ? names : [names];
  for (const name of candidates) {
    const value = row[name];
    if (value !== undefined && value !== null && text(value) !== '') return value;
  }
  const normalisedEntries = Object.entries(row).map(([key, value]) => [normaliseKey(key), value]);
  for (const name of candidates) {
    const wanted = normaliseKey(name);
    const found = normalisedEntries.find(([key, value]) => key === wanted && value !== undefined && value !== null && text(value) !== '');
    if (found) return found[1];
  }
  return undefined;
}

const MINUS_SIGNS = /[\u2212\u2012\u2013\u2014\ufe63\uff0d]/g;

/**
 * Erkennt das Dezimaltrennzeichen einer Spalte. Ein Komma mit ein bis zwei
 * Nachkommastellen („10,00“) spricht für deutsches Format, ein Punkt mit ein
 * bis zwei Nachkommastellen („10.5“) für englisches. Ohne eindeutigen Hinweis
 * gilt das deutsche Format.
 */
export function detectNumberFormat(values) {
  let comma = 0;
  let dot = 0;
  for (const raw of values || []) {
    if (typeof raw === 'number') continue;
    const value = text(raw).replace(MINUS_SIGNS, '-').replace(/[\s\u00a0\u202f']/g, '');
    if (!value) continue;
    if (/\d\.\d{3},\d/.test(value) || /\d,\d{1,2}(?!\d)/.test(value)) comma += 1;
    if (/\d,\d{3}\.\d/.test(value) || /\d\.\d{1,2}(?!\d)/.test(value)) dot += 1;
  }
  const decimal = dot > comma ? '.' : ',';
  return { decimal, evidence: Math.max(comma, dot), label: decimal === ',' ? '1.234,56' : '1,234.56' };
}

/**
 * Liest eine Zahl aus Tabellen-, CSV- oder JSON-Werten. Unterstützt
 * Währungszeichen, Tausendertrennzeichen, Klammern und nachgestellte
 * Minuszeichen als negative Beträge sowie typografische Minuszeichen.
 * `decimal` legt das Dezimaltrennzeichen fest; ohne Angabe gilt: Komma ist
 * Dezimaltrenner, ein einzelner Punkt vor genau drei Ziffern ist ein
 * Tausendertrenner („1.234“ = 1234), sonst ein Dezimalpunkt.
 */
export function parseNumber(value, { decimal } = {}) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let source = text(value).replace(MINUS_SIGNS, '-');
  if (!source) return null;
  let negative = false;
  if (/^\(.*\)$/.test(source)) {
    negative = true;
    source = source.slice(1, -1);
  }
  source = source.replace(/[\s\u00a0\u202f']/g, '');
  // Genau ein Zahlenblock; davor und dahinter dürfen nur Währungen, Einheiten
  // oder Vorzeichen stehen („-10,00 €“, „1,5 Std.“, „EUR 12.50“, „10,00-“).
  const match = source.match(/^([^0-9]*?)([0-9][0-9.,]*)([^0-9]*)$/);
  if (!match) return null;
  const [, prefix, core, suffix] = match;
  if (prefix.includes('-')) negative = !negative;
  // „10,-“ ist ein glatter Betrag, „10,00-“ dagegen ein nachgestelltes Minus.
  const wholeAmountNotation = /[.,]$/.test(core) && suffix.startsWith('-');
  if (suffix.startsWith('-') && !wholeAmountNotation) negative = !negative;
  let digits = core.replace(/[.,]+$/, '');
  if (!digits) return null;

  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');
  if (decimal === ',') {
    digits = digits.replace(/\./g, '').replace(',', '.').replace(/,/g, '');
  } else if (decimal === '.') {
    digits = digits.replace(/,/g, '');
  } else if (lastComma >= 0 && lastDot >= 0) {
    digits = lastComma > lastDot
      ? digits.replace(/\./g, '').replace(',', '.')
      : digits.replace(/,/g, '');
  } else if (lastComma >= 0) {
    digits = (digits.match(/,/g) || []).length > 1
      ? digits.replace(/,/g, '')
      : digits.replace(',', '.');
  } else if ((digits.match(/\./g) || []).length > 1) {
    digits = digits.replace(/\./g, '');
  } else if (/^[1-9]\d{0,2}\.\d{3}$/.test(digits)) {
    digits = digits.replace('.', '');
  }
  if ((digits.match(/\./g) || []).length > 1) return null;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function isoFromParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function expandYear(value) {
  const source = String(value);
  if (source.length === 4) return Number(source);
  if (source.length !== 2) return NaN;
  const short = Number(source);
  return short >= 70 ? 1900 + short : 2000 + short;
}

// Excel zählt Tage ab dem 30.12.1899. Der Bereich deckt 1927 bis 2119 ab und
// schließt übliche Beträge, Postleitzahlen und Jahreszahlen aus.
export function excelSerialToIso(serial) {
  const number = Number(serial);
  if (!Number.isFinite(number) || number < 10000 || number > 80000) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(number) * 86400000);
  return date.toISOString().slice(0, 10);
}

const MONTHS = {
  jan: 1, januar: 1, january: 1, jaenner: 1, jaen: 1,
  feb: 2, februar: 2, february: 2,
  mar: 3, maer: 3, maerz: 3, marz: 3, march: 3, mrz: 3,
  apr: 4, april: 4,
  mai: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, november: 11,
  dez: 12, dec: 12, dezember: 12, december: 12,
};

/**
 * Erkennt die Reihenfolge von Tag und Monat einer Spalte. Ein erster Teil
 * über 12 belegt Tag-Monat-Jahr, ein zweiter Teil über 12 Monat-Tag-Jahr.
 * Ohne Beleg gilt die deutsche Reihenfolge.
 */
export function detectDateOrder(values) {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const raw of values || []) {
    const match = text(raw).match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})\b/);
    if (!match) continue;
    if (Number(match[1]) > 12) dayFirst += 1;
    if (Number(match[2]) > 12) monthFirst += 1;
  }
  return monthFirst > dayFirst ? 'mdy' : 'dmy';
}

/**
 * Liest ein Datum als ISO-Zeichenfolge (JJJJ-MM-TT) oder `null`. Unterstützt
 * TT.MM.JJ(JJ), JJJJ-MM-TT, JJJJ/MM/TT, TT/MM/JJJJ, JJJJMMTT, Excel-Seriennummern,
 * ausgeschriebene Monatsnamen sowie angehängte Uhrzeiten. Es wird bewusst
 * kein freier `Date`-Parser verwendet, damit Zeitzonen und Browser das
 * Ergebnis nicht verschieben.
 */
export function parseDate(value, { order = 'dmy' } = {}) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : isoFromParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === 'number') return excelSerialToIso(value);
  let source = text(value);
  if (!source) return null;
  // Uhrzeiten nach dem Datum sind für Buchungen ohne Bedeutung.
  source = source.replace(/[T\s]+\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2}|Uhr)?$/i, '').trim();

  let match = source.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return isoFromParts(match[1], match[2], match[3]);

  match = source.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (match) {
    const year = expandYear(match[3]);
    return order === 'mdy'
      ? isoFromParts(year, match[1], match[2])
      : isoFromParts(year, match[2], match[1]);
  }

  match = source.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) {
    const iso = isoFromParts(match[1], match[2], match[3]);
    if (iso) return iso;
  }

  if (/^\d{5}(\.\d+)?$/.test(source)) return excelSerialToIso(Number(source));

  match = source.match(/^(\d{1,2})\.?\s*([A-Za-zÄÖÜäöü]+)\.?\s*(\d{2}|\d{4})$/);
  if (match) {
    const month = MONTHS[normaliseKey(match[2])];
    return month ? isoFromParts(expandYear(match[3]), month, match[1]) : null;
  }
  match = source.match(/^([A-Za-zÄÖÜäöü]+)\.?\s*(\d{1,2}),?\s*(\d{4})$/);
  if (match) {
    const month = MONTHS[normaliseKey(match[1])];
    return month ? isoFromParts(match[3], month, match[2]) : null;
  }
  return null;
}

export function parseTime(value) {
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minutes = Math.round(value * 24 * 60);
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const source = text(value);
  if (!source) return null;
  const match = source.match(/^(\d{1,2})[:.](\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` : null;
}

/** `true`, `false` oder `null`, wenn der Wert keine eindeutige Angabe ist. */
export function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalised = normaliseKey(value);
  if (!normalised) return null;
  if (['true', '1', 'yes', 'ja', 'y', 'j', 'x', 'wahr', 'aktiv', 'standard'].includes(normalised)) return true;
  if (['false', '0', 'no', 'nein', 'n', 'falsch', 'inaktiv'].includes(normalised)) return false;
  return null;
}

const ENTRY_TYPE_ALIASES = {
  income: 'income', einnahme: 'income', einnahmen: 'income', e: 'income', ein: 'income', eingang: 'income',
  zahlungseingang: 'income', erloes: 'income', erloese: 'income', umsatz: 'income', plus: 'income',
  expense: 'expense', ausgabe: 'expense', ausgaben: 'expense', a: 'expense', aus: 'expense', ausgang: 'expense',
  zahlungsausgang: 'expense', kosten: 'expense', aufwand: 'expense', minus: 'expense',
};

/** Liest „Einnahme“/„Ausgabe“ (auch „+“ und „-“) als `income` oder `expense`. */
export function parseEntryType(value) {
  const raw = text(value);
  if (raw === '+') return 'income';
  if (raw === '-' || raw === '\u2212') return 'expense';
  return ENTRY_TYPE_ALIASES[normaliseKey(raw)] || null;
}

export const EUER_EXPENSE_CATEGORIES = [
  'materials', 'office', 'software', 'telecommunications', 'travel', 'vehicle',
  'marketing', 'professional_services', 'insurance', 'bank_fees', 'other_expense',
];

const EUER_CATEGORY_ALIASES = {
  material: 'materials', materialien: 'materials', materials: 'materials', waren: 'materials', wareneinkauf: 'materials', einkauf: 'materials',
  office: 'office', buero: 'office', buerobedarf: 'office', buerokosten: 'office', burobedarf: 'office', burokosten: 'office', bueromaterial: 'office', porto: 'office',
  software: 'software', lizenzen: 'software', lizenz: 'software', abo: 'software', abonnement: 'software', saas: 'software', edv: 'software',
  telefon: 'telecommunications', internet: 'telecommunications', telekommunikation: 'telecommunications', telecommunications: 'telecommunications', handy: 'telecommunications', mobilfunk: 'telecommunications',
  reise: 'travel', reisekosten: 'travel', travel: 'travel', fahrt: 'travel', fahrten: 'travel', fahrtkosten: 'travel', fahrkarte: 'travel', ticket: 'travel', bahn: 'travel', hotel: 'travel', uebernachtung: 'travel',
  fahrzeug: 'vehicle', fahrzeugkosten: 'vehicle', vehicle: 'vehicle', kfz: 'vehicle', kfzkosten: 'vehicle', tanken: 'vehicle', benzin: 'vehicle', auto: 'vehicle',
  werbung: 'marketing', marketing: 'marketing', werbekosten: 'marketing', anzeigen: 'marketing',
  beratung: 'professional_services', dienstleistung: 'professional_services', fremdleistung: 'professional_services', fremdleistungen: 'professional_services',
  professionalservices: 'professional_services', steuerberatung: 'professional_services', steuerberater: 'professional_services', rechtsberatung: 'professional_services', fortbildung: 'professional_services', weiterbildung: 'professional_services',
  versicherung: 'insurance', versicherungen: 'insurance', insurance: 'insurance', beitraege: 'insurance',
  bankgebuehren: 'bank_fees', bankgebuhren: 'bank_fees', bankkosten: 'bank_fees', bankfees: 'bank_fees', kontofuehrung: 'bank_fees', gebuehren: 'bank_fees',
  sonstige: 'other_expense', sonstiges: 'other_expense', sonstigeausgabe: 'other_expense', sonstigeausgaben: 'other_expense',
  sonstigebetriebsausgaben: 'other_expense', otherexpense: 'other_expense', other: 'other_expense',
};

/** Ordnet eigene Kategorienamen einer EÜR-Ausgabenkategorie zu oder liefert `null`. */
export function normaliseEuerCategory(value) {
  const raw = text(value);
  if (EUER_EXPENSE_CATEGORIES.includes(raw)) return raw;
  return EUER_CATEGORY_ALIASES[normaliseKey(raw)] || null;
}

const PAID_ALIASES = new Set(['paid', 'bezahlt', 'beglichen', 'erledigt', 'ausgeglichen', 'ja', 'yes', 'x', 'bez', 'gezahlt', 'vollstaendigbezahlt']);
const OPEN_ALIASES = new Set(['open', 'offen', 'unbezahlt', 'nein', 'no', 'ausstehend', 'faellig', 'ueberfaellig', 'overdue', 'sent', 'versendet', 'gesendet', 'teilbezahlt', 'teilweisebezahlt', 'partial']);

/** `paid`, `open` oder `null` für Zahlungsstatus-Angaben aus Fremdsystemen. */
export function parsePaymentStatus(value) {
  const normalised = normaliseKey(value);
  if (!normalised) return null;
  if (PAID_ALIASES.has(normalised)) return 'paid';
  if (OPEN_ALIASES.has(normalised)) return 'open';
  return null;
}

// Stichwörter für Wiederholungen von Kursen und Aufträgen.
export function parseRepeatInterval(value) {
  const normalised = normaliseKey(value);
  if (!normalised) return null;
  if (['woechentlich', 'wochentlich', 'weekly', 'jedewoche', '1woche', 'w'].includes(normalised)) return { intervalUnit: 'week', interval: 1 };
  if (['14taegig', '14tagig', 'zweiwoechentlich', 'alle2wochen', 'biweekly', '2wochen', 'vierzehntaegig'].includes(normalised)) return { intervalUnit: 'week', interval: 2 };
  if (['monatlich', 'monthly', 'jedenmonat', 'm'].includes(normalised)) return { intervalUnit: 'month', interval: 1 };
  if (['keine', 'nein', 'einmalig', 'none', 'no'].includes(normalised)) return { intervalUnit: null, interval: 0 };
  return undefined;
}

const JOB_STATUS_ALIASES = {
  draft: 'draft', entwurf: 'draft', offen: 'draft', geplant: 'draft', planung: 'draft',
  inprogress: 'in-progress', inarbeit: 'in-progress', laufend: 'in-progress', begonnen: 'in-progress',
  completed: 'completed', erledigt: 'completed', abgeschlossen: 'completed', durchgefuehrt: 'completed', stattgefunden: 'completed', gehalten: 'completed', fertig: 'completed',
  invoiced: 'invoiced', abgerechnet: 'invoiced', berechnet: 'invoiced', bezahlt: 'invoiced', fakturiert: 'invoiced',
};

const QUOTE_STATUS_ALIASES = {
  draft: 'draft', entwurf: 'draft', offen: 'draft',
  sent: 'sent', gesendet: 'sent', versendet: 'sent', verschickt: 'sent',
  accepted: 'accepted', angenommen: 'accepted', beauftragt: 'accepted',
  rejected: 'rejected', abgelehnt: 'rejected',
  expired: 'expired', abgelaufen: 'expired',
  billed: 'billed', abgerechnet: 'billed',
};

function aliasStatus(value, aliases) {
  const raw = text(value);
  if (!raw) return null;
  return aliases[normaliseKey(raw)] || (Object.values(aliases).includes(raw) ? raw : null);
}

/** Auftrags- bzw. Kursstatus (`draft`, `in-progress`, `completed`, `invoiced`) oder `null`. */
export function parseJobStatus(value) {
  return aliasStatus(value, JOB_STATUS_ALIASES);
}

/** Angebotsstatus oder `null`. */
export function parseQuoteStatus(value) {
  return aliasStatus(value, QUOTE_STATUS_ALIASES);
}

const ORGANIZATION_ALIASES = ['organisation', 'organization', 'firma', 'unternehmen', 'company', 'org', 'geschaeftskunde', 'gewerblich', 'b2b', 'traeger', 'institution', 'verein', 'behoerde'];
const PERSON_ALIASES = ['person', 'privat', 'privatperson', 'privatkunde', 'b2c', 'natuerlicheperson', 'einzelperson'];

/** `person`, `organization` oder `null`, wenn die Angabe fehlt oder unbekannt ist. */
export function parseCustomerType(value) {
  const source = normaliseKey(value);
  if (!source) return null;
  if (ORGANIZATION_ALIASES.includes(source)) return 'organization';
  if (PERSON_ALIASES.includes(source)) return 'person';
  return null;
}
