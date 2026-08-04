import express from 'express';
import { sendInvoiceEmail, sendInvoiceEmailMultiFormat, sendReminderEmail, testEmailConnection } from '../services/emailService.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Test email configuration
router.get('/test', async (req, res) => {
  try {
    const result = await testEmailConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Fehler beim Testen der E-Mail-Konfiguration',
      error: error.message 
    });
  }
});

// Send invoice via email with multiple formats
router.post('/send-invoice-multi', async (req, res) => {
  try {
    const { customerEmails, invoiceFormats, invoiceData, customText, attachments } = req.body;
    
    if (!customerEmails || !Array.isArray(customerEmails) || customerEmails.length === 0 || !invoiceFormats || !Array.isArray(invoiceFormats) || !invoiceData) {
      return res.status(400).json({ 
        success: false, 
        message: 'Fehlende Parameter: customerEmails (Array), invoiceFormats und invoiceData sind erforderlich' 
      });
    }

    // Get company settings for styling
    const { query } = await import('../database.js');
    const companyResult = await query('SELECT primary_color, secondary_color, locale, number_format, currency, date_format, time_format FROM company WHERE id = 1');
    const companySettings = companyResult.rows[0] || { primary_color: '#2563eb', secondary_color: '#64748b', locale: 'de-DE', number_format: 'european', currency: 'EUR', date_format: 'DD.MM.YYYY', time_format: '24h' };

    // Convert base64 PDFs to buffers
    const processedFormats = invoiceFormats.map(({ format, content }) => ({
      format,
      content: Buffer.from(content, 'base64')
    }));
    
    // Process additional attachments if provided
    let processedAttachments = [];
    if (attachments && Array.isArray(attachments)) {
      processedAttachments = attachments.map(attachment => ({
        name: attachment.name,
        content: attachment.content, // Already base64
        contentType: attachment.contentType || 'application/octet-stream'
      }));
    }

    // Send to all recipients
    const results = [];
    for (const email of customerEmails) {
      try {
        const result = await sendInvoiceEmailMultiFormat(email, processedFormats, invoiceData, customText, processedAttachments, companySettings);
        results.push({ email, success: true, messageId: result.messageId });
      } catch (error) {
        logger.error(`Error sending to ${email}:`, error);
        results.push({ email, success: false, error: error.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    res.json({
      success: successCount > 0,
      message: `Rechnung versendet: ${successCount} erfolgreich, ${failureCount} fehlgeschlagen`,
      results,
      successCount,
      failureCount
    });
    
  } catch (error) {
    logger.error('Fehler beim E-Mail-Versand:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Fehler beim E-Mail-Versand',
      error: error.message 
    });
  }
});

// Send invoice via email
router.post('/send-invoice', async (req, res) => {
  try {
    const { customerEmail, invoicePDF, invoiceData, format = 'standard', customText, attachments } = req.body;
    
    if (!customerEmail || !invoicePDF || !invoiceData) {
      return res.status(400).json({ 
        success: false, 
        message: 'Fehlende Parameter: customerEmail, invoicePDF und invoiceData sind erforderlich' 
      });
    }

    // Get company settings for styling
    const { query } = await import('../database.js');
    const companyResult = await query('SELECT primary_color, secondary_color, locale, number_format, currency, date_format, time_format FROM company WHERE id = 1');
    const companySettings = companyResult.rows[0] || { primary_color: '#2563eb', secondary_color: '#64748b', locale: 'de-DE', number_format: 'european', currency: 'EUR', date_format: 'DD.MM.YYYY', time_format: '24h' };

    // Convert base64 PDF to buffer
    const pdfBuffer = Buffer.from(invoicePDF, 'base64');
    
    // Process additional attachments if provided
    let processedAttachments = [];
    if (attachments && Array.isArray(attachments)) {
      processedAttachments = attachments.map(attachment => ({
        name: attachment.name,
        content: attachment.content, // Already base64
        contentType: attachment.contentType || 'application/octet-stream'
      }));
    }
    
    const result = await sendInvoiceEmail(customerEmail, pdfBuffer, invoiceData, format, customText, processedAttachments, companySettings);
    
    res.json({
      success: true,
      message: 'Rechnung erfolgreich per E-Mail versendet',
      messageId: result.messageId
    });
    
  } catch (error) {
    logger.error('Fehler beim E-Mail-Versand:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Fehler beim E-Mail-Versand',
      error: error.message 
    });
  }
});

// Send reminder email
router.post('/send-reminder', async (req, res) => {
  try {
    const { customerEmails, reminderPDF, invoiceData, stage, fee, customText, additionalAttachments } = req.body;
    
    if (!customerEmails || !Array.isArray(customerEmails) || customerEmails.length === 0 || !reminderPDF || !invoiceData || !stage) {
      return res.status(400).json({ 
        success: false, 
        message: 'Fehlende Parameter: customerEmails (Array), reminderPDF, invoiceData und stage sind erforderlich' 
      });
    }

    // Get company settings for styling
    const { query } = await import('../database.js');
    const companyResult = await query('SELECT primary_color, secondary_color, locale, number_format, currency, date_format, time_format FROM company WHERE id = 1');
    const companySettings = companyResult.rows[0] || { primary_color: '#2563eb', secondary_color: '#64748b', locale: 'de-DE', number_format: 'european', currency: 'EUR', date_format: 'DD.MM.YYYY', time_format: '24h' };

    const result = await sendReminderEmail(
      customerEmails, 
      reminderPDF, 
      invoiceData, 
      stage, 
      fee || 0, 
      customText, 
      companySettings,
      additionalAttachments || []
    );
    
    res.json(result);
    
  } catch (error) {
    logger.error('Fehler beim Mahnungs-Versand:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Fehler beim Mahnungs-Versand',
      error: error.message 
    });
  }
});

export default router;
