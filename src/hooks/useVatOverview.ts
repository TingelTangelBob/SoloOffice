import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { financeApi } from '../services/financeApi';
import type { VatOverview } from '../types/vat';

const EXTENSIONS_CHANGED_EVENT = 'solooffice-extensions-changed';
const FINANCE_CHANGED_EVENT = 'solooffice-finance-changed';

/**
 * Umsatzsteuer-Übersicht eines Jahres. Anders als die private Prognose ist sie
 * betrieblich und braucht nur die Erweiterung, nicht das Einstellungsrecht.
 */
export function useVatOverview(year: number, enabled = true) {
  const { workspace } = useAuth();
  const workspaceId = workspace?.id ?? null;
  const requestKey = `${workspaceId || ''}:${year}:${enabled}`;
  const [state, setState] = useState<{ key: string; value: VatOverview | null; error: string | null }>({ key: '', value: null, error: null });
  const [loading, setLoading] = useState(Boolean(enabled && workspaceId));
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!enabled || !workspaceId || !Number.isInteger(year)) {
      setState({ key: requestKey, value: null, error: null });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await financeApi.getVatOverview(year);
      if (requestVersion.current === version) setState({ key: requestKey, value: result, error: null });
    } catch (requestError) {
      if (requestVersion.current === version) {
        setState({ key: requestKey, value: null, error: requestError instanceof Error ? requestError.message : 'Die Umsatzsteuer-Übersicht konnte nicht geladen werden.' });
      }
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [enabled, workspaceId, year, requestKey]);

  useEffect(() => {
    void refresh();
    return () => { requestVersion.current += 1; };
  }, [refresh]);

  useEffect(() => {
    const onChanged = () => { void refresh(); };
    window.addEventListener(EXTENSIONS_CHANGED_EVENT, onChanged);
    window.addEventListener(FINANCE_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(EXTENSIONS_CHANGED_EVENT, onChanged);
      window.removeEventListener(FINANCE_CHANGED_EVENT, onChanged);
    };
  }, [refresh]);

  const current = state.key === requestKey;
  return { overview: current ? state.value : null, error: current ? state.error : null, loading, refresh };
}
