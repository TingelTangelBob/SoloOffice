import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Building2, ChevronRight, LifeBuoy, Loader2, Plus, Send, UserRound } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { Notice } from './Notice';
import { apiService } from '../services/api';
import { isDemoMode } from '../services/demoApi';
import { useFeedback } from '../context/FeedbackContext';
import { useCompany } from '../context/CompanyContext';
import { formatDate } from '../utils/formatters';
import type { DateFormat, SupportMessage, SupportStatus, SupportTicket, SupportTicketCategory, SupportTicketDetail } from '../types';

interface SupportManagementProps {
  /** Ticket-Kennung aus dem URL-Hash (`#support/<id>`) oder `neu`. */
  initialTicketId?: string;
  onNavigate?: (page: string, filter?: string) => void;
}

const CATEGORY_LABELS: Record<SupportTicketCategory, string> = {
  question: 'Frage zur Bedienung',
  bug: 'Fehler melden',
  billing: 'Konto & Abrechnung',
  feature: 'Wunsch / Anregung',
  other: 'Sonstiges',
};

const STATUS_LABELS: Record<SupportTicket['status'], { label: string; className: string }> = {
  open: { label: 'In Bearbeitung', className: 'bg-amber-100 text-amber-800' },
  pending: { label: 'Antwort erhalten', className: 'bg-primary-light-custom text-primary-custom' },
  resolved: { label: 'Gelöst', className: 'bg-green-100 text-green-800' },
  closed: { label: 'Geschlossen', className: 'bg-gray-100 text-gray-700' },
};

interface Formatting {
  locale: string;
  dateFormat?: DateFormat;
}

function formatDateTime(value: string | null | undefined, formatting: Formatting): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${formatDate(date, formatting.locale, formatting.dateFormat)} ${date.toLocaleTimeString(formatting.locale, { hour: '2-digit', minute: '2-digit' })}`;
}

function StatusBadge({ status }: { status: SupportTicket['status'] }) {
  const entry = STATUS_LABELS[status] || STATUS_LABELS.open;
  return <span className={`status-badge inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${entry.className}`}>{entry.label}</span>;
}

/**
 * Support-Anfragen aus der Fachapp. Tickets liegen im Control Plane des
 * Betreibers; die Fachapp reicht sie signiert weiter (backend/routes/support.js).
 * Ohne angebundenes Control Plane (Self-Hosting) ist der Bereich nicht
 * verfügbar und wird im Kontomenü ausgeblendet.
 */
export function SupportManagement({ initialTicketId, onNavigate }: SupportManagementProps) {
  const { company } = useCompany();
  const locale: Formatting = { locale: company.locale || 'de-DE', dateFormat: company.dateFormat };
  const [status, setStatus] = useState<SupportStatus | null>(null);
  const [statusError, setStatusError] = useState('');

  useEffect(() => {
    let active = true;
    apiService.getSupportStatus()
      .then(result => { if (active) setStatus(result); })
      .catch(error => { if (active) { setStatus({ available: false }); setStatusError(error instanceof Error ? error.message : 'Der Support-Status konnte nicht geladen werden.'); } });
    return () => { active = false; };
  }, []);

  const navigate = useCallback((filter?: string) => onNavigate?.('support', filter), [onNavigate]);

  if (!status) {
    return (
      <div className="page-root space-y-6">
        <PageHeader icon={LifeBuoy} title="Support" />
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Lade Support…</div>
      </div>
    );
  }

  if (!status.available) {
    return (
      <div className="page-root space-y-6">
        <PageHeader icon={LifeBuoy} title="Support" />
        <Notice variant="info" title="Support-Anfragen sind für diese Installation nicht eingerichtet">
          Der Ticket-Support steht in der gehosteten Version von SoloOffice zur Verfügung. Für selbst betriebene Installationen finden Sie Dokumentation und Kontaktmöglichkeiten unter{' '}
          <a href="https://solooffice.de" target="_blank" rel="noreferrer" className="font-medium text-primary-custom hover:underline">solooffice.de</a>.
          {statusError && <span className="mt-1 block text-xs text-gray-500">{statusError}</span>}
        </Notice>
      </div>
    );
  }

  if (initialTicketId === 'neu') return <NewTicketView locale={locale} navigate={navigate} />;
  if (initialTicketId) return <TicketDetailView ticketId={initialTicketId} locale={locale} navigate={navigate} />;
  return <TicketListView locale={locale} navigate={navigate} />;
}

function TicketListView({ locale, navigate }: { locale: Formatting; navigate: (filter?: string) => void }) {
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiService.getSupportTickets()
      .then(result => { if (active) setTickets(result); })
      .catch(loadError => { if (active) { setTickets([]); setError(loadError instanceof Error ? loadError.message : 'Die Anfragen konnten nicht geladen werden.'); } });
    return () => { active = false; };
  }, []);

  return (
    <div className="page-root space-y-6">
      <PageHeader icon={LifeBuoy} title="Support">
        <button type="button" onClick={() => navigate('neu')} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Neue Anfrage</span>
          <span className="sm:hidden">Neu</span>
        </button>
      </PageHeader>

      {isDemoMode && <Notice variant="info">Im Demo-Modus bleiben Anfragen im Browser und erreichen keinen Betreiber. In der gehosteten Version erscheinen sie sofort in der Adminkonsole; Antworten kommen per E-Mail und hier im Verlauf.</Notice>}
      {error && <Notice variant="error">{error}</Notice>}

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="font-semibold text-gray-900">Meine Anfragen</h2>
          <p className="text-sm text-gray-500">Wir antworten in der Regel innerhalb eines Werktags – per E-Mail und hier im Verlauf.</p>
        </div>
        {tickets === null ? (
          <div className="flex items-center gap-2 px-5 py-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Lade Anfragen…</div>
        ) : tickets.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <LifeBuoy className="mx-auto mb-3 h-8 w-8 text-gray-300" aria-hidden="true" />
            <p className="text-sm font-medium text-gray-900">Noch keine Anfragen</p>
            <p className="mt-1 text-sm text-gray-500">Fragen zur Bedienung, Fehler, Abrechnung oder Wünsche – wir helfen gern.</p>
            <button type="button" onClick={() => navigate('neu')} className="btn-primary mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"><Plus className="h-4 w-4" />Erste Anfrage stellen</button>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {tickets.map(ticket => (
              <li key={ticket.id}>
                <button type="button" onClick={() => navigate(ticket.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-gray-50">
                  <span className="hidden w-16 shrink-0 text-xs font-medium text-gray-500 sm:block">{ticket.reference}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">{ticket.subject}</span>
                    <span className="block truncate text-xs text-gray-500">
                      <span className="sm:hidden">{ticket.reference} · </span>{CATEGORY_LABELS[ticket.category] || ticket.category} · {formatDateTime(ticket.updatedAt, locale)}
                    </span>
                  </span>
                  <StatusBadge status={ticket.status} />
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NewTicketView({ locale, navigate }: { locale: Formatting; navigate: (filter?: string) => void }) {
  void locale;
  const { notify } = useFeedback();
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<SupportTicketCategory>('question');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    setBusy(true);
    try {
      const result = await apiService.createSupportTicket({ subject: subject.trim(), body: body.trim(), category, page: window.location.hash.slice(1) || undefined });
      notify({ variant: 'success', message: result.mail?.sent ? `Anfrage ${result.ticket.reference} gesendet. Eine Bestätigung ist per E-Mail unterwegs.` : `Anfrage ${result.ticket.reference} gesendet.` });
      navigate(result.ticket.id);
    } catch (error) {
      notify({ variant: 'error', message: error instanceof Error ? error.message : 'Die Anfrage konnte nicht gesendet werden.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-root space-y-6">
      <PageHeader icon={LifeBuoy} title="Neue Support-Anfrage" shortTitle="Anfrage">
        <button type="button" onClick={() => navigate()} className="action-button inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Meine Anfragen</span></button>
      </PageHeader>
      <form onSubmit={submit} className="form-consistent-fields space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_15rem]">
          <label className="block text-sm text-gray-700">Betreff
            <input value={subject} onChange={event => setSubject(event.target.value)} className="form-input mt-1 w-full" placeholder="Worum geht es?" maxLength={200} required />
          </label>
          <label className="block text-sm text-gray-700">Kategorie
            <select value={category} onChange={event => setCategory(event.target.value as SupportTicketCategory)} className="form-input mt-1 w-full">
              {(Object.keys(CATEGORY_LABELS) as SupportTicketCategory[]).map(key => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-sm text-gray-700">Nachricht
          <textarea value={body} onChange={event => setBody(event.target.value)} className="form-input mt-1 min-h-44 w-full" placeholder="Beschreiben Sie Ihr Anliegen so genau wie möglich – bei Fehlern gern mit den Schritten, die dorthin führen, und was Sie erwartet hätten." maxLength={10000} required />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-gray-500">Mit der Anfrage werden Ihre E-Mail-Adresse, der Name des Arbeitsbereichs und die Programmversion übermittelt – keine Rechnungs- oder Kundendaten.</p>
          <button type="submit" disabled={busy || !subject.trim() || !body.trim()} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Anfrage senden
          </button>
        </div>
      </form>
    </div>
  );
}

function TicketDetailView({ ticketId, locale, navigate }: { ticketId: string; locale: Formatting; navigate: (filter?: string) => void }) {
  const { notify } = useFeedback();
  const [detail, setDetail] = useState<SupportTicketDetail | null>(null);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await apiService.getSupportTicket(ticketId));
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Die Anfrage konnte nicht geladen werden.');
    }
  }, [ticketId]);

  useEffect(() => { void load(); }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    try {
      setDetail(await apiService.replySupportTicket(ticketId, reply.trim()));
      setReply('');
      notify({ variant: 'success', message: 'Antwort gesendet.' });
    } catch (replyError) {
      notify({ variant: 'error', message: replyError instanceof Error ? replyError.message : 'Die Antwort konnte nicht gesendet werden.' });
    } finally {
      setBusy(false);
    }
  };

  const ticket = detail?.ticket;

  return (
    <div className="page-root space-y-6">
      <PageHeader icon={LifeBuoy} title={ticket ? `${ticket.reference} · ${ticket.subject}` : 'Anfrage'} shortTitle={ticket?.reference || 'Anfrage'}>
        <button type="button" onClick={() => navigate()} className="action-button inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Meine Anfragen</span></button>
      </PageHeader>

      {error && <Notice variant="error">{error}</Notice>}
      {!detail && !error && <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Lade Anfrage…</div>}

      {ticket && (
        <>
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-200 px-5 py-3 text-xs text-gray-500">
              <StatusBadge status={ticket.status} />
              <span>{CATEGORY_LABELS[ticket.category] || ticket.category}</span>
              <span>Erstellt {formatDateTime(ticket.createdAt, locale)}</span>
            </header>
            <ol className="divide-y divide-gray-100">
              {detail.messages.map(message => <MessageRow key={message.id} message={message} locale={locale} />)}
            </ol>
          </section>

          {ticket.status === 'closed' ? (
            <Notice variant="info" action={<button type="button" onClick={() => navigate('neu')} className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"><Plus className="h-4 w-4" />Neue Anfrage</button>}>
              Diese Anfrage ist geschlossen. Für ein neues Anliegen stellen Sie bitte eine neue Anfrage.
            </Notice>
          ) : (
            <form onSubmit={submit} className="form-consistent-fields rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <label className="block text-sm text-gray-700">Antworten
                <textarea value={reply} onChange={event => setReply(event.target.value)} className="form-input mt-1 min-h-28 w-full" placeholder="Ihre Rückmeldung …" maxLength={10000} required />
              </label>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-gray-500">{ticket.status === 'resolved' ? 'Die Anfrage ist gelöst. Eine Antwort öffnet sie wieder.' : 'Der Support meldet sich per E-Mail und hier im Verlauf.'}</p>
                <button type="submit" disabled={busy || !reply.trim()} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Senden
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}

function MessageRow({ message, locale }: { message: SupportMessage; locale: Formatting }) {
  const isAdmin = message.authorType === 'admin';
  const Icon = isAdmin ? Building2 : UserRound;
  return (
    <li className={`px-5 py-4 ${isAdmin ? 'bg-primary-light-custom/30' : ''}`}>
      <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="font-medium text-gray-800">{isAdmin ? `${message.authorName || 'SoloOffice'} · Support` : 'Sie'}</span>
        <span>{formatDateTime(message.createdAt, locale)}</span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm text-gray-900">{message.body}</p>
    </li>
  );
}
