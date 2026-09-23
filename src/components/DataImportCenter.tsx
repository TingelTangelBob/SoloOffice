import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, CalendarCheck, CheckCircle2, Download, FileText, History, Loader2, RotateCcw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import { useCustomers } from '../context/CustomerContext';
import { useFeedback } from '../context/FeedbackContext';
import { useInvoices } from '../context/InvoiceContext';
import { useJobs } from '../context/JobContext';
import { useQuotes } from '../context/QuoteContext';
import { apiService } from '../services/api';
import type { ImportResource, ImportRun, TakeoverStatus } from '../types';
import { buildImportTemplate, detectImportResources, getImportDefinition, parseImportFile, type ImportResourceCandidate, type ParsedImportFile } from '../utils/importParser';
import { getTerminology } from '../utils/terminology';
import { DialogShell } from './DialogShell';
import { ImportResultTable, ImportWizard } from './ImportWizard';
import { LocalizedDateInput } from './LocalizedDateInput';
import { PageHeader } from './PageHeader';

interface DataImportCenterProps {
  onNavigate?: (page: string, filter?: string) => void;
}

interface ImportStepCard {
  id: string;
  title: string;
  description: string;
  resources: Array<{ resource: ImportResource; label: string }>;
  adminOnly?: boolean;
}

const statusLabels: Record<ImportRun['status'], string> = {
  pending: 'Offen – rückgängig möglich',
  confirmed: 'Abgeschlossen',
  reverted: 'Rückgängig gemacht',
};

const statusClasses: Record<ImportRun['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-green-100 text-green-800',
  reverted: 'bg-gray-100 text-gray-600',
};

function downloadCsvText(fileName: string, content: string) {
  const blob = new Blob([`\ufeff${content}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

export function DataImportCenter({ onNavigate }: DataImportCenterProps) {
  const { can } = useAuth();
  const { company, setCompany, setHourlyRates, setMaterialTemplates } = useCompany();
  const { refreshCustomers } = useCustomers();
  const { refreshInvoices } = useInvoices();
  const { refreshJobEntries } = useJobs();
  const { refreshQuotes } = useQuotes();
  const { confirm, notify } = useFeedback();
  const terminology = getTerminology(company.terminologyProfile);
  const canWrite = can('data.write');
  const canAdmin = can('workspace.settings');
  const [runs, setRuns] = useState<ImportRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cutoverDate, setCutoverDate] = useState('');
  const [savedCutoverDate, setSavedCutoverDate] = useState('');
  const [wizardResource, setWizardResource] = useState<ImportResource | null>(null);
  const [wizardSourceFile, setWizardSourceFile] = useState<File | null>(null);
  const [wizardSheet, setWizardSheet] = useState<string | undefined>(undefined);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scannedFile, setScannedFile] = useState<File | null>(null);
  const [scanResult, setScanResult] = useState<ParsedImportFile | null>(null);
  const [scanCandidates, setScanCandidates] = useState<ImportResourceCandidate[]>([]);
  const [manualScanResource, setManualScanResource] = useState<ImportResource | ''>('');
  const [protocolRun, setProtocolRun] = useState<ImportRun | null>(null);
  const [loadError, setLoadError] = useState('');
  const [takeover, setTakeover] = useState<TakeoverStatus | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [runList, settings, takeoverStatus] = await Promise.all([apiService.getImportRuns(), apiService.getImportSettings(), apiService.getTakeoverStatus()]);
      setRuns(runList);
      setTakeover(takeoverStatus);
      setCutoverDate(settings.cutoverDate || '');
      setSavedCutoverDate(settings.cutoverDate || '');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Die Datenübernahme konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refreshData = useCallback(async (resource?: ImportResource) => {
    const tasks: Array<Promise<unknown>> = [];
    if (!resource || ['customers', 'jobs', 'quotes', 'euerEntries', 'invoices'].includes(resource)) tasks.push(refreshCustomers());
    if (!resource || ['invoices', 'invoicePayments', 'euerEntries'].includes(resource)) tasks.push(refreshInvoices());
    if (!resource || resource === 'jobs') tasks.push(refreshJobEntries());
    if (!resource || resource === 'quotes') tasks.push(refreshQuotes());
    if (!resource || resource === 'hourlyRates') tasks.push(apiService.getHourlyRates().then(setHourlyRates));
    if (!resource || resource === 'materials') tasks.push(apiService.getMaterialTemplates().then(setMaterialTemplates));
    if (!resource || resource === 'positions') tasks.push(apiService.getCompany().then(setCompany));
    await Promise.allSettled(tasks);
  }, [refreshCustomers, refreshInvoices, refreshJobEntries, refreshQuotes, setCompany, setHourlyRates, setMaterialTemplates]);

  const steps = useMemo<ImportStepCard[]>(() => ([
    {
      id: 'customers',
      title: terminology.entity.plural,
      description: `Stammdaten zuerst: Namen, Adressen und Nummern. Später importierte Zeilen werden den ${terminology.entity.plural} darüber zugeordnet.`,
      resources: [{ resource: 'customers', label: terminology.entity.plural }],
    },
    {
      id: 'prices',
      title: 'Leistungen und Preise',
      description: 'Positionsvorlagen, Stundensätze und Materialien mit Preis und Steuersatz.',
      resources: [
        { resource: 'positions', label: 'Positionen' },
        { resource: 'hourlyRates', label: 'Stundensätze' },
        { resource: 'materials', label: 'Materialien' },
      ],
      adminOnly: true,
    },
    {
      id: 'invoices',
      title: 'Rechnungen (Altbestand)',
      description: 'Bereits geschriebene Rechnungen mit ursprünglicher Nummer. Offene Rechnungen bleiben offen und können gemahnt werden; Original-PDFs lassen sich danach an der Rechnung hinterlegen.',
      resources: [{ resource: 'invoices', label: 'Rechnungen' }],
    },
    {
      id: 'money',
      title: 'Einnahmen und Ausgaben',
      description: 'Ihre bisherige Einnahmen-/Ausgabentabelle. Einnahmen zu vorhandenen Rechnungen werden als deren Zahlung gebucht, alle übrigen als Einnahme ohne Rechnung.',
      resources: [{ resource: 'euerEntries', label: 'Einnahmen und Ausgaben' }],
    },
    {
      id: 'payments',
      title: 'Zahlungseingänge',
      description: 'Zahlungen, die sich eindeutig einer Rechnungsnummer zuordnen lassen, etwa aus einem Kontoauszug.',
      resources: [{ resource: 'invoicePayments', label: 'Zahlungseingänge' }],
    },
    {
      id: 'work',
      title: company.jobTrackingEnabled ? terminology.work.plural : 'Angebote',
      description: company.jobTrackingEnabled
        ? `Vergangene und geplante ${terminology.work.plural}. Bereits abgerechnete Termine können als abgerechnet übernommen werden; Wiederholungen legen Serien an.`
        : 'Offene oder angenommene Angebote mit ihren Positionen.',
      resources: [
        ...(company.jobTrackingEnabled ? [{ resource: 'jobs' as const, label: terminology.work.plural }] : []),
        ...(company.quotesEnabled ? [{ resource: 'quotes' as const, label: 'Angebote' }] : []),
      ],
    },
  ] satisfies ImportStepCard[]).filter(step => step.resources.length > 0), [company.jobTrackingEnabled, company.quotesEnabled, terminology]);

  const importedCount = (resource: ImportResource) => runs
    .filter(run => run.resource === resource && run.status !== 'reverted')
    .reduce((sum, run) => sum + Number(run.summary?.imported || 0), 0);
  const pendingRuns = runs.filter(run => run.status === 'pending');

  const saveCutover = async () => {
    try {
      const result = await apiService.updateImportSettings({ cutoverDate: cutoverDate || null });
      setSavedCutoverDate(result.cutoverDate || '');
      notify({ variant: 'success', message: result.cutoverDate ? 'Der Stichtag wurde gespeichert.' : 'Der Stichtag wurde entfernt.' });
    } catch (error) {
      notify({ variant: 'error', message: error instanceof Error ? error.message : 'Der Stichtag konnte nicht gespeichert werden.' });
    }
  };

  const revert = async (run: ImportRun) => {
    const accepted = await confirm({
      title: 'Import rückgängig machen?',
      message: `Alle ${run.summary?.imported ?? ''} Datensätze aus „${run.fileName || run.resourceLabel}“ werden entfernt, geänderte Stammdaten zurückgesetzt. EÜR-Buchungen werden storniert und bleiben im Änderungsverlauf sichtbar.`,
      confirmText: 'Rückgängig machen',
      isDestructive: true,
    });
    if (!accepted) return;
    setBusyId(run.id);
    try {
      await apiService.revertImportRun(run.id);
      await Promise.all([load(), refreshData(run.resource)]);
      notify({ variant: 'success', message: 'Der Import wurde rückgängig gemacht.' });
    } catch (error) {
      notify({ variant: 'error', title: 'Rückgängig machen nicht möglich', message: error instanceof Error ? error.message : 'Der Import konnte nicht rückgängig gemacht werden.' });
    } finally {
      setBusyId(null);
    }
  };

  const confirmRun = async (run: ImportRun) => {
    const accepted = await confirm({
      title: 'Import abschließen?',
      message: 'Danach kann dieser Import nicht mehr rückgängig gemacht werden. Die übernommenen Daten bleiben unverändert erhalten.',
      confirmText: 'Abschließen',
    });
    if (!accepted) return;
    setBusyId(run.id);
    try {
      await apiService.confirmImportRun(run.id);
      await load();
    } catch (error) {
      notify({ variant: 'error', message: error instanceof Error ? error.message : 'Der Import konnte nicht abgeschlossen werden.' });
    } finally {
      setBusyId(null);
    }
  };

  const confirmAll = async () => {
    const accepted = await confirm({
      title: 'Offene Importe bestätigen?',
      message: `${pendingRuns.length} ${pendingRuns.length === 1 ? 'offener Import wird' : 'offene Importe werden'} bestätigt. Prüfen Sie vorher Übersicht, EÜR und Auswertungen. Danach sind diese Importe nicht mehr rückgängig zu machen.`,
      confirmText: 'Importe bestätigen',
    });
    if (!accepted) return;
    setBusyId('all');
    try {
      const result = await apiService.confirmAllImportRuns();
      await load();
      notify({ variant: 'success', message: `${result.confirmed} ${result.confirmed === 1 ? 'Import wurde' : 'Importe wurden'} abgeschlossen.` });
    } catch (error) {
      notify({ variant: 'error', message: error instanceof Error ? error.message : 'Die offenen Importe konnten nicht bestätigt werden.' });
    } finally {
      setBusyId(null);
    }
  };

  const completeTakeover = async () => {
    if (!takeover?.session || takeover.session.status !== 'open') return;
    const accepted = await confirm({
      title: 'Umzug abschließen?',
      message: 'Damit wird die Umzugssitzung endgültig abgeschlossen. Noch offene Importe werden bestätigt und können danach nicht mehr rückgängig gemacht werden. Der einmalige Start bleibt dauerhaft verbraucht.',
      confirmText: 'Umzug abschließen',
    });
    if (!accepted) return;
    setBusyId('takeover');
    try {
      setTakeover(await apiService.completeTakeover(takeover.session.id));
      window.dispatchEvent(new Event('solooffice-takeover-status-changed'));
      await load();
      notify({ variant: 'success', message: 'Der Umzug wurde abgeschlossen.' });
    } catch (error) {
      notify({ variant: 'error', message: error instanceof Error ? error.message : 'Der Umzug konnte nicht abgeschlossen werden.' });
    } finally {
      setBusyId(null);
    }
  };

  const startTakeover = async () => {
    if (takeover?.takeoverUsed) return;
    setBusyId('takeover-start');
    try {
      setTakeover(await apiService.startTakeover());
      window.dispatchEvent(new Event('solooffice-takeover-status-changed'));
      notify({ variant: 'success', message: 'Die Umzugssitzung wurde gestartet.' });
    } catch (error) {
      notify({ variant: 'error', message: error instanceof Error ? error.message : 'Der Umzug konnte nicht gestartet werden.' });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const openProtocol = async (run: ImportRun) => {
    setBusyId(run.id);
    try {
      setProtocolRun(await apiService.getImportRun(run.id));
    } catch (error) {
      notify({ variant: 'error', message: error instanceof Error ? error.message : 'Das Protokoll konnte nicht geladen werden.' });
    } finally {
      setBusyId(null);
    }
  };

  const templateFor = (resource: ImportResource, label: string) => {
    downloadCsvText(`Vorlage-${label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-')}.csv`, buildImportTemplate(getImportDefinition(resource)));
  };

  const scanFile = async (file: File, sheet?: string) => {
    setScanBusy(true);
    setScanError('');
    setScannedFile(null);
    setScanResult(null);
    setScanCandidates([]);
    try {
      const parsed = await parseImportFile(file, { sheet });
      if (parsed.rows.length > 5000) throw new Error('Für den Scan sind höchstens 5.000 Datenzeilen zulässig. Bitte teilen Sie die Datei auf.');
      const validation = await apiService.scanTakeoverFile({
        fileName: parsed.fileName,
        format: parsed.format,
        fileSize: file.size,
        hash: parsed.hash || '',
        headers: parsed.headers,
        rows: parsed.rows,
        rowNumbers: parsed.rowNumbers,
        warnings: parsed.warnings,
        sheets: parsed.sheets,
        sheet: parsed.sheet,
      });
      if (!validation.accepted) throw new Error('Die Datei konnte serverseitig nicht geprüft werden.');
      setScannedFile(file);
      setScanResult(parsed);
      setScanCandidates(detectImportResources(parsed));
      setManualScanResource('');
    } catch (error) {
      setScannedFile(null);
      setScanResult(null);
      setScanCandidates([]);
      setScanError(error instanceof Error ? error.message : 'Die Datei konnte nicht geprüft werden.');
    } finally {
      setScanBusy(false);
    }
  };

  const openCandidate = (resource: ImportResource) => {
    if (!scannedFile) return;
    setWizardSourceFile(scannedFile);
    setWizardSheet(scanResult?.sheet);
    setWizardResource(resource);
  };

  const allUnclearColumns = scanResult
    ? scanResult.headers.filter(header => !scanCandidates.some(candidate => candidate.matchedColumns.includes(header)))
    : [];
  const canImportResource = (resource: ImportResource) => canWrite && (!steps.find(step => step.resources.some(item => item.resource === resource))?.adminOnly || canAdmin);

  return (
    <div className="page-root space-y-6">
      <PageHeader icon={ArrowRightLeft} title="Datenübernahme" subtitle="Daten aus Excel oder einem anderen Programm übernehmen">
        {pendingRuns.length > 0 && canWrite && (
          <button type="button" onClick={confirmAll} disabled={busyId !== null} className="btn-primary inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium sm:px-4 disabled:opacity-50">
            {busyId === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            <span>Offene Importe bestätigen</span>
          </button>
        )}
      </PageHeader>

      {takeover && <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Umzugsstatus">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Umzugsstatus</h2>
            {takeover.demoMode && <p className="mt-1 text-xs font-medium text-amber-800">Demo: Dieser Status wird nur in dieser Browser-Sitzung simuliert.</p>}
            {takeover.session?.legacyBackfill
              ? <p className="mt-1 text-sm text-gray-600">Der Umzug-Start wurde bereits durch Importläufe aus dem Altbestand belegt. Diese Läufe belegen keinen fachlichen Abschluss.</p>
              : takeover.session?.status === 'open'
                ? <p className="mt-1 text-sm text-gray-600">Sitzung gestartet am {formatDateTime(takeover.session.startedAt)}. Fortschrittsrevision {takeover.session.progressRevision}.</p>
                : takeover.session?.status === 'completed'
                  ? <p className="mt-1 text-sm text-gray-600">Abgeschlossen am {formatDateTime(takeover.session.completedAt)}. Ein neuer Umzug kann nicht gestartet werden.</p>
                  : <p className="mt-1 text-sm text-gray-600">Noch nicht gestartet. Eine Vorschau oder Prüfung verbraucht den einmaligen Start nicht.</p>}
          </div>
          {!takeover.session && canAdmin && <button type="button" onClick={startTakeover} disabled={busyId !== null} className="btn-primary inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium disabled:opacity-50">
            {busyId === 'takeover-start' && <Loader2 className="h-4 w-4 animate-spin" />}Datenübernahme starten
          </button>}
          {takeover.session?.status === 'open' && !takeover.session.legacyBackfill && canAdmin && <button type="button" onClick={completeTakeover} disabled={busyId !== null} className="btn-primary inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium disabled:opacity-50">
            {busyId === 'takeover' && <Loader2 className="h-4 w-4 animate-spin" />}Umzug abschließen
          </button>}
        </div>
      </section>}

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="takeover-scan-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="takeover-scan-title" className="text-lg font-semibold text-gray-900">1. Datei prüfen</h2>
            <p className="mt-1 text-sm text-gray-600">Die Datei wird lokal gelesen und serverseitig als normalisierte Tabelle geprüft. Der Scan schreibt keine Fachdaten.</p>
          </div>
          <button type="button" onClick={() => scanInputRef.current?.click()} disabled={scanBusy} className="btn-primary inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium disabled:opacity-50">
            {scanBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}{scanBusy ? 'Datei wird geprüft …' : scannedFile ? 'Andere Datei prüfen' : 'Datei auswählen und prüfen'}
          </button>
          <input ref={scanInputRef} className="sr-only" type="file" accept=".csv,.tsv,.txt,.json,.xlsx,.xlsm,.xls,.ods,.numbers" onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void scanFile(file);
          }} />
        </div>
        {scanError && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{scanError}</p>}
        {scanResult && scannedFile && <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
          <div className="grid gap-2 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-4">
            <p><span className="font-medium">Datei:</span> <span className="break-all">{scanResult.fileName}</span></p>
            <p><span className="font-medium">Typ / Größe:</span> {scanResult.format.toUpperCase()} · {(scannedFile.size / 1024).toLocaleString('de-DE', { maximumFractionDigits: 0 })} KB</p>
            <p><span className="font-medium">Blatt:</span> {scanResult.sheet || '–'}{scanResult.sheets && scanResult.sheets.length > 1 && <select aria-label="Tabellenblatt auswählen" value={scanResult.sheet} onChange={event => void scanFile(scannedFile, event.target.value)} className="form-input ml-2 max-w-full py-1 text-sm">{scanResult.sheets.map(name => <option key={name} value={name}>{name}</option>)}</select>}</p>
            <p><span className="font-medium">Analyse:</span> {scanResult.headers.length} Spalten · {scanResult.rows.length.toLocaleString('de-DE')} Zeilen</p>
          </div>
          <p className="break-all text-xs text-gray-500"><span className="font-medium">SHA-256:</span> {scanResult.hash || 'nicht verfügbar'}</p>
          {scanResult.warnings.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-medium">Hinweise zur Datei</p><ul className="mt-1 list-disc pl-5">{scanResult.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>}
          <div>
            <h3 className="font-semibold text-gray-900">Erkannte Kategorien</h3>
            {scanCandidates.length === 0 ? <p className="mt-2 text-sm text-gray-600">Es wurde keine Kategorie sicher genug erkannt. Bitte prüfen Sie Kopfzeile und Spalten manuell; es wird nichts automatisch zugeordnet.</p> : <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
              {scanCandidates.map(candidate => <li key={candidate.resource} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h4 className="font-medium text-gray-900">{candidate.label}</h4><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{candidate.confidence === 'high' ? 'Hohe' : candidate.confidence === 'medium' ? 'Mittlere' : 'Niedrige'} Konfidenz · {candidate.score} %</span></div>
                  <p className="mt-1 text-sm text-gray-600">{candidate.reason}</p>
                  <p className="mt-1 text-xs text-gray-500">Zeilen mit passenden Werten: {candidate.matchedRowCount.toLocaleString('de-DE')} von {scanResult.rows.length.toLocaleString('de-DE')}{candidate.matchedRowNumbers.length > 0 ? ` · z. B. ${candidate.matchedRowNumbers.slice(0, 8).join(', ')}` : ''}</p>
                  <p className="mt-1 text-xs text-gray-500">Passende Spalten: {candidate.matchedColumns.join(', ') || 'keine'}</p>
                  {candidate.unclearColumns.length > 0 && <p className="mt-1 text-xs text-amber-800">In dieser Kategorie unklar: {candidate.unclearColumns.join(', ')}</p>}
                  {candidate.overlaps.length > 0 && <p className="mt-1 text-sm text-amber-800">Überschneidung prüfen: {candidate.overlaps.map(resource => `${getImportDefinition(resource).label}${candidate.overlapRows[resource]?.length ? ` (Zeile${candidate.overlapRows[resource]!.length === 1 ? '' : 'n'} ${candidate.overlapRows[resource]!.slice(0, 8).join(', ')})` : ''}`).join('; ')}. {['euerEntries', 'invoicePayments', 'invoices'].includes(candidate.resource) ? 'Geldzeilen werden nicht automatisch doppelt vorgeschlagen.' : 'Bitte prüfen Sie, welche Zuordnung zu den gemeinsamen Zeilen passt.'}</p>}
                </div>
                <button type="button" onClick={() => openCandidate(candidate.resource)} disabled={!canImportResource(candidate.resource)} className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50">Zuordnung prüfen</button>
              </li>)}
            </ul>}
          </div>
          <div className="flex flex-col gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:items-end">
            <label className="text-sm font-medium text-gray-700">Andere Kategorie nach Scan manuell prüfen
              <select value={manualScanResource} onChange={event => setManualScanResource(event.target.value as ImportResource | '')} className="form-input mt-1 block w-full sm:w-72">
                <option value="">Kategorie auswählen …</option>
                {steps.flatMap(step => step.resources).map(item => <option key={item.resource} value={item.resource} disabled={!canImportResource(item.resource)}>{item.label}{!canImportResource(item.resource) ? ' (keine Berechtigung)' : ''}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => manualScanResource && openCandidate(manualScanResource)} disabled={!manualScanResource || !canImportResource(manualScanResource)} className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50">Manuelle Zuordnung öffnen</button>
          </div>
          {allUnclearColumns.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-medium">Noch nicht erkannte Spalten</p><p className="mt-1">{allUnclearColumns.join(', ')}</p><p className="mt-1 text-xs">Sie bleiben im Importassistenten sichtbar und müssen dort ausdrücklich zugeordnet oder freigelassen werden.</p></div>}
        </div>}
      </section>

      <section className="guidance-panel p-5 text-sm leading-6">
        <h2 className="text-base font-semibold text-gray-900">So gelingt der Umzug</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Prüfen Sie die Datei zuerst und öffnen Sie danach jede erkannte Kategorie einzeln zur Feldzuordnung.</li>
          <li>Die Summenkontrolle zeigt Einnahmen und Ausgaben je Monat zum Abgleich mit Ihrer Tabelle.</li>
          <li>Bis Sie den Umzug abschließen, lässt sich jeder Import vollständig rückgängig machen.</li>
        </ol>
      </section>

      {loadError && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{loadError}</div>}

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><CalendarCheck className="h-5 w-5 text-primary-custom" /> Stichtag</h2>
            <p className="mt-1 text-sm text-gray-600">Ab diesem Tag arbeiten Sie mit SoloOffice. Importierte Buchungen und Rechnungen ab dem Stichtag werden in der Vorschau markiert, damit nichts doppelt erfasst wird. Für eine vollständige EÜR sollte das laufende Jahr bis zum Stichtag übernommen werden.</p>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-sm font-medium text-gray-700">
              Stichtag
              <LocalizedDateInput aria-label="Stichtag" value={cutoverDate} onChange={setCutoverDate} locale={company.locale || 'de-DE'} dateFormat={company.dateFormat} className="form-input mt-1 w-48" />
            </label>
            <button type="button" onClick={saveCutover} disabled={!canAdmin || cutoverDate === savedCutoverDate} className="btn-primary min-h-11 rounded-lg px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50" title={canAdmin ? undefined : 'Nur Administratoren können den Stichtag festlegen'}>
              Speichern
            </button>
          </div>
        </div>
      </section>

      <section aria-labelledby="import-steps-title">
        <h2 id="import-steps-title" className="mb-3 text-lg font-semibold text-gray-900">Vorlagen je Einzelkategorie</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {steps.map((step, index) => {
            const imported = step.resources.reduce((sum, item) => sum + importedCount(item.resource), 0);
            return (
              <article key={step.id} className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-custom text-sm font-semibold text-white">{index + 1}</span>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900">{step.title}</h3>
                    <p className="mt-1 text-sm text-gray-600">{step.description}</p>
                  </div>
                </div>
                <div className="mt-auto pt-4">
                  {imported > 0 && <p className="mb-2 text-xs text-gray-500">Bisher übernommen: {imported.toLocaleString('de-DE')}</p>}
                  <div className="flex flex-wrap gap-2">
                    {step.resources.map(item => (
                      <div key={item.resource} className="inline-flex overflow-hidden rounded-lg border border-gray-300">
                        <span className="bg-white px-3 py-1.5 text-sm text-gray-700">{item.label}</span>
                        <button type="button" onClick={() => templateFor(item.resource, item.label)} className="border-l border-gray-300 bg-white px-2 text-gray-500 hover:bg-gray-50 hover:text-gray-800" aria-label={`Vorlage für ${item.label} herunterladen`} title="Vorlage herunterladen">
                          <Download className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm" aria-labelledby="import-history-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-5">
          <h2 id="import-history-title" className="flex items-center gap-2 text-lg font-semibold text-gray-900"><History className="h-5 w-5 text-primary-custom" /> Importverlauf</h2>
          {pendingRuns.length > 0 && <span className="text-sm text-amber-800">{pendingRuns.length} {pendingRuns.length === 1 ? 'Import ist' : 'Importe sind'} noch nicht abgeschlossen</span>}
        </div>
        {loading ? (
          <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
        ) : runs.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">Noch keine Importe. Starten Sie oben mit Ihrer ersten Datei.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {runs.map(run => (
              <li key={run.id} className="flex flex-col gap-3 p-4 tablet:flex-row tablet:items-center tablet:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{run.resourceLabel}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses[run.status]}`}>{statusLabels[run.status]}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-gray-600" title={run.fileName}>
                    <FileText className="mr-1 inline h-3.5 w-3.5" />{run.fileName || 'Ohne Dateiname'} · {formatDateTime(run.createdAt)}{run.createdByName ? ` · ${run.createdByName}` : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {Number(run.summary?.imported || 0).toLocaleString('de-DE')} übernommen
                    {run.summary?.newCustomers ? ` · ${run.summary.newCustomers === 1 ? `1 neuer ${terminology.entity.singular}` : `${run.summary.newCustomers} neue ${terminology.entity.plural}`}` : ''}
                    {run.summary?.duplicates ? ` · ${run.summary.duplicates} Duplikate` : ''}
                    {run.summary?.errors ? ` · ${run.summary.errors} Fehler` : ''}
                    {run.status === 'confirmed' && run.confirmedAt ? ` · abgeschlossen ${formatDateTime(run.confirmedAt)}` : ''}
                    {run.status === 'reverted' && run.revertedAt ? ` · rückgängig ${formatDateTime(run.revertedAt)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button type="button" onClick={() => void openProtocol(run)} disabled={busyId !== null} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">Protokoll</button>
                  {run.status === 'pending' && canWrite && (
                    <>
                      <button type="button" onClick={() => void revert(run)} disabled={busyId !== null} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
                        {busyId === run.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Rückgängig
                      </button>
                      <button type="button" onClick={() => void confirmRun(run)} disabled={busyId !== null} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">Abschließen</button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-gray-500">
        Übernommene Daten sind vorbereitende Unterlagen. Originalbelege und bereits versendete Rechnungen bewahren Sie weiterhin gemäß den gesetzlichen Fristen auf; zu übernommenen Rechnungen kann das Original-PDF hinterlegt werden.
        {onNavigate && <> Ergebnis prüfen: <button type="button" className="font-medium text-primary-custom hover:underline" onClick={() => onNavigate('euer')}>EÜR</button>{company.reportingEnabled && <> · <button type="button" className="font-medium text-primary-custom hover:underline" onClick={() => onNavigate('reporting')}>Auswertungen</button></>}</>}
      </p>

      {wizardResource && (
        <ImportWizard
          resource={wizardResource}
          isOpen
          initialFile={wizardSourceFile || undefined}
          initialSheet={wizardSheet}
          onClose={() => { setWizardResource(null); setWizardSourceFile(null); setWizardSheet(undefined); }}
          onImported={async () => {
            await Promise.all([load(), refreshData(wizardResource)]);
          }}
        />
      )}

      {protocolRun && (
        <DialogShell
          title={`Protokoll: ${protocolRun.resourceLabel}`}
          description={`${protocolRun.fileName || 'Ohne Dateiname'} · ${formatDateTime(protocolRun.createdAt)}`}
          icon={History}
          titleId="import-protocol-title"
          onClose={() => setProtocolRun(null)}
          size="wide"
          fitContent
          footer={<div className="flex justify-end"><button type="button" onClick={() => setProtocolRun(null)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Schließen</button></div>}
        >
          <ImportResultTable rows={protocolRun.report || []} />
        </DialogShell>
      )}
    </div>
  );
}
