import express from 'express';
import { pool } from '../database.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Define JSONB columns for each table that need special handling during restore
const JSONB_COLUMNS = {
  'email_history': ['attachments', 'smtp_response'],
  'job_entries': ['materials', 'signature'],
  'job_recurrences': ['rule'],
  'company': ['payment_methods', 'invoice_templates', 'document_templates'],
  'receipts': ['extracted_data', 'ocr_extracted_data'],
  'euer_entry_history': ['old_data', 'new_data'],
  'invoice_history': ['old_data', 'new_data'],
  'incoming_e_invoices': ['extracted_data']
};

const BACKUP_TABLES = [
  'customers',
  'customer_emails',
  'recurring_invoices',
  'recurring_invoice_runs',
  'invoices',
  'invoice_items',
  'invoice_attachments',
  'invoice_job_sources',
  'quotes',
  'quote_items',
  'quote_attachments',
  'job_recurrences',
  'job_entries',
  'calendar_events',
  'job_attachments',
  'job_time_entries',
  'company',
  'hourly_rates',
  'material_templates',
  'yearly_invoice_start_numbers',
  'euer_entries',
  'euer_entry_history',
  'invoice_history',
  'fixed_assets',
  'receipts',
  'email_history',
  'smtp_settings',
  'customer_hourly_rates',
  'customer_specific_hourly_rates',
  'customer_specific_materials',
  'incoming_e_invoices'
];

// Änderungshistorien stehen bewusst nicht in dieser Liste. Sie sind per
// Datenbank-Trigger gegen UPDATE und DELETE gesperrt – ein Löschversuch würde
// die gesamte Wiederherstellung abbrechen. Fachlich passt es ebenfalls: Der
// Nachweis, wer wann was geändert hat, darf durch das Einspielen einer
// Sicherung nicht verschwinden. Die Sätze aus der Sicherung kommen hinzu.
const RESTORE_CLEAR_TABLES = [
  'email_history', 'customer_emails', 'customer_hourly_rates',
  'customer_specific_hourly_rates', 'customer_specific_materials',
  'recurring_invoice_runs', 'recurring_invoices',
  'job_time_entries', 'job_attachments',
  'quote_attachments', 'quote_items', 'quotes',
  'invoice_attachments', 'invoice_items', 'invoice_job_sources', 'calendar_events', 'job_entries', 'job_recurrences', 'invoices',
  'hourly_rates', 'material_templates', 'customers', 'company',
  'yearly_invoice_start_numbers', 'receipts', 'fixed_assets', 'euer_entries', 'incoming_e_invoices'
];

const RESTORE_ORDER = [
  'company',
  'customers',
  'yearly_invoice_start_numbers',
  'euer_entries',
  'euer_entry_history',
  'fixed_assets',
  'hourly_rates',
  'material_templates',
  'customer_hourly_rates',
  'customer_specific_hourly_rates',
  'customer_specific_materials',
  'recurring_invoices',
  'calendar_events',
  'invoices',
  'receipts',
  'invoice_items',
  'invoice_history',
  'invoice_attachments',
  'recurring_invoice_runs',
  'quotes',
  'quote_items',
  'quote_attachments',
  'job_recurrences',
  'job_entries',
  'job_attachments',
  'job_time_entries',
  'invoice_job_sources',
  'customer_emails',
  'email_history',
  'incoming_e_invoices'
];

/**
 * Tabellen mit protokollierenden Triggern. Während der Wiederherstellung
 * werden sie stillgelegt: Sonst erzeugt jeder eingespielte Datensatz einen
 * frischen Historieneintrag und täuscht eine Änderung vor, die nie stattfand.
 */
async function setAuditSuppressed(client, suppressed) {
  // Transaktionslokale Sitzungsvariable statt ALTER TABLE ... DISABLE TRIGGER:
  // Das funktioniert ohne Tabellenbesitzer-Rechte und kann nach einem Fehler
  // nicht versehentlich für die nächste Pool-Verbindung aktiv bleiben.
  await client.query("SELECT set_config('app.audit_disabled', $1, true)", [suppressed ? 'true' : 'false']);
}

const WORKSPACE_SCOPED_TABLES = new Set([
  'customers', 'customer_emails', 'recurring_invoices', 'recurring_invoice_runs', 'invoices', 'invoice_items', 'invoice_attachments', 'invoice_job_sources',
  'quotes', 'quote_items', 'quote_attachments', 'job_recurrences', 'job_entries', 'job_attachments',
  'calendar_events', 'job_time_entries', 'company', 'hourly_rates', 'material_templates',
  'yearly_invoice_start_numbers', 'euer_entries', 'euer_entry_history', 'fixed_assets',
  'receipts', 'email_history', 'smtp_settings', 'customer_hourly_rates',
  'customer_specific_hourly_rates', 'customer_specific_materials', 'incoming_e_invoices',
  'invoice_history',
]);

function prepareBackupRecord(table, record) {
  if (table !== 'smtp_settings') return record;
  return { ...record, smtp_pass: null, smtp_pass_encrypted: null };
}

function workspaceBackupPrefix(req, kind) {
  return `${kind}_${req.auth.workspaceId}_`;
}

function isOwnedBackup(filename, req, kind, extension) {
  return filename === path.basename(filename)
    && !filename.includes('..')
    && filename.startsWith(workspaceBackupPrefix(req, kind))
    && filename.endsWith(extension);
}

function getBackupWorkspaceId(backupData) {
  if (typeof backupData?.workspaceId === 'string' && backupData.workspaceId) {
    return backupData.workspaceId;
  }

  const workspaceIds = new Set();
  for (const records of Object.values(backupData?.data || {})) {
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      if (record && typeof record.workspace_id === 'string' && record.workspace_id) {
        workspaceIds.add(record.workspace_id);
      }
    }
  }
  if (workspaceIds.size > 1) {
    throw new Error('Das Backup enthält Daten aus mehreren Workspaces und kann nicht wiederhergestellt werden.');
  }
  return [...workspaceIds][0] || null;
}

function backupWorkspaceMismatchMessage() {
  return 'Dieses Backup gehört zu einem anderen Workspace. Wechseln Sie zum ursprünglichen Workspace und starten Sie die Wiederherstellung dort erneut.';
}

function getBackupTimeZone(req) {
  const requestedTimeZone = typeof req.body?.timeZone === 'string' ? req.body.timeZone : '';
  const candidates = [requestedTimeZone, process.env.APP_TIME_ZONE, 'Europe/Berlin'];

  for (const timeZone of candidates) {
    if (!timeZone) continue;
    try {
      new Intl.DateTimeFormat('de-DE', { timeZone }).format();
      return timeZone;
    } catch {
      // Ungültige Zeitzonen werden ignoriert; der nächste Fallback wird geprüft.
    }
  }

  return 'UTC';
}

function formatBackupFilenameTimestamp(date, timeZone) {
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}-${values.minute}-${values.second}-${values.fractionalSecond}`;
}

async function getTableColumns(client, table) {
  if (!BACKUP_TABLES.includes(table)) throw new Error(`Nicht erlaubte Restore-Tabelle: ${table}`);
  const result = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
  `, [table]);
  return new Set(result.rows.map(row => row.column_name));
}

async function clearWorkspaceData(client, workspaceId) {
  for (const table of RESTORE_CLEAR_TABLES) {
    if (!WORKSPACE_SCOPED_TABLES.has(table)) continue;
    await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [workspaceId]);
    logger.info(`Workspace-Daten gelöscht: ${table}`);
  }
}

async function getRestoreCompanyId(client, workspaceId) {
  const existing = await client.query(
    'SELECT id FROM company WHERE workspace_id = $1 LIMIT 1',
    [workspaceId]
  );
  if (existing.rows[0]?.id != null) return existing.rows[0].id;

  const allocated = await client.query("SELECT nextval('company_id_seq') AS id");
  return allocated.rows[0].id;
}

// Function to process values for JSONB columns
function processValueForRestore(table, column, value) {
  if (JSONB_COLUMNS[table] && JSONB_COLUMNS[table].includes(column)) {
    // For JSONB columns, ensure the value is properly handled
    if (value === null || value === undefined) {
      return null;
    }
    
    // If it's already an object/array, stringify it for JSONB
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    
    // If it's a string, check if it's valid JSON
    if (typeof value === 'string') {
      try {
        // Try to parse it to validate JSON
        JSON.parse(value);
        return value; // It's already a valid JSON string
      } catch {
        // If parsing fails, treat it as a plain string and wrap in JSON
        return JSON.stringify(value);
      }
    }
    
    // For other types, stringify them
    return JSON.stringify(value);
  }
  
  // For non-JSONB columns, return the value as-is
  return value;
}

async function restoreDeferredInvoiceRelations(client, backupData, workspaceId) {
  const invoices = backupData?.data?.invoices;
  if (!Array.isArray(invoices)) return;

  for (const record of invoices) {
    if (record.reference_invoice_id) {
      await client.query('UPDATE invoices SET reference_invoice_id = $1 WHERE id = $2 AND workspace_id = $3', [record.reference_invoice_id, record.id, workspaceId]);
    }
    if (record.recurring_invoice_id) {
      await client.query('UPDATE invoices SET recurring_invoice_id = $1 WHERE id = $2 AND workspace_id = $3', [record.recurring_invoice_id, record.id, workspaceId]);
    }
    if (record.source_quote_id) {
      await client.query('UPDATE invoices SET source_quote_id = $1 WHERE id = $2 AND workspace_id = $3', [record.source_quote_id, record.id, workspaceId]);
    }
  }
}

async function restoreBackupTables(client, backupData, workspaceId, restoreCompanyId) {
  let restoredTables = 0;
  let restoredRecords = 0;
  const deferredInvoiceColumns = new Set(['reference_invoice_id', 'recurring_invoice_id', 'source_quote_id']);

  for (const table of RESTORE_ORDER) {
    const records = backupData.data[table];
    if (!Array.isArray(records)) continue;

    // Only columns that exist in the current schema can enter the query. The
    // table name comes from RESTORE_ORDER; the column names come from this
    // database, never from the uploaded JSON.
    const schemaColumns = await getTableColumns(client, table);
    const incomingColumns = new Set(records.flatMap(record => (
      record && typeof record === 'object' && !Array.isArray(record) ? Object.keys(record) : []
    )));
    const columns = [...incomingColumns]
      .filter(column => schemaColumns.has(column))
      .filter(column => !(table === 'invoices' && deferredInvoiceColumns.has(column)))
      .filter(column => column !== 'smtp_pass' && column !== 'smtp_pass_encrypted');

    if (WORKSPACE_SCOPED_TABLES.has(table)) {
      if (!schemaColumns.has('workspace_id')) throw new Error(`Restore-Tabelle ${table} hat keine Workspace-Spalte.`);
      if (!columns.includes('workspace_id')) columns.push('workspace_id');
    }
    if (records.length > 0 && columns.length === 0) {
      throw new Error(`Keine zulässigen Spalten für Restore-Tabelle ${table} gefunden.`);
    }

    if (records.length > 0) {
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
      const columnNames = columns.join(', ');
      for (const record of records) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
          throw new Error(`Ungültiger Datensatz in Restore-Tabelle ${table}.`);
        }
        const values = columns.map(column => {
          if (column === 'workspace_id') return workspaceId;
          if (table === 'company' && column === 'id') return restoreCompanyId;
          if ((table === 'hourly_rates' || table === 'material_templates') && column === 'company_id') {
            return restoreCompanyId;
          }
          return processValueForRestore(table, column, record[column]);
        });
        const conflictClause = table === 'euer_entry_history' || table === 'invoice_history'
          ? ' ON CONFLICT (id) DO NOTHING'
          : '';
        await client.query(`INSERT INTO ${table} (${columnNames}) VALUES (${placeholders})${conflictClause}`, values);
      }
      restoredRecords += records.length;
    }
    restoredTables++;
  }
  return { restoredTables, restoredRecords };
}

// Create backup
router.post('/create', async (req, res) => {
  const client = await pool.connect();
  
  try {
    logger.info('Creating backup...');
    const now = new Date();
    const timeZone = getBackupTimeZone(req);
    
    const backup = {
      timestamp: now.toISOString(),
      version: '1.0',
      workspaceId: req.auth.workspaceId,
      timeZone,
      data: {}
    };

    for (const table of BACKUP_TABLES) {
      try {
        const result = await client.query(`SELECT * FROM ${table}`);
        backup.data[table] = result.rows.map(record => prepareBackupRecord(table, record));
        logger.debug(`Backed up ${result.rows.length} records from ${table}`);
      } catch (error) {
        logger.warn(`Could not backup table ${table}`, { table, error: error.message });
        backup.data[table] = [];
      }
    }

    // Create backup directory if it doesn't exist
    const backupDir = path.join(__dirname, '../../backups');
    try {
      await fs.access(backupDir);
    } catch {
      await fs.mkdir(backupDir, { recursive: true });
    }

    // Save backup to file
    const timestamp = formatBackupFilenameTimestamp(now, timeZone);
    const filename = `backup_${req.auth.workspaceId}_${timestamp}.json`;
    const filepath = path.join(backupDir, filename);
    
    await fs.writeFile(filepath, JSON.stringify(backup, null, 2));
    
    logger.info('Backup created successfully', { filename });
    
    res.json({
      success: true,
      message: 'Backup erfolgreich erstellt',
      filename,
      timestamp: backup.timestamp,
      tableCount: Object.keys(backup.data).length,
      totalRecords: Object.values(backup.data).reduce((sum, records) => sum + records.length, 0)
    });

  } catch (error) {
    logger.error('Failed to create backup', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      message: 'Fehler beim Erstellen des Backups',
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Download backup
router.get('/download/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    // Validate filename for security
    if (!isOwnedBackup(filename, req, 'backup', '.json')) {
      return res.status(400).json({
        success: false,
        message: 'Ungültiger Dateiname'
      });
    }

    const backupDir = path.join(__dirname, '../../backups');
    const filepath = path.join(backupDir, filename);
    
    try {
      await fs.access(filepath);
    } catch {
      return res.status(404).json({
        success: false,
        message: 'Backup-Datei nicht gefunden'
      });
    }

    const backupContent = await fs.readFile(filepath);
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(backupContent);

  } catch (error) {
    logger.error('Failed to download backup', { 
      error: error.message, 
      stack: error.stack,
      method: 'GET',
      endpoint: '/download/:filename' 
    });
    res.status(500).json({
      success: false,
      message: 'Fehler beim Download des Backups',
      error: error.message
    });
  }
});

// List available backups
router.get('/list', async (req, res) => {
  try {
    const backupDir = path.join(__dirname, '../../backups');
    
    try {
      await fs.access(backupDir);
    } catch {
      return res.json({
        success: true,
        backups: []
      });
    }

    const files = await fs.readdir(backupDir);
    const backupFiles = files.filter(file => isOwnedBackup(file, req, 'backup', '.json'));
    
    const backups = await Promise.all(
      backupFiles.map(async (filename) => {
        try {
          const filepath = path.join(backupDir, filename);
          const stats = await fs.stat(filepath);
          const content = await fs.readFile(filepath, 'utf8');
          const backup = JSON.parse(content);
          
          return {
            filename,
            timestamp: backup.timestamp,
            size: stats.size,
            tableCount: Object.keys(backup.data || {}).length,
            totalRecords: Object.values(backup.data || {}).reduce((sum, records) => sum + (records?.length || 0), 0),
            created: stats.birthtime.toISOString()
          };
        } catch (error) {
          logger.warn(`Could not parse backup file ${filename}:`, error.message);
          return null;
        }
      })
    );

    const validBackups = backups.filter(backup => backup !== null);
    
    // Sort by creation date (newest first)
    validBackups.sort((a, b) => new Date(b.created) - new Date(a.created));

    res.json({
      success: true,
      backups: validBackups
    });

  } catch (error) {
    logger.error('Failed to list backups', { 
      error: error.message, 
      stack: error.stack,
      method: 'GET',
      endpoint: '/list' 
    });
    res.status(500).json({
      success: false,
      message: 'Fehler beim Auflisten der Backups',
      error: error.message
    });
  }
});

// Restore from backup
router.post('/restore', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { backupData } = req.body;
    
    if (!backupData || !backupData.data) {
      return res.status(400).json({
        success: false,
        message: 'Ungültige Backup-Daten'
      });
    }

    const backupWorkspaceId = getBackupWorkspaceId(backupData);
    if (backupWorkspaceId && backupWorkspaceId !== req.auth.workspaceId) {
      return res.status(409).json({
        success: false,
        message: backupWorkspaceMismatchMessage(),
        code: 'BACKUP_WORKSPACE_MISMATCH'
      });
    }

    logger.info('Starting restore process...');
    
    // Begin transaction
    await client.query('BEGIN');
    
    let restoredTables = 0;
    let restoredRecords = 0;

    logger.info('Clearing data for the active workspace only...');
    await setAuditSuppressed(client, true);
    const restoreCompanyId = await getRestoreCompanyId(client, req.auth.workspaceId);
    await clearWorkspaceData(client, req.auth.workspaceId);

    logger.info('Restoring JSON data with schema allow-list...');
    ({ restoredTables, restoredRecords } = await restoreBackupTables(client, backupData, req.auth.workspaceId, restoreCompanyId));

    await restoreDeferredInvoiceRelations(client, backupData, req.auth.workspaceId);

    // Post-restore fixes for backward compatibility
    logger.info('Running post-restore compatibility fixes...');
    
    // Fix invoice_items without proper order values (from old backups)
    try {
      const missingOrderResult = await client.query(`
        SELECT COUNT(*) as count FROM invoice_items WHERE item_order IS NULL OR item_order = 0
      `);
      
      const missingOrderCount = parseInt(missingOrderResult.rows[0].count);
      if (missingOrderCount > 0) {
        logger.info(`Fixing ${missingOrderCount} invoice items without proper order values...`);
        
        // Update items to have sequential order values per invoice
        await client.query(`
          UPDATE invoice_items 
          SET item_order = subq.row_number
          FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY invoice_id ORDER BY id) as row_number
            FROM invoice_items
            WHERE item_order IS NULL OR item_order = 0
          ) subq
          WHERE invoice_items.id = subq.id
        `);
        
        logger.info(`Fixed order values for ${missingOrderCount} invoice items`);
      }
    } catch (error) {
      logger.warn('Warning: Could not fix invoice item order values:', error.message);
    }

    // Fix missing discount fields in invoice_items (from old backups without discount support)
    try {
      const missingDiscountResult = await client.query(`
        SELECT COUNT(*) as count FROM invoice_items WHERE discount_type IS NULL AND discount_value IS NULL AND discount_amount IS NULL
      `);
      
      const missingDiscountCount = parseInt(missingDiscountResult.rows[0].count);
      if (missingDiscountCount > 0) {
        logger.info(`Setting default discount values for ${missingDiscountCount} invoice items from old backups...`);
        
        // Set default values for discount fields (no discount)
        await client.query(`
          UPDATE invoice_items 
          SET discount_type = NULL, discount_value = NULL, discount_amount = 0
          WHERE discount_type IS NULL AND discount_value IS NULL AND discount_amount IS NULL
        `);
        
        logger.info(`Fixed discount values for ${missingDiscountCount} invoice items`);
      }
    } catch (error) {
      logger.warn('Warning: Could not fix invoice item discount values:', error.message);
    }

    // Fix missing global discount fields in invoices (from old backups without discount support)
    try {
      const missingGlobalDiscountResult = await client.query(`
        SELECT COUNT(*) as count FROM invoices WHERE global_discount_type IS NULL AND global_discount_value IS NULL AND global_discount_amount IS NULL
      `);
      
      const missingGlobalDiscountCount = parseInt(missingGlobalDiscountResult.rows[0].count);
      if (missingGlobalDiscountCount > 0) {
        logger.info(`Setting default global discount values for ${missingGlobalDiscountCount} invoices from old backups...`);
        
        // Set default values for global discount fields (no discount)
        await client.query(`
          UPDATE invoices 
          SET global_discount_type = NULL, global_discount_value = NULL, global_discount_amount = 0
          WHERE global_discount_type IS NULL AND global_discount_value IS NULL AND global_discount_amount IS NULL
        `);
        
        logger.info(`Fixed global discount values for ${missingGlobalDiscountCount} invoices`);
      }
    } catch (error) {
      logger.warn('Warning: Could not fix invoice global discount values:', error.message);
    }

    // Fix missing discount fields in job_time_entries (from old backups without discount support)
    try {
      const missingJobDiscountResult = await client.query(`
        SELECT COUNT(*) as count FROM job_time_entries WHERE discount_type IS NULL AND discount_value IS NULL AND discount_amount IS NULL
      `);
      
      const missingJobDiscountCount = parseInt(missingJobDiscountResult.rows[0].count);
      if (missingJobDiscountCount > 0) {
        logger.info(`Setting default discount values for ${missingJobDiscountCount} job time entries from old backups...`);
        
        // Set default values for discount fields (no discount)
        await client.query(`
          UPDATE job_time_entries 
          SET discount_type = NULL, discount_value = NULL, discount_amount = 0
          WHERE discount_type IS NULL AND discount_value IS NULL AND discount_amount IS NULL
        `);
        
        logger.info(`Fixed discount values for ${missingJobDiscountCount} job time entries`);
      }
    } catch (error) {
      logger.warn('Warning: Could not fix job time entry discount values:', error.message);
    }

    // Fix missing reminder texts in company (from old backups before reminder system)
    try {
      const missingReminderTextsResult = await client.query(`
        SELECT COUNT(*) as count FROM company 
        WHERE (reminder_text_stage_1 IS NULL OR reminder_text_stage_1 = '')
        OR (reminder_text_stage_2 IS NULL OR reminder_text_stage_2 = '')
        OR (reminder_text_stage_3 IS NULL OR reminder_text_stage_3 = '')
      `);
      
      const missingReminderTextsCount = parseInt(missingReminderTextsResult.rows[0].count);
      if (missingReminderTextsCount > 0) {
        logger.info(`Setting default reminder texts for ${missingReminderTextsCount} company records from old backups...`);
        
        // Set default German reminder texts
        await client.query(`
          UPDATE company 
          SET 
            reminder_text_stage_1 = CASE 
              WHEN reminder_text_stage_1 IS NULL OR reminder_text_stage_1 = '' THEN 
                'Sehr geehrte Damen und Herren,

bei der Durchsicht unserer Unterlagen ist uns aufgefallen, dass die folgende Rechnung noch nicht beglichen wurde. Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.

Wir bitten Sie höflich, den ausstehenden Betrag innerhalb der nächsten 7 Tage zu begleichen.'
              ELSE reminder_text_stage_1 
            END,
            reminder_text_stage_2 = CASE 
              WHEN reminder_text_stage_2 IS NULL OR reminder_text_stage_2 = '' THEN 
                'Sehr geehrte Damen und Herren,

leider haben wir trotz unserer ersten Zahlungserinnerung noch keinen Zahlungseingang feststellen können. Wir möchten Sie nochmals dringend bitten, den ausstehenden Betrag umgehend zu begleichen.

Sollte die Zahlung nicht innerhalb von 5 Tagen bei uns eingehen, sehen wir uns gezwungen, weitere Schritte einzuleiten.'
              ELSE reminder_text_stage_2 
            END,
            reminder_text_stage_3 = CASE 
              WHEN reminder_text_stage_3 IS NULL OR reminder_text_stage_3 = '' THEN 
                'Sehr geehrte Damen und Herren,

trotz mehrfacher Zahlungserinnerungen ist der ausstehende Betrag noch immer nicht beglichen worden. Dies ist unsere letzte Mahnung vor rechtlichen Schritten.

Wir fordern Sie hiermit letztmalig auf, den Betrag unverzüglich, spätestens jedoch innerhalb von 3 Tagen, zu begleichen. Andernfalls werden wir ohne weitere Ankündigung rechtliche Schritte einleiten.'
              ELSE reminder_text_stage_3 
            END
          WHERE (reminder_text_stage_1 IS NULL OR reminder_text_stage_1 = '')
             OR (reminder_text_stage_2 IS NULL OR reminder_text_stage_2 = '')
             OR (reminder_text_stage_3 IS NULL OR reminder_text_stage_3 = '')
        `);
        
        logger.info(`Fixed reminder texts for ${missingReminderTextsCount} company records`);
      }
    } catch (error) {
      logger.warn('Warning: Could not fix missing reminder texts:', error.message);
    }

    // Commit transaction
    // Protokollierung wieder aktivieren, bevor die Transaktion endet.
    await setAuditSuppressed(client, false);
    await client.query('COMMIT');
    
    logger.info(`Restore completed: ${restoredTables} tables, ${restoredRecords} records`);
    
    res.json({
      success: true,
      message: 'Backup erfolgreich wiederhergestellt',
      restoredTables,
      restoredRecords,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    // Rollback transaction on error
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error('Error during rollback:', rollbackError);
    }
    
    logger.error('Error during restore:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Wiederherstellen des Backups',
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Delete backup
router.delete('/delete/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    // Validate filename for security
    if (!isOwnedBackup(filename, req, 'backup', '.json')) {
      return res.status(400).json({
        success: false,
        message: 'Ungültiger Dateiname'
      });
    }

    const backupDir = path.join(__dirname, '../../backups');
    const filepath = path.join(backupDir, filename);
    
    try {
      await fs.unlink(filepath);
      logger.info(`Deleted backup: ${filename}`);
      
      res.json({
        success: true,
        message: 'Backup erfolgreich gelöscht'
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({
          success: false,
          message: 'Backup-Datei nicht gefunden'
        });
      }
      throw error;
    }

  } catch (error) {
    logger.error('Error deleting backup:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Löschen des Backups',
      error: error.message
    });
  }
});

// Create full ZIP backup (database + files)
router.post('/create-zip', async (req, res) => {
  const client = await pool.connect();
  
  try {
    // Dynamic import for AdmZip
    const { default: AdmZip } = await import('adm-zip');
    
    logger.info('Creating full ZIP backup...');
    const now = new Date();
    const timeZone = getBackupTimeZone(req);
    
    const backup = {
      timestamp: now.toISOString(),
      version: '2.0',
      type: 'full',
      workspaceId: req.auth.workspaceId,
      timeZone,
      data: {}
    };

    for (const table of BACKUP_TABLES) {
      try {
        const result = await client.query(`SELECT * FROM ${table}`);
        backup.data[table] = result.rows.map(record => prepareBackupRecord(table, record));
        logger.debug(`Backed up ${result.rows.length} records from ${table}`);
      } catch (error) {
        logger.warn(`Could not backup table ${table}`, { table, error: error.message });
        backup.data[table] = [];
      }
    }

    // Create ZIP archive
    const zip = new AdmZip();
    
    // Add database backup as JSON
    zip.addFile('database.json', Buffer.from(JSON.stringify(backup, null, 2)));
    
    // Add metadata file
    const metadata = {
      name: 'SoloOffice Vollbackup',
      created: backup.timestamp,
      timeZone,
      version: backup.version,
      tables: Object.keys(backup.data).length,
      totalRecords: Object.values(backup.data).reduce((sum, records) => sum + records.length, 0)
    };
    zip.addFile('metadata.json', Buffer.from(JSON.stringify(metadata, null, 2)));

    // Create backup directory if it doesn't exist
    const backupDir = path.join(__dirname, '../../backups');
    try {
      await fs.access(backupDir);
    } catch {
      await fs.mkdir(backupDir, { recursive: true });
    }

    // Save ZIP file
    const timestamp = formatBackupFilenameTimestamp(now, timeZone);
    const filename = `vollbackup_${req.auth.workspaceId}_${timestamp}.zip`;
    const filepath = path.join(backupDir, filename);
    
    const zipBuffer = zip.toBuffer();
    await fs.writeFile(filepath, zipBuffer);
    
    logger.info(`ZIP backup created successfully: ${filename}`);
    
    res.json({
      success: true,
      message: 'Vollständiges Backup erfolgreich erstellt',
      filename,
      timestamp: backup.timestamp,
      size: zipBuffer.length,
      tableCount: metadata.tables,
      totalRecords: metadata.totalRecords
    });

  } catch (error) {
    logger.error('Error creating ZIP backup:', error);
    
    if (error.code === 'MODULE_NOT_FOUND' || error.message.includes('adm-zip')) {
      res.status(503).json({
        success: false,
        message: 'ZIP-Backup-Funktionalität noch nicht verfügbar. Bitte starten Sie den Container neu.',
        error: 'Dependencies not installed'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Fehler beim Erstellen des Vollbackups',
        error: error.message
      });
    }
  } finally {
    client.release();
  }
});

// Download ZIP backup
router.get('/download-zip/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    // Validate filename for security
    if (!isOwnedBackup(filename, req, 'vollbackup', '.zip')) {
      return res.status(400).json({
        success: false,
        message: 'Ungültiger Dateiname'
      });
    }

    const backupDir = path.join(__dirname, '../../backups');
    const filepath = path.join(backupDir, filename);
    
    try {
      await fs.access(filepath);
    } catch {
      return res.status(404).json({
        success: false,
        message: 'Backup-Datei nicht gefunden'
      });
    }

    const backupContent = await fs.readFile(filepath);
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(backupContent);

  } catch (error) {
    logger.error('Error downloading ZIP backup:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Download des Backups',
      error: error.message
    });
  }
});

// Upload and restore from ZIP backup
router.post('/restore-zip', async (req, res) => {
  try {
    // Dynamic imports
    const multer = await import('multer');
    const { default: AdmZip } = await import('adm-zip');
    
    const upload = multer.default({ 
      dest: '/tmp/',
      limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
    });
    
    // Handle file upload with promise
    await new Promise((resolve, reject) => {
      upload.single('backupFile')(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const client = await pool.connect();
    
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Keine Backup-Datei hochgeladen'
        });
      }

      logger.info('Processing ZIP backup restore...');
      
      // Read and extract ZIP file
      const zipBuffer = await fs.readFile(req.file.path);
      const zip = new AdmZip(zipBuffer);
      
      // Check if it's a valid backup
      const databaseEntry = zip.getEntry('database.json');
      const metadataEntry = zip.getEntry('metadata.json');
      
      if (!databaseEntry || !metadataEntry) {
        return res.status(400).json({
          success: false,
          message: 'Ungültige Backup-Datei - fehlende Dateien'
        });
      }

      // Extract and parse database backup
      const databaseContent = databaseEntry.getData().toString('utf8');
      const backupData = JSON.parse(databaseContent);
      
      if (!backupData || !backupData.data) {
        return res.status(400).json({
          success: false,
          message: 'Ungültige Backup-Daten'
        });
      }

      const backupWorkspaceId = getBackupWorkspaceId(backupData);
      if (backupWorkspaceId && backupWorkspaceId !== req.auth.workspaceId) {
        await fs.unlink(req.file.path).catch(() => undefined);
        return res.status(409).json({
          success: false,
          message: backupWorkspaceMismatchMessage(),
          code: 'BACKUP_WORKSPACE_MISMATCH'
        });
      }

      logger.info('Starting restore process...');
      
      // Begin transaction
      await client.query('BEGIN');
      
      let restoredTables = 0;
      let restoredRecords = 0;

      // SMTP credentials are intentionally preserved; backups contain only a redacted placeholder.
      logger.info('Clearing data for the active workspace only...');
      await setAuditSuppressed(client, true);
      const restoreCompanyId = await getRestoreCompanyId(client, req.auth.workspaceId);
      await clearWorkspaceData(client, req.auth.workspaceId);
      logger.info('Restoring data with schema allow-list...');
      ({ restoredTables, restoredRecords } = await restoreBackupTables(client, backupData, req.auth.workspaceId, restoreCompanyId));

      await restoreDeferredInvoiceRelations(client, backupData, req.auth.workspaceId);

      // Post-restore fixes for backward compatibility
      logger.info('Running post-restore compatibility fixes...');
      
      // Fix invoice_items without proper order values (from old backups)
      try {
        const missingOrderResult = await client.query(`
          SELECT COUNT(*) as count FROM invoice_items WHERE item_order IS NULL OR item_order = 0
        `);
        
        const missingOrderCount = parseInt(missingOrderResult.rows[0].count);
        if (missingOrderCount > 0) {
          logger.info(`Fixing ${missingOrderCount} invoice items without proper order values...`);
          
          // Update items to have sequential order values per invoice
          await client.query(`
            UPDATE invoice_items 
            SET item_order = subq.row_number
            FROM (
              SELECT id, ROW_NUMBER() OVER (PARTITION BY invoice_id ORDER BY id) as row_number
              FROM invoice_items
              WHERE item_order IS NULL OR item_order = 0
            ) subq
            WHERE invoice_items.id = subq.id
          `);
          
          logger.info(`Fixed order values for ${missingOrderCount} invoice items`);
        }
      } catch (error) {
        logger.warn('Warning: Could not fix invoice item order values:', error.message);
      }

      // Fix missing discount fields in invoice_items (from old backups without discount support)
      try {
        const missingDiscountResult = await client.query(`
          SELECT COUNT(*) as count FROM invoice_items WHERE discount_type IS NULL AND discount_value IS NULL AND discount_amount IS NULL
        `);
        
        const missingDiscountCount = parseInt(missingDiscountResult.rows[0].count);
        if (missingDiscountCount > 0) {
          logger.info(`Setting default discount values for ${missingDiscountCount} invoice items from old backups...`);
          
          // Set default values for discount fields (no discount)
          await client.query(`
            UPDATE invoice_items 
            SET discount_type = NULL, discount_value = NULL, discount_amount = 0
            WHERE discount_type IS NULL AND discount_value IS NULL AND discount_amount IS NULL
          `);
          
          logger.info(`Fixed discount values for ${missingDiscountCount} invoice items`);
        }
      } catch (error) {
        logger.warn('Warning: Could not fix invoice item discount values:', error.message);
      }

      // Fix missing global discount fields in invoices (from old backups without discount support)
      try {
        const missingGlobalDiscountResult = await client.query(`
          SELECT COUNT(*) as count FROM invoices WHERE global_discount_type IS NULL AND global_discount_value IS NULL AND global_discount_amount IS NULL
        `);
        
        const missingGlobalDiscountCount = parseInt(missingGlobalDiscountResult.rows[0].count);
        if (missingGlobalDiscountCount > 0) {
          logger.info(`Setting default global discount values for ${missingGlobalDiscountCount} invoices from old backups...`);
          
          // Set default values for global discount fields (no discount)
          await client.query(`
            UPDATE invoices 
            SET global_discount_type = NULL, global_discount_value = NULL, global_discount_amount = 0
            WHERE global_discount_type IS NULL AND global_discount_value IS NULL AND global_discount_amount IS NULL
          `);
          
          logger.info(`Fixed global discount values for ${missingGlobalDiscountCount} invoices`);
        }
      } catch (error) {
        logger.warn('Warning: Could not fix invoice global discount values:', error.message);
      }

      // Fix missing discount fields in job_time_entries (from old backups without discount support)
      try {
        const missingJobDiscountResult = await client.query(`
          SELECT COUNT(*) as count FROM job_time_entries WHERE discount_type IS NULL AND discount_value IS NULL AND discount_amount IS NULL
        `);
        
        const missingJobDiscountCount = parseInt(missingJobDiscountResult.rows[0].count);
        if (missingJobDiscountCount > 0) {
          logger.info(`Setting default discount values for ${missingJobDiscountCount} job time entries from old backups...`);
          
          // Set default values for discount fields (no discount)
          await client.query(`
            UPDATE job_time_entries 
            SET discount_type = NULL, discount_value = NULL, discount_amount = 0
            WHERE discount_type IS NULL AND discount_value IS NULL AND discount_amount IS NULL
          `);
          
          logger.info(`Fixed discount values for ${missingJobDiscountCount} job time entries`);
        }
      } catch (error) {
        logger.warn('Warning: Could not fix job time entry discount values:', error.message);
      }

      // Fix missing reminder texts in company (from old backups before reminder system)
      try {
        const missingReminderTextsResult = await client.query(`
          SELECT COUNT(*) as count FROM company 
          WHERE (reminder_text_stage_1 IS NULL OR reminder_text_stage_1 = '')
          OR (reminder_text_stage_2 IS NULL OR reminder_text_stage_2 = '')
          OR (reminder_text_stage_3 IS NULL OR reminder_text_stage_3 = '')
        `);
        
        const missingReminderTextsCount = parseInt(missingReminderTextsResult.rows[0].count);
        if (missingReminderTextsCount > 0) {
          logger.info(`Setting default reminder texts for ${missingReminderTextsCount} company records from old backups...`);
          
          // Set default German reminder texts
          await client.query(`
            UPDATE company 
            SET 
              reminder_text_stage_1 = CASE 
                WHEN reminder_text_stage_1 IS NULL OR reminder_text_stage_1 = '' THEN 
                  'Sehr geehrte Damen und Herren,

bei der Durchsicht unserer Unterlagen ist uns aufgefallen, dass die folgende Rechnung noch nicht beglichen wurde. Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.

Wir bitten Sie höflich, den ausstehenden Betrag innerhalb der nächsten 7 Tage zu begleichen.'
                ELSE reminder_text_stage_1 
              END,
              reminder_text_stage_2 = CASE 
                WHEN reminder_text_stage_2 IS NULL OR reminder_text_stage_2 = '' THEN 
                  'Sehr geehrte Damen und Herren,

leider haben wir trotz unserer ersten Zahlungserinnerung noch keinen Zahlungseingang feststellen können. Wir möchten Sie nochmals dringend bitten, den ausstehenden Betrag umgehend zu begleichen.

Sollte die Zahlung nicht innerhalb von 5 Tagen bei uns eingehen, sehen wir uns gezwungen, weitere Schritte einzuleiten.'
                ELSE reminder_text_stage_2 
              END,
              reminder_text_stage_3 = CASE 
                WHEN reminder_text_stage_3 IS NULL OR reminder_text_stage_3 = '' THEN 
                  'Sehr geehrte Damen und Herren,

trotz mehrfacher Zahlungserinnerungen ist der ausstehende Betrag noch immer nicht beglichen worden. Dies ist unsere letzte Mahnung vor rechtlichen Schritten.

Wir fordern Sie hiermit letztmalig auf, den Betrag unverzüglich, spätestens jedoch innerhalb von 3 Tagen, zu begleichen. Andernfalls werden wir ohne weitere Ankündigung rechtliche Schritte einleiten.'
                ELSE reminder_text_stage_3 
              END
            WHERE (reminder_text_stage_1 IS NULL OR reminder_text_stage_1 = '')
               OR (reminder_text_stage_2 IS NULL OR reminder_text_stage_2 = '')
               OR (reminder_text_stage_3 IS NULL OR reminder_text_stage_3 = '')
          `);
          
          logger.info(`Fixed reminder texts for ${missingReminderTextsCount} company records`);
        }
      } catch (error) {
        logger.warn('Warning: Could not fix missing reminder texts:', error.message);
      }

      // Commit transaction
      // Protokollierung wieder aktivieren, bevor die Transaktion endet.
      await setAuditSuppressed(client, false);
      await client.query('COMMIT');
      
      // Clean up uploaded file
      try {
        await fs.unlink(req.file.path);
      } catch (cleanupError) {
        logger.warn('Could not clean up uploaded file:', cleanupError.message);
      }
      
      logger.info(`ZIP restore completed: ${restoredTables} tables, ${restoredRecords} records`);
      
      res.json({
        success: true,
        message: 'Vollständiges Backup erfolgreich wiederhergestellt',
        restoredTables,
        restoredRecords,
        timestamp: new Date().toISOString()
      });

    } catch (restoreError) {
      // Rollback transaction on error
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error('Error during rollback:', rollbackError);
      }
      
      // Clean up uploaded file
      if (req.file) {
        try {
          await fs.unlink(req.file.path);
        } catch (cleanupError) {
          logger.warn('Could not clean up uploaded file:', cleanupError.message);
        }
      }
      
      logger.error('Error during ZIP restore:', restoreError);
      res.status(500).json({
        success: false,
        message: 'Fehler beim Wiederherstellen des Vollbackups',
        error: restoreError.message
      });
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error in ZIP restore setup:', error);
    
    if (error.code === 'MODULE_NOT_FOUND' || error.message.includes('multer') || error.message.includes('adm-zip')) {
      res.status(503).json({
        success: false,
        message: 'ZIP-Restore-Funktionalität noch nicht verfügbar. Bitte starten Sie den Container neu.',
        error: 'Dependencies not installed'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Fehler beim Wiederherstellen des Vollbackups',
        error: error.message
      });
    }
  }
});

// List all backups (both JSON and ZIP) - with fallback for missing dependencies
router.get('/list-all', async (req, res) => {
  try {
    const backupDir = path.join(__dirname, '../../backups');
    
    try {
      await fs.access(backupDir);
    } catch {
      return res.json({
        success: true,
        backups: [],
        zipBackups: []
      });
    }

    const files = await fs.readdir(backupDir);
    logger.info(`Found ${files.length} files in backup directory:`, files);
    
    // JSON Backups
    const backupFiles = files.filter(file => isOwnedBackup(file, req, 'backup', '.json'));
    logger.info(`Found ${backupFiles.length} JSON backup files:`, backupFiles);
    
    const backups = await Promise.all(
      backupFiles.map(async (filename) => {
        try {
          const filepath = path.join(backupDir, filename);
          const stats = await fs.stat(filepath);
          const content = await fs.readFile(filepath, 'utf8');
          const backup = JSON.parse(content);
          logger.info(`Processing JSON file: ${filename}, size: ${stats.size}, tables: ${Object.keys(backup.data || {}).length}`);
          
          return {
            filename,
            type: 'json',
            timestamp: backup.timestamp,
            size: stats.size,
            tableCount: Object.keys(backup.data || {}).length,
            totalRecords: Object.values(backup.data || {}).reduce((sum, records) => sum + (records?.length || 0), 0),
            created: stats.birthtime.toISOString()
          };
        } catch (error) {
          logger.warn(`Could not parse backup file ${filename}:`, error.message);
          return null;
        }
      })
    );

    // ZIP Backups - with error handling for missing AdmZip
    let zipBackups = [];
    try {
      const zipBackupFiles = files.filter(file => isOwnedBackup(file, req, 'vollbackup', '.zip'));
      logger.info(`Found ${zipBackupFiles.length} ZIP backup files:`, zipBackupFiles);
      
      if (zipBackupFiles.length > 0) {
        try {
          // Dynamic import for AdmZip
          const { default: AdmZip } = await import('adm-zip');
          logger.info('AdmZip imported successfully');
          
          zipBackups = await Promise.all(
            zipBackupFiles.map(async (filename) => {
              try {
                const filepath = path.join(backupDir, filename);
                const stats = await fs.stat(filepath);
                logger.info(`Processing ZIP file: ${filename}, size: ${stats.size}`);
                
                // Try to read metadata from ZIP
                const zipBuffer = await fs.readFile(filepath);
                const zip = new AdmZip(zipBuffer);
                const metadataEntry = zip.getEntry('metadata.json');
                
                let metadata = { tables: 0, totalRecords: 0 };
                if (metadataEntry) {
                  const metadataContent = metadataEntry.getData().toString('utf8');
                  metadata = JSON.parse(metadataContent);
                  logger.info(`ZIP metadata:`, metadata);
                } else {
                  logger.info(`No metadata found in ZIP: ${filename}`);
                }
                
                return {
                  filename,
                  type: 'zip',
                  timestamp: metadata.created || stats.birthtime.toISOString(),
                  size: stats.size,
                  tableCount: metadata.tables || 0,
                  totalRecords: metadata.totalRecords || 0,
                  created: stats.birthtime.toISOString()
                };
              } catch (error) {
                logger.warn(`Could not parse ZIP backup file ${filename}:`, error.message);
                return null;
              }
            })
          );
        } catch (admZipError) {
          logger.warn('AdmZip import failed:', admZipError.message);
          // Fallback: create basic entries without metadata
          zipBackups = zipBackupFiles.map(filename => {
            try {
              const filepath = path.join(backupDir, filename);
              const stats = fs.statSync(filepath);
              return {
                filename,
                type: 'zip',
                timestamp: stats.birthtime.toISOString(),
                size: stats.size,
                tableCount: 0,
                totalRecords: 0,
                created: stats.birthtime.toISOString()
              };
            } catch (error) {
              logger.warn(`Could not stat ZIP file ${filename}:`, error.message);
              return null;
            }
          }).filter(item => item !== null);
        }
      }
    } catch (zipError) {
      logger.warn('ZIP backup processing error:', zipError.message);
      zipBackups = [];
    }

    const validBackups = backups.filter(backup => backup !== null);
    const validZipBackups = zipBackups.filter(backup => backup !== null);
    
    logger.info(`Returning ${validBackups.length} JSON backups and ${validZipBackups.length} ZIP backups`);
    
    // Sort by creation date (newest first)
    validBackups.sort((a, b) => new Date(b.created) - new Date(a.created));
    validZipBackups.sort((a, b) => new Date(b.created) - new Date(a.created));

    const response = {
      success: true,
      backups: validBackups,
      zipBackups: validZipBackups
    };
    
    logger.info('Final response:', JSON.stringify(response, null, 2));
    res.json(response);

  } catch (error) {
    logger.error('Error listing all backups:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Auflisten der Backups',
      error: error.message
    });
  }
});

export default router;
