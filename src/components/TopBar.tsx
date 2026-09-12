import type { ReactNode } from 'react';
import { Bell, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
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
  onNavigate: (page: string) => void;
  onOpenMobileMenu: () => void;
}

const NOTICE_DOT: Record<TopBarNotice['tone'], string> = {
  warning: 'bg-amber-500',
  negative: 'bg-red-500',
  neutral: 'bg-gray-400',
};

/**
 * Kopfleiste über dem Inhaltsbereich.
 *
 * Sie trägt den Umschalter der Seitenleiste, den Seitentitel, die globale
 * Suche, die Seitenaktionen und die offenen Hinweise. Das Konto sitzt bewusst
 * dauerhaft unten in der Seitenleiste, damit die rechte Seite der Kopfleiste
 * ruhig bleibt.
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
  onNavigate,
  onOpenMobileMenu,
}: TopBarProps) {
  const noticeCount = notices.length;

  return (
    <header className="topbar-shell sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-3 lg:gap-4 lg:px-6">
      <div className="flex min-w-0 basis-0 flex-1 items-center gap-1">
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

        <div id="topbar-page-title" className="min-w-0 flex-1" aria-live="polite" />
      </div>

      {/* Die Suche bleibt mittig, ist auf dem Desktop bewusst kompakter und
          wird auf kleinen Geräten von ihrem Symbol aus aufgeklappt. */}
      <div className="topbar-search-slot shrink-0">{searchSlot}</div>

      <div className="flex min-w-0 basis-0 flex-1 items-center justify-end gap-1 lg:gap-2">
        <div id="topbar-page-actions" className="topbar-page-actions-slot min-w-0 max-w-[min(55vw,42rem)]" />

        {/* Dezente Abtrennung zwischen Seitenaktionen und Hinweisen. */}
        <span className="mx-1 h-5 w-px shrink-0 bg-gray-200" aria-hidden="true" />

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
      </div>
    </header>
  );
}
