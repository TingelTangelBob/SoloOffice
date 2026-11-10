import { createContext, useContext } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export interface LoadingContextType {
  /** Alle Daten sind geladen; Seiten dürfen Listen voraussetzen. */
  loading: boolean;
  /** Firmendaten sind da: Navigation, Module und Farben stehen fest, die Hülle darf erscheinen. */
  shellReady: boolean;
  error: string | null;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setShellReady: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

export const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

export function useLoading(): LoadingContextType {
  const context = useContext(LoadingContext);
  if (context === undefined) {
    throw new Error('useLoading must be used within LoadingProvider');
  }
  return context;
}
