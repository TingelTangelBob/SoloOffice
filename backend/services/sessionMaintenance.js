import { query } from '../database.js';

/**
 * Remove sessions that can no longer authenticate. Revoked sessions are kept
 * for a short grace period for incident review, then removed as well.
 */
export async function pruneSessions() {
  const result = await query(`
    DELETE FROM sessions
    WHERE expires_at <= NOW()
       OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '30 days')
  `);
  return result.rowCount || 0;
}
