import { Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Notice } from './Notice';

interface WorkspaceSuspendedNoticeProps {
  onNavigate: (page: string, filter?: string) => void;
}

/**
 * Dauerhinweis für einen vom Control Plane gesperrten Arbeitsbereich (AP-4.4).
 *
 * Eine Sperre – typischerweise wegen offener Zahlungen – ist kein Löschvorgang:
 * Lesen und Export bleiben möglich, jeder Schreibzugriff antwortet mit
 * `403 WORKSPACE_SUSPENDED`. Bisher erfuhr der Nutzer das nur beim Speichern
 * als Fehlermeldung. Der Hinweis steht deshalb bewusst ruhig, nicht
 * wegklickbar und auf jeder Seite über dem Inhalt; die Handlung, die wirklich
 * hilft, ist eine Sicherung der eigenen Daten.
 *
 * Rendert nichts, solange der aktive Arbeitsbereich nicht gesperrt ist.
 */
export function WorkspaceSuspendedNotice({ onNavigate }: WorkspaceSuspendedNoticeProps) {
  const { workspace } = useAuth();
  if (!workspace?.suspended) return null;

  const since = workspace.suspendedAt
    ? new Date(workspace.suspendedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : null;

  return (
    <div className="mb-4" data-testid="workspace-suspended-notice">
      <Notice
        variant="warning"
        icon={Lock}
        title={`Arbeitsbereich „${workspace.name}“ ist gesperrt`}
        action={
          <button
            type="button"
            onClick={() => onNavigate('settings', 'system')}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
          >
            Sicherung erstellen
          </button>
        }
      >
        <p>
          Daten lassen sich weiterhin ansehen und exportieren; Änderungen sind bis zur Freigabe durch den Betreiber nicht möglich
          {since ? ` (gesperrt seit ${since})` : ''}. Bei Fragen zur Freigabe wenden Sie sich an den Betreiber Ihres Hosting-Abos.
        </p>
      </Notice>
    </div>
  );
}
