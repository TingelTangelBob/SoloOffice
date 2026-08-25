import { useState } from 'react';
import { ExternalLink, RotateCcw, X } from 'lucide-react';
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
          className="fixed inset-x-0 bottom-8 z-50 mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 shadow-lg sm:bottom-10"
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
              className="rounded-md bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700 disabled:opacity-60"
            >
              Auffrischen
            </button>
            <button
              type="button"
              onClick={() => setStale(false)}
              aria-label="Hinweis schließen"
              className="rounded-md p-1.5 text-amber-800 hover:bg-amber-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div
        className="demo-bar fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-gray-700 bg-gray-900 px-3 py-1 text-xs text-gray-300 sm:px-4"
        data-testid="demo-bar"
      >
        <p className="min-w-0 truncate">
          <span className="font-semibold text-white">Demo</span>
          <span className="mx-1.5 text-gray-500">·</span>
          <span className="hidden sm:inline">
            Daten bleiben nur in diesem Browser und werden nicht übertragen
          </span>
          <span className="sm:hidden">nur in diesem Browser</span>
        </p>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={resetting}
            className="inline-flex min-h-0 items-center gap-1.5 rounded px-2 py-0.5 hover:bg-gray-800 hover:text-white disabled:opacity-60"
            title="Testdaten auf den Ausgangszustand zurücksetzen"
          >
            <RotateCcw className="h-3 w-3" />
            <span className="hidden sm:inline">Zurücksetzen</span>
          </button>

          <a
            href={SELF_HOSTING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-0 items-center gap-1.5 rounded px-2 py-0.5 hover:bg-gray-800 hover:text-white"
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
            className="inline-flex min-h-0 items-center gap-1.5 rounded px-2 py-0.5 hover:bg-gray-800 hover:text-white"
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
            className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 hover:bg-gray-800 hover:text-white"
            title="Quelltext genau dieser Fassung ansehen"
          >
            <span className="hidden sm:inline">Quelltext</span>
            {versionLabel && (
              <span className="hidden font-mono text-[11px] text-gray-500 sm:inline">{versionLabel}</span>
            )}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </>
  );
}
