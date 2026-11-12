import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, RotateCcw, X } from 'lucide-react';
import { isDemoDataStale, isDemoMode, resetDemoData } from '../services/demoApi';

const REPO_URL = 'https://github.com/TingelTangelBob/SoloOffice';
const SELF_HOSTING_URL = 'https://solooffice.de/selbst-hosten';
const HOSTED_URL = 'https://solooffice.de/preise#warteliste';

const commitSha = import.meta.env.VITE_COMMIT_SHA || '';
const appVersion = import.meta.env.VITE_APP_VERSION || '';
const shortSha = commitSha && commitSha !== 'unknown' ? commitSha.slice(0, 7) : '';

/**
 * Quelltextverweis auf **genau** die laufende Fassung.
 *
 * AGPL § 13 verlangt bei einem über das Netz erreichbaren Dienst, dass Nutzer
 * an den Quelltext der eingesetzten Version kommen. Ein Link auf den
 * Projektstand allgemein genügt dafür nicht, sobald die Demo hinter `main`
 * zurückfällt – deshalb der Commit-genaue Verweis, wenn der Hash im Build
 * steckt.
 */
const sourceUrl = shortSha ? `${REPO_URL}/tree/${commitSha}` : REPO_URL;

const versionLabel = [appVersion && appVersion !== 'dev' ? `v${appVersion}` : '', shortSha]
  .filter(Boolean)
  .join(' · ');

/**
 * Dauerhafter Hinweis, dass es sich um eine Vorführung handelt.
 *
 * Bewusst als schmale, fest stehende Leiste statt als wegklickbarer Kasten:
 * Ein Besucher soll zu jedem Zeitpunkt erkennen können, dass er nicht in einer
 * echten Installation arbeitet – auch tief in einem Formular. Der bestehende
 * Kasten in den Einstellungen ist auf den meisten Seiten unsichtbar und reicht
 * dafür nicht.
 *
 * Erscheint ausschließlich im Demo-Modus; im Self-Hosting rendert die
 * Komponente nichts.
 */
export function DemoNotice() {
  const [stale, setStale] = useState(() => isDemoDataStale());
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Auslöser merken, damit der Fokus nach dem Schließen dorthin zurückkehrt.
  const triggerRef = useRef<HTMLElement | null>(null);

  // Fokus beim Öffnen auf „Abbrechen“ (nicht auf den zerstörenden Knopf),
  // Tab bleibt im Dialog, Escape schließt, beim Schließen Fokus zurück zum Auslöser.
  useEffect(() => {
    if (!confirmReset) return undefined;
    cancelRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setConfirmReset(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && dialog.contains(active);
      if (event.shiftKey && (!inside || active === first)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (!inside || active === last)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      const trigger = triggerRef.current;
      if (trigger && trigger.isConnected) trigger.focus();
    };
  }, [confirmReset]);

  if (!isDemoMode) return null;

  const handleReset = () => {
    setResetting(true);
    resetDemoData();
    // Vollständiges Neuladen statt Zustandspflege im Speicher: Sämtliche
    // Kontexte halten bereits Daten, die sonst zur neu erzeugten Fassung
    // widersprüchlich wären.
    window.location.reload();
  };

  return (
    <>
      {/* Veraltete Testdaten: erscheint nur, wenn der Besucher selbst etwas
          angelegt hat – sonst frischt die Anwendung still auf. */}
      {stale && (
        <div
          role="status"
          className="notice notice-warning fixed inset-x-3 bottom-8 z-50 mx-auto max-w-2xl items-center py-2.5 shadow-lg sm:bottom-10"
        >
          <span className="min-w-0">
            Diese Testdaten sind älter als zwei Wochen – Termine und
            Fälligkeiten passen nicht mehr zum heutigen Datum.
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handleReset}
              disabled={resetting}
              className="rounded-md border border-current px-3 py-1.5 font-medium hover:bg-black/5 disabled:opacity-60"
            >
              Auffrischen
            </button>
            <button
              type="button"
              onClick={() => setStale(false)}
              aria-label="Hinweis schließen"
              className="notice-dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div
        className="demo-bar fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t px-3 py-1 text-xs sm:px-4"
        data-testid="demo-bar"
      >
        <p className="min-w-0 truncate">
          <span className="demo-bar-strong font-semibold">Demo</span>
          <span className="demo-bar-muted mx-1.5">·</span>
          <span className="hidden sm:inline">
            Daten bleiben nur in diesem Browser und werden nicht übertragen
          </span>
          <span className="sm:hidden">nur in diesem Browser</span>
        </p>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={event => {
              triggerRef.current = event.currentTarget;
              setConfirmReset(true);
            }}
            disabled={resetting}
            className="inline-flex min-h-0 items-center gap-1.5 rounded px-2 py-0.5 demo-bar-action disabled:opacity-60 relative after:absolute after:-inset-x-2 after:-top-5 after:-bottom-1 after:content-['']"
            title="Testdaten auf den Ausgangszustand zurücksetzen"
            aria-label="Testdaten zurücksetzen"
          >
            <RotateCcw className="h-3 w-3" />
            <span className="hidden sm:inline">Zurücksetzen</span>
          </button>

          <a
            href={SELF_HOSTING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden min-h-0 items-center gap-1.5 rounded px-2 py-0.5 demo-bar-action sm:inline-flex"
            aria-label="SoloOffice selbst hosten"
            title="SoloOffice selbst hosten"
          >
            <span className="hidden sm:inline">Selbst hosten</span>
            <ExternalLink className="h-3 w-3" />
          </a>

          <a
            href={HOSTED_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden min-h-0 items-center gap-1.5 rounded px-2 py-0.5 demo-bar-action sm:inline-flex"
            aria-label="Gehostetes SoloOffice vormerken"
            title="Gehostetes SoloOffice vormerken"
          >
            <span className="hidden sm:inline">Gehostet</span>
            <ExternalLink className="h-3 w-3" />
          </a>

          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 demo-bar-action relative after:absolute after:inset-x-0 after:-top-5 after:-bottom-1 after:content-['']"
            title="Quelltext genau dieser Fassung ansehen"
          >
            <span>Quelltext</span>
            {versionLabel && (
              <span className="demo-bar-muted hidden font-mono text-[11px] sm:inline">{versionLabel}</span>
            )}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
      {confirmReset && (
        <div
          className="dialog-overlay fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setConfirmReset(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={messageId}
            className="confirmation-dialog w-full max-w-md rounded-lg shadow-lg"
          >
            <div className="confirmation-dialog-header flex items-center justify-between gap-3 border-b p-6">
              <div className="flex min-w-0 items-center space-x-3">
                <div className="confirmation-dialog-icon confirmation-dialog-icon--destructive rounded-full p-2">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <h3 id={titleId} className="confirmation-dialog-title min-w-0 text-lg font-semibold">
                  Demo zurücksetzen?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="confirmation-dialog-close shrink-0"
                aria-label="Dialog schließen"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="confirmation-dialog-content p-6">
              <p id={messageId} className="confirmation-dialog-message whitespace-pre-line leading-relaxed">
                Alle in dieser Demo eingegebenen Daten gehen verloren.
              </p>
            </div>

            <div className="confirmation-dialog-actions form-action-bar border-t p-6">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => setConfirmReset(false)}
                className="confirmation-dialog-cancel rounded-lg border px-4 py-2 transition-colors"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={resetting}
                className="confirmation-dialog-confirm confirmation-dialog-confirm--destructive rounded-lg px-4 py-2 transition-colors"
              >
                Zurücksetzen
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
