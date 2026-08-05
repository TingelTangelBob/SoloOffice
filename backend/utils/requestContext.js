import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/**
 * Request-scoped identity used by the database adapter to set PostgreSQL's
 * workspace context before every query.
 */
export function runWithRequestContext(context, callback) {
  return storage.run(context, callback);
}

export function getRequestContext() {
  return storage.getStore();
}

