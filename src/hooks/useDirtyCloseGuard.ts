import { useCallback, useEffect, useRef } from 'react';
import type { ConfirmOptions } from '../context/FeedbackContext';

interface UseDirtyCloseGuardOptions {
  isDirty: boolean;
  isDisabled?: boolean;
  onClose: () => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  title?: string;
  message?: string;
}

export function useDirtyCloseGuard({
  isDirty,
  isDisabled = false,
  onClose,
  confirm,
  title = 'Ungespeicherte Änderungen',
  message = 'Es gibt ungespeicherte Änderungen. Möchten Sie diese wirklich verwerfen?',
}: UseDirtyCloseGuardOptions) {
  const confirmationPending = useRef(false);

  useEffect(() => {
    if (!isDirty) return;
    const protectNavigation = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectNavigation);
    return () => window.removeEventListener('beforeunload', protectNavigation);
  }, [isDirty]);

  return useCallback(async () => {
    if (isDisabled || confirmationPending.current) return;

    if (!isDirty) {
      onClose();
      return;
    }

    confirmationPending.current = true;
    try {
      const shouldClose = await confirm({
        title,
        message,
        confirmText: 'Änderungen verwerfen',
        cancelText: 'Weiter bearbeiten',
        isDestructive: true,
      });
      if (shouldClose) onClose();
    } finally {
      confirmationPending.current = false;
    }
  }, [confirm, isDisabled, isDirty, message, onClose, title]);
}
