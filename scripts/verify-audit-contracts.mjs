import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireText(relativePath, text) {
  if (!read(relativePath).includes(text)) {
    throw new Error(`${relativePath} enthält nicht den erwarteten Vertrag: ${text}`);
  }
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

const backup = read('backend/routes/backup.js');
const clearTables = backup.match(/const RESTORE_CLEAR_TABLES = \[(.*?)\];/s)?.[1] || '';
const restoreOrder = backup.match(/const RESTORE_ORDER = \[(.*?)\];/s)?.[1] || '';

requireText('Dockerfile', 'RUN npm run test:frontend && npm run lint && npm run typecheck && npm run build');
requireText('Dockerfile.demo', 'RUN npm run test:frontend && npm run lint && npm run typecheck && npm run build');
requireText('Dockerfile', 'FROM node:22-alpine AS build');
requireText('Dockerfile.demo', 'FROM node:22-alpine AS build');
requireText('package.json', '"vite": "^8.2.2"');
requireText('package.json', '"eslint": "^10.9.1"');
requireText('package.json', '"node": "^20.19.0 || ^22.13.0 || >=24.0.0"');
requireText('Dockerfile', 'ARG VITE_DEMO_MODE=false');
requireText('backend/Dockerfile', 'RUN npm test');
requireText('backend/Dockerfile', 'FROM node:22-alpine');
requireText('backend/package.json', '"pdfkit": "^0.20.1"');
requireText('backend/test/pdfKit.test.js', "assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');");
requireText('.dockerignore', '**/._*');
requireText('backend/.dockerignore', '**/._*');
requireText('docker-compose.yml', 'POSTGRES_PASSWORD muss in der Instanz-Umgebung gesetzt sein');
requireText('docker-compose.yml', "fetch('http://127.0.0.1:3001/health/ready')");
requireText('docker-compose.yml', 'no-new-privileges:true');
requireText('.github/workflows/quality.yml', 'Migrationen und Workspace-RLS gegen PostgreSQL prüfen');
requireText('.github/workflows/quality.yml', 'npm run audit:dependencies');
requireText('.github/workflows/quality.yml', 'npm --prefix backend run audit:dependencies');
requireText('backend/routes/backup.js', 'ignoredTables: IGNORED_LEGACY_BACKUP_TABLES');
requireText('backend/utils/backupArchive.js', 'uploadBytes: 50 * 1024 * 1024');
requireText('backend/utils/metrics.js', "const OVERFLOW_KEY = 'OTHER';");
requireText('docs/manual-release-checklist.md', 'Status:** vor dem nächsten öffentlichen Release erneut vorlegen');
requireText('backend/migrations/index.js', "import * as migration025 from './025_security_and_compliance.js';");
requireText('backend/migrations/index.js', "import * as migration026 from './026_incoming_e_invoices.js';");
requireText('src/utils/pdf/xrechnungGenerator.ts', "assertEInvoiceXML(xmlContent, 'XRechnung');");
requireText('src/utils/pdf/zugferdGenerator.ts', "assertEInvoiceXML(xml, 'ZUGFeRD');");
requireText('src/utils/pdf/zugferdGenerator.ts', "'factur-x.xml'");
requireText('src/components/CustomerManagement.tsx', 'Leitweg-ID');
requireText('backend/routes/eInvoices.js', 'createHash');
requireText('backend/routes/eInvoices.js', "validation_status");
requireText('src/components/IncomingEInvoicesManagement.tsx', 'E-Rechnungseingang');
requireCondition(!/TRUNCATE/i.test(backup), 'Backup-Restore darf kein TRUNCATE verwenden.');
requireCondition(!/['"]migrations['"]/.test(clearTables), 'Die Migrationstabelle darf nicht gelöscht werden.');
requireCondition(!/['"]migrations['"]/.test(restoreOrder), 'Die Migrationstabelle darf nicht wiederhergestellt werden.');
requireCondition(/throw new Error\(`ZUGFeRD-PDF konnte nicht erzeugt werden/.test(read('src/utils/pdf/zugferdGenerator.ts')), 'ZUGFeRD-Fehler dürfen nicht still auf ein normales PDF zurückfallen.');

console.log('SoloOffice Audit-Verträge: OK');
