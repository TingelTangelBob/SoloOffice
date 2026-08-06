import express from 'express';
import { query } from '../database.js';
import logger from '../utils/logger.js';

const router = express.Router();
const LOCALES = new Set(['de-DE', 'en-US', 'fr-FR', 'es-ES']);
const NUMBER_FORMATS = new Set(['european', 'american']);
const DATE_FORMATS = new Set(['DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']);
const TIME_FORMATS = new Set(['24h', '12h']);
const TIME_ZONES = new Set([
  'Europe/Berlin', 'Europe/London', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Madrid', 'Europe/Rome',
  'Europe/Athens', 'Europe/Helsinki', 'Europe/Bucharest', 'Europe/Istanbul', 'America/New_York',
  'America/Chicago', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney', 'UTC'
]);
const THEME_MODES = new Set(['system', 'light', 'dark']);
const PAYMENT_INFORMATION_MODES = new Set(['separate', 'company']);
const TERMINOLOGY_PROFILES = new Set(['customers', 'mandants', 'patients', 'students', 'clients']);
const TERMINOLOGY_COLOR_SOURCES = new Set(['appearance', 'profile']);
const TAX_BUSINESS_TYPES = new Set(['freelance', 'commercial', 'agriculture', 'nonprofit', 'other']);
const LEGAL_FORMS = new Set(['sole_proprietorship', 'partnership', 'gbr', 'ug', 'gmbh', 'ag', 'eg', 'nonprofit', 'other']);
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapCompanyRow(row) {
  return {
    name: row.name,
    address: row.address,
    city: row.city,
    postalCode: row.postal_code,
    country: row.country,
    phone: row.phone,
    email: row.email,
    website: row.website,
    taxId: row.tax_id,
    taxIdentificationNumber: row.tax_identification_number,
    taxBusinessType: row.tax_business_type || 'commercial',
    legalForm: row.legal_form || 'other',
    logo: row.logo,
    icon: row.icon,
    terminologyProfile: row.terminology_profile || 'customers',
    terminologyColorSource: row.terminology_color_source || 'profile',
    receiptLabel: row.receipt_label || 'Belege',
    locale: row.locale,
    numberFormat: row.number_format || (row.locale === 'en-US' ? 'american' : 'european'),
    currency: row.currency || 'EUR',
    dateFormat: row.date_format || 'DD.MM.YYYY',
    timeFormat: row.time_format || '24h',
    timeZone: row.time_zone || 'Europe/Berlin',
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    themeMode: row.theme_mode || 'system',
    paymentInformationMode: row.payment_information_mode || 'separate',
    jobTrackingEnabled: row.job_tracking_enabled ?? false,
    reportingEnabled: row.reporting_enabled ?? false,
    quotesEnabled: row.quotes_enabled ?? false,
    discountsEnabled: row.discounts_enabled ?? true,
    defaultPaymentDays: row.default_payment_days ?? 30,
    immediatePaymentClause: row.immediate_payment_clause,
    invoiceStartNumber: row.invoice_start_number || 1,
    remindersEnabled: row.reminders_enabled ?? false,
    reminderDaysAfterDue: row.reminder_days_after_due ?? 7,
    reminderDaysBetween: row.reminder_days_between ?? 7,
    reminderFeeStage1: row.reminder_fee_stage_1 !== null ? parseFloat(row.reminder_fee_stage_1) : 0,
    reminderFeeStage2: row.reminder_fee_stage_2 !== null ? parseFloat(row.reminder_fee_stage_2) : 0,
    reminderFeeStage3: row.reminder_fee_stage_3 !== null ? parseFloat(row.reminder_fee_stage_3) : 0,
    reminderTextStage1: row.reminder_text_stage_1,
    reminderTextStage2: row.reminder_text_stage_2,
    reminderTextStage3: row.reminder_text_stage_3,
    paymentInformation: {
      accountHolder: row.payment_account_holder,
      bankAccount: row.payment_bank_account || row.bank_account,
      bic: row.payment_bic || row.bic,
      bankName: row.payment_bank_name,
      paymentTerms: row.payment_terms,
      paymentMethods: jsonArray(row.payment_methods)
    },
    companyHeaderTwoLine: row.company_header_two_line ?? false,
    companyHeaderLine1: row.company_header_line1,
    companyHeaderLine2: row.company_header_line2,
    showCombinedDropdowns: row.show_combined_dropdowns ?? false,
    isSmallBusiness: row.is_small_business ?? false,
    bankAccount: row.bank_account || row.payment_bank_account,
    bic: row.bic || row.payment_bic,
    invoiceTemplates: jsonArray(row.invoice_templates),
    documentTemplates: jsonArray(row.document_templates)
  };
}

// Get company information
router.get('/', async (req, res) => {
  try {
    const companyResult = await query("SELECT * FROM company WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid");
    
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Company information not found' });
    }

    const row = companyResult.rows[0];
    const company = mapCompanyRow(row);

    res.json(company);
  } catch (error) {
    logger.error('Error fetching company:', error);
    res.status(500).json({ error: 'Failed to fetch company information' });
  }
});

// Update company information
router.put('/', async (req, res) => {
  try {
    const updates = [];
    const values = [];
    let paramIndex = 1;

    // Build dynamic update query based on provided fields
    if (req.body.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(req.body.name);
    }
    if (req.body.address !== undefined) {
      updates.push(`address = $${paramIndex++}`);
      values.push(req.body.address);
    }
    if (req.body.city !== undefined) {
      updates.push(`city = $${paramIndex++}`);
      values.push(req.body.city);
    }
    if (req.body.postalCode !== undefined) {
      updates.push(`postal_code = $${paramIndex++}`);
      values.push(req.body.postalCode);
    }
    if (req.body.country !== undefined) {
      updates.push(`country = $${paramIndex++}`);
      values.push(req.body.country);
    }
    if (req.body.phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      values.push(req.body.phone);
    }
    if (req.body.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(req.body.email);
    }
    if (req.body.website !== undefined) {
      updates.push(`website = $${paramIndex++}`);
      values.push(req.body.website);
    }
    if (req.body.taxId !== undefined) {
      updates.push(`tax_id = $${paramIndex++}`);
      values.push(req.body.taxId);
    }
    if (req.body.taxIdentificationNumber !== undefined) {
      updates.push(`tax_identification_number = $${paramIndex++}`);
      values.push(req.body.taxIdentificationNumber);
    }
    if (req.body.taxBusinessType !== undefined) {
      if (!TAX_BUSINESS_TYPES.has(req.body.taxBusinessType)) {
        return res.status(400).json({ error: 'Ungültige Betriebsart.' });
      }
      updates.push(`tax_business_type = $${paramIndex++}`);
      values.push(req.body.taxBusinessType);
    }
    if (req.body.legalForm !== undefined) {
      if (!LEGAL_FORMS.has(req.body.legalForm)) {
        return res.status(400).json({ error: 'Ungültige Rechtsform.' });
      }
      updates.push(`legal_form = $${paramIndex++}`);
      values.push(req.body.legalForm);
    }
    const paymentInfo = req.body.paymentInformation;
    if (paymentInfo?.bankAccount !== undefined) {
      updates.push(`bank_account = $${paramIndex++}`);
      values.push(paymentInfo.bankAccount);
      updates.push(`payment_bank_account = $${paramIndex++}`);
      values.push(paymentInfo.bankAccount);
    } else if (req.body.bankAccount !== undefined) {
      updates.push(`bank_account = $${paramIndex++}`);
      values.push(req.body.bankAccount);
    }
    if (paymentInfo?.bic !== undefined) {
      updates.push(`bic = $${paramIndex++}`);
      values.push(paymentInfo.bic);
      updates.push(`payment_bic = $${paramIndex++}`);
      values.push(paymentInfo.bic);
    } else if (req.body.bic !== undefined) {
      updates.push(`bic = $${paramIndex++}`);
      values.push(req.body.bic);
    }
    if (req.body.logo !== undefined) {
      updates.push(`logo = $${paramIndex++}`);
      values.push(req.body.logo);
    }
    if (req.body.icon !== undefined) {
      updates.push(`icon = $${paramIndex++}`);
      values.push(req.body.icon);
    }
    if (req.body.locale !== undefined) {
      if (!LOCALES.has(req.body.locale)) {
        return res.status(400).json({
          error: 'locale must be one of de-DE, en-US, fr-FR or es-ES'
        });
      }
      updates.push(`locale = $${paramIndex++}`);
      values.push(req.body.locale);
    }
    if (req.body.numberFormat !== undefined) {
      if (!NUMBER_FORMATS.has(req.body.numberFormat)) {
        return res.status(400).json({
          error: 'numberFormat must be either european or american'
        });
      }
      updates.push(`number_format = $${paramIndex++}`);
      values.push(req.body.numberFormat);
    }
    if (req.body.currency !== undefined) {
      if (typeof req.body.currency !== 'string' || !CURRENCY_CODE_PATTERN.test(req.body.currency)) {
        return res.status(400).json({
          error: 'currency must be a three-letter uppercase ISO 4217 code'
        });
      }
      updates.push(`currency = $${paramIndex++}`);
      values.push(req.body.currency);
    }
    if (req.body.dateFormat !== undefined) {
      if (!DATE_FORMATS.has(req.body.dateFormat)) {
        return res.status(400).json({
          error: 'dateFormat must be one of DD.MM.YYYY, DD/MM/YYYY, MM/DD/YYYY or YYYY-MM-DD'
        });
      }
      updates.push(`date_format = $${paramIndex++}`);
      values.push(req.body.dateFormat);
    }
    if (req.body.timeFormat !== undefined) {
      if (!TIME_FORMATS.has(req.body.timeFormat)) {
        return res.status(400).json({ error: 'timeFormat must be either 24h or 12h' });
      }
      updates.push(`time_format = $${paramIndex++}`);
      values.push(req.body.timeFormat);
    }
    if (req.body.timeZone !== undefined) {
      if (!TIME_ZONES.has(req.body.timeZone)) {
        return res.status(400).json({ error: 'Ungültige Workspace-Zeitzone.' });
      }
      updates.push(`time_zone = $${paramIndex++}`);
      values.push(req.body.timeZone);
    }
    if (req.body.primaryColor !== undefined) {
      updates.push(`primary_color = $${paramIndex++}`);
      values.push(req.body.primaryColor);
    }
    if (req.body.secondaryColor !== undefined) {
      updates.push(`secondary_color = $${paramIndex++}`);
      values.push(req.body.secondaryColor);
    }
    if (req.body.themeMode !== undefined) {
      if (!THEME_MODES.has(req.body.themeMode)) {
        return res.status(400).json({ error: 'themeMode must be system, light or dark' });
      }
      updates.push(`theme_mode = $${paramIndex++}`);
      values.push(req.body.themeMode);
    }
    if (req.body.terminologyProfile !== undefined) {
      if (!TERMINOLOGY_PROFILES.has(req.body.terminologyProfile)) {
        return res.status(400).json({ error: 'terminologyProfile is not supported' });
      }
      updates.push(`terminology_profile = $${paramIndex++}`);
      values.push(req.body.terminologyProfile);
    }
    if (req.body.terminologyColorSource !== undefined) {
      if (!TERMINOLOGY_COLOR_SOURCES.has(req.body.terminologyColorSource)) {
        return res.status(400).json({ error: 'terminologyColorSource must be appearance or profile' });
      }
      updates.push(`terminology_color_source = $${paramIndex++}`);
      values.push(req.body.terminologyColorSource);
    }
    if (req.body.receiptLabel !== undefined) {
      if (typeof req.body.receiptLabel !== 'string' || !req.body.receiptLabel.trim() || req.body.receiptLabel.trim().length > 40) {
        return res.status(400).json({ error: 'Die Bezeichnung für Belege muss zwischen 1 und 40 Zeichen enthalten.' });
      }
      updates.push(`receipt_label = $${paramIndex++}`);
      values.push(req.body.receiptLabel.trim());
    }
    if (req.body.paymentInformationMode !== undefined) {
      if (!PAYMENT_INFORMATION_MODES.has(req.body.paymentInformationMode)) {
        return res.status(400).json({ error: 'paymentInformationMode must be separate or company' });
      }
      updates.push(`payment_information_mode = $${paramIndex++}`);
      values.push(req.body.paymentInformationMode);
    }
    if (req.body.jobTrackingEnabled !== undefined) {
      updates.push(`job_tracking_enabled = $${paramIndex++}`);
      values.push(req.body.jobTrackingEnabled);
    }
    if (req.body.reportingEnabled !== undefined) {
      updates.push(`reporting_enabled = $${paramIndex++}`);
      values.push(req.body.reportingEnabled);
    }
    if (req.body.quotesEnabled !== undefined) {
      updates.push(`quotes_enabled = $${paramIndex++}`);
      values.push(req.body.quotesEnabled);
    }
    if (req.body.discountsEnabled !== undefined) {
      updates.push(`discounts_enabled = $${paramIndex++}`);
      values.push(req.body.discountsEnabled);
    }
    if (req.body.defaultPaymentDays !== undefined) {
      updates.push(`default_payment_days = $${paramIndex++}`);
      values.push(req.body.defaultPaymentDays);
    }
    if (req.body.immediatePaymentClause !== undefined) {
      updates.push(`immediate_payment_clause = $${paramIndex++}`);
      values.push(req.body.immediatePaymentClause);
    }
    if (req.body.invoiceStartNumber !== undefined) {
      updates.push(`invoice_start_number = $${paramIndex++}`);
      values.push(req.body.invoiceStartNumber);
    }
    if (req.body.invoiceTemplates !== undefined) {
      if (!Array.isArray(req.body.invoiceTemplates)) {
        return res.status(400).json({ error: 'invoiceTemplates must be an array' });
      }
      updates.push(`invoice_templates = $${paramIndex++}`);
      values.push(JSON.stringify(req.body.invoiceTemplates));
    }
    if (req.body.documentTemplates !== undefined) {
      if (!Array.isArray(req.body.documentTemplates)) {
        return res.status(400).json({ error: 'documentTemplates must be an array' });
      }
      updates.push(`document_templates = $${paramIndex++}`);
      values.push(JSON.stringify(req.body.documentTemplates));
    }
    
    // Handle payment information fields
    if (paymentInfo) {
      if (paymentInfo.accountHolder !== undefined) {
        updates.push(`payment_account_holder = $${paramIndex++}`);
        values.push(paymentInfo.accountHolder);
      }
      if (paymentInfo.bankName !== undefined) {
        updates.push(`payment_bank_name = $${paramIndex++}`);
        values.push(paymentInfo.bankName);
      }
      if (paymentInfo.paymentTerms !== undefined) {
        updates.push(`payment_terms = $${paramIndex++}`);
        values.push(paymentInfo.paymentTerms);
      }
      if (paymentInfo.paymentMethods !== undefined) {
        updates.push(`payment_methods = $${paramIndex++}`);
        values.push(JSON.stringify(paymentInfo.paymentMethods));
      }
    }

    // Handle company header layout fields
    if (req.body.companyHeaderTwoLine !== undefined) {
      updates.push(`company_header_two_line = $${paramIndex++}`);
      values.push(req.body.companyHeaderTwoLine);
    }
    if (req.body.companyHeaderLine1 !== undefined) {
      updates.push(`company_header_line1 = $${paramIndex++}`);
      values.push(req.body.companyHeaderLine1);
    }
    if (req.body.companyHeaderLine2 !== undefined) {
      updates.push(`company_header_line2 = $${paramIndex++}`);
      values.push(req.body.companyHeaderLine2);
    }
    if (req.body.showCombinedDropdowns !== undefined) {
      updates.push(`show_combined_dropdowns = $${paramIndex++}`);
      values.push(req.body.showCombinedDropdowns);
    }
    if (req.body.isSmallBusiness !== undefined) {
      updates.push(`is_small_business = $${paramIndex++}`);
      values.push(req.body.isSmallBusiness);
    }
    
    // Handle reminder settings
    if (req.body.remindersEnabled !== undefined) {
      updates.push(`reminders_enabled = $${paramIndex++}`);
      values.push(req.body.remindersEnabled);
    }
    if (req.body.reminderDaysAfterDue !== undefined) {
      updates.push(`reminder_days_after_due = $${paramIndex++}`);
      values.push(req.body.reminderDaysAfterDue);
    }
    if (req.body.reminderDaysBetween !== undefined) {
      updates.push(`reminder_days_between = $${paramIndex++}`);
      values.push(req.body.reminderDaysBetween);
    }
    if (req.body.reminderFeeStage1 !== undefined) {
      updates.push(`reminder_fee_stage_1 = $${paramIndex++}`);
      values.push(req.body.reminderFeeStage1);
    }
    if (req.body.reminderFeeStage2 !== undefined) {
      updates.push(`reminder_fee_stage_2 = $${paramIndex++}`);
      values.push(req.body.reminderFeeStage2);
    }
    if (req.body.reminderFeeStage3 !== undefined) {
      updates.push(`reminder_fee_stage_3 = $${paramIndex++}`);
      values.push(req.body.reminderFeeStage3);
    }
    if (req.body.reminderTextStage1 !== undefined) {
      updates.push(`reminder_text_stage_1 = $${paramIndex++}`);
      values.push(req.body.reminderTextStage1);
    }
    if (req.body.reminderTextStage2 !== undefined) {
      updates.push(`reminder_text_stage_2 = $${paramIndex++}`);
      values.push(req.body.reminderTextStage2);
    }
    if (req.body.reminderTextStage3 !== undefined) {
      updates.push(`reminder_text_stage_3 = $${paramIndex++}`);
      values.push(req.body.reminderTextStage3);
    }

    let result = null;
    
    // Only run UPDATE if there are fields to update
    if (updates.length > 0) {
      const updateQuery = `
        UPDATE company SET
          ${updates.join(', ')}
        WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
        RETURNING *
      `;
      result = await query(updateQuery, values);
    } else {
      // If no fields to update, just fetch the current data
      result = await query("SELECT * FROM company WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid");
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company information not found' });
    }

    const row = result.rows[0];
    const company = mapCompanyRow(row);

    res.json(company);
  } catch (error) {
    logger.error('Error updating company:', error);
    res.status(500).json({ error: 'Failed to update company information' });
  }
});

export default router;
