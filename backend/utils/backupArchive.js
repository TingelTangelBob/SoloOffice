import AdmZip from 'adm-zip';

export const BACKUP_ARCHIVE_LIMITS = Object.freeze({
  uploadBytes: 50 * 1024 * 1024,
  databaseBytes: 45 * 1024 * 1024,
  metadataBytes: 256 * 1024,
  records: 250_000,
});

const REQUIRED_ENTRIES = new Set(['database.json', 'metadata.json']);

export class BackupArchiveError extends Error {
  constructor(message, code = 'BACKUP_ARCHIVE_INVALID', statusCode = 400) {
    super(message);
    this.name = 'BackupArchiveError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function parseJson(buffer, label) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new BackupArchiveError(`${label} enthält kein gültiges JSON.`, 'BACKUP_JSON_INVALID');
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getEntryData(entry, maximumBytes, label) {
  const declaredSize = Number(entry?.header?.size);
  if (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > maximumBytes) {
    throw new BackupArchiveError(
      `${label} ist für eine Wiederherstellung zu groß.`,
      'BACKUP_ARCHIVE_EXPANDED_TOO_LARGE',
      413,
    );
  }

  let data;
  try {
    data = entry.getData();
  } catch {
    throw new BackupArchiveError(`${label} konnte nicht gelesen werden.`, 'BACKUP_ARCHIVE_CORRUPT');
  }
  if (data.length > maximumBytes) {
    throw new BackupArchiveError(
      `${label} ist für eine Wiederherstellung zu groß.`,
      'BACKUP_ARCHIVE_EXPANDED_TOO_LARGE',
      413,
    );
  }
  return data;
}

export function validateBackupData(
  backupData,
  { allowedTables = [], ignoredTables = [], limits = BACKUP_ARCHIVE_LIMITS } = {},
) {
  if (!isPlainObject(backupData) || !isPlainObject(backupData.data)) {
    throw new BackupArchiveError('Das Backup enthält keine gültigen Sicherungsdaten.', 'BACKUP_DATA_INVALID');
  }

  const allowed = new Set(allowedTables);
  const ignored = new Set(ignoredTables);
  let totalRecords = 0;
  for (const [table, records] of Object.entries(backupData.data)) {
    if (!allowed.has(table) && !ignored.has(table)) {
      throw new BackupArchiveError(
        `Das Backup enthält die unbekannte Tabelle „${table}“.`,
        'BACKUP_TABLE_UNSUPPORTED',
      );
    }
    if (!Array.isArray(records) || records.some(record => !isPlainObject(record))) {
      throw new BackupArchiveError(
        `Die Sicherungsdaten für „${table}“ sind ungültig.`,
        'BACKUP_DATA_INVALID',
      );
    }
    totalRecords += records.length;
    if (totalRecords > limits.records) {
      throw new BackupArchiveError(
        'Das Backup enthält zu viele Datensätze für eine Wiederherstellung.',
        'BACKUP_RECORD_LIMIT_EXCEEDED',
        413,
      );
    }
  }
  return { totalRecords };
}

/**
 * Liest ausschließlich das von SoloOffice erzeugte Zwei-Dateien-Format. Die
 * Größenprüfung erfolgt vor und nach dem Entpacken, damit ein kleines
 * komprimiertes Archiv nicht unkontrolliert Arbeitsspeicher belegen kann.
 */
export function parseBackupArchive(
  zipBuffer,
  { allowedTables = [], ignoredTables = [], limits = BACKUP_ARCHIVE_LIMITS } = {},
) {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length === 0) {
    throw new BackupArchiveError('Die hochgeladene Backup-Datei ist leer.', 'BACKUP_ARCHIVE_EMPTY');
  }
  if (zipBuffer.length > limits.uploadBytes) {
    throw new BackupArchiveError(
      'Das Backup ist zu groß. Erlaubt sind maximal 50 MB.',
      'BACKUP_FILE_TOO_LARGE',
      413,
    );
  }

  let zip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw new BackupArchiveError('Die hochgeladene Datei ist kein lesbares ZIP-Archiv.', 'BACKUP_ARCHIVE_CORRUPT');
  }

  const entries = zip.getEntries();
  const entryNames = entries.map(entry => entry.entryName);
  const unexpected = entries.find(entry => entry.isDirectory || !REQUIRED_ENTRIES.has(entry.entryName));
  const hasDuplicates = new Set(entryNames).size !== entryNames.length;
  if (entries.length !== REQUIRED_ENTRIES.size || unexpected || hasDuplicates) {
    throw new BackupArchiveError(
      'Das ZIP-Backup hat nicht die erwartete SoloOffice-Struktur.',
      'BACKUP_ARCHIVE_STRUCTURE_INVALID',
    );
  }

  const databaseEntry = zip.getEntry('database.json');
  const metadataEntry = zip.getEntry('metadata.json');
  if (!databaseEntry || !metadataEntry) {
    throw new BackupArchiveError(
      'Im ZIP-Backup fehlen database.json oder metadata.json.',
      'BACKUP_ARCHIVE_STRUCTURE_INVALID',
    );
  }

  const backupData = parseJson(
    getEntryData(databaseEntry, limits.databaseBytes, 'database.json'),
    'database.json',
  );
  const metadata = parseJson(
    getEntryData(metadataEntry, limits.metadataBytes, 'metadata.json'),
    'metadata.json',
  );

  if (!isPlainObject(metadata)) {
    throw new BackupArchiveError('Das ZIP-Backup enthält keine gültigen Sicherungsdaten.', 'BACKUP_DATA_INVALID');
  }
  const { totalRecords } = validateBackupData(backupData, { allowedTables, ignoredTables, limits });

  return { backupData, metadata, totalRecords };
}
