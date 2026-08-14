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
  'invoice_history',
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
  // Audit-Historien sind im Alltag unveränderbar. Nur die ausdrücklich
  // bestätigte Löschung des gesamten Kontos darf sie innerhalb derselben
  // Transaktion entfernen, damit keine verwaisten personenbezogenen Daten
  // zurückbleiben und die Workspace-Löschung nicht am Schutz-Trigger scheitert.
  await client.query("SELECT set_config('app.allow_history_purge', 'true', true)");
  // Beim anschließenden Löschen der aktuellen Rechnungen und EÜR-Sätze
  // dürfen die Audit-Trigger nicht sofort neue Historienzeilen erzeugen.
  await client.query("SELECT set_config('app.audit_disabled', 'true', true)");
  for (const table of WORKSPACE_DATA_DELETE_ORDER) {
    await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [workspaceId]);
  }
  await client.query('DELETE FROM workspace_invitations WHERE workspace_id = $1', [workspaceId]);
  await client.query('DELETE FROM sessions WHERE workspace_id = $1', [workspaceId]);
  await client.query('DELETE FROM workspace_members WHERE workspace_id = $1', [workspaceId]);
  await client.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
}
