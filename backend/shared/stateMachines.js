// Zentrale Beschreibung aller Fachstatus in SoloOffice.
//
// Diese Datei ist die einzige Quelle für Statuswerte, deutsche Beschriftungen,
// Farbton und erlaubte Übergänge. Backend, Frontend und Demo-Modus lesen sie
// gemeinsam. Sie enthält bewusst nur Daten und reine Funktionen (kein Node-,
// kein Datenbankzugriff), damit sie auch im Browser läuft.
//
// Auslöser eines Übergangs:
//   manual    – der Nutzer wählt den Status direkt (Statusauswahl, allgemeines Update)
//   action    – nur über eine eigene Aktion erreichbar (Zahlung, Mahnung, Umwandlung …)
//   automatic – das System leitet den Status ab (Datum, Zahlungsstand)
//
// Die Tabellen bilden das heute geprüfte Verhalten ab. Wer eine Regel ändert,
// ändert sie hier; die Vertragstests gleichen die Werte mit den CHECK-
// Bedingungen der Migrationen und mit den TypeScript-Typen ab, und
// `docs/zustandsautomaten.md` wird aus dieser Datei erzeugt.

const INVOICE_OPEN = ['sent', 'overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x'];
const QUOTE_OPEN = ['draft', 'sent', 'accepted', 'rejected', 'expired'];
const JOB_OPEN = ['draft', 'in-progress', 'completed'];

function each(fromStates, toStates, rest) {
  return fromStates.flatMap(from => toStates.filter(to => to !== from).map(to => ({ from, to, ...rest })));
}

export const STATE_MACHINES = {
  invoice: {
    label: 'Rechnung',
    kind: 'workflow',
    db: { table: 'invoices', column: 'status' },
    tsType: 'InvoiceStatus',
    initial: 'draft',
    states: {
      draft: { label: 'Entwurf', tone: 'neutral' },
      sent: { label: 'Versendet', tone: 'primary' },
      overdue: { label: 'Überfällig', tone: 'danger' },
      reminded_1x: { label: '1x gemahnt', tone: 'warning' },
      reminded_2x: { label: '2x gemahnt', tone: 'warningStrong' },
      reminded_3x: { label: '3x gemahnt', tone: 'dangerStrong' },
      paid: { label: 'Bezahlt', tone: 'success' },
    },
    transitions: [
      { from: 'draft', to: 'sent', trigger: 'manual', label: 'Ausstellen oder versenden', guard: 'Mindestens eine Position' },
      { from: 'draft', to: 'overdue', trigger: 'manual', label: 'Als überfällig ausstellen', guard: 'Mindestens eine Position' },
      { from: 'sent', to: 'overdue', trigger: 'manual', label: 'Als überfällig markieren' },
      { from: 'sent', to: 'overdue', trigger: 'automatic', label: 'Fälligkeitsdatum überschritten (beim Öffnen der Rechnungsliste)' },
      ...each(['overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x'], ['sent'], { trigger: 'manual', label: 'Auf versendet zurücksetzen' }),
      ...each(['reminded_1x', 'reminded_2x', 'reminded_3x'], ['overdue'], { trigger: 'manual', label: 'Auf überfällig zurücksetzen' }),
      { from: 'sent', to: 'reminded_1x', trigger: 'action', label: '1. Mahnung senden', guard: 'Offener Betrag' },
      { from: 'overdue', to: 'reminded_1x', trigger: 'action', label: '1. Mahnung senden', guard: 'Offener Betrag' },
      { from: 'reminded_1x', to: 'reminded_2x', trigger: 'action', label: '2. Mahnung senden', guard: 'Offener Betrag' },
      { from: 'reminded_2x', to: 'reminded_3x', trigger: 'action', label: '3. Mahnung senden', guard: 'Offener Betrag' },
      ...each(INVOICE_OPEN, ['paid'], { trigger: 'action', label: 'Zahlungseingang erfassen', guard: 'Zahlungen decken den Rechnungsbetrag' }),
      { from: 'paid', to: 'sent', trigger: 'automatic', label: 'Zahlung storniert, Fälligkeit noch nicht erreicht' },
      { from: 'paid', to: 'overdue', trigger: 'automatic', label: 'Zahlung storniert, Fälligkeit überschritten' },
    ],
    notes: [
      'Ausgestellte Rechnungen kehren nie zum Entwurf zurück; Korrekturen laufen über eine Gutschrift.',
      '„Bezahlt“ wird ausschließlich aus den erfassten Zahlungen abgeleitet und lässt sich nicht von Hand setzen.',
      'Das allgemeine Update nimmt Mahnstufen derzeit auch direkt an (durch Tests abgesichert); die Oberfläche bietet das nicht an.',
    ],
  },

  creditNote: {
    label: 'Gutschrift',
    kind: 'workflow',
    db: null,
    tsType: null,
    initial: 'draft',
    states: {
      draft: { label: 'Entwurf', tone: 'neutral' },
      sent: { label: 'Versendet', tone: 'primary' },
      paid: { label: 'Altstatus prüfen', tone: 'warning' },
    },
    transitions: [
      { from: 'draft', to: 'sent', trigger: 'manual', label: 'Als versendet markieren' },
    ],
    notes: [
      'Gutschriften liegen in der Tabelle `invoices` (document_type = credit_note) und kennen nur Entwurf und versendet.',
      '„paid“ stammt aus alten Datenständen; Rückzahlung und Verrechnung gibt es noch nicht.',
    ],
  },

  quote: {
    label: 'Angebot',
    kind: 'workflow',
    db: { table: 'quotes', column: 'status' },
    tsType: 'QuoteStatus',
    initial: 'draft',
    states: {
      draft: { label: 'Entwurf', tone: 'neutral' },
      sent: { label: 'Versendet', tone: 'primary' },
      accepted: { label: 'Akzeptiert', tone: 'success' },
      rejected: { label: 'Abgelehnt', tone: 'danger' },
      expired: { label: 'Abgelaufen', tone: 'warning' },
      billed: { label: 'Abgerechnet', tone: 'settled' },
    },
    transitions: [
      ...each(QUOTE_OPEN, QUOTE_OPEN, { trigger: 'manual', label: 'Status wählen' }),
      { from: 'sent', to: 'expired', trigger: 'automatic', label: 'Gültigkeit überschritten (beim Öffnen der Angebotsliste)' },
      { from: 'accepted', to: 'billed', trigger: 'action', label: 'In Rechnung umwandeln' },
    ],
    notes: [
      '„Abgerechnet“ entsteht nur durch die Umwandlung in eine Rechnung und ist endgültig.',
      'Löschen ist nur für unabhängige Entwürfe möglich.',
    ],
  },

  job: {
    label: 'Auftrag',
    kind: 'workflow',
    db: { table: 'job_entries', column: 'status' },
    tsType: 'JobStatus',
    initial: 'draft',
    states: {
      draft: { label: 'Entwurf', tone: 'neutral' },
      'in-progress': { label: 'In Bearbeitung', tone: 'progress' },
      completed: { label: 'Abgeschlossen', tone: 'success' },
      invoiced: { label: 'Abgerechnet', tone: 'settled' },
    },
    transitions: [
      ...each(JOB_OPEN, JOB_OPEN, { trigger: 'manual', label: 'Status wählen', guard: 'Kunde, Titel und Beschreibung außerhalb des Entwurfs' }),
      ...each(JOB_OPEN, ['invoiced'], { trigger: 'manual', label: 'Von Hand als abgerechnet markieren', guard: 'Kunde, Titel und Beschreibung' }),
      { from: 'completed', to: 'invoiced', trigger: 'action', label: 'Rechnung aus Aufträgen erstellen' },
      { from: 'draft', to: 'completed', trigger: 'action', label: 'Unterschrift erfassen' },
      { from: 'in-progress', to: 'completed', trigger: 'action', label: 'Unterschrift erfassen' },
      { from: 'invoiced', to: 'completed', trigger: 'action', label: 'Zugehörigen Rechnungsentwurf löschen' },
    ],
    notes: [
      'Abgerechnete Aufträge sind gesperrt: kein Bearbeiten, kein Statuswechsel.',
      'Ein von Hand gesetztes „Abgerechnet“ ohne Rechnung lässt sich nicht zurücknehmen (offene Produktentscheidung).',
    ],
  },

  recurringInvoice: {
    label: 'Wiederkehrende Rechnung',
    kind: 'workflow',
    db: { table: 'recurring_invoices', column: 'status' },
    tsType: 'RecurringInvoiceStatus',
    initial: 'active',
    states: {
      active: { label: 'Aktiv', tone: 'success' },
      paused: { label: 'Pausiert', tone: 'warning' },
      ended: { label: 'Beendet', tone: 'neutral' },
    },
    transitions: [
      { from: 'active', to: 'paused', trigger: 'manual', label: 'Pausieren' },
      { from: 'paused', to: 'active', trigger: 'manual', label: 'Fortsetzen' },
      { from: 'active', to: 'ended', trigger: 'manual', label: 'Beenden' },
      { from: 'paused', to: 'ended', trigger: 'manual', label: 'Beenden' },
      { from: 'active', to: 'ended', trigger: 'automatic', label: 'Nächster Lauf läge hinter dem Enddatum' },
    ],
    notes: [
      'Rechnungen entstehen nur aus aktiven Vorlagen.',
      'Der Server prüft die Reihenfolge der Übergänge derzeit nicht; die Oberfläche bietet für beendete Vorlagen keine Aktion an.',
    ],
  },

  recurringInvoiceRun: {
    label: 'Lauf einer wiederkehrenden Rechnung',
    kind: 'log',
    db: { table: 'recurring_invoice_runs', column: 'status' },
    tsType: 'RecurringInvoiceRunStatus',
    initial: null,
    states: {
      success: { label: 'Erfolgreich', tone: 'success' },
      failure: { label: 'Fehlgeschlagen', tone: 'danger' },
    },
    transitions: [],
    notes: ['Protokolleintrag je Lauf; der Wert ändert sich nach dem Anlegen nicht.'],
  },

  recurringExpense: {
    label: 'Fixkosten',
    kind: 'workflow',
    db: { table: 'recurring_expenses', column: 'status' },
    tsType: null,
    initial: 'active',
    states: {
      active: { label: 'Aktiv', tone: 'success' },
      paused: { label: 'Pausiert', tone: 'warning' },
      ended: { label: 'Beendet', tone: 'neutral' },
    },
    transitions: [
      { from: 'active', to: 'paused', trigger: 'manual', label: 'Pausieren' },
      { from: 'paused', to: 'active', trigger: 'manual', label: 'Fortsetzen' },
      { from: 'active', to: 'ended', trigger: 'manual', label: 'Beenden' },
      { from: 'paused', to: 'ended', trigger: 'manual', label: 'Beenden' },
      { from: 'active', to: 'ended', trigger: 'action', label: 'Löschen mit Historie (wird archiviert)' },
      { from: 'paused', to: 'ended', trigger: 'action', label: 'Löschen mit Historie (wird archiviert)' },
    ],
    notes: [
      'Der angezeigte Status wird zusätzlich aus Enddatum und Pausenzeiträumen abgeleitet (`currentExpenseStatus`).',
      'Ein unbekannter Statuswert wird beim Speichern abgelehnt; ohne Angabe gilt „aktiv“.',
    ],
  },

  recurringExpenseRun: {
    label: 'Fälligkeit einer Fixkostenvorlage',
    kind: 'workflow',
    db: { table: 'recurring_expense_runs', column: 'status' },
    tsType: null,
    initial: 'planned',
    states: {
      planned: { label: 'Geplant', tone: 'neutral' },
      confirmed: { label: 'Bezahlt', tone: 'success' },
      skipped: { label: 'Übersprungen', tone: 'warning' },
    },
    transitions: [
      { from: 'planned', to: 'confirmed', trigger: 'action', label: 'Zahlung bestätigen', guard: 'Fälligkeit nach aktueller Regel zulässig' },
      { from: 'planned', to: 'skipped', trigger: 'action', label: 'Überspringen' },
    ],
    notes: ['Bestätigte und übersprungene Fälligkeiten sind endgültig; ein Datenbank-Trigger sperrt jede weitere Änderung.'],
  },

  importRun: {
    label: 'Importlauf',
    kind: 'workflow',
    db: { table: 'import_runs', column: 'status' },
    tsType: 'ImportRunStatus',
    initial: 'pending',
    states: {
      pending: { label: 'Offen – rückgängig möglich', tone: 'warning' },
      confirmed: { label: 'Abgeschlossen', tone: 'success' },
      reverted: { label: 'Rückgängig gemacht', tone: 'neutral' },
    },
    transitions: [
      { from: 'pending', to: 'confirmed', trigger: 'action', label: 'Import abschließen oder Umzug beenden' },
      { from: 'pending', to: 'reverted', trigger: 'action', label: 'Import rückgängig machen' },
    ],
    notes: ['Abgeschlossene und rückgängig gemachte Läufe sind endgültig.'],
  },

  migrationSession: {
    label: 'Umzug (Datenübernahme)',
    kind: 'workflow',
    db: { table: 'migration_sessions', column: 'status' },
    tsType: 'MigrationSessionStatus',
    initial: 'open',
    states: {
      open: { label: 'Offen', tone: 'warning' },
      completed: { label: 'Abgeschlossen', tone: 'success' },
    },
    transitions: [
      { from: 'open', to: 'completed', trigger: 'action', label: 'Umzug abschließen' },
    ],
    notes: ['Je Workspace gibt es genau einen Umzug; er lässt sich weder abbrechen noch wieder öffnen.'],
  },

  migrationCategory: {
    label: 'Umzugskategorie',
    kind: 'workflow',
    db: { table: 'migration_categories', column: 'status' },
    tsType: null,
    initial: 'open',
    states: {
      open: { label: 'Offen', tone: 'warning' },
      completed: { label: 'Erledigt', tone: 'success' },
    },
    transitions: [
      { from: 'open', to: 'completed', trigger: 'action', label: 'Kategorie importieren oder überspringen' },
      { from: 'completed', to: 'open', trigger: 'action', label: 'Zugehörigen Import rückgängig machen' },
    ],
    notes: [],
  },

  receiptOcr: {
    label: 'Belegerkennung (OCR)',
    kind: 'workflow',
    db: { table: 'receipts', column: 'ocr_status' },
    tsType: 'ReceiptOcrStatus',
    initial: null,
    states: {
      pending: { label: 'Wartet auf Erkennung', tone: 'neutral' },
      processing: { label: 'Erkennung läuft', tone: 'progress' },
      completed: { label: 'Beleg erkannt', tone: 'success' },
      failed: { label: 'Erkennung fehlgeschlagen', tone: 'danger' },
    },
    transitions: [
      { from: 'failed', to: 'completed', trigger: 'action', label: 'Erkennung erneut starten' },
      { from: 'completed', to: 'failed', trigger: 'action', label: 'Erneute Erkennung fehlgeschlagen' },
    ],
    notes: [
      'Die Erkennung läuft beim Hochladen synchron; ein Beleg entsteht direkt als „erkannt“ oder „fehlgeschlagen“.',
      '„pending“ und „processing“ sind in Datenbank und Typ vorgesehen, werden vom Server derzeit aber nicht geschrieben.',
      'Das Ergebnis ist immer ein Vorschlag; gebucht wird erst nach sichtbarer Bestätigung.',
    ],
  },

  euerEntry: {
    label: 'EÜR-Buchung',
    kind: 'workflow',
    db: { table: 'euer_entries', column: 'status' },
    tsType: null,
    initial: 'active',
    states: {
      active: { label: 'Aktiv', tone: 'success' },
      voided: { label: 'Storniert', tone: 'neutral' },
    },
    transitions: [
      { from: 'active', to: 'voided', trigger: 'action', label: 'Stornieren', guard: 'Begründung' },
      { from: 'active', to: 'voided', trigger: 'action', label: 'Import rückgängig machen oder USt-Zahlung zurücksetzen' },
      { from: 'voided', to: 'active', trigger: 'automatic', label: 'USt-Zahlung wieder als bezahlt erfasst' },
    ],
    notes: ['Buchungen werden nie gelöscht; jede Änderung steht in `euer_entry_history`.'],
  },

  fixedAsset: {
    label: 'Anlage',
    kind: 'workflow',
    db: { table: 'fixed_assets', column: 'status' },
    tsType: 'FixedAssetStatus',
    initial: 'active',
    states: {
      active: { label: 'Aktiv', tone: 'success' },
      disposed: { label: 'Abgegangen', tone: 'neutral' },
    },
    transitions: [
      { from: 'active', to: 'disposed', trigger: 'manual', label: 'Abgang erfassen', guard: 'Abgangsdatum' },
      { from: 'disposed', to: 'active', trigger: 'manual', label: 'Abgang zurücknehmen' },
    ],
    notes: [],
  },

  incomingEInvoice: {
    label: 'Eingangs-E-Rechnung',
    kind: 'log',
    db: { table: 'incoming_e_invoices', column: 'validation_status' },
    tsType: 'IncomingEInvoiceValidationStatus',
    initial: null,
    states: {
      validated: { label: 'E-Rechnung geprüft', tone: 'success' },
      rejected: { label: 'Prüfung fehlgeschlagen', tone: 'danger' },
    },
    transitions: [],
    notes: ['Ergebnis der Prüfung beim Hochladen; der Wert ändert sich danach nicht.'],
  },

  emailLog: {
    label: 'E-Mail-Protokoll',
    kind: 'log',
    db: { table: 'email_history', column: 'status' },
    tsType: null,
    initial: null,
    states: {
      sent: { label: 'Gesendet', tone: 'success' },
      failed: { label: 'Fehlgeschlagen', tone: 'danger' },
    },
    transitions: [],
    notes: ['Protokolleintrag je Versandversuch.'],
  },

  supportTicket: {
    label: 'Support-Ticket',
    kind: 'external',
    db: null,
    tsType: 'SupportTicketStatus',
    initial: 'open',
    states: {
      open: { label: 'In Bearbeitung', tone: 'warning' },
      pending: { label: 'Antwort erhalten', tone: 'primary' },
      resolved: { label: 'Gelöst', tone: 'success' },
      closed: { label: 'Geschlossen', tone: 'neutral' },
    },
    transitions: [],
    notes: ['Der Bestand liegt im Control Plane; SoloOffice zeigt den Status nur an. Die Übergänge stehen in `control-plane/src/support.js`.'],
  },
};

export const STATE_TONES = ['neutral', 'primary', 'success', 'progress', 'warning', 'warningStrong', 'danger', 'dangerStrong', 'settled'];

function machineOf(name) {
  const machine = STATE_MACHINES[name];
  if (!machine) throw new Error(`Unbekannter Zustandsautomat: ${name}`);
  return machine;
}

/** Alle Statuswerte eines Automaten in Anzeigereihenfolge. */
export function statesOf(name) {
  return Object.keys(machineOf(name).states);
}

export function isKnownState(name, state) {
  return typeof state === 'string' && Object.hasOwn(machineOf(name).states, state);
}

/** Deutsche Beschriftung; unbekannte Werte liefern `fallback` statt eines Rohschlüssels. */
export function stateLabel(name, state, fallback = 'Unbekannt') {
  return isKnownState(name, state) ? machineOf(name).states[state].label : fallback;
}

export function stateTone(name, state) {
  return isKnownState(name, state) ? machineOf(name).states[state].tone : 'neutral';
}

export function transitionsFrom(name, from, triggers) {
  return machineOf(name).transitions.filter(transition => transition.from === from
    && (!triggers || triggers.includes(transition.trigger)));
}

/** Gleicher Status gilt immer als erlaubt (kein Wechsel). */
export function canTransition(name, from, to, triggers) {
  if (!isKnownState(name, to)) return false;
  if (from === to) return true;
  return transitionsFrom(name, from, triggers).some(transition => transition.to === to);
}

/** Zielstatus, die der Nutzer für einen Datensatz direkt wählen darf. */
export function manualTargets(name, from) {
  const targets = new Set(transitionsFrom(name, from, ['manual']).map(transition => transition.to));
  return statesOf(name).filter(state => targets.has(state));
}

/** Zielstatus für eine Mehrfachauswahl: alles, was mindestens ein Datensatz erreichen kann. */
export function manualTargetsForSelection(name, fromStates) {
  const targets = new Set(fromStates.flatMap(from => manualTargets(name, from)));
  return statesOf(name).filter(state => targets.has(state));
}

/** Endzustand: kein Übergang führt hinaus. */
export function isTerminal(name, state) {
  return isKnownState(name, state) && transitionsFrom(name, state).length === 0;
}

/**
 * Prüft einen vom Nutzer gewählten Statuswechsel. Liefert `null`, wenn er
 * erlaubt ist, sonst `{ code, message }` mit deutscher Meldung.
 */
export function checkManualTransition(name, from, to) {
  const machine = machineOf(name);
  if (!isKnownState(name, to)) return { code: 'unknown_state', message: `Ungültiger Status für ${machine.label}.` };
  if (from === to) return null;
  if (canTransition(name, from, to, ['manual'])) return null;
  const fromLabel = stateLabel(name, from, String(from));
  const toLabel = stateLabel(name, to);
  const viaAction = machine.transitions.find(transition => transition.to === to && transition.trigger === 'action');
  if (isTerminal(name, from)) {
    return { code: 'terminal_state', message: `${machine.label}: Der Status „${fromLabel}“ ist endgültig und lässt sich nicht mehr ändern.` };
  }
  if (viaAction) {
    return { code: 'action_required', message: `${machine.label}: „${toLabel}“ lässt sich nicht von Hand setzen. Der Status entsteht über „${viaAction.label}“.` };
  }
  return { code: 'not_allowed', message: `${machine.label}: Der Wechsel von „${fromLabel}“ zu „${toLabel}“ ist nicht möglich.` };
}
