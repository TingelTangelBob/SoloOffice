// Gemeinsame, FK-sichere Löschreihenfolge für Workspace-Fachdaten.
// Workspace-Identität, Mitgliedschaften und migration_sessions stehen bewusst
// nicht in dieser Liste.
export const WORKSPACE_BUSINESS_DATA_DELETE_ORDER = [
  'migration_categories',
  'import_run_items',
  'import_runs',
  'smtp_settings',
  'invoice_job_sources',
  'email_history',
  'customer_emails',
  'customer_hourly_rates',
  'customer_specific_hourly_rates',
  'customer_specific_materials',
  'recurring_invoice_runs',
  'recurring_invoices',
  'job_time_entries',
  'job_attachments',
  'job_entries',
  'job_recurrences',
  'quote_attachments',
  'quote_items',
  'invoice_attachments',
  'invoice_original_documents',
  'invoice_history',
  'invoice_items',
  'invoices',
  'quotes',
  'calendar_events',
  'hourly_rates',
  'material_templates',
  'customers',
  'company',
  'yearly_invoice_start_numbers',
  'receipts',
  'fixed_assets',
  'euer_entry_history',
  'euer_entries',
  'incoming_e_invoices',
];

export async function clearWorkspaceBusinessData(client, workspaceId) {
  // Audit-Historien sind im Alltag unveränderbar. Reset und Workspace-Löschung
  // sind ausdrücklich destruktive Aktionen und entfernen sie transaktional.
  await client.query("SELECT set_config('app.allow_history_purge', 'true', true)");
  await client.query("SELECT set_config('app.audit_disabled', 'true', true)");
  for (const table of WORKSPACE_BUSINESS_DATA_DELETE_ORDER) {
    await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [workspaceId]);
  }
}
