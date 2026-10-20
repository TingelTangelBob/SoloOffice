import { useState } from 'react';
import { ArrowRight, ArrowRightLeft, Database, Mail } from 'lucide-react';
import { BackupManagement } from '../BackupManagement';
import { EmailManagement } from '../EmailManagement';
import { SettingsCard } from './SettingsUi';

/** Bereich „E-Mail & Backup“ (`#settings/system`). Speichert jeweils direkt. */
export function SystemArea({ isDemoMode, onNavigate }: { isDemoMode: boolean; onNavigate?: (page: string) => void }) {
  const [showBackupManagement, setShowBackupManagement] = useState(false);

  return (
    <>
      <SettingsCard
        sectionId="email"
        icon={Mail}
        title="E-Mail-Versand"
        description={isDemoMode ? 'Im Demo-Modus ist die SMTP-Verwaltung deaktiviert.' : 'Absender, SMTP-Zugang und Benachrichtigungen.'}
      >
        {!isDemoMode && <EmailManagement embedded />}
      </SettingsCard>

      <SettingsCard
        sectionId="sicherung"
        icon={Database}
        title="Datensicherung"
        description="JSON- und ZIP-Sicherungen erstellen, verwalten oder wiederherstellen."
        actions={(
          <button
            type="button"
            onClick={() => setShowBackupManagement(true)}
            disabled={isDemoMode}
            className="btn-primary inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            Sicherungen verwalten
          </button>
        )}
      >
        {isDemoMode && <p className="text-xs text-gray-500">Im Demo-Modus nicht verfügbar.</p>}
      </SettingsCard>

      <SettingsCard
        sectionId="datenuebernahme"
        icon={ArrowRightLeft}
        title="Datenübernahme"
        actions={(
          <button type="button" onClick={() => onNavigate?.('data-import')} className="btn-secondary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium">
            Datenübernahme öffnen
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      />

      {showBackupManagement && <BackupManagement onClose={() => setShowBackupManagement(false)} />}
    </>
  );
}
