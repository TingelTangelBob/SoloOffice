import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createTables, pool, checkHealth } from './database.js';
import logger from './utils/logger.js';
import customersRouter from './routes/customers.js';
import invoicesRouter from './routes/invoices.js';
import quotesRouter from './routes/quotes.js';
import companyRouter from './routes/company.js';
import emailRouter from './routes/email.js';
import emailManagementRouter from './routes/emailManagement.js';
import jobsRouter from './routes/jobs.js';
import materialTemplatesRouter from './routes/materialTemplates.js';
import hourlyRatesRouter from './routes/hourlyRates.js';
import yearlyInvoiceStartNumbersRouter from './routes/yearlyInvoiceStartNumbers.js';
import backupRouter from './routes/backup.js';
import reportingRouter from './routes/reporting.js';
import remindersRouter from './routes/reminders.js';
import calendarEventsRouter from './routes/calendarEvents.js';
import recurringInvoicesRouter from './routes/recurringInvoices.js';
import creditNotesRouter from './routes/creditNotes.js';
import euerEntriesRouter from './routes/euerEntries.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' })); // Increase limit for PDF attachments
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Health check endpoint
app.get('/health', async (req, res) => {
  const dbHealth = await checkHealth();
  
  if (dbHealth.healthy) {
    res.json({ 
      status: 'OK', 
      message: 'Server is running',
      database: {
        status: 'connected',
        poolStats: dbHealth.poolStats,
      },
    });
  } else {
    res.status(503).json({ 
      status: 'DEGRADED', 
      message: 'Server is running but database connection failed',
      database: {
        status: 'disconnected',
        error: dbHealth.error,
        poolStats: dbHealth.poolStats,
      },
    });
  }
});

// API routes
app.use('/api/customers', customersRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/recurring-invoices', recurringInvoicesRouter);
app.use('/api/credit-notes', creditNotesRouter);
app.use('/api/euer-entries', euerEntriesRouter);
app.use('/api/quotes', quotesRouter);
app.use('/api/company', companyRouter);
app.use('/api/email', emailRouter);
app.use('/api/email-management', emailManagementRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/material-templates', materialTemplatesRouter);
app.use('/api/hourly-rates', hourlyRatesRouter);
app.use('/api/yearly-invoice-start-numbers', yearlyInvoiceStartNumbersRouter);
app.use('/api/backup', backupRouter);
app.use('/api/reporting', reportingRouter);
app.use('/api/reminders', remindersRouter);
app.use('/api/calendar-events', calendarEventsRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled server error', { error: err.message, stack: err.stack, url: req.url, method: req.method });
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize database and start server
async function startServer() {
  try {
    logger.info('Connecting to database...');
    await createTables();
    logger.info('Database initialized successfully');
    
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Server started`, { port: PORT, environment: process.env.NODE_ENV || 'development' });
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down server...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down server (SIGTERM)...');
  await pool.end();
  process.exit(0);
});

startServer();
