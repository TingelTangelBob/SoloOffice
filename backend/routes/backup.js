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
  'company': ['payment_methods']
};

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

// Create backup
router.post('/create', async (req, res) => {
  const client = await pool.connect();
  
  try {
    logger.info('Creating backup...');
    
    const backup = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      data: {}
    };

    // Backup all tables - COMPLETE LIST including email history and SMTP settings
    const tables = [
      'customers',
      'customer_emails',
      'invoices',
      'invoice_items', 
      'invoice_attachments',
      'quotes',  // QUOTES MODULE
      'quote_items',  // QUOTES MODULE
      'quote_attachments',  // QUOTES MODULE
      'job_entries',  // Fixed: was 'jobs' but table is 'job_entries'
      'job_attachments',
      'job_time_entries',
      'company',  // Fixed: was 'company_settings' but table is 'company'
      'hourly_rates',
      'material_templates',
      'yearly_invoice_start_numbers',
      'email_history',  // ADDED: Email history - critical for user data!
      'smtp_settings',  // ADDED: SMTP settings - critical for user configuration!
      'customer_hourly_rates',  // FIXED: Customer-hourly rate associations - critical!
      'customer_specific_hourly_rates',  // FIXED: Customer-specific hourly rates - critical!
      'customer_specific_materials',  // FIXED: Customer-specific materials - critical!
      'migrations'
    ];

    for (const table of tables) {
      try {
        const result = await client.query(`SELECT * FROM ${table}`);
        backup.data[table] = result.rows;
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
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup_${timestamp}.json`;
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
    if (!filename.match(/^backup_[\d-T:Z]+\.json$/)) {
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
    const backupFiles = files.filter(file => file.match(/^backup_[\d-T:Z]+\.json$/));
    
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

    logger.info('Starting restore process...');
    
    // Begin transaction
    await client.query('BEGIN');
    
    let restoredTables = 0;
    let restoredRecords = 0;

    // Step 1: Clear all data using TRUNCATE CASCADE to handle foreign key constraints
    logger.info('Clearing all data for JSON restore...');
    const tablesToClear = [
      'email_history', 'customer_emails', 'customer_hourly_rates',
      'customer_specific_hourly_rates', 'customer_specific_materials',
      'job_time_entries', 'job_attachments',
      'quote_attachments', 'quote_items', 'quotes',  // QUOTES MODULE - delete in reverse order
      'invoice_attachments', 'invoice_items', 'job_entries', 'invoices', 
      'hourly_rates', 'material_templates', 'customers', 'company',
      'yearly_invoice_start_numbers', 'smtp_settings'
    ];
    
    for (const table of tablesToClear) {
      try {
        await client.query(`TRUNCATE TABLE ${table} CASCADE`);
        logger.info(`Truncated table ${table}`);
      } catch (error) {
        logger.warn(`Could not truncate table ${table}:`, error.message);
      }
    }

    // Step 2: Restore tables in correct dependency order (parent tables first)  
    const restoreOrder = [
      'migrations',        // system table - restore first
      'company',           // parent table
      'customers',         // parent table  
      'yearly_invoice_start_numbers',
      'hourly_rates',      // references company(id)
      'material_templates', // references company(id)
      'smtp_settings',     // standalone settings table
      'customer_hourly_rates',  // references customers(id) and hourly_rates(id)
      'customer_specific_hourly_rates',  // references customers(id)
      'customer_specific_materials',  // references customers(id)
      'invoices',          // references customers(id)
      'invoice_items',     // references invoices(id)
      'invoice_attachments', // references invoices(id)
      'quotes',            // references customers(id) and invoices(id) - MUST be after invoices!
      'quote_items',       // references quotes(id)
      'quote_attachments', // references quotes(id)
      'job_entries',       // references customers(id) - fixed from 'jobs'
      'job_attachments',   // references job_entries(id)
      'job_time_entries',  // references job_entries(id)
      'customer_emails',   // references customers(id)
      'email_history'      // references invoices(id), quotes(id) and customers(id) - restore last
    ];

    logger.info('Restoring JSON data...');
    for (const table of restoreOrder) {
      if (backupData.data[table] && Array.isArray(backupData.data[table])) {
        try {
          logger.info(`Restoring table ${table}...`);

          if (backupData.data[table].length > 0) {
            // Get column names from first record
            const columns = Object.keys(backupData.data[table][0]);
            const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
            const columnNames = columns.join(', ');

            // Insert data
            for (const record of backupData.data[table]) {
              const values = columns.map(col => processValueForRestore(table, col, record[col]));
              await client.query(
                `INSERT INTO ${table} (${columnNames}) VALUES (${placeholders})`,
                values
              );
            }

            logger.info(`Restored ${backupData.data[table].length} records to ${table}`);
            restoredRecords += backupData.data[table].length;
          }
          
          restoredTables++;
        } catch (error) {
          logger.error(`ERROR: Could not restore table ${table}:`, error.message);
          // Don't throw here to continue with other tables, but log it prominently
        }
      }
    }

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
    if (!filename.match(/^backup_[\d-T:Z]+\.json$/)) {
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
    
    const backup = {
      timestamp: new Date().toISOString(),
      version: '2.0',
      type: 'full',
      data: {}
    };

    // Backup all tables - COMPLETE LIST including email history and SMTP settings
    const tables = [
      'customers',
      'customer_emails',
      'invoices', 
      'invoice_items',
      'invoice_attachments',
      'quotes',  // QUOTES MODULE
      'quote_items',  // QUOTES MODULE
      'quote_attachments',  // QUOTES MODULE
      'job_entries',  // Fixed: removed duplicate 'jobs' entry
      'job_attachments',
      'job_time_entries',
      'company',  // Fixed: removed 'company_settings' which doesn't exist
      'hourly_rates',
      'material_templates',
      'yearly_invoice_start_numbers',
      'email_history',  // ADDED: Email history - critical for user data!
      'smtp_settings',  // ADDED: SMTP settings - critical for user configuration!
      'customer_hourly_rates',  // FIXED: Customer-hourly rate associations - critical!
      'customer_specific_hourly_rates',  // FIXED: Customer-specific hourly rates - critical!
      'customer_specific_materials',  // FIXED: Customer-specific materials - critical!
      'migrations'
    ];

    for (const table of tables) {
      try {
        const result = await client.query(`SELECT * FROM ${table}`);
        backup.data[table] = result.rows;
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
      created: new Date().toISOString(),
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
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `vollbackup_${timestamp}.zip`;
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
    if (!filename.match(/^vollbackup_[\d-T:Z]+\.zip$/)) {
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

      logger.info('Starting restore process...');
      
      // Begin transaction
      await client.query('BEGIN');
      
      let restoredTables = 0;
      let restoredRecords = 0;

      // Step 1: Clear all data using TRUNCATE CASCADE and explicit DELETE for migrations
      logger.info('Clearing all data...');
      const tablesToClear = [
        'email_history', 'customer_emails', 'customer_hourly_rates',
        'customer_specific_hourly_rates', 'customer_specific_materials',
        'job_time_entries', 'job_attachments',
        'quote_attachments', 'quote_items', 'quotes',  // QUOTES MODULE - delete in reverse order
        'invoice_attachments', 'invoice_items', 'job_entries', 'invoices', 
        'hourly_rates', 'material_templates', 'customers', 'company',
        'yearly_invoice_start_numbers', 'smtp_settings'
      ];
      
      for (const table of tablesToClear) {
        try {
          await client.query(`TRUNCATE TABLE ${table} CASCADE`);
          logger.info(`Truncated table ${table}`);
        } catch (error) {
          logger.warn(`Could not truncate table ${table}:`, error.message);
        }
      }
      
      // Special handling for migrations table (explicit DELETE instead of TRUNCATE)
      try {
        await client.query(`DELETE FROM migrations`);
        logger.info(`Deleted all records from migrations table`);
      } catch (error) {
        logger.warn(`Could not clear migrations table:`, error.message);
      }

      // Step 2: Restore tables in correct dependency order (parent tables first)
      const restoreOrder = [
        'migrations',        // system table - restore first
        'company',           // parent table
        'customers',         // parent table  
        'yearly_invoice_start_numbers',
        'hourly_rates',      // references company(id)
        'material_templates', // references company(id)
        'smtp_settings',     // standalone settings table
        'customer_hourly_rates',  // references customers(id) and hourly_rates(id)
        'customer_specific_hourly_rates',  // references customers(id)
        'customer_specific_materials',  // references customers(id)
        'invoices',          // references customers(id)
        'invoice_items',     // references invoices(id)
        'invoice_attachments', // references invoices(id)
        'quotes',            // references customers(id) and invoices(id) - MUST be after invoices!
        'quote_items',       // references quotes(id)
        'quote_attachments', // references quotes(id)
        'job_entries',       // references customers(id)
        'job_attachments',   // references job_entries(id)
        'job_time_entries',  // references job_entries(id)
        'customer_emails',   // references customers(id)
        'email_history'      // references invoices(id), quotes(id) and customers(id) - restore last
      ];

      logger.info('Restoring data...');
      for (const table of restoreOrder) {
        if (backupData.data[table] && Array.isArray(backupData.data[table])) {
          try {
            logger.info(`Restoring table ${table}...`);

            if (backupData.data[table].length > 0) {
              // Get column names from first record
              const columns = Object.keys(backupData.data[table][0]);
              const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
              const columnNames = columns.join(', ');

              // Insert data
              for (const record of backupData.data[table]) {
                const values = columns.map(col => processValueForRestore(table, col, record[col]));
                await client.query(
                  `INSERT INTO ${table} (${columnNames}) VALUES (${placeholders})`,
                  values
                );
              }

              logger.info(`✅ Restored ${backupData.data[table].length} records to ${table}`);
              restoredRecords += backupData.data[table].length;
            } else {
              logger.info(`ℹ️  No data to restore for table ${table}`);
            }
            
            restoredTables++;
          } catch (error) {
            logger.error(`❌ ERROR: Could not restore table ${table}:`, error.message);
            // Don't throw here to continue with other tables, but log it prominently
          }
        } else {
          logger.info(`⏭️  Skipping table ${table} - no data in backup`);
        }
      }

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
    const backupFiles = files.filter(file => file.match(/^backup_[\d-T:Z]+\.json$/));
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
      const zipBackupFiles = files.filter(file => file.match(/^vollbackup_[\d-T:Z]+\.zip$/));
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
