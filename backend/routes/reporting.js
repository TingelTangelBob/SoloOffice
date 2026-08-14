import express from 'express';
import { query } from '../database.js';
import logger from '../utils/logger.js';
import PDFDocument from 'pdfkit';

const router = express.Router();

function formatReportDate(value, company) {
  const date = new Date(value);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  switch (company.date_format) {
    case 'DD/MM/YYYY': return `${day}/${month}/${year}`;
    case 'MM/DD/YYYY': return `${month}/${day}/${year}`;
    case 'YYYY-MM-DD': return `${year}-${month}-${day}`;
    case 'DD.MM.YYYY': return `${day}.${month}.${year}`;
    default: return date.toLocaleDateString(company.locale || 'de-DE');
  }
}

function formatReportAmount(amount, company) {
  const locale = company.number_format === 'american' ? 'en-US' : company.locale || 'de-DE';
  return Number(amount).toLocaleString(locale, {
    style: 'currency',
    currency: company.currency || 'EUR'
  });
}

// Get invoice journal data for reporting
router.get('/invoice-journal', async (req, res) => {
  try {
    const { startDate, endDate, customerId } = req.query;

    let whereClause = "COALESCE(i.document_type, 'invoice') = 'invoice'";
    let params = [];
    let paramIndex = 1;

    // Add date filters
    if (startDate) {
      whereClause += ` AND i.issue_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    if (endDate) {
      whereClause += ` AND i.issue_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    // Add customer filter
    if (customerId) {
      whereClause += ` AND i.customer_id = $${paramIndex}`;
      params.push(customerId);
      paramIndex++;
    }

    const result = await query(`
      SELECT 
        i.id,
        i.invoice_number,
        i.customer_name,
        i.issue_date,
        i.due_date,
        i.subtotal,
        i.global_discount_amount,
        i.tax_amount,
        i.total,
        i.status,
        i.created_at,
        c.customer_number,
        -- Teilzahlungen werden als EÜR-Buchung mit source_type
        -- 'invoice_payment' erfasst. Ohne sie zählt eine Rechnung mit
        -- Anzahlung als vollständig offen, obwohl das Geld eingegangen ist.
        LEAST(
          i.total,
          GREATEST(
            COALESCE((
              SELECT SUM(e.amount)
              FROM euer_entries e
              WHERE e.source_type = 'invoice_payment'
                AND e.source_id = i.id
                AND COALESCE(e.status, 'active') <> 'voided'
            ), 0),
            CASE WHEN i.status = 'paid' THEN i.total ELSE 0 END
          )
        ) as paid_amount,
        CASE
          WHEN i.status = 'overdue' THEN GREATEST(i.total - COALESCE((
            SELECT SUM(e.amount)
            FROM euer_entries e
            WHERE e.source_type = 'invoice_payment'
              AND e.source_id = i.id
              AND COALESCE(e.status, 'active') <> 'voided'
          ), 0), 0)
          ELSE 0
        END as overdue_amount,
        CASE
          WHEN i.status = 'paid' THEN 0
          ELSE GREATEST(i.total - COALESCE((
            SELECT SUM(e.amount)
            FROM euer_entries e
            WHERE e.source_type = 'invoice_payment'
              AND e.source_id = i.id
              AND COALESCE(e.status, 'active') <> 'voided'
          ), 0), 0)
        END as outstanding_amount,
        (
          SELECT COALESCE(SUM(COALESCE(discount_amount, 0)), 0)
          FROM invoice_items
          WHERE invoice_id = i.id
        ) as item_discounts_total
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      WHERE ${whereClause}
      ORDER BY i.issue_date DESC, i.invoice_number DESC
    `, params);

    const invoices = result.rows;

    // Calculate summary statistics
    const summary = {
      totalInvoices: invoices.length,
      totalAmount: invoices.reduce((sum, inv) => sum + parseFloat(inv.total), 0),
      paidAmount: invoices.reduce((sum, inv) => sum + parseFloat(inv.paid_amount), 0),
      overdueAmount: invoices.reduce((sum, inv) => sum + parseFloat(inv.overdue_amount), 0),
      outstandingAmount: invoices.reduce((sum, inv) => sum + parseFloat(inv.outstanding_amount), 0),
      // Nettosumme mit Rabatten: Subtotal - Item-Rabatte - Global-Rabatt
      subtotalSum: invoices.reduce((sum, inv) => {
        const subtotal = parseFloat(inv.subtotal);
        const itemDiscounts = parseFloat(inv.item_discounts_total || 0);
        const globalDiscount = parseFloat(inv.global_discount_amount || 0);
        return sum + (subtotal - itemDiscounts - globalDiscount);
      }, 0),
      taxSum: invoices.reduce((sum, inv) => sum + parseFloat(inv.tax_amount), 0)
    };

    res.json({
      invoices: invoices.map(inv => {
        const subtotal = parseFloat(inv.subtotal);
        const itemDiscounts = parseFloat(inv.item_discounts_total || 0);
        const globalDiscount = parseFloat(inv.global_discount_amount || 0);
        // Nettosumme nach Rabatten
        const discountedSubtotal = subtotal - itemDiscounts - globalDiscount;
        
        return {
          id: inv.id,
          invoiceNumber: inv.invoice_number,
          customerName: inv.customer_name,
          customerNumber: inv.customer_number,
          issueDate: inv.issue_date,
          dueDate: inv.due_date,
          subtotal: discountedSubtotal, // Netto nach Rabatten
          taxAmount: parseFloat(inv.tax_amount),
          total: parseFloat(inv.total),
          status: inv.status,
          paidAmount: parseFloat(inv.paid_amount),
          overdueAmount: parseFloat(inv.overdue_amount),
          outstandingAmount: parseFloat(inv.outstanding_amount),
          createdAt: inv.created_at
        };
      }),
      summary,
      dateRange: {
        startDate: startDate || null,
        endDate: endDate || null
      }
    });
  } catch (error) {
    logger.error('Error fetching invoice journal:', error);
    res.status(500).json({ error: 'Failed to fetch invoice journal' });
  }
});

// Generate invoice journal PDF
router.post('/invoice-journal/pdf', async (req, res) => {
  try {
    const { startDate, endDate, customerId, title = 'Rechnungsjournal' } = req.body;

    // Get company data
    const companyResult = await query('SELECT * FROM company LIMIT 1');
    const company = companyResult.rows[0] || {};

    // Get invoice journal data (reuse the logic from GET endpoint)
    let whereClause = "COALESCE(i.document_type, 'invoice') = 'invoice'";
    let params = [];
    let paramIndex = 1;

    if (startDate) {
      whereClause += ` AND i.issue_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    if (endDate) {
      whereClause += ` AND i.issue_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }
    if (customerId) {
      whereClause += ` AND i.customer_id = $${paramIndex}`;
      params.push(customerId);
      paramIndex++;
    }

    const result = await query(`
      SELECT 
        i.id,
        i.invoice_number,
        i.customer_name,
        i.issue_date,
        i.due_date,
        i.subtotal,
        i.global_discount_amount,
        i.tax_amount,
        i.total,
        i.status,
        i.created_at,
        c.customer_number,
        -- Teilzahlungen werden als EÜR-Buchung mit source_type
        -- 'invoice_payment' erfasst. Ohne sie zählt eine Rechnung mit
        -- Anzahlung als vollständig offen, obwohl das Geld eingegangen ist.
        LEAST(
          i.total,
          GREATEST(
            COALESCE((
              SELECT SUM(e.amount)
              FROM euer_entries e
              WHERE e.source_type = 'invoice_payment'
                AND e.source_id = i.id
                AND COALESCE(e.status, 'active') <> 'voided'
            ), 0),
            CASE WHEN i.status = 'paid' THEN i.total ELSE 0 END
          )
        ) as paid_amount,
        CASE
          WHEN i.status = 'overdue' THEN GREATEST(i.total - COALESCE((
            SELECT SUM(e.amount)
            FROM euer_entries e
            WHERE e.source_type = 'invoice_payment'
              AND e.source_id = i.id
              AND COALESCE(e.status, 'active') <> 'voided'
          ), 0), 0)
          ELSE 0
        END as overdue_amount,
        CASE
          WHEN i.status = 'paid' THEN 0
          ELSE GREATEST(i.total - COALESCE((
            SELECT SUM(e.amount)
            FROM euer_entries e
            WHERE e.source_type = 'invoice_payment'
              AND e.source_id = i.id
              AND COALESCE(e.status, 'active') <> 'voided'
          ), 0), 0)
        END as outstanding_amount,
        (
          SELECT COALESCE(SUM(COALESCE(discount_amount, 0)), 0)
          FROM invoice_items
          WHERE invoice_id = i.id
        ) as item_discounts_total
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      WHERE ${whereClause}
      ORDER BY i.issue_date DESC, i.invoice_number DESC
    `, params);

    const invoices = result.rows;

    // Calculate summary
    const summary = {
      totalInvoices: invoices.length,
      totalAmount: invoices.reduce((sum, inv) => sum + parseFloat(inv.total), 0),
      paidAmount: invoices.reduce((sum, inv) => sum + parseFloat(inv.paid_amount), 0),
      overdueAmount: invoices.reduce((sum, inv) => sum + parseFloat(inv.overdue_amount), 0),
      outstandingAmount: invoices.reduce((sum, inv) => sum + parseFloat(inv.outstanding_amount), 0),
      // Nettosumme mit Rabatten: Subtotal - Item-Rabatte - Global-Rabatt
      subtotalSum: invoices.reduce((sum, inv) => {
        const subtotal = parseFloat(inv.subtotal);
        const itemDiscounts = parseFloat(inv.item_discounts_total || 0);
        const globalDiscount = parseFloat(inv.global_discount_amount || 0);
        return sum + (subtotal - itemDiscounts - globalDiscount);
      }, 0),
      taxSum: invoices.reduce((sum, inv) => sum + parseFloat(inv.tax_amount), 0)
    };

    // Create PDF
    const doc = new PDFDocument({ 
      margin: 50,
      size: 'A4',
      layout: 'landscape' // Use landscape for better table display
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="rechnungsjournal_${new Date().toISOString().split('T')[0]}.pdf"`);

    // Pipe PDF to response
    doc.pipe(res);

    // Company header
    const primaryColor = '#2563eb';
    const formatAmount = (amount) => formatReportAmount(amount, company);
    
    // Title and company info positioning
    const titleY = 70;
    const titleFontSize = 20;
    
    // Add company logo if available with original aspect ratio, vertically centered to title
    if (company.logo) {
      try {
        const logoBuffer = Buffer.from(company.logo.replace(/^data:image\/[a-z]+;base64,/, ''), 'base64');
        
        // Position logo vertically centered to the title text
        // Approximate vertical center: titleY - (titleFontSize / 3)
        const logoY = titleY + 20;
        
        // Only specify width - PDFKit will automatically maintain aspect ratio
        doc.image(logoBuffer, 50, logoY, { width: 80 });
      } catch (error) {
        logger.warn('Error adding logo to PDF:', error);
      }
    }

    // Title and company info
    doc.fontSize(titleFontSize)
       .fillColor(primaryColor)
       .text(title, 150, titleY)
       .fontSize(12)
       .fillColor('black')
       .text(company.name || 'Firma', 150, 95);

    if (company.address) {
      doc.text(company.address, 150, 110);
    }

    // Date range info
    const today = formatReportDate(new Date(), company);
    doc.fontSize(10)
       .text(`Erstellt am: ${today}`, 600, 70);

    if (startDate || endDate) {
      const dateRangeText = `Zeitraum: ${startDate || 'Anfang'} bis ${endDate || 'Ende'}`;
      doc.text(dateRangeText, 600, 85);
    }

    // Summary section
    let yPosition = 150;
    doc.fontSize(14)
       .fillColor(primaryColor)
       .text('Zusammenfassung', 50, yPosition);

    yPosition += 25;
    doc.fontSize(10)
       .fillColor('black')
       .text(`Anzahl Rechnungen: ${summary.totalInvoices}`, 50, yPosition)
       .text(`Nettosumme: ${formatAmount(summary.subtotalSum)}`, 200, yPosition)
       .text(`MwSt.: ${formatAmount(summary.taxSum)}`, 350, yPosition)
       .text(`Bruttosumme: ${formatAmount(summary.totalAmount)}`, 500, yPosition);

    // Table header
    yPosition += 40;
    
    // Draw table header background
    doc.rect(50, yPosition - 5, 500, 20).fillAndStroke(primaryColor, primaryColor);
    
    doc.fontSize(9)
       .fillColor('white')
       .text('Rech.-Nr.', 55, yPosition)
       .text('Datum', 130, yPosition)
       .text('Empfänger', 200, yPosition)
       .text('Netto', 320, yPosition)
       .text('MwSt.', 380, yPosition)
       .text('Brutto', 440, yPosition)
       .text('Status', 500, yPosition);

    yPosition += 25;

    // Table content
    doc.fillColor('black');
    
    invoices.forEach((invoice, index) => {
      // Check if we need a new page
      if (yPosition > 520) {
        doc.addPage();
        yPosition = 50;
        
        // Repeat header on new page
        doc.rect(50, yPosition - 5, 500, 20).fillAndStroke(primaryColor, primaryColor);
        doc.fontSize(9)
           .fillColor('white')
           .text('Rech.-Nr.', 55, yPosition)
           .text('Datum', 130, yPosition)
           .text('Empfänger', 200, yPosition)
           .text('Netto', 320, yPosition)
           .text('MwSt.', 380, yPosition)
           .text('Brutto', 440, yPosition)
           .text('Status', 500, yPosition);
        
        yPosition += 25;
        doc.fillColor('black');
      }

      // Alternate row background
      if (index % 2 === 0) {
        doc.rect(50, yPosition - 3, 500, 15).fill('#f8f9fa');
      }

      const issueDate = formatReportDate(invoice.issue_date, company);
      
      // Status translation
      const statusMap = {
        'draft': 'Entwurf',
        'sent': 'Gesendet',
        'paid': 'Bezahlt',
        'overdue': 'Überfällig'
      };

      // Berechne Nettosumme nach Rabatten
      const subtotal = parseFloat(invoice.subtotal);
      const itemDiscounts = parseFloat(invoice.item_discounts_total || 0);
      const globalDiscount = parseFloat(invoice.global_discount_amount || 0);
      const discountedSubtotal = subtotal - itemDiscounts - globalDiscount;

      doc.fontSize(8)
         .fillColor('black')
         .text(invoice.invoice_number, 55, yPosition)
         .text(issueDate, 130, yPosition)
         .text(invoice.customer_name?.substring(0, 25) || '', 200, yPosition)
         .text(formatAmount(discountedSubtotal), 320, yPosition)
         .text(formatAmount(invoice.tax_amount), 380, yPosition)
         .text(formatAmount(invoice.total), 440, yPosition)
         .text(statusMap[invoice.status] || invoice.status, 500, yPosition);

      yPosition += 15;
    });

    // Final totals row
    yPosition += 10;
    doc.rect(50, yPosition - 5, 500, 20).fillAndStroke('#e5e7eb', '#e5e7eb');
    doc.fontSize(9)
       .fillColor('black')
       .font('Helvetica-Bold')
       .text('SUMME:', 55, yPosition)
       .text(formatAmount(summary.subtotalSum), 320, yPosition)
       .text(formatAmount(summary.taxSum), 380, yPosition)
       .text(formatAmount(summary.totalAmount), 440, yPosition);

    // Finalize PDF
    doc.end();
    
  } catch (error) {
    logger.error('Error generating invoice journal PDF:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Get reporting statistics
router.get('/statistics', async (req, res) => {
  try {
    const { year = new Date().getFullYear() } = req.query;

    // Monthly revenue statistics
    const monthlyRevenueResult = await query(`
      SELECT 
        EXTRACT(MONTH FROM i.issue_date) as month,
        COUNT(*) as invoice_count,
        SUM(
          i.subtotal - 
          COALESCE((
            SELECT SUM(COALESCE(discount_amount, 0))
            FROM invoice_items
            WHERE invoice_id = i.id
          ), 0) - 
          COALESCE(i.global_discount_amount, 0)
        ) as subtotal_sum,
        SUM(i.tax_amount) as tax_sum,
        SUM(i.total) as total_sum,
        SUM(LEAST(i.total, GREATEST(COALESCE((
          SELECT SUM(e.amount)
          FROM euer_entries e
          WHERE e.source_type = 'invoice_payment'
            AND e.source_id = i.id
            AND COALESCE(e.status, 'active') <> 'voided'
        ), 0), CASE WHEN i.status = 'paid' THEN i.total ELSE 0 END))) as paid_sum,
        SUM(CASE WHEN i.status = 'overdue' THEN GREATEST(i.total - COALESCE((
          SELECT SUM(e.amount)
          FROM euer_entries e
          WHERE e.source_type = 'invoice_payment'
            AND e.source_id = i.id
            AND COALESCE(e.status, 'active') <> 'voided'
        ), 0), 0) ELSE 0 END) as overdue_sum
      FROM invoices i
      WHERE COALESCE(i.document_type, 'invoice') = 'invoice'
        AND EXTRACT(YEAR FROM i.issue_date) = $1
      GROUP BY EXTRACT(MONTH FROM i.issue_date)
      ORDER BY month
    `, [year]);

    // Customer statistics
    const customerStatsResult = await query(`
      SELECT 
        i.customer_id,
        i.customer_name,
        COUNT(*) as invoice_count,
        SUM(i.total) as total_revenue,
        AVG(i.total) as avg_invoice_amount
      FROM invoices i
      WHERE COALESCE(i.document_type, 'invoice') = 'invoice'
        AND EXTRACT(YEAR FROM i.issue_date) = $1
      GROUP BY i.customer_id, i.customer_name
      ORDER BY total_revenue DESC
      LIMIT 10
    `, [year]);

    // Status distribution
    const statusDistributionResult = await query(`
      SELECT 
        status,
        COUNT(*) as count,
        SUM(total) as total_amount
      FROM invoices
      WHERE COALESCE(document_type, 'invoice') = 'invoice'
        AND EXTRACT(YEAR FROM issue_date) = $1
      GROUP BY status
    `, [year]);

    // Year overview
    const yearOverviewResult = await query(`
      SELECT 
        COUNT(*) as total_invoices,
        SUM(
          i.subtotal - 
          COALESCE((
            SELECT SUM(COALESCE(discount_amount, 0))
            FROM invoice_items
            WHERE invoice_id = i.id
          ), 0) - 
          COALESCE(i.global_discount_amount, 0)
        ) as total_subtotal,
        SUM(i.tax_amount) as total_tax,
        SUM(i.total) as total_amount,
        SUM(LEAST(i.total, GREATEST(COALESCE((
          SELECT SUM(e.amount)
          FROM euer_entries e
          WHERE e.source_type = 'invoice_payment'
            AND e.source_id = i.id
            AND COALESCE(e.status, 'active') <> 'voided'
        ), 0), CASE WHEN i.status = 'paid' THEN i.total ELSE 0 END))) as paid_amount,
        SUM(CASE WHEN i.status = 'overdue' THEN GREATEST(i.total - COALESCE((
          SELECT SUM(e.amount)
          FROM euer_entries e
          WHERE e.source_type = 'invoice_payment'
            AND e.source_id = i.id
            AND COALESCE(e.status, 'active') <> 'voided'
        ), 0), 0) ELSE 0 END) as overdue_amount,
        AVG(i.total) as avg_invoice_amount
      FROM invoices i
      WHERE COALESCE(i.document_type, 'invoice') = 'invoice'
        AND EXTRACT(YEAR FROM i.issue_date) = $1
    `, [year]);

    res.json({
      year: parseInt(year),
      monthlyRevenue: monthlyRevenueResult.rows.map(row => ({
        month: parseInt(row.month),
        invoiceCount: parseInt(row.invoice_count),
        subtotalSum: parseFloat(row.subtotal_sum || 0),
        taxSum: parseFloat(row.tax_sum || 0),
        totalSum: parseFloat(row.total_sum || 0),
        paidSum: parseFloat(row.paid_sum || 0),
        overdueSum: parseFloat(row.overdue_sum || 0)
      })),
      topCustomers: customerStatsResult.rows.map(row => ({
        customerId: row.customer_id,
        customerName: row.customer_name,
        invoiceCount: parseInt(row.invoice_count),
        totalRevenue: parseFloat(row.total_revenue),
        avgInvoiceAmount: parseFloat(row.avg_invoice_amount)
      })),
      statusDistribution: statusDistributionResult.rows.map(row => ({
        status: row.status,
        count: parseInt(row.count),
        totalAmount: parseFloat(row.total_amount)
      })),
      yearOverview: yearOverviewResult.rows[0] ? {
        totalInvoices: parseInt(yearOverviewResult.rows[0].total_invoices),
        totalSubtotal: parseFloat(yearOverviewResult.rows[0].total_subtotal || 0),
        totalTax: parseFloat(yearOverviewResult.rows[0].total_tax || 0),
        totalAmount: parseFloat(yearOverviewResult.rows[0].total_amount || 0),
        paidAmount: parseFloat(yearOverviewResult.rows[0].paid_amount || 0),
        overdueAmount: parseFloat(yearOverviewResult.rows[0].overdue_amount || 0),
        avgInvoiceAmount: parseFloat(yearOverviewResult.rows[0].avg_invoice_amount || 0)
      } : null
    });
  } catch (error) {
    logger.error('Error fetching reporting statistics:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

export default router;
