const WORKSPACE_DATA_DELETE_ORDER = [
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
  'quotes',
  'invoice_attachments',
  'invoice_items',
  'invoices',
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

export async function deleteWorkspaceData(client, workspaceId) {
  for (const table of WORKSPACE_DATA_DELETE_ORDER) {
    await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [workspaceId]);
  }
  await client.query('DELETE FROM workspace_invitations WHERE workspace_id = $1', [workspaceId]);
  await client.query('DELETE FROM sessions WHERE workspace_id = $1', [workspaceId]);
  await client.query('DELETE FROM workspace_members WHERE workspace_id = $1', [workspaceId]);
  await client.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
}
