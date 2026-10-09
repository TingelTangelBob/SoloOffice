import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiService } from '../services/api';
import type { ForecastResult } from '../types/finance';

const EXTENSIONS_CHANGED_EVENT = 'solooffice-extensions-changed';
const FINANCE_CHANGED_EVENT = 'solooffice-finance-changed';

export function useForecast(year: number, enabled = true) {
  const { workspace, can } = useAuth();
  const workspaceId = workspace?.id ?? null;
  const canRead = can('workspace.settings');
  const [forecastState, setForecastState] = useState<{ key: string; value: ForecastResult | null }>({ key: '', value: null });
  const [loading, setLoading] = useState(Boolean(enabled && workspaceId && canRead));
  const [errorState, setErrorState] = useState<{ key: string; value: string | null }>({ key: '', value: null });
  const requestVersion = useRef(0);
  const requestKey = `${workspaceId || ''}:${year}:${enabled}:${canRead}`;

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!enabled || !workspaceId || !canRead || !Number.isInteger(year)) {
      setForecastState({ key: requestKey, value: null });
      setLoading(false);
      setErrorState({ key: requestKey, value: null });
      return;
    }
    setLoading(true);
    setErrorState({ key: requestKey, value: null });
    try {
      const result = await apiService.financeRequest<ForecastResult>(`/forecast/${year}`);
      if (requestVersion.current === version) setForecastState({ key: requestKey, value: result });
    } catch (requestError) {
      if (requestVersion.current === version) {
        setForecastState({ key: requestKey, value: null });
        setErrorState({ key: requestKey, value: requestError instanceof Error ? requestError.message : 'Die Prognose konnte nicht geladen werden.' });
      }
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [enabled, workspaceId, canRead, year, requestKey]);

  useEffect(() => {
    void refresh();
    return () => { requestVersion.current += 1; };
  }, [refresh]);

  useEffect(() => {
    setForecastState({ key: requestKey, value: null });
    setErrorState({ key: requestKey, value: null });
    setLoading(Boolean(enabled && workspaceId && canRead));
  }, [requestKey, workspaceId, enabled, canRead]);

  useEffect(() => {
    const onChanged = () => { void refresh(); };
    window.addEventListener(EXTENSIONS_CHANGED_EVENT, onChanged);
    window.addEventListener(FINANCE_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(EXTENSIONS_CHANGED_EVENT, onChanged);
      window.removeEventListener(FINANCE_CHANGED_EVENT, onChanged);
    };
  }, [refresh]);

  return { forecast: forecastState.key === requestKey ? forecastState.value : null, loading,
    error: errorState.key === requestKey ? errorState.value : null, refresh };
}
