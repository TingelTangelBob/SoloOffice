/**
 * The PostgreSQL role used by the application must not be able to bypass RLS.
 *
 * Docker's POSTGRES_USER is a superuser on a fresh volume. FORCE ROW LEVEL
 * SECURITY does not protect against superusers, so demote the current role
 * after the schema is ready. The server restarts once after this migration so
 * pooled connections are established with the new role attributes.
 */

export const name = '032_runtime_rls_role';

export async function ensureRuntimeRoleIsRlsSafe(client) {
  const result = await client.query(`
    SELECT rolsuper, rolbypassrls
    FROM pg_roles
    WHERE rolname = current_user
  `);

  const role = result.rows[0];
  if (!role?.rolsuper && !role?.rolbypassrls) return false;

  await client.query('ALTER ROLE CURRENT_USER NOSUPERUSER NOBYPASSRLS');
  return true;
}

export async function ensureRlsTablesAreForced(client) {
  const result = await client.query(`
    SELECT
      quote_ident(namespace.nspname) || '.' || quote_ident(table_class.relname) AS qualified_name
    FROM pg_class AS table_class
    JOIN pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
    WHERE table_class.relkind IN ('r', 'p')
      AND table_class.relrowsecurity
      AND NOT table_class.relforcerowsecurity
      AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY namespace.nspname, table_class.relname
  `);

  for (const table of result.rows) {
    await client.query(`ALTER TABLE ${table.qualified_name} FORCE ROW LEVEL SECURITY`);
  }

  return result.rowCount > 0;
}

export async function ensureRuntimeDatabaseIsRlsSafe(client) {
  const tablesChanged = await ensureRlsTablesAreForced(client);
  // Keep superuser capabilities until every table is repaired. This also
  // covers imported dumps whose original table owner differs from DB_USER.
  const roleChanged = await ensureRuntimeRoleIsRlsSafe(client);
  return roleChanged || tablesChanged;
}

export async function up(client) {
  return { requiresRestart: await ensureRuntimeDatabaseIsRlsSafe(client) };
}

export async function down() {
  // Privilege demotion is intentionally not reversed by a rollback. Restoring
  // superuser access would disable the security boundary this migration adds.
}
