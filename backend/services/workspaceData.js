// Gemeinsame, FK-sichere Löschreihenfolge für Workspace-Fachdaten.
// Workspace-Identität und Mitgliedschaften stehen bewusst nicht in dieser Liste.
export const WORKSPACE_BUSINESS_DATA_DELETE_ORDER = [
  'vat_payments', 'levy_payments', 'recurring_expense_runs', 'recurring_expenses', 'tax_profiles', 'workspace_extensions',
  'import_run_items',
  'import_runs',
  'migration_categories',
  'migration_sessions',
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

/**
 * Firmendaten und workspaceweite Einstellungen. Beim Zurücksetzen lässt sich
 * dieser Teil ausdrücklich behalten: Betriebsdaten, Logo, Vorlagen,
 * Nummernkreise und der E-Mail-Versand bleiben dann unverändert.
 */
export const WORKSPACE_COMPANY_PROFILE_TABLES = ['tax_profiles', 'workspace_extensions', 'smtp_settings', 'company', 'yearly_invoice_start_numbers', 'hourly_rates', 'material_templates'];

/**
 * Zustand der Datenübernahme: einmaliger Start je Workspace und der
 * Freigabefortschritt der einzelnen Kategorien.
 */
export const WORKSPACE_TAKEOVER_TABLES = ['migration_categories', 'migration_sessions'];

/**
 * Welche Tabellen ein Reset mit den gewählten Optionen leert. Die Funktion ist
 * bewusst datenbankfrei, damit die Auswahl prüfbar bleibt.
 */
export function planWorkspaceReset(options = {}) {
  const companyProfile = options.companyProfile !== false;
  const takeover = options.takeover !== false;
  const tables = WORKSPACE_BUSINESS_DATA_DELETE_ORDER.filter(table => {
    if (WORKSPACE_COMPANY_PROFILE_TABLES.includes(table)) return companyProfile;
    if (WORKSPACE_TAKEOVER_TABLES.includes(table)) return takeover;
    return true;
  });
  return { companyProfile, takeover, tables };
}

export async function clearWorkspaceBusinessData(client, workspaceId, options = {}) {
  // Audit-Historien sind im Alltag unveränderbar. Reset und Workspace-Löschung
  // sind ausdrücklich destruktive Aktionen und entfernen sie transaktional.
  await client.query("SELECT set_config('app.allow_history_purge', 'true', true)");
  await client.query("SELECT set_config('app.audit_disabled', 'true', true)");
  const plan = planWorkspaceReset(options);
  for (const table of plan.tables) {
    await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [workspaceId]);
  }
  return plan;
}
