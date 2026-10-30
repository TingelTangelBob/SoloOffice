export const name = '060_recurring_expense_archive';

export async function up(client) {
  await client.query('ALTER TABLE recurring_expenses ADD COLUMN archived_at TIMESTAMPTZ');
  await client.query("CREATE INDEX recurring_expenses_active_workspace_idx ON recurring_expenses(workspace_id, next_due_date) WHERE archived_at IS NULL");
}

export async function down(client) {
  await client.query('DROP INDEX IF EXISTS recurring_expenses_active_workspace_idx');
  await client.query('ALTER TABLE recurring_expenses DROP COLUMN IF EXISTS archived_at');
}
