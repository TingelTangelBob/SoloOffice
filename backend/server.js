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
import receiptsRouter from './routes/receipts.js';
import fixedAssetsRouter from './routes/fixedAssets.js';
import importsRouter from './routes/imports.js';
import authRouter from './routes/auth.js';
import workspacesRouter from './routes/workspaces.js';
import { requireAuth, authorizeLegacyRequest, csrfProtection } from './middleware/auth.js';
import { persistentRateLimit, pruneRateLimitBuckets } from './middleware/rateLimit.js';
import { requestTracing } from './middleware/requestTracing.js';
import { metricsMiddleware, getMetricsSnapshot, metricsAccessStatus } from './utils/metrics.js';
import { pruneSessions } from './services/sessionMaintenance.js';
import eInvoicesRouter from './routes/eInvoices.js';
import { livenessPayload, readinessResult } from './utils/health.js';
import { createGracefulShutdown } from './utils/gracefulShutdown.js';
import { createCorsOriginValidator } from './utils/corsOrigin.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const trustProxy = process.env.TRUST_PROXY === 'false'
  ? false
  : Number.isFinite(Number(process.env.TRUST_PROXY || 1))
    ? Number(process.env.TRUST_PROXY || 1)
    : 1;
app.set('trust proxy', trustProxy);
app.use(requestTracing);
app.use(metricsMiddleware);

// API security headers are set here as a defence in depth for deployments
// that do not put another reverse proxy in front of the backend.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.ENABLE_HSTS === 'true') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Middleware
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:8080,http://localhost:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
app.use(cors({
  origin: createCorsOriginValidator(allowedOrigins),
  credentials: true,
  exposedHeaders: ['X-Request-ID'],
}));
async function sendReadiness(req, res, legacy = false) {
  const dbHealth = await checkHealth();
  const result = readinessResult(dbHealth, { legacy });
  return res.status(result.statusCode).json(result.payload);
}

// Liveness beantwortet nur, ob der Node-Prozess reagiert. Readiness prüft die
// Datenbank, veröffentlicht aber weder Verbindungsfehler noch Pool-Interna.
app.get('/health/live', (req, res) => res.json(livenessPayload()));
app.get('/health/ready', (req, res) => sendReadiness(req, res));
app.get('/health', (req, res) => sendReadiness(req, res, true));

// API routes
// Authentication endpoints that must be reachable without an existing session.
app.use('/api', csrfProtection);
app.use('/api', persistentRateLimit({
  name: 'api-ip',
  windowMs: 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX || 300),
  keyGenerator: req => req.ip,
}));
app.use('/api/auth', express.json({ limit: '1mb' }), express.urlencoded({ limit: '1mb', extended: true }), authRouter);

// Parsers are deliberately scoped. Receipt/PDF and backup payloads need more
// room; ordinary API requests must stay small.
app.use('/api/receipts', express.json({ limit: '35mb' }));
app.use('/api/e-invoices', express.json({ limit: '15mb' }));
app.use('/api/email', express.json({ limit: '100mb' }));
app.use('/api/backup', express.json({ limit: '50mb' }));
app.use('/api', express.json({ limit: '2mb' }));
app.use('/api', express.urlencoded({ limit: '2mb', extended: true }));

// All business routes share one authentication and authorization seam. The
// database adapter applies the request's workspace context underneath it.
app.use('/api', requireAuth);
app.use('/api', authorizeLegacyRequest);

app.use('/api/workspaces', workspacesRouter);
app.use('/api/customers', customersRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/recurring-invoices', recurringInvoicesRouter);
app.use('/api/credit-notes', creditNotesRouter);
app.use('/api/euer-entries', euerEntriesRouter);
app.use('/api/receipts', receiptsRouter);
app.use('/api/e-invoices', eInvoicesRouter);
app.use('/api/fixed-assets', fixedAssetsRouter);
app.use('/api/imports', importsRouter);
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

app.get('/metrics', (req, res) => {
  const accessStatus = metricsAccessStatus(process.env.METRICS_TOKEN, req.get('authorization'));
  if (accessStatus === 'unconfigured') {
    return res.status(503).json({ error: 'Metriken sind nicht konfiguriert', code: 'METRICS_NOT_CONFIGURED' });
  }
  if (accessStatus === 'unauthorized') {
    return res.status(401).json({ error: 'Metriken nicht autorisiert', code: 'METRICS_UNAUTHORIZED' });
  }
  return res.json(getMetricsSnapshot());
});

// Make unknown API paths explicit instead of falling through to a proxy or
// returning an HTML error page.
app.use((req, res) => {
  res.status(404).json({ error: 'Endpunkt nicht gefunden', requestId: req.requestId });
});

// Error handling middleware
app.use((err, req, res, next) => {
  const parserStatus = Number.isInteger(err.status) ? err.status : err.statusCode;
  const statusCode = Number.isInteger(parserStatus) && parserStatus >= 400 && parserStatus < 500
    ? parserStatus
    : 500;
  const logMeta = { error: err.message, url: req.url, method: req.method, statusCode };
  if (statusCode >= 500) {
    logger.error('Unhandled server error', { ...logMeta, stack: err.stack });
  } else {
    logger.warn('Server request rejected', { ...logMeta, code: err.code || err.type });
  }
  const isOversizedBackupPayload = statusCode === 413 && req.path.startsWith('/api/backup');
  if (isOversizedBackupPayload) {
    return res.status(413).json({
      error: 'Das Backup ist zu groß. Erlaubt sind maximal 50 MB.',
      code: 'BACKUP_PAYLOAD_TOO_LARGE',
      requestId: req.requestId,
    });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Der Anfrageinhalt enthält kein gültiges JSON.',
      code: 'REQUEST_JSON_INVALID',
      requestId: req.requestId,
    });
  }
  if (statusCode === 413) {
    return res.status(413).json({
      error: 'Der Anfrageinhalt ist zu groß.',
      code: 'REQUEST_PAYLOAD_TOO_LARGE',
      requestId: req.requestId,
    });
  }
  return res.status(statusCode).json({
    error: statusCode === 500 ? 'Interner Serverfehler' : err.message,
    ...(err.code ? { code: err.code } : {}),
    requestId: req.requestId,
  });
});

// Initialize database and start server
async function startServer() {
  try {
    logger.info('Connecting to database...');
    await createTables();
    logger.info('Database initialized successfully');
    await pruneSessions();
    const maintenanceInterval = setInterval(() => {
      pruneRateLimitBuckets().catch(error => logger.warn('Rate-Limit-Bereinigung fehlgeschlagen', { error: error.message }));
      pruneSessions().catch(error => logger.warn('Session-Bereinigung fehlgeschlagen', { error: error.message }));
    }, 60 * 60 * 1000);
    app.locals.maintenanceInterval = maintenanceInterval;
    
    const httpServer = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Server started`, { port: PORT, environment: process.env.NODE_ENV || 'development' });
    });
    const shutdown = createGracefulShutdown({
      httpServer,
      closeDatabase: () => pool.end(),
      clearMaintenance: () => {
        if (app.locals.maintenanceInterval) clearInterval(app.locals.maintenanceInterval);
      },
      logger,
      timeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS || 10_000),
    });
    app.locals.httpServer = httpServer;
    app.locals.shutdown = shutdown;

    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => {
        shutdown(signal).catch(error => {
          process.exitCode = 1;
          logger.error('Server shutdown failed', { signal, error: error.message, stack: error.stack });
        });
      });
    }
  } catch (error) {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

startServer();
