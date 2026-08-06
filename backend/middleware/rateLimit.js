import { query } from '../database.js';
import logger from '../utils/logger.js';

function safeKey(value) {
  return String(value || 'unknown').slice(0, 180);
}

/**
 * PostgreSQL-backed fixed-window limiter. It works across backend replicas and
 * does not grow an unbounded in-process map of attacker-controlled keys.
 */
export function persistentRateLimit({ name, windowMs, max, keyGenerator = req => req.ip, failClosed = false }) {
  return async (req, res, next) => {
    const bucketKey = `${name}:${safeKey(keyGenerator(req))}`;
    try {
      const result = await query(`
        INSERT INTO rate_limit_buckets (bucket_key, window_started, hit_count, updated_at)
        VALUES ($1, NOW(), 1, NOW())
        ON CONFLICT (bucket_key) DO UPDATE SET
          hit_count = CASE
            WHEN rate_limit_buckets.window_started <= NOW() - ($2::bigint * INTERVAL '1 millisecond') THEN 1
            ELSE rate_limit_buckets.hit_count + 1
          END,
          window_started = CASE
            WHEN rate_limit_buckets.window_started <= NOW() - ($2::bigint * INTERVAL '1 millisecond') THEN NOW()
            ELSE rate_limit_buckets.window_started
          END,
          updated_at = NOW()
        RETURNING hit_count,
          EXTRACT(EPOCH FROM (
            window_started + ($2::bigint * INTERVAL '1 millisecond') - NOW()
          )) AS retry_after
      `, [bucketKey, windowMs]);

      const bucket = result.rows[0];
      if (Number(bucket.hit_count) > max) {
        const retryAfter = Math.max(1, Math.ceil(Number(bucket.retry_after || windowMs / 1000)));
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({
          error: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.',
          retryAfter,
        });
      }
      return next();
    } catch (error) {
      logger.error('Rate-Limit konnte nicht geprüft werden', { name, error: error.message });
      if (failClosed) {
        return res.status(503).json({ error: 'Sicherheitsprüfung momentan nicht verfügbar.' });
      }
      return next();
    }
  };
}

export async function pruneRateLimitBuckets() {
  await query(`
    DELETE FROM rate_limit_buckets
    WHERE updated_at < NOW() - INTERVAL '2 hours'
  `);
}
