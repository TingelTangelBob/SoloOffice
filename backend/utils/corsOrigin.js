export function createCorsOriginValidator(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return (origin, callback) => {
    if (!origin || allowed.has(origin)) return callback(null, true);
    const error = new Error('Anfrageursprung nicht erlaubt');
    error.status = 403;
    error.code = 'CORS_ORIGIN_DENIED';
    return callback(error);
  };
}
