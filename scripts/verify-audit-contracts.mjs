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

requireText('Dockerfile', 'RUN npm run lint && npm run typecheck && npm run build');
requireText('Dockerfile', 'ARG VITE_DEMO_MODE=false');
requireText('docker-compose.yml', 'POSTGRES_PASSWORD muss in der Instanz-Umgebung gesetzt sein');
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
