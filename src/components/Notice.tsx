import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';

export type NoticeVariant = 'info' | 'success' | 'warning' | 'error';

interface NoticeProps {
  variant?: NoticeVariant;
  title?: string;
  icon?: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
}

export function Notice({ variant = 'info', title, icon: Icon, children, action, onDismiss }: NoticeProps) {
  const role = variant === 'error' || variant === 'warning' ? 'alert' : 'status';

  return (
    <section className={`notice notice-${variant}`} role={role}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          {title && <h2 className="font-semibold">{title}</h2>}
          <div className={title ? 'mt-1' : undefined}>{children}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-start gap-2">
        {action}
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="notice-dismiss" aria-label="Hinweis ausblenden">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}
