import React, { useState, useEffect } from 'react';
import logger from '../utils/logger';
import { 
  Save, 
  Download, 
  Upload, 
  Trash2, 
  AlertTriangle, 
  CheckCircle, 
  Database,
  FileText,
  RefreshCw,
  X
} from 'lucide-react';
import { ApiResponseError, apiService } from '../services/api';
import { useFeedback } from '../context/FeedbackContext';

interface BackupInfo {
  filename: string;
  type: 'json' | 'zip';
  timestamp: string;
  size: number;
  tableCount: number;
  totalRecords: number;
  created: string;
}

interface BackupManagementProps {
  onClose?: () => void;
}

interface RestoreData {
  version?: string | number;
  timestamp?: string;
  workspaceId?: string;
  timeZone?: string;
  data?: Record<string, unknown[]>;
  file?: File;
}

export function BackupManagement({ onClose }: BackupManagementProps) {
  const { confirm } = useFeedback();
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [zipBackups, setZipBackups] = useState<BackupInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isCreatingZipBackup, setIsCreatingZipBackup] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [restoreData, setRestoreData] = useState<RestoreData | null>(null);
  const [restoreType, setRestoreType] = useState<'json' | 'zip'>('json');
  const [workspaceTransfer, setWorkspaceTransfer] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);

  useEffect(() => {
    loadBackups();
  }, []);

  const loadBackups = async () => {
    setIsLoading(true);
    try {
      // Try new API first, fallback to old API if it fails
      try {
        const response = await apiService.listAllBackups();
        if (response.success) {
          setBackups(response.backups);
          setZipBackups(response.zipBackups);
          return;
        }
      } catch (error) {
        console.warn('New backup API failed, trying fallback:', error);
      }
      
      // Fallback to old API
      const response = await apiService.listBackups();
      if (response.success) {
        setBackups(response.backups.map(backup => ({ ...backup, type: 'json' as const })));
        setZipBackups([]);
      } else {
        setMessage({ type: 'error', text: 'Fehler beim Laden der Backups' });
      }
    } catch (error) {
      logger.error('Error loading backups:', error);
      setMessage({ type: 'error', text: 'Fehler beim Laden der Backups' });
    } finally {
      setIsLoading(false);
    }
  };

  const createBackup = async () => {
    setIsCreatingBackup(true);
    try {
      const response = await apiService.createBackup();
      if (response.success) {
        setMessage({ 
          type: 'success', 
          text: `Backup erfolgreich erstellt: ${response.totalRecords} Datensätze aus ${response.tableCount} Tabellen` 
        });
        await loadBackups();
      } else {
        setMessage({ type: 'error', text: response.message || 'Fehler beim Erstellen des Backups' });
      }
    } catch (error) {
      logger.error('Error creating backup:', error);
      setMessage({ type: 'error', text: 'Fehler beim Erstellen des Backups' });
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const createZipBackup = async () => {
    setIsCreatingZipBackup(true);
    try {
      const response = await apiService.createZipBackup();
      if (response.success) {
        setMessage({ 
          type: 'success', 
          text: `Vollbackup erfolgreich erstellt: ${response.totalRecords} Datensätze aus ${response.tableCount} Tabellen` 
        });
        await loadBackups();
      } else {
        setMessage({ type: 'error', text: response.message || 'Fehler beim Erstellen des Vollbackups' });
      }
    } catch (error) {
      logger.error('Error creating ZIP backup:', error);
      setMessage({ 
        type: 'warning', 
        text: 'ZIP-Backup noch nicht verfügbar. Bitte starten Sie den Container neu: docker-compose down && docker-compose up --build' 
      });
    } finally {
      setIsCreatingZipBackup(false);
    }
  };

  const downloadBackup = async (filename: string, type: 'json' | 'zip') => {
    try {
      if (type === 'zip') {
        await apiService.downloadZipBackup(filename);
        setMessage({ type: 'success', text: 'Vollbackup erfolgreich heruntergeladen' });
      } else {
        await apiService.downloadBackup(filename);
        setMessage({ type: 'success', text: 'Backup erfolgreich heruntergeladen' });
      }
    } catch (error) {
      logger.error('Error downloading backup:', error);
      setMessage({ type: 'error', text: 'Fehler beim Download des Backups' });
    }
  };

  const deleteBackup = async (filename: string, type: 'json' | 'zip', displayName?: string) => {
    const backupTypeLabel = type === 'zip' ? 'Vollbackup (ZIP)' : 'Datenbank-Backup (JSON)';
    const confirmed = await confirm({
      title: 'Backup löschen',
      message: `Soll das ${backupTypeLabel} „${displayName || filename}“ wirklich gelöscht werden? Es kann danach nicht mehr eingespielt werden.`,
      confirmText: 'Löschen',
      isDestructive: true,
    });
    if (!confirmed) return;

    try {
      const response = type === 'zip'
        ? await apiService.deleteZipBackup(filename)
        : await apiService.deleteBackup(filename);
      if (response.success) {
        setMessage({ type: 'success', text: 'Backup erfolgreich gelöscht' });
        await loadBackups();
      } else {
        setMessage({ type: 'error', text: response.message || 'Fehler beim Löschen des Backups' });
      }
    } catch (error) {
      logger.error('Error deleting backup:', error);
      setMessage({ type: 'error', text: 'Fehler beim Löschen des Backups' });
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setSelectedFile(file);
    
    if (file.type === 'application/json' || file.name.endsWith('.json')) {
      // Handle JSON backup
      setRestoreType('json');
      
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string) as RestoreData;
          if (data.version && data.data && data.timestamp) {
            setRestoreData(data);
            setWorkspaceTransfer(false);
            setShowRestoreConfirm(true);
          } else {
            setMessage({ type: 'error', text: 'Ungültige JSON-Backup-Datei' });
          }
        } catch {
          setMessage({ type: 'error', text: 'Fehler beim Lesen der JSON-Backup-Datei' });
        }
      };
      reader.readAsText(file);
    } else if (file.type === 'application/zip' || file.name.endsWith('.zip')) {
      // Handle ZIP backup
      setRestoreType('zip');
      setRestoreData({ file });
      setWorkspaceTransfer(false);
      setShowRestoreConfirm(true);
    } else {
      setMessage({ type: 'error', text: 'Bitte wählen Sie eine gültige JSON- oder ZIP-Datei aus' });
    }
  };

  const restoreBackup = async () => {
    if (!restoreData) return;

    setIsRestoring(true);
    try {
      let response;
      const options = { allowWorkspaceTransfer: workspaceTransfer };
      
      if (restoreType === 'zip' && restoreData.file) {
        response = await apiService.restoreZipBackup(restoreData.file, options);
      } else {
        response = await apiService.restoreBackup(restoreData, options);
      }
      
      if (response.success) {
        setMessage({ 
          type: 'success', 
          text: `${restoreType === 'zip' ? 'Vollbackup' : 'Backup'} erfolgreich wiederhergestellt: ${response.restoredRecords} Datensätze aus ${response.restoredTables} Tabellen` 
        });
        setShowRestoreConfirm(false);
        setSelectedFile(null);
        setRestoreData(null);
        // Reload page to reflect restored data
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        setMessage({ type: 'error', text: response.message || 'Fehler beim Wiederherstellen des Backups' });
      }
    } catch (error) {
      // Ein Backup aus einem anderen Workspace (z. B. einer eigenen
      // Installation) wird erst nach ausdrücklicher Bestätigung übernommen.
      if (error instanceof ApiResponseError && error.code === 'BACKUP_WORKSPACE_MISMATCH' && !workspaceTransfer) {
        setWorkspaceTransfer(true);
        return;
      }
      logger.error('Error restoring backup:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Fehler beim Wiederherstellen des Backups',
      });
    } finally {
      setIsRestoring(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatBackupDate = (backup: BackupInfo): string => {
    const date = new Date(backup.timestamp || backup.created);
    return Number.isNaN(date.getTime())
      ? 'Unbekanntes Datum'
      : date.toLocaleString('de-DE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
      });
  };

  const getBackupName = (backup: BackupInfo): string => (
    `${backup.type === 'zip' ? 'Vollbackup' : 'Datenbank-Backup'} · ${formatBackupDate(backup)}`
  );

  const renderBackupRow = (backup: BackupInfo, type: 'json' | 'zip') => (
    <div key={backup.filename} className="rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 hover:bg-gray-50">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <h5 className="break-words font-medium text-gray-900" title={backup.filename}>
            {getBackupName({ ...backup, type })}
          </h5>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-500">
            <span>{type === 'zip' ? 'ZIP' : 'JSON'} · {formatFileSize(backup.size)}</span>
            <span className="inline-flex items-center gap-1">
              <Database className="h-4 w-4" />
              {backup.tableCount} Tabellen
            </span>
            <span className="inline-flex items-center gap-1">
              <FileText className="h-4 w-4" />
              {backup.totalRecords.toLocaleString('de-DE')} Datensätze
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
          <button
            type="button"
            onClick={() => downloadBackup(backup.filename, type)}
            className="btn-secondary inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
            title="Backup herunterladen"
          >
            <Download className="h-4 w-4" />
            <span>Herunterladen</span>
          </button>
          <button
            type="button"
            onClick={() => deleteBackup(backup.filename, type, getBackupName({ ...backup, type }))}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300"
            title="Backup löschen"
          >
            <Trash2 className="h-4 w-4" />
            <span>Löschen</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6">
      <div role="dialog" aria-modal="true" aria-labelledby="backup-management-title" className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 px-5 py-4 sm:px-6 sm:py-5">
          <div className="flex items-center">
            <Database className="mr-3 h-6 w-6 shrink-0 text-primary-custom" />
            <h2 id="backup-management-title" className="text-xl font-semibold text-gray-900">Daten-Backup und Wiederherstellung</h2>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              aria-label="Backup-Verwaltung schließen"
            >
              <X className="h-6 w-6" />
            </button>
          )}
        </div>

        {message && (
          <div className={`mx-5 mt-4 flex items-center rounded-lg border p-4 sm:mx-6 ${
            message.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800' :
            message.type === 'error' ? 'bg-red-50 border border-red-200 text-red-800' :
            'bg-yellow-50 border border-yellow-200 text-yellow-800'
          }`}>
            {message.type === 'success' ? (
              <CheckCircle className="h-5 w-5 mr-2" />
            ) : (
              <AlertTriangle className="h-5 w-5 mr-2" />
            )}
            <span>{message.text}</span>
            <button
              onClick={() => setMessage(null)}
              className="ml-auto text-current opacity-70 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
          <div className="space-y-6">
          {/* Create Backup Section */}
          <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 sm:p-6">
            <h3 className="mb-4 text-lg font-semibold text-blue-900">Backup erstellen</h3>
            
            {/* JSON Backup */}
            <div className="mb-3 flex flex-col gap-4 rounded-lg bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h4 className="mb-1 font-medium text-gray-900">Datenbank-Backup (JSON)</h4>
                <p className="text-sm text-gray-600">
                  Sichert nur die Datenbank-Inhalte als JSON-Datei.
                </p>
              </div>
              <button
                onClick={createBackup}
                disabled={isCreatingBackup || isCreatingZipBackup}
                className="btn-secondary inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreatingBackup ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                <span>{isCreatingBackup ? 'Erstelle...' : 'JSON-Backup'}</span>
              </button>
            </div>

            {/* ZIP Backup */}
            <div className="flex flex-col gap-4 rounded-lg bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h4 className="mb-1 font-medium text-gray-900">Vollständiges Backup (ZIP)</h4>
                <p className="text-sm text-gray-600">
                  Sichert alle Daten inklusive Logos und Anhänge als ZIP-Archiv.
                </p>
              </div>
              <button
                onClick={createZipBackup}
                disabled={isCreatingBackup || isCreatingZipBackup}
                className="btn-primary inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreatingZipBackup ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span>{isCreatingZipBackup ? 'Erstelle...' : 'Vollbackup (ZIP)'}</span>
              </button>
            </div>
          </section>

          {/* Restore Backup Section */}
          <section className="rounded-xl border border-orange-200 bg-orange-50 p-4 sm:p-6">
            <div className="mb-4">
              <h3 className="mb-2 text-lg font-semibold text-orange-900">Backup wiederherstellen</h3>
              <p className="text-sm text-orange-700">
                <AlertTriangle className="mr-1 inline h-4 w-4" />
                <strong>Warnung:</strong> Dies überschreibt alle vorhandenen Daten!
              </p>
            </div>

            <div className="flex flex-col gap-4 rounded-lg bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h4 className="mb-1 font-medium text-gray-900">Backup-Datei auswählen</h4>
                <p className="text-sm text-gray-600">JSON (Datenbank) oder ZIP (Vollbackup)</p>
                {selectedFile && (
                  <p className="mt-2 truncate text-sm text-gray-500" title={selectedFile.name}>
                    Ausgewählt: {selectedFile.name} ({formatFileSize(selectedFile.size)})
                  </p>
                )}
              </div>
              <label htmlFor="backup-file-input" className="btn-secondary inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors">
                <Upload className="h-4 w-4" />
                <span>{selectedFile ? 'Andere Datei wählen' : 'Datei auswählen'}</span>
                <input
                  id="backup-file-input"
                  type="file"
                  accept=".json,.zip"
                  onChange={handleFileSelect}
                  className="sr-only"
                />
              </label>
            </div>
          </section>

          {/* Available Backups */}
          <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
            <div className="flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Verfügbare Backups</h3>
              <button
                type="button"
                onClick={loadBackups}
                disabled={isLoading}
                className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-lg border border-primary-custom px-4 py-2 text-sm font-medium text-primary-custom transition-colors hover:bg-primary-light-custom disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Aktualisieren</span>
              </button>
            </div>

            {isLoading ? (
              <div className="py-10 text-center">
                <RefreshCw className="mx-auto mb-2 h-8 w-8 animate-spin text-gray-400" />
                <p className="text-gray-500">Lade Backups...</p>
              </div>
            ) : backups.length === 0 && zipBackups.length === 0 ? (
              <div className="py-10 text-center">
                <FileText className="mx-auto mb-2 h-8 w-8 text-gray-400" />
                <p className="text-gray-500">Keine Backups verfügbar</p>
              </div>
            ) : (
              <div className="mt-4 space-y-5">
                {zipBackups.length > 0 && (
                  <div>
                    <div className="mb-3 flex items-center gap-2 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
                      <Save className="h-4 w-4" />
                      <span>Vollständige Backups (ZIP)</span>
                    </div>
                    <div className="space-y-3">
                      {zipBackups.map(backup => renderBackupRow(backup, 'zip'))}
                    </div>
                  </div>
                )}

                {backups.length > 0 && (
                  <div>
                    <div className="mb-3 flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
                      <FileText className="h-4 w-4" />
                      <span>Datenbank-Backups (JSON)</span>
                    </div>
                    <div className="space-y-3">
                      {backups.map(backup => renderBackupRow(backup, 'json'))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
          </div>
        </div>

        {/* Restore Confirmation Modal */}
        {showRestoreConfirm && restoreData && (
          <div className="dialog-overlay fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="p-6">
                <div className="flex items-center mb-4">
                  <AlertTriangle className="h-6 w-6 text-red-500 mr-3" />
                  <h3 className="text-lg font-semibold text-gray-900">Backup wiederherstellen</h3>
                </div>
                
                <div className="mb-6">
                  <p className="text-gray-700 mb-4">
                    <strong>Achtung:</strong> Diese Aktion überschreibt alle vorhandenen Daten unwiderruflich!
                  </p>
                  {workspaceTransfer && (
                    <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      Dieses Backup stammt aus einem anderen Workspace, etwa aus einer eigenen Installation. Es kann in diesen Workspace übernommen werden; alle aktuellen Daten dieses Workspace werden dabei ersetzt. SMTP-Passwörter sind nicht enthalten und müssen neu eingetragen werden.
                    </p>
                  )}
                  
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                    <div><strong>Backup-Typ:</strong> {restoreType === 'zip' ? 'Vollständiges ZIP-Backup' : 'Datenbank JSON-Backup'}</div>
                    {restoreType === 'json' && restoreData.timestamp && (
                      <div><strong>Backup-Datum:</strong> {formatDate(restoreData.timestamp)}</div>
                    )}
                    {restoreType === 'json' && restoreData.data && (
                      <>
                        <div><strong>Tabellen:</strong> {Object.keys(restoreData.data || {}).length}</div>
                        <div><strong>Datensätze:</strong> {Object.values(restoreData.data || {}).reduce((sum, records) => sum + records.length, 0).toLocaleString('de-DE')}</div>
                      </>
                    )}
                    {restoreType === 'zip' && restoreData.file && (
                      <>
                        <div><strong>Dateiname:</strong> {restoreData.file.name}</div>
                        <div><strong>Dateigröße:</strong> {formatFileSize(restoreData.file.size)}</div>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => {
                      setShowRestoreConfirm(false);
                      setRestoreData(null);
                      setSelectedFile(null);
                      setWorkspaceTransfer(false);
                    }}
                    className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={restoreBackup}
                    disabled={isRestoring}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
                  >
                    {isRestoring ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    <span>{isRestoring ? 'Wiederherstellen...' : workspaceTransfer ? 'In diesen Workspace übernehmen' : 'Wiederherstellen'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
