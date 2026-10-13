import { useEffect, useRef } from 'react';
import { useFeedback } from '../context/FeedbackContext';
import { registerNavigationGuard } from '../utils/navigationGuard';

interface UnsavedChangesGuardOptions {
  id: string;
  isDirty: boolean;
  title?: string;
  message?: string;
}

/**
 * Warnt vor dem Verlassen mit ungespeicherten Änderungen: beim Schließen oder
 * Neuladen über den Browser, beim Seitenwechsel innerhalb der App über
 * `confirmNavigation`.
 */
export function useUnsavedChangesGuard({
  id,
  isDirty,
  title = 'Ungespeicherte Änderungen',
  message = 'Es gibt ungespeicherte Änderungen. Möchten Sie diese verwerfen?',
}: UnsavedChangesGuardOptions) {
  const { confirm } = useFeedback();
  const state = useRef({ isDirty, title, message, confirm });
  state.current = { isDirty, title, message, confirm };

  useEffect(() => registerNavigationGuard({
    id,
    isBlocking: () => state.current.isDirty,
    confirm: () => state.current.confirm({
      title: state.current.title,
      message: state.current.message,
      confirmText: 'Änderungen verwerfen',
      cancelText: 'Weiter bearbeiten',
      isDestructive: true,
    }),
  }), [id]);

  useEffect(() => {
    if (!isDirty) return;
    const protectNavigation = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectNavigation);
    return () => window.removeEventListener('beforeunload', protectNavigation);
  }, [isDirty]);
}
