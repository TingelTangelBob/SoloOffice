import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { apiService } from '../services/api';
import { isDemoMode } from '../services/demoApi';

interface MotionContextValue { animationsEnabled: boolean; setAnimationsEnabled: (enabled: boolean) => Promise<void>; }
const MotionContext = createContext<MotionContextValue>({ animationsEnabled: true, setAnimationsEnabled: async () => undefined });
const DEMO_KEY = 'solooffice-demo-animations-enabled-v1';

export function MotionProvider({ children }: { children: ReactNode }) {
  const [animationsEnabled, setEnabled] = useState(true);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const value = isDemoMode ? window.localStorage.getItem(DEMO_KEY) !== 'false' : await apiService.getMotionPreference();
        if (active) setEnabled(value);
      } catch { /* Standard: Animationen an, bis der Serverwert geladen werden kann. */ }
    };
    void load();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.motion = animationsEnabled ? 'on' : 'off';
    const systemMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const stopCurrentMotion = () => document.getAnimations().forEach(animation => animation.cancel());
    if (!animationsEnabled || systemMotion?.matches) stopCurrentMotion();
    const handleSystemMotionChange = (event: MediaQueryListEvent) => { if (event.matches) stopCurrentMotion(); };
    systemMotion?.addEventListener?.('change', handleSystemMotionChange);
    document.documentElement.style.setProperty('--motion-fast', animationsEnabled ? '120ms' : '0ms');
    document.documentElement.style.setProperty('--motion-base', animationsEnabled ? '180ms' : '0ms');
    document.documentElement.style.setProperty('--motion-slow', animationsEnabled ? '320ms' : '0ms');
    document.documentElement.style.setProperty('--motion-draw', animationsEnabled ? '700ms' : '0ms');
    return () => systemMotion?.removeEventListener?.('change', handleSystemMotionChange);
  }, [animationsEnabled]);
  const setAnimationsEnabled = useCallback(async (enabled: boolean) => {
    const previous = animationsEnabled;
    setEnabled(enabled);
    try {
      if (isDemoMode) window.localStorage.setItem(DEMO_KEY, String(enabled));
      else await apiService.updateMotionPreference(enabled);
    } catch (error) { setEnabled(previous); throw error; }
  }, [animationsEnabled]);
  const value = useMemo(() => ({ animationsEnabled, setAnimationsEnabled }), [animationsEnabled, setAnimationsEnabled]);
  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

export function useMotionPreference() { return useContext(MotionContext); }
