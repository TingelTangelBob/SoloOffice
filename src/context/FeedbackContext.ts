import { createContext, useContext } from 'react';
import type { NoticeVariant } from '../components/Notice';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  isGoBDWarning?: boolean;
}

export interface NotifyOptions {
  variant?: NoticeVariant;
  title?: string;
  message: string;
}

export interface FeedbackContextValue {
  /** Öffnet eine gestaltete Rückfrage und liefert die Entscheidung. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Zeigt eine kurze Rückmeldung am oberen Rand an. */
  notify: (options: NotifyOptions) => void;
}

export const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function useFeedback(): FeedbackContextValue {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useFeedback muss innerhalb von FeedbackProvider verwendet werden.');
  return context;
}
