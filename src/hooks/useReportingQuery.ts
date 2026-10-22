import { useLayoutEffect, useState } from 'react';
import { createRequestScope, runScopedRequest } from '../utils/reportingRequests';

/** Veraltete Filter- und Workspace-Antworten dürfen weder Daten noch Fehler setzen. */
export function useReportingQuery<T>(key: string, request: () => Promise<T>) {
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ key: string; data: T | null; error: unknown; loading: boolean } | null>(null);
  useLayoutEffect(() => {
    const scope = createRequestScope();
    setResult({ key, data: null, error: null, loading: true });
    void runScopedRequest(scope, request,
      data => setResult({ key, data, error: null, loading: true }),
      error => setResult({ key, data: null, error, loading: true }),
      () => setResult(current => current?.key === key ? { ...current, loading: false } : current),
    );
    return scope.invalidate;
  }, [key, refresh, request]);
  return {
    data: result?.key === key ? result.data : null,
    error: result?.key === key ? result.error : null,
    loading: result?.key === key ? result.loading : true,
    reload: () => setRefresh(current => current + 1),
  };
}
