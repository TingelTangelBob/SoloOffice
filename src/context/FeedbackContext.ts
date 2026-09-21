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

export type BackgroundTaskStatus = 'running' | 'success' | 'error';

export interface BackgroundTask {
  id: string;
  title: string;
  detail: string;
  progress?: number;
  status: BackgroundTaskStatus;
  page?: string;
}

export interface BackgroundTaskOptions {
  title: string;
  detail: string;
  progress?: number;
  page?: string;
}

export interface BackgroundTaskUpdate {
  detail?: string;
  progress?: number;
  status?: BackgroundTaskStatus;
}

export interface FeedbackContextValue {
  /** Öffnet eine gestaltete Rückfrage und liefert die Entscheidung. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Zeigt eine kurze Rückmeldung am oberen Rand an. */
  notify: (options: NotifyOptions) => void;
  /** Legt einen langlebigen Fortschrittseintrag für die Glocke an. */
  backgroundTasks: BackgroundTask[];
  startBackgroundTask: (options: BackgroundTaskOptions) => string;
  updateBackgroundTask: (id: string, update: BackgroundTaskUpdate) => void;
  dismissBackgroundTask: (id: string) => void;
}

export const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function useFeedback(): FeedbackContextValue {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useFeedback muss innerhalb von FeedbackProvider verwendet werden.');
  return context;
}
