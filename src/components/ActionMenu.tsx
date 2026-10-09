import { MoreHorizontal } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import { createPortal } from 'react-dom';

interface ActionMenuProps {
  ariaLabel?: string;
  children: ReactNode;
  containerClassName?: string;
  icon?: ReactNode;
  menuClassName?: string;
  title?: string;
  triggerClassName?: string;
  variant?: 'default' | 'primary';
  /** Öffnet das Menü einmal automatisch, wenn sich das Signal ändert. */
  autoOpenSignal?: string | number | null;
  closeOnClick?: boolean;
  disabled?: boolean;
  /** Nutzt für umfangreiche Menüs den Platz bis zum unteren Fensterrand. */
  fitViewport?: boolean;
}

interface MenuPosition {
  left: number;
  top: number;
}

export type ActionMenuTone = 'blue' | 'green' | 'indigo' | 'orange' | 'red' | 'gray';

interface ActionMenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  accessory?: ReactNode;
  children: ReactNode;
  icon: ReactNode;
  multiline?: boolean;
  tone?: ActionMenuTone;
}

const MENU_GAP = 8;
const VIEWPORT_PADDING = 8;
const FALLBACK_MENU_WIDTH = 224;
const FALLBACK_MENU_HEIGHT = 220;

const actionMenuToneClasses: Record<ActionMenuTone, { icon: string; item: string }> = {
  blue: { icon: 'text-blue-600', item: 'text-gray-700 hover:bg-blue-50' },
  green: { icon: 'text-green-600', item: 'text-gray-700 hover:bg-green-50' },
  indigo: { icon: 'text-indigo-600', item: 'text-gray-700 hover:bg-indigo-50' },
  orange: { icon: 'text-orange-600', item: 'text-gray-700 hover:bg-orange-50' },
  red: { icon: 'text-red-600', item: 'text-red-700 hover:bg-red-50' },
  gray: { icon: 'text-gray-500', item: 'text-gray-700 hover:bg-gray-50' }
};

export function ActionMenuItem({
  accessory,
  children,
  className = '',
  icon,
  multiline = false,
  tone = 'gray',
  type = 'button',
  ...buttonProps
}: ActionMenuItemProps) {
  const colors = actionMenuToneClasses[tone];

  const item = (
    <button
      {...buttonProps}
      type={type}
      className={`action-menu-item flex min-h-0 ${accessory ? 'min-w-0 flex-1' : 'w-full'} ${multiline ? 'items-start action-menu-item-multiline' : 'items-center'} gap-2 rounded-md px-3 py-1 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${colors.item} ${className}`}
    >
      <span className={`shrink-0 ${colors.icon}`}>{icon}</span>
      <span className={`min-w-0 flex-1 ${multiline ? '' : 'truncate'}`}>{children}</span>
    </button>
  );
  if (!accessory) return item;
  return (
    <div className="flex items-center gap-1" role="none">
      {item}
      <span className="shrink-0" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>{accessory}</span>
    </div>
  );
}

export function ActionMenu({
  ariaLabel = 'Aktionen',
  children,
  containerClassName = '',
  icon = <MoreHorizontal className="h-4 w-4" />,
  menuClassName = 'min-w-52',
  title = 'Aktionen',
  triggerClassName = 'action-icon-button action-icon-blue',
  variant = 'default',
  autoOpenSignal = null,
  closeOnClick = true,
  disabled = false,
  fitViewport = false,
}: ActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const autoCloseTimer = useRef<number | null>(null);
  const portalTarget = typeof document !== 'undefined'
    ? document.getElementById('app-shell') || document.body
    : null;

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const menuWidth = menuRef.current?.offsetWidth || FALLBACK_MENU_WIDTH;
    const menuHeight = menuRef.current?.offsetHeight || FALLBACK_MENU_HEIGHT;
    const opensUp = triggerRect.bottom + menuHeight + MENU_GAP > window.innerHeight
      && triggerRect.top - menuHeight - MENU_GAP >= VIEWPORT_PADDING;
    const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - menuWidth - VIEWPORT_PADDING);
    const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - menuHeight - VIEWPORT_PADDING);
    const preferredTop = opensUp
      ? triggerRect.top - menuHeight - MENU_GAP
      : triggerRect.bottom + MENU_GAP;

    setPosition({
      left: Math.min(Math.max(VIEWPORT_PADDING, triggerRect.right - menuWidth), maxLeft),
      top: Math.min(Math.max(VIEWPORT_PADDING, preferredTop), maxTop)
    });
  }, []);

  const toggleMenu = () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }

    setIsOpen(true);
    updatePosition();
  };

  useLayoutEffect(() => {
    if (isOpen) {
      updatePosition();
      // Echte Menüeinträge zuerst: Ein Hilfe-Symbol im Menü soll beim Öffnen
      // nicht den Fokus und damit seine Kurzinfo bekommen.
      requestAnimationFrame(() => (menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled):not([aria-disabled="true"])')
        || menuRef.current?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus());
    }
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (autoOpenSignal == null) return undefined;

    setIsOpen(true);
    updatePosition();
    if (autoCloseTimer.current !== null) window.clearTimeout(autoCloseTimer.current);
    autoCloseTimer.current = window.setTimeout(() => {
      setIsOpen(false);
      autoCloseTimer.current = null;
    }, 2400);

    return undefined;
  }, [autoOpenSignal, updatePosition]);

  useEffect(() => () => {
    if (autoCloseTimer.current !== null) window.clearTimeout(autoCloseTimer.current);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  return (
    <div className={containerClassName}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleMenu}
        className={`${variant === 'primary' ? 'action-menu-trigger-primary' : 'action-menu-trigger'} ${triggerClassName}`}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        title={title}
        disabled={disabled}
      >
        {icon}
      </button>

      {isOpen && portalTarget && createPortal(
        <div
          ref={menuRef}
          className={`action-menu fixed z-[1000] max-h-[min(70vh,22rem)] overflow-x-hidden overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 text-left shadow-xl ${menuClassName}`}
          role="menu"
          style={{
            left: position?.left ?? VIEWPORT_PADDING,
            top: position?.top ?? VIEWPORT_PADDING,
            maxWidth: `calc(100vw - ${VIEWPORT_PADDING * 2}px)`,
            boxSizing: 'border-box',
            maxHeight: fitViewport ? `calc(100dvh - ${(position?.top ?? VIEWPORT_PADDING) + VIEWPORT_PADDING}px)` : undefined,
            visibility: position ? 'visible' : 'hidden'
          }}
          onClick={event => { if (closeOnClick && !event.defaultPrevented) setIsOpen(false); }}
          onKeyDown={event => {
            const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [role^="menuitem"]:not([aria-disabled="true"])') || []);
            const currentIndex = items.indexOf(document.activeElement as HTMLElement);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const nextIndex = event.key === 'ArrowDown'
                ? (currentIndex + 1 + items.length) % items.length
                : (currentIndex - 1 + items.length) % items.length;
              items[nextIndex]?.focus();
            } else if (event.key === 'Home') {
              event.preventDefault(); items[0]?.focus();
            } else if (event.key === 'End') {
              event.preventDefault(); items.at(-1)?.focus();
            } else if (event.key === 'Escape') {
              setIsOpen(false); triggerRef.current?.focus();
            } else if (event.key === 'Tab') {
              setIsOpen(false);
            }
          }}
        >
          {children}
        </div>,
        portalTarget
      )}
    </div>
  );
}
