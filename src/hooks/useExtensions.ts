import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiService } from '../services/api';
import type { ExtensionId, WorkspaceExtension } from '../../backend/shared/extensions.js';

const EXTENSIONS_CHANGED_EVENT = 'solooffice-extensions-changed';

export function useExtensions() {
  const { workspace } = useAuth();
  const workspaceId = workspace?.id ?? null;
  const [extensions, setExtensions] = useState<WorkspaceExtension[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!workspaceId) {
      setExtensions([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await apiService.financeRequest<WorkspaceExtension[]>('/extensions');
      if (requestVersion.current === version) setExtensions(result);
    } catch (requestError) {
      if (requestVersion.current === version) {
        setError(requestError instanceof Error ? requestError.message : 'Erweiterungen konnten nicht geladen werden.');
      }
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
    return () => { requestVersion.current += 1; };
  }, [refresh]);

  useEffect(() => {
    setExtensions([]);
    setError(null);
    setLoading(true);
  }, [workspaceId]);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string; extension?: WorkspaceExtension }>).detail;
      if (detail?.workspaceId !== workspaceId || !detail.extension) return;
      const updated = detail.extension;
      setExtensions(current => current.map(item => item.id === updated.id ? updated : item));
    };
    window.addEventListener(EXTENSIONS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(EXTENSIONS_CHANGED_EVENT, onChanged);
  }, [workspaceId]);

  const setEnabled = useCallback(async (id: ExtensionId, enabled: boolean, acceptDisclaimer?: boolean) => {
    const version = requestVersion.current;
    setError(null);
    try {
      const updated = await apiService.financeRequest<WorkspaceExtension>(`/extensions/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled, ...(acceptDisclaimer ? { acceptDisclaimer: true } : {}) }),
      });
      if (requestVersion.current === version && workspaceId) {
        setExtensions(current => current.map(item => item.id === id ? updated : item));
        window.dispatchEvent(new CustomEvent(EXTENSIONS_CHANGED_EVENT, { detail: { workspaceId, extension: updated } }));
      }
      return updated;
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Die Änderung konnte nicht gespeichert werden.';
      if (requestVersion.current === version) setError(message);
      throw requestError;
    }
  }, [workspaceId]);

  const isEnabled = useCallback((id: ExtensionId) => {
    const extension = extensions.find(item => item.id === id);
    return extension?.enabled === true && extension.available;
  }, [extensions]);

  return { extensions, loading, error, isEnabled, refresh, setEnabled };
}
