import express from 'express';
import * as os from 'node:os';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { query } from '../database.js';
import logger from '../utils/logger.js';
import { testEmailConnection } from '../services/emailService.js';

const router = express.Router();

// Get email history with pagination and filtering
router.get('/history', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      filter = 'all', // 'all', 'sent', 'failed'
      search = '', // search in recipient_email, subject, customer_name
      startDate,
      endDate
    } = req.query;

    const offset = (page - 1) * limit;
    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    // Filter by status
    if (filter && filter !== 'all') {
      whereClause += ` AND status = $${paramIndex}`;
      params.push(filter);
      paramIndex++;
    }

    // Search functionality
    if (search && search.trim()) {
      whereClause += ` AND (
        recipient_email ILIKE $${paramIndex} OR 
        subject ILIKE $${paramIndex} OR 
        customer_name ILIKE $${paramIndex} OR
        invoice_number ILIKE $${paramIndex}
      )`;
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }

    // Date range filtering
    if (startDate) {
      whereClause += ` AND sent_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereClause += ` AND sent_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    // Get total count for pagination
    const countResult = await query(
      `SELECT COUNT(*) as total FROM email_history ${whereClause}`,
      params
    );
    const totalRecords = parseInt(countResult.rows[0].total);

    // Get paginated results
    const result = await query(`
      SELECT 
        id,
        sender_email,
        sender_name,
        recipient_email,
        subject,
        body_html,
        attachments,
        message_id,
        invoice_id,
        invoice_number,
        customer_id,
        customer_name,
        email_type,
        status,
        error_message,
        sent_at,
        created_at
      FROM email_history
      ${whereClause}
      ORDER BY sent_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, limit, offset]);

    const emails = result.rows.map(email => ({
      ...email,
      attachments: email.attachments || [],
      attachment_count: (email.attachments || []).length
    }));

    res.json({
      success: true,
      emails,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalRecords / limit),
        totalRecords,
        hasMore: (page * limit) < totalRecords
      }
    });

  } catch (error) {
    logger.error('Failed to fetch email history', {
      error: error.message,
      stack: error.stack,
      method: 'GET',
      endpoint: '/email-history'
    });
    res.status(500).json({
      success: false,
      message: 'Fehler beim Laden der E-Mail-Historie',
      error: error.message
    });
  }
});

// Get single email details
router.get('/history/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(`
      SELECT 
        id,
        sender_email,
        sender_name,
        recipient_email,
        subject,
        body_html,
        body_plain,
        attachments,
        message_id,
        smtp_response,
        invoice_id,
        invoice_number,
        customer_id,
        customer_name,
        email_type,
        status,
        error_message,
        sent_at,
        created_at
      FROM email_history
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'E-Mail nicht gefunden'
      });
    }

    const email = result.rows[0];
    email.attachments = email.attachments || [];

    res.json({
      success: true,
      email
    });

  } catch (error) {
    logger.error('Failed to fetch email details', {
      error: error.message,
      stack: error.stack,
      emailId: req.params.id,
      method: 'GET',
      endpoint: '/email-history/:id'
    });
    res.status(500).json({
      success: false,
      message: 'Fehler beim Laden der E-Mail-Details',
      error: error.message
    });
  }
});

// Get email statistics
router.get('/statistics', async (req, res) => {
  try {
    // Get overall statistics
    const totalResult = await query('SELECT COUNT(*) as total FROM email_history');
    const sentResult = await query("SELECT COUNT(*) as sent FROM email_history WHERE status = 'sent'");
    const failedResult = await query("SELECT COUNT(*) as failed FROM email_history WHERE status = 'failed'");
    
    // Get statistics for last 30 days
    const last30DaysResult = await query(`
      SELECT COUNT(*) as last_30_days 
      FROM email_history 
      WHERE sent_at >= NOW() - INTERVAL '30 days'
    `);

    // Get statistics by day for the last 7 days
    const dailyStatsResult = await query(`
      SELECT 
        DATE(sent_at) as date,
        COUNT(*) as count,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count
      FROM email_history
      WHERE sent_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(sent_at)
      ORDER BY date DESC
    `);

    // Get top recipients
    const topRecipientsResult = await query(`
      SELECT 
        recipient_email,
        customer_name,
        COUNT(*) as email_count
      FROM email_history
      GROUP BY recipient_email, customer_name
      ORDER BY email_count DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      statistics: {
        total: parseInt(totalResult.rows[0].total),
        sent: parseInt(sentResult.rows[0].sent),
        failed: parseInt(failedResult.rows[0].failed),
        last30Days: parseInt(last30DaysResult.rows[0].last_30_days),
        dailyStats: dailyStatsResult.rows,
        topRecipients: topRecipientsResult.rows
      }
    });

  } catch (error) {
    logger.error('Failed to fetch email statistics', {
      error: error.message,
      stack: error.stack,
      method: 'GET',
      endpoint: '/statistics'
    });
    res.status(500).json({
      success: false,
      message: 'Fehler beim Laden der E-Mail-Statistiken',
      error: error.message
    });
  }
});

// Get SMTP settings
router.get('/smtp-settings', async (req, res) => {
  try {
    const result = await query('SELECT * FROM smtp_settings WHERE id = 1');
    
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        settings: {
          smtp_host: '',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: '',
          smtp_pass: '',
          email_from: '',
          email_from_name: '',
          is_enabled: false,
          test_email: ''
        }
      });
    }

    const settings = result.rows[0];
    // Don't send the password in the response for security
    const sanitizedSettings = {
      ...settings,
      smtp_pass: settings.smtp_pass ? '****' : ''
    };

    res.json({
      success: true,
      settings: sanitizedSettings
    });

  } catch (error) {
    logger.error('Failed to fetch SMTP settings', {
      error: error.message,
      stack: error.stack,
      method: 'GET',
      endpoint: '/smtp-settings'
    });
    res.status(500).json({
      success: false,
      message: 'Fehler beim Laden der SMTP-Einstellungen',
      error: error.message
    });
  }
});

// Update SMTP settings
router.post('/smtp-settings', async (req, res) => {
  try {
    const {
      smtp_host,
      smtp_port,
      smtp_secure,
      smtp_user,
      smtp_pass,
      email_from,
      email_from_name,
      is_enabled,
      test_email
    } = req.body;

    // Validate required fields
    if (is_enabled && (!smtp_host || !smtp_port || !smtp_user || !email_from)) {
      return res.status(400).json({
        success: false,
        message: 'SMTP-Host, Port, Benutzer und Absender-E-Mail sind erforderlich'
      });
    }

    // Check if settings exist
    const existingResult = await query('SELECT id FROM smtp_settings WHERE id = 1');
    
    if (existingResult.rows.length === 0) {
      // Create new settings
      await query(`
        INSERT INTO smtp_settings (
          id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass,
          email_from, email_from_name, is_enabled, test_email, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      `, [
        1, smtp_host, smtp_port || 587, smtp_secure || false,
        smtp_user, smtp_pass, email_from, email_from_name,
        is_enabled || false, test_email
      ]);
    } else {
      // Update existing settings
      let updateQuery = `
        UPDATE smtp_settings SET
          smtp_host = $1,
          smtp_port = $2,
          smtp_secure = $3,
          smtp_user = $4,
          email_from = $5,
          email_from_name = $6,
          is_enabled = $7,
          test_email = $8,
          updated_at = NOW()
        WHERE id = 1
      `;
      let params = [
        smtp_host, smtp_port || 587, smtp_secure || false,
        smtp_user, email_from, email_from_name,
        is_enabled || false, test_email
      ];

      // Only update password if it's provided and not masked
      if (smtp_pass && smtp_pass !== '****') {
        updateQuery = `
          UPDATE smtp_settings SET
            smtp_host = $1,
            smtp_port = $2,
            smtp_secure = $3,
            smtp_user = $4,
            smtp_pass = $5,
            email_from = $6,
            email_from_name = $7,
            is_enabled = $8,
            test_email = $9,
            updated_at = NOW()
          WHERE id = 1
        `;
        params = [
          smtp_host, smtp_port || 587, smtp_secure || false,
          smtp_user, smtp_pass, email_from, email_from_name,
          is_enabled || false, test_email
        ];
      }

      await query(updateQuery, params);
    }

    res.json({
      success: true,
      message: 'SMTP-Einstellungen erfolgreich gespeichert'
    });

  } catch (error) {
    logger.error('Error updating SMTP settings:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Speichern der SMTP-Einstellungen',
      error: error.message
    });
  }
});

// Debug environment and database configuration
router.post('/debug-config', async (req, res) => {
  try {
    // Get environment variables
    const envConfig = {
      SMTP_HOST: process.env.SMTP_HOST,
      SMTP_PORT: process.env.SMTP_PORT,
      SMTP_SECURE: process.env.SMTP_SECURE,
      SMTP_USER: process.env.SMTP_USER,
      SMTP_PASS: process.env.SMTP_PASS ? '****' : undefined,
      EMAIL_FROM: process.env.EMAIL_FROM,
      EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME,
      NODE_ENV: process.env.NODE_ENV
    };

    // Get database settings
    let dbConfig = null;
    try {
      const result = await query('SELECT * FROM smtp_settings WHERE id = 1');
      if (result.rows.length > 0) {
        const settings = result.rows[0];
        dbConfig = {
          smtp_host: settings.smtp_host,
          smtp_port: settings.smtp_port,
          smtp_secure: settings.smtp_secure,
          smtp_user: settings.smtp_user,
          smtp_pass: settings.smtp_pass ? '****' : null,
          email_from: settings.email_from,
          email_from_name: settings.email_from_name,
          is_enabled: settings.is_enabled
        };
      }
    } catch (error) {
      logger.error('Error fetching database settings:', error);
    }

    // Determine which config would be used
    const activeConfig = dbConfig && dbConfig.is_enabled ? 'database' : 'environment';
    
    res.json({
      success: true,
      debug: {
        activeConfig,
        environment: envConfig,
        database: dbConfig,
        containerInfo: {
          hostname: os.hostname(),
          platform: os.platform(),
          networkInterfaces: os.networkInterfaces()
        }
      }
    });

  } catch (error) {
    logger.error('Error debugging config:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Debugging der Konfiguration',
      error: error.message
    });
  }
});

// Diagnose SMTP settings
router.post('/diagnose-smtp', async (req, res) => {
  try {
    const result = await query('SELECT * FROM smtp_settings WHERE id = 1');
    
    if (result.rows.length === 0) {
      return res.json({
        success: false,
        message: 'Keine SMTP-Einstellungen in der Datenbank gefunden',
        diagnosis: {
          hasSettings: false,
          isEnabled: false,
          commonPorts: { 587: 'STARTTLS', 465: 'SSL/TLS', 25: 'Plain' },
          suggestions: [
            'Speichern Sie zunächst SMTP-Einstellungen in der Datenbank',
            'Verwenden Sie Port 587 mit STARTTLS für die meisten Provider',
            'Gmail: smtp.gmail.com:587, Outlook: smtp-mail.outlook.com:587'
          ]
        }
      });
    }

    const settings = result.rows[0];
    const diagnosis = {
      hasSettings: true,
      isEnabled: settings.is_enabled,
      host: settings.smtp_host,
      port: settings.smtp_port,
      secure: settings.smtp_secure,
      hasAuth: !!(settings.smtp_user && settings.smtp_pass),
      commonIssues: [],
      suggestions: []
    };

    // Check for common configuration issues
    if (!settings.is_enabled) {
      diagnosis.commonIssues.push('SMTP ist deaktiviert');
      diagnosis.suggestions.push('Aktivieren Sie SMTP in den Einstellungen');
    }

    if (!settings.smtp_host) {
      diagnosis.commonIssues.push('Kein SMTP-Host konfiguriert');
    }

    if (!settings.smtp_user || !settings.smtp_pass) {
      diagnosis.commonIssues.push('Unvollständige Anmeldedaten');
      diagnosis.suggestions.push('Überprüfen Sie Benutzername und Passwort');
    }

    // Port-specific suggestions
    if (settings.smtp_port === 465 && !settings.smtp_secure) {
      diagnosis.commonIssues.push('Port 465 erfordert SSL/TLS');
      diagnosis.suggestions.push('Aktivieren Sie SSL/TLS für Port 465');
    }

    if (settings.smtp_port === 587 && settings.smtp_secure) {
      diagnosis.commonIssues.push('Port 587 sollte STARTTLS verwenden, nicht SSL/TLS');
      diagnosis.suggestions.push('Deaktivieren Sie SSL/TLS für Port 587');
    }

    res.json({
      success: true,
      message: 'SMTP-Diagnose abgeschlossen',
      diagnosis
    });

  } catch (error) {
    logger.error('Error diagnosing SMTP settings:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler bei der SMTP-Diagnose',
      error: error.message
    });
  }
});

// Test SMTP connection with database settings
router.post('/test-smtp', async (req, res) => {
  try {
    const { use_database_settings = true, settings = null } = req.body;

    let smtpConfig;

    if (use_database_settings) {
      // Use settings from database
      const result = await query('SELECT * FROM smtp_settings WHERE id = 1');
      const dbSettings = result.rows[0];
      if (dbSettings?.is_enabled) {
        smtpConfig = {
          host: dbSettings.smtp_host,
          port: dbSettings.smtp_port,
          secure: dbSettings.smtp_secure,
          auth: {
            user: dbSettings.smtp_user,
            pass: dbSettings.smtp_pass,
          },
        };
      } else if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        smtpConfig = {
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || '587', 10),
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        };
      } else {
        return res.status(400).json({
          success: false,
          message: 'Keine aktiven SMTP-Einstellungen in Datenbank oder Umgebungsvariablen gefunden'
        });
      }
    } else if (settings) {
      // Use provided settings for testing
      smtpConfig = {
        host: settings.smtp_host,
        port: settings.smtp_port,
        secure: settings.smtp_secure,
        auth: {
          user: settings.smtp_user,
          pass: settings.smtp_pass,
        },
      };
    } else {
      return res.status(400).json({
        success: false,
        message: 'Keine SMTP-Einstellungen zum Testen bereitgestellt'
      });
    }

    // Test the connection
    const nodemailer = await import('nodemailer');
    
    // Add timeout and connection options
    const enhancedSmtpConfig = {
      ...smtpConfig,
      connectionTimeout: 10000, // 10 seconds
      greetingTimeout: 10000, // 10 seconds
      socketTimeout: 30000, // 30 seconds
      pool: false, // Don't use connection pooling for testing
      debug: false, // Set to true for debugging
      logger: false // Set to true for debugging
    };

    const transporter = nodemailer.createTransport(enhancedSmtpConfig);

    // Test with timeout
    const testTimeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('SMTP-Test-Timeout nach 30 Sekunden')), 30000);
    });

    await Promise.race([transporter.verify(), testTimeout]);

    res.json({
      success: true,
      message: 'SMTP-Verbindung erfolgreich getestet'
    });

  } catch (error) {
    logger.error('SMTP test failed:', error);
    
    // Provide more specific error messages
    let errorMessage = error.message;
    let troubleshootingTips = [];

    if (error.message.includes('Greeting never received')) {
      errorMessage = 'Keine Antwort vom SMTP-Server erhalten';
      troubleshootingTips.push('Überprüfen Sie Host und Port');
      troubleshootingTips.push('Stellen Sie sicher, dass der Server erreichbar ist');
      troubleshootingTips.push('Prüfen Sie Firewall-Einstellungen');
    } else if (error.message.includes('timeout')) {
      errorMessage = 'Verbindungs-Timeout';
      troubleshootingTips.push('Server antwortet nicht rechtzeitig');
      troubleshootingTips.push('Versuchen Sie einen anderen Port (587, 465, 25)');
    } else if (error.message.includes('ENOTFOUND')) {
      errorMessage = 'SMTP-Server nicht gefunden';
      troubleshootingTips.push('Überprüfen Sie den Hostnamen');
    } else if (error.message.includes('ECONNREFUSED')) {
      errorMessage = 'Verbindung verweigert';
      troubleshootingTips.push('Port ist möglicherweise gesperrt oder falsch');
    } else if (error.message.includes('Invalid login')) {
      errorMessage = 'Ungültige Anmeldedaten';
      troubleshootingTips.push('Überprüfen Sie Benutzername und Passwort');
    }

    res.status(500).json({
      success: false,
      message: `SMTP-Test fehlgeschlagen: ${errorMessage}`,
      error: error.message,
      troubleshooting: troubleshootingTips
    });
  }
});

// Test network connectivity to SMTP server
router.post('/test-network', async (req, res) => {
  try {
    const { host, port } = req.body;
    
    if (!host || !port) {
      return res.status(400).json({
        success: false,
        message: 'Host und Port sind erforderlich'
      });
    }

    const results = {
      dns: null,
      tcp: null,
      timing: {}
    };

    try {
      // DNS Lookup Test
      const dnsStart = Date.now();
      const addresses = await lookup(host);
      results.dns = {
        success: true,
        address: addresses.address,
        family: addresses.family,
        timing: Date.now() - dnsStart
      };
    } catch (dnsError) {
      results.dns = {
        success: false,
        error: dnsError.message,
        timing: Date.now() - dnsStart || 0
      };
    }

    // TCP Connection Test
    const tcpStart = Date.now();
    const tcpPromise = new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve({
          success: false,
          error: 'Connection timeout (10s)',
          timing: Date.now() - tcpStart
        });
      }, 10000);

      socket.connect(port, host, () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve({
          success: true,
          timing: Date.now() - tcpStart
        });
      });

      socket.on('error', (error) => {
        clearTimeout(timeout);
        socket.destroy();
        resolve({
          success: false,
          error: error.message,
          timing: Date.now() - tcpStart
        });
      });
    });

    results.tcp = await tcpPromise;

    const overallSuccess = results.dns.success && results.tcp.success;

    res.json({
      success: overallSuccess,
      message: overallSuccess 
        ? 'Netzwerkverbindung erfolgreich' 
        : 'Netzwerkverbindung fehlgeschlagen',
      results,
      recommendations: overallSuccess ? [] : [
        !results.dns.success ? 'DNS-Problem: Überprüfen Sie den Hostnamen' : null,
        !results.tcp.success ? 'TCP-Problem: Überprüfen Sie Port und Firewall' : null,
        'Stellen Sie sicher, dass Docker externe Verbindungen erlaubt',
        'Überprüfen Sie Unternehmens-Firewall/Proxy-Einstellungen'
      ].filter(Boolean)
    });

  } catch (error) {
    logger.error('Network test error:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Netzwerktest',
      error: error.message
    });
  }
});

// Send test email
router.post('/send-test-email', async (req, res) => {
  try {
    const { recipient_email, custom_subject, custom_message } = req.body;

    if (!recipient_email) {
      return res.status(400).json({
        success: false,
        message: 'Empfänger-E-Mail-Adresse ist erforderlich'
      });
    }

    // Get SMTP settings from database
    const settingsResult = await query('SELECT * FROM smtp_settings WHERE id = 1');
    
    if (settingsResult.rows.length === 0 || !settingsResult.rows[0].is_enabled) {
      return res.status(400).json({
        success: false,
        message: 'Keine aktiven SMTP-Einstellungen gefunden'
      });
    }

    const dbSettings = settingsResult.rows[0];

    // Create transporter
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host: dbSettings.smtp_host,
      port: dbSettings.smtp_port,
      secure: dbSettings.smtp_secure,
      auth: {
        user: dbSettings.smtp_user,
        pass: dbSettings.smtp_pass,
      },
      connectionTimeout: 10000, // 10 seconds
      greetingTimeout: 10000, // 10 seconds
      socketTimeout: 30000, // 30 seconds
    });

    // Prepare email content
    const subject = custom_subject || 'Test-E-Mail von SoloOffice';
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Test-E-Mail erfolgreich!</h2>
        <p>Diese Test-E-Mail wurde von Ihrem SoloOffice-System gesendet.</p>
        ${custom_message ? `
          <div style="background-color: #f0f8ff; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #2563eb;">
            <p style="margin: 0; white-space: pre-line;">${custom_message}</p>
          </div>
        ` : ''}
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Systemdetails:</h3>
          <p><strong>Gesendet am:</strong> ${new Date().toLocaleString('de-DE')}</p>
          <p><strong>SMTP-Server:</strong> ${dbSettings.smtp_host}:${dbSettings.smtp_port}</p>
          <p><strong>Verschlüsselung:</strong> ${dbSettings.smtp_secure ? 'SSL/TLS' : 'STARTTLS'}</p>
        </div>
        <p>Wenn Sie diese E-Mail erhalten haben, funktioniert Ihre E-Mail-Konfiguration korrekt!</p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
        <p style="font-size: 12px; color: #666;">
          Diese E-Mail wurde automatisch von SoloOffice generiert.
        </p>
      </div>
    `;

    // Send the email
    const mailOptions = {
      from: {
        name: dbSettings.email_from_name || 'SoloOffice',
        address: dbSettings.email_from || dbSettings.smtp_user
      },
      to: recipient_email,
      subject: subject,
      html: htmlContent
    };

    const result = await transporter.sendMail(mailOptions);

    // Log the test email in history
    await query(`
      INSERT INTO email_history (
        sender_email, sender_name, recipient_email, subject, body_html,
        message_id, email_type, status, sent_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `, [
      dbSettings.email_from || dbSettings.smtp_user,
      dbSettings.email_from_name || 'SoloOffice',
      recipient_email,
      subject,
      htmlContent,
      result.messageId,
      'test',
      'sent'
    ]);

    res.json({
      success: true,
      message: 'Test-E-Mail erfolgreich versendet',
      messageId: result.messageId,
      recipient: recipient_email
    });

  } catch (error) {
    logger.error('Error sending test email:', error);
    
    // Log failed test email in history
    try {
      const settingsResult = await query('SELECT * FROM smtp_settings WHERE id = 1');
      if (settingsResult.rows.length > 0) {
        const dbSettings = settingsResult.rows[0];
        await query(`
          INSERT INTO email_history (
            sender_email, sender_name, recipient_email, subject, 
            email_type, status, error_message, sent_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `, [
          dbSettings.email_from || dbSettings.smtp_user,
          dbSettings.email_from_name || 'SoloOffice',
          req.body.recipient_email || 'unknown',
          req.body.custom_subject || 'Test-E-Mail von SoloOffice',
          'test',
          'failed',
          error.message
        ]);
      }
    } catch (logError) {
      logger.error('Error logging failed test email:', logError);
    }

    res.status(500).json({
      success: false,
      message: `Fehler beim Versenden der Test-E-Mail: ${error.message}`,
      error: error.message
    });
  }
});

export default router;
