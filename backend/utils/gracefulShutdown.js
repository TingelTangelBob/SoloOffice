/**
 * Stoppt zuerst neue HTTP-Verbindungen, lässt laufende Requests auslaufen und
 * schließt danach den Datenbank-Pool. Wiederholte Signale teilen sich denselben
 * Ablauf; nach dem Timeout werden verbliebene Verbindungen beendet.
 */
export function createGracefulShutdown({
  httpServer,
  closeDatabase,
  clearMaintenance = () => undefined,
  logger,
  timeoutMs = 10_000,
}) {
  let shutdownPromise;
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10_000;

  return function shutdown(signal = 'unknown') {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = new Promise((resolve, reject) => {
      let finished = false;
      clearMaintenance();
      logger?.info?.('Server shutdown started', { signal, timeoutMs: effectiveTimeoutMs });

      const finish = async ({ error = null, forced = false } = {}) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        try {
          await closeDatabase();
          if (error) throw error;
          logger?.info?.('Server shutdown completed', { signal, forced });
          resolve({ signal, forced });
        } catch (shutdownError) {
          reject(shutdownError);
        }
      };

      const timeout = setTimeout(() => {
        logger?.warn?.('Server shutdown timeout reached', { signal, timeoutMs: effectiveTimeoutMs });
        httpServer.closeAllConnections?.();
        void finish({ forced: true });
      }, effectiveTimeoutMs);

      httpServer.close(error => {
        void finish({ error: error || null });
      });
      httpServer.closeIdleConnections?.();
    });

    return shutdownPromise;
  };
}
