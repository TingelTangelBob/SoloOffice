/**
 * The PostgreSQL role used by the application must not be able to bypass RLS.
 *
 * Docker's POSTGRES_USER is a superuser on a fresh volume. FORCE ROW LEVEL
 * SECURITY does not protect against superusers, so demote the current role
 * after the schema is ready. The server restarts once after this migration so
 * pooled connections are established with the new role attributes.
 */

export const name = '032_runtime_rls_role';

export async function up(client) {
  const result = await client.query(`
    SELECT rolsuper
    FROM pg_roles
    WHERE rolname = current_user
  `);

  if (!result.rows[0]?.rolsuper) return { requiresRestart: false };

  await client.query('ALTER ROLE CURRENT_USER NOSUPERUSER NOBYPASSRLS');
  return { requiresRestart: true };
}

export async function down() {
  // Privilege demotion is intentionally not reversed by a rollback. Restoring
  // superuser access would disable the security boundary this migration adds.
}
