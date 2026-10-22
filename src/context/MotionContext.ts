import { createContext, useContext } from 'react';

interface MotionContextValue {
  animationsEnabled: boolean;
  setAnimationsEnabled: (enabled: boolean) => Promise<void>;
}

export const MotionContext = createContext<MotionContextValue>({ animationsEnabled: true, setAnimationsEnabled: async () => undefined });

export function useMotionPreference() { return useContext(MotionContext); }
