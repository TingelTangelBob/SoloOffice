export function livenessPayload() {
  return { status: 'UP' };
}

export function readinessResult(databaseHealth, { legacy = false } = {}) {
  if (databaseHealth?.healthy) {
    return {
      statusCode: 200,
      payload: legacy
        ? { status: 'OK', message: 'Server is running', database: { status: 'connected' } }
        : { status: 'READY', database: { status: 'connected' } },
    };
  }

  return {
    statusCode: 503,
    payload: legacy
      ? {
          status: 'DEGRADED',
          message: 'Server is running but not ready',
          code: 'DATABASE_UNAVAILABLE',
          database: { status: 'disconnected' },
        }
      : {
          status: 'NOT_READY',
          code: 'DATABASE_UNAVAILABLE',
          database: { status: 'disconnected' },
        },
  };
}
