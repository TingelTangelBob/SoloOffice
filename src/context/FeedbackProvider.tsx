import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { Notice } from '../components/Notice';
import type { NoticeVariant } from '../components/Notice';
import { generateUUID } from '../utils/uuid';
import { FeedbackContext, type ConfirmOptions, type NotifyOptions } from './FeedbackContext';

interface FeedbackMessage extends NotifyOptions {
  id: string;
  variant: NoticeVariant;
}

/**
 * Jede Rückmeldung blendet sich selbst wieder aus, damit sie nichts dauerhaft
 * überdeckt. Warnungen und Fehler bleiben länger stehen: Sie müssen gelesen
 * und oft noch abgetippt werden. Schließen ist jederzeit möglich.
 */
const AUTO_DISMISS_MS: Record<NoticeVariant, number> = {
  success: 6000,
  info: 6000,
  warning: 12000,
  error: 12000,
};
const MAX_VISIBLE_MESSAGES = 4;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions | null>(null);
  const pendingConfirm = useRef<((result: boolean) => void) | null>(null);
  const timeouts = useRef<number[]>([]);

  useEffect(() => {
    const pendingTimeouts = timeouts.current;
    return () => {
      pendingTimeouts.forEach(window.clearTimeout);
      pendingConfirm.current?.(false);
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setMessages(current => current.filter(message => message.id !== id));
  }, []);

  const notify = useCallback(({ variant = 'info', title, message }: NotifyOptions) => {
    const id = generateUUID();
    setMessages(current => [
      // Dieselbe Meldung mehrfach gleichzeitig zu stapeln hilft niemandem.
      ...current.filter(entry => entry.message !== message),
      { id, variant, title, message },
    ].slice(-MAX_VISIBLE_MESSAGES));

    const timeout = window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS[variant]);
    timeouts.current.push(timeout);
  }, [dismiss]);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => {
    // Eine noch offene Rückfrage wird abgebrochen, damit kein Aufrufer wartet.
    pendingConfirm.current?.(false);
    pendingConfirm.current = resolve;
    setConfirmOptions(options);
  }), []);

  const settleConfirm = useCallback((result: boolean) => {
    const resolve = pendingConfirm.current;
    if (!resolve) return;
    pendingConfirm.current = null;
    setConfirmOptions(null);
    resolve(result);
  }, []);

  const value = useMemo(() => ({ confirm, notify }), [confirm, notify]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      {messages.length > 0 && (
        <div className="feedback-stack" aria-live="polite">
          {messages.map(message => (
            <div key={message.id} className="pointer-events-auto w-full max-w-md shadow-lg">
              <Notice
                variant={message.variant}
                title={message.title}
                onDismiss={() => dismiss(message.id)}
              >
                {message.message}
              </Notice>
            </div>
          ))}
        </div>
      )}

      <ConfirmationModal
        isOpen={Boolean(confirmOptions)}
        onClose={() => settleConfirm(false)}
        onConfirm={() => settleConfirm(true)}
        title={confirmOptions?.title || ''}
        message={confirmOptions?.message || ''}
        confirmText={confirmOptions?.confirmText}
        cancelText={confirmOptions?.cancelText}
        isDestructive={confirmOptions?.isDestructive}
        isGoBDWarning={confirmOptions?.isGoBDWarning}
      />
    </FeedbackContext.Provider>
  );
}
