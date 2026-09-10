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
export function mapCompanyRow(row) {
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
    invoiceNumberPattern: row.invoice_number_pattern || 'RE-{YYYY}-{NNN}',
    creditNoteNumberPattern: row.credit_note_number_pattern || 'GS-{YYYY}-{NNN}',
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
