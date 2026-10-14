import express from 'express';
import * as os from 'node:os';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { query } from '../database.js';
import logger from '../utils/logger.js';
import { testEmailConnection } from '../services/emailService.js';
import { renderSystemEmail } from '../services/emailTemplates.js';
import { decryptSecret, encryptSecret } from '../utils/secretBox.js';
import { isSingleEmailAddress, publicSmtpSettings, smtpErrorMessage, smtpPassword, smtpTransportOptions, validateSmtpSettings } from '../utils/smtpSettings.js';

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

// Zugangsdaten werden nie an den Browser zurückgeliefert.
router.get('/smtp-settings', async (req, res) => {
  try {
    const result = await query('SELECT * FROM smtp_settings WHERE id = 1');
    res.json({ success: true, settings: publicSmtpSettings(result.rows[0]) });
  } catch (error) {
    logger.error('Failed to fetch SMTP settings', { code: error.code });
    res.status(500).json({ success: false, message: 'Die Mail-Einstellungen konnten nicht geladen werden.' });
  }
});

router.post('/smtp-settings', async (req, res) => {
  try {
    const existing = await query('SELECT id, smtp_pass_encrypted FROM smtp_settings WHERE id = 1');
    const stored = existing.rows[0];
    const settings = validateSmtpSettings(req.body, { hasStoredPassword: Boolean(stored?.smtp_pass_encrypted) });
    const encryptedPassword = settings.smtp_pass ? encryptSecret(settings.smtp_pass) : stored?.smtp_pass_encrypted || null;
    const values = [settings.smtp_host, settings.smtp_port, settings.smtp_secure, settings.smtp_user,
      encryptedPassword, settings.email_from, settings.email_from_name, settings.is_enabled, settings.test_email];
    if (stored) {
      await query(`UPDATE smtp_settings SET smtp_host = $1, smtp_port = $2, smtp_secure = $3,
        smtp_user = $4, smtp_pass_encrypted = $5, email_from = $6, email_from_name = $7,
        is_enabled = $8, test_email = $9, updated_at = NOW() WHERE id = 1`, values);
    } else {
      await query(`INSERT INTO smtp_settings (id, smtp_host, smtp_port, smtp_secure, smtp_user,
        smtp_pass_encrypted, email_from, email_from_name, is_enabled, test_email, created_at, updated_at)
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`, values);
    }
    res.json({ success: true, message: 'Mail-Einstellungen gespeichert.' });
  } catch (error) {
    logger.error('Error updating SMTP settings', { code: error.code });
    res.status(error.status || 500).json({ success: false,
      message: error.status === 400 ? error.message : 'Die Mail-Einstellungen konnten nicht gespeichert werden.' });
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
          smtp_pass: settings.smtp_pass_encrypted ? '****' : null,
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
      hasAuth: !!(settings.smtp_user && settings.smtp_pass_encrypted),
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

    if (!settings.smtp_user || !settings.smtp_pass_encrypted) {
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

// Entwurfswerte prüfen; ein leeres Passwort behält das gespeicherte Geheimnis.
router.post('/test-smtp', async (req, res) => {
  let transporter;
  let timeout;
  try {
    const { use_database_settings = true, settings = null } = req.body;
    const result = await query('SELECT * FROM smtp_settings WHERE id = 1');
    const stored = result.rows[0];
    let input;
    let password;
    if (use_database_settings) {
      if (stored?.is_enabled) {
        input = stored;
        password = decryptSecret(stored.smtp_pass_encrypted);
      } else {
        input = { smtp_host: process.env.SMTP_HOST, smtp_port: process.env.SMTP_PORT || 587,
          smtp_secure: process.env.SMTP_SECURE === 'true', smtp_user: process.env.SMTP_USER,
          smtp_pass: process.env.SMTP_PASS };
        password = process.env.SMTP_PASS;
      }
    } else {
      input = settings;
      password = smtpPassword(settings?.smtp_pass) || (stored?.smtp_pass_encrypted ? decryptSecret(stored.smtp_pass_encrypted) : '');
    }
    const config = validateSmtpSettings(input, { hasStoredPassword: Boolean(password), forConnection: true });
    const { default: nodemailer } = await import('nodemailer');
    transporter = nodemailer.createTransport(smtpTransportOptions(config, password));
    await Promise.race([
      transporter.verify(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Object.assign(new Error('SMTP-Test-Timeout'), { code: 'ETIMEDOUT' })), 30000);
      }),
    ]);
    res.json({ success: true, message: 'Verbindung und Anmeldung erfolgreich geprüft. Dabei wurde keine E-Mail gesendet.' });
  } catch (error) {
    logger.warn('SMTP test failed', { code: error.code });
    res.status(error.status || 502).json({ success: false,
      message: error.status === 400 ? error.message : smtpErrorMessage(error) });
  } finally {
    clearTimeout(timeout);
    transporter?.close();
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

// Eine echte Testmail verwendet ausschließlich den gespeicherten SMTP-Stand.
router.post('/send-test-email', async (req, res) => {
  let transporter;
  let dbSettings;
  let recipient;
  let subject;
  try {
    const { recipient_email, custom_subject, custom_message } = req.body;
    if (!isSingleEmailAddress(recipient_email)) {
      return res.status(400).json({ success: false, message: 'Bitte eine gültige Empfängeradresse für die Testmail eingeben.' });
    }
    recipient = recipient_email.trim();
    if ((custom_subject != null && (typeof custom_subject !== 'string' || custom_subject.length > 500 || /[\r\n\0]/u.test(custom_subject)))
      || (custom_message != null && (typeof custom_message !== 'string' || custom_message.length > 10000))) {
      return res.status(400).json({ success: false, message: 'Betreff oder Nachricht der Testmail ist ungültig.' });
    }
    subject = custom_subject?.trim() || 'Testmail von SoloOffice';
    const settingsResult = await query('SELECT * FROM smtp_settings WHERE id = 1');
    dbSettings = settingsResult.rows[0];
    if (!dbSettings?.is_enabled) {
      return res.status(400).json({ success: false, message: 'Bitte die Mail-Einstellungen zuerst speichern und den Versand aktivieren.' });
    }
    const password = decryptSecret(dbSettings.smtp_pass_encrypted);
    const settings = validateSmtpSettings(dbSettings, { hasStoredPassword: Boolean(password) });
    const { default: nodemailer } = await import('nodemailer');
    transporter = nodemailer.createTransport(smtpTransportOptions(settings, password));
    const testMail = renderSystemEmail({
      title: 'Testmail von SoloOffice',
      preheader: 'Diese Nachricht prüft den Mailversand Ihrer SoloOffice-Instanz.',
      greeting: 'Guten Tag,',
      paragraphs: ['diese Testmail wurde mit den gespeicherten Mail-Einstellungen von SoloOffice gesendet. Wenn Sie sie lesen, ist sie in Ihrem Postfach angekommen.',
        ...(custom_message ? [custom_message] : [])],
      details: [{ label: 'Gesendet am', value: new Date().toLocaleString('de-DE') }],
      reason: 'Sie erhalten diese E-Mail, weil in SoloOffice eine Testmail ausgelöst wurde.',
      recipient,
    });
    const info = await transporter.sendMail({
      from: { name: settings.email_from_name || 'SoloOffice', address: settings.email_from },
      to: recipient, subject, text: testMail.text, html: testMail.html,
    });
    if (Array.isArray(info.accepted) && !info.accepted.some(address => String(address).toLowerCase() === recipient.toLowerCase())) {
      throw Object.assign(new Error('Testmail recipient rejected'), { code: 'EENVELOPE' });
    }
    // Ein Protokollfehler darf nach erfolgreichem Versand keinen erneuten Versand auslösen.
    let historyWarning;
    try {
      await query(`INSERT INTO email_history (sender_email, sender_name, recipient_email, subject, body_html,
        body_plain, message_id, smtp_response, email_type, status, sent_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'test', 'sent', NOW())`,
      [settings.email_from, settings.email_from_name || 'SoloOffice', recipient, subject,
        testMail.html, testMail.text, info.messageId, JSON.stringify(info)]);
    } catch (historyError) {
      logger.error('Could not record sent test email', { code: historyError.code });
      historyWarning = 'Der Versand konnte nicht im Verlauf gespeichert werden.';
    }
    res.json({ success: true,
      message: `Testmail an ${recipient} wurde dem Mailserver übergeben. Bitte Posteingang und Spamordner prüfen.`,
      messageId: info.messageId, recipient, ...(historyWarning ? { warning: historyWarning } : {}) });
  } catch (error) {
    logger.warn('Test email failed', { code: error.code });
    const message = error.status === 400 ? error.message : smtpErrorMessage(error);
    if (dbSettings && error.status !== 400) {
      try {
        await query(`INSERT INTO email_history (sender_email, sender_name, recipient_email, subject,
          email_type, status, error_message, sent_at) VALUES ($1, $2, $3, $4, 'test', 'failed', $5, NOW())`,
        [dbSettings.email_from || dbSettings.smtp_user, dbSettings.email_from_name || 'SoloOffice', recipient, subject, message]);
      } catch (historyError) {
        logger.error('Could not record failed test email', { code: historyError.code });
      }
    }
    res.status(error.status || 502).json({ success: false, message });
  } finally {
    transporter?.close();
  }
});

export default router;
