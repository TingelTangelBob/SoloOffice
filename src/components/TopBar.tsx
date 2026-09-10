import type { ReactNode } from 'react';
import { Bell, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings as SettingsIcon, Building2, CircleUserRound } from 'lucide-react';
import { ActionMenu, ActionMenuItem } from './ActionMenu';

export interface TopBarNotice {
  id: string;
  label: string;
  detail: string;
  page: string;
  tone: 'warning' | 'negative' | 'neutral';
}

interface TopBarProps {
  searchSlot: ReactNode;
  isSidebarCompact: boolean;
  onToggleSidebar: () => void;
  notices: TopBarNotice[];
  userName: string;
  userEmail?: string;
  workspaceName: string;
  onNavigate: (page: string) => void;
  onOpenMobileMenu: () => void;
  onLogout: () => void;
}

const NOTICE_DOT: Record<TopBarNotice['tone'], string> = {
  warning: 'bg-amber-500',
  negative: 'bg-red-500',
  neutral: 'bg-gray-400',
};

/** Initialen aus dem Anzeigenamen; bei nur einem Wort dessen erste zwei Zeichen. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '–';
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase('de-DE');
  return (parts[0][0] + parts[parts.length - 1][0]).toLocaleUpperCase('de-DE');
}

/**
 * Kopfleiste über dem Inhaltsbereich.
 *
 * Sie trägt den Umschalter der Seitenleiste, die globale Suche, die offenen
 * Hinweise und das Benutzermenü. Umschalter, Suche und Benutzermenü standen
 * vorher in der Seitenleiste – sie sind umgezogen und nicht doppelt vorhanden.
 * Den Namen der Ansicht trägt die Seitenüberschrift im Inhalt.
 *
 * Auf schmalen Geräten sitzt hier auch der Knopf für die Seitenleiste. Vorher
 * schwebte er frei über dem Inhalt; in der Leiste kann er nichts mehr
 * verdecken.
 */
export function TopBar({
  searchSlot,
  isSidebarCompact,
  onToggleSidebar,
  notices,
  userName,
  userEmail,
  workspaceName,
  onNavigate,
  onOpenMobileMenu,
  onLogout,
}: TopBarProps) {
  const noticeCount = notices.length;

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-3 lg:grid lg:grid-cols-[1fr_minmax(0,26rem)_1fr] lg:px-6">
      <div className="flex shrink-0 items-center lg:justify-self-start">
      <button
        type="button"
        onClick={onOpenMobileMenu}
        aria-label="Menü öffnen"
        className="topbar-icon-button -ml-1 shrink-0 lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <button
        type="button"
        onClick={onToggleSidebar}
        aria-pressed={isSidebarCompact}
        aria-label={isSidebarCompact ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}
        title={isSidebarCompact ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}
        className="topbar-icon-button sidebar-toggle -ml-1 hidden shrink-0 lg:inline-flex"
      >
        {isSidebarCompact
          ? <PanelLeftOpen className="h-[1.125rem] w-[1.125rem]" />
          : <PanelLeftClose className="h-[1.125rem] w-[1.125rem]" />}
      </button>

      </div>

      {/* Mittlere Rasterspalte. Die Höchstbreite verhindert, dass die Suche
          über die ganze Leiste läuft und wie ein Formularfeld wirkt. */}
      <div className="min-w-0 flex-1 lg:flex-none">{searchSlot}</div>

      <div className="flex shrink-0 items-center gap-1 lg:justify-self-end">
        <ActionMenu
          ariaLabel={noticeCount > 0 ? `Hinweise (${noticeCount})` : 'Hinweise'}
          title="Hinweise"
          menuClassName="min-w-[17rem]"
          triggerClassName="topbar-icon-button relative"
          icon={
            <>
              <Bell className="h-[1.125rem] w-[1.125rem]" />
              {noticeCount > 0 && (
                <span
                  className="topbar-badge"
                  aria-hidden="true"
                />
              )}
            </>
          }
        >
          <p className="px-3 pb-1 pt-2 text-xs font-medium text-gray-500">
            {noticeCount > 0 ? 'Offene Hinweise' : 'Hinweise'}
          </p>
          {notices.length > 0 ? (
            notices.map((notice) => (
              <ActionMenuItem
                key={notice.id}
                icon={<span className={`block h-2 w-2 rounded-full ${NOTICE_DOT[notice.tone]}`} />}
                onClick={() => onNavigate(notice.page)}
              >
                <span className="block truncate font-medium text-gray-900">{notice.label}</span>
                <span className="block truncate text-xs text-gray-500">{notice.detail}</span>
              </ActionMenuItem>
            ))
          ) : (
            <p className="px-3 pb-2 pt-1 text-sm text-gray-500">Zurzeit nichts zu tun.</p>
          )}
        </ActionMenu>

        {/* Dezente Abtrennung zwischen Hinweisen und Benutzerkonto. */}
        <span className="mx-1 h-5 w-px shrink-0 bg-gray-200" aria-hidden="true" />

        <ActionMenu
          ariaLabel={`Konto von ${userName}`}
          title={userName}
          menuClassName="min-w-[15rem]"
          triggerClassName="topbar-user-button"
          icon={
            <>
              <span className="topbar-avatar" aria-hidden="true">{initialsOf(userName)}</span>
              <span className="hidden min-w-0 max-w-[10rem] truncate text-sm font-medium lg:block">
                {userName}
              </span>
            </>
          }
        >
          <div className="border-b border-gray-200 px-3 pb-2 pt-1.5">
            <p className="truncate text-sm font-medium text-gray-900">{userName}</p>
            <p className="truncate text-xs text-gray-500">{userEmail || workspaceName}</p>
          </div>
          <div className="pt-1">
            <ActionMenuItem icon={<CircleUserRound className="h-4 w-4" />} onClick={() => onNavigate('profile')}>
              Profil
            </ActionMenuItem>
            <ActionMenuItem icon={<SettingsIcon className="h-4 w-4" />} onClick={() => onNavigate('settings')}>
              Einstellungen
            </ActionMenuItem>
            <ActionMenuItem icon={<Building2 className="h-4 w-4" />} onClick={() => onNavigate('workspace')}>
              Workspace
            </ActionMenuItem>
          </div>
          <div className="mt-1 border-t border-gray-200 pt-1">
            <ActionMenuItem icon={<LogOut className="h-4 w-4" />} tone="red" onClick={onLogout}>
              Abmelden
            </ActionMenuItem>
          </div>
        </ActionMenu>
      </div>
    </header>
  );
}
