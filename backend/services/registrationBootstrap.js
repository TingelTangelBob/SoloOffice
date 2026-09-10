// Shared transaction lock for the first-registration decision path.
// The two-part key avoids coupling the lock to a particular table row. Since
// this is an xact lock, PostgreSQL releases it on COMMIT or ROLLBACK.
const REGISTRATION_BOOTSTRAP_LOCK_NAMESPACE = 0x534f;
const REGISTRATION_BOOTSTRAP_LOCK_ID = 0x424f4f54;

/**
 * Serialize registration decisions for the lifetime of the current transaction.
 *
 * @param {import('pg').PoolClient} client
 * @returns {Promise<void>}
 */
export async function lockRegistrationBootstrap(client) {
  await client.query(
    'SELECT pg_advisory_xact_lock($1::integer, $2::integer)',
    [REGISTRATION_BOOTSTRAP_LOCK_NAMESPACE, REGISTRATION_BOOTSTRAP_LOCK_ID],
  );
}
