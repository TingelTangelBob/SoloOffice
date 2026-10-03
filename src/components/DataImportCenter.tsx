import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Download, FileText, History, Loader2, RotateCcw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import { useCustomers } from '../context/CustomerContext';
import { useFeedback } from '../context/FeedbackContext';
import { useInvoices } from '../context/InvoiceContext';
import { useJobs } from '../context/JobContext';
import { useQuotes } from '../context/QuoteContext';
import { apiService } from '../services/api';
import type { EuerEntry, ImportResource, ImportRun, TakeoverStatus } from '../types';
import { buildImportTemplate, detectImportResources, getImportDefinition, parseImportFile, analyseHeaderMapping, type ImportResourceCandidate, type ParsedImportFile } from '../utils/importParser';
import { getTerminology } from '../utils/terminology';
import { isValidTakeoverOrder, planTakeoverDependencies } from '../../backend/utils/takeoverDependencies.js';
import { DialogShell } from './DialogShell';
import { ImportResultTable, ImportWizard } from './ImportWizard';
import { LocalizedDateInput } from './LocalizedDateInput';
import { InfoTooltip } from './InfoTooltip';
import { PageHeader } from './PageHeader';

interface DataImportCenterProps {
  onNavigate?: (page: string, filter?: string) => void;
}

interface ImportStepCard {
  id: string;
  title: string;
  description: string;
  help?: string;
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

const confidencePresentation: Record<ImportResourceCandidate['confidence'], { label: string; className: string }> = {
  high: { label: 'Gute Übereinstimmung', className: 'bg-green-100 text-green-800' },
  medium: { label: 'Teilweise erkannt', className: 'bg-amber-100 text-amber-900' },
  low: { label: 'Unsicher', className: 'bg-gray-100 text-gray-700' },
};

function categoryStatus(opts: {
  completed: boolean;
  skipped: boolean;
  blocked: string | null;
  isNext: boolean;
}): { label: string; className: string } {
  if (opts.completed) return { label: 'Übernommen', className: 'text-green-800' };
  if (opts.skipped) return { label: 'Übersprungen', className: 'text-gray-500' };
  if (opts.blocked) return { label: 'Gesperrt', className: 'text-red-800' };
  if (opts.isNext) return { label: 'Als Nächstes', className: 'text-primary-custom' };
  return { label: 'Offen', className: 'text-gray-700' };
}

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
  const { customers, refreshCustomers } = useCustomers();
  const { invoices, refreshInvoices } = useInvoices();
  const { jobEntries, refreshJobEntries } = useJobs();
  const { quotes, refreshQuotes } = useQuotes();
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
  const [wizardSelectedRowNumbers, setWizardSelectedRowNumbers] = useState<number[] | undefined>(undefined);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scannedFile, setScannedFile] = useState<File | null>(null);
  const [scanResult, setScanResult] = useState<ParsedImportFile | null>(null);
  const [scanCandidates, setScanCandidates] = useState<ImportResourceCandidate[]>([]);
  const [scannedEuerEntries, setScannedEuerEntries] = useState<EuerEntry[]>([]);
  const [skippedCategories, setSkippedCategories] = useState<ImportResource[]>([]);
  const [dependencyOrder, setDependencyOrder] = useState<string[]>([]);
  const [editedCustomerNames, setEditedCustomerNames] = useState<Record<string, string>>({});
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
      description: 'Namen, Adressen und Nummern für die Zuordnung in anderen Kategorien.',
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
      description: 'Bestehende Rechnungen mit ihrer ursprünglichen Nummer.',
      help: 'Offene Rechnungen bleiben offen und können gemahnt werden. Das Original-PDF können Sie anschließend an der Rechnung hinterlegen.',
      resources: [{ resource: 'invoices', label: 'Rechnungen' }],
    },
    {
      id: 'money',
      title: 'Einnahmen und Ausgaben',
      description: 'Einnahmen und Ausgaben aus Ihrer bisherigen Tabelle.',
      help: 'Einnahmen zu vorhandenen Rechnungen werden als deren Zahlung gebucht, alle übrigen als Einnahme ohne Rechnung.',
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
        ? `Vergangene und geplante ${terminology.work.plural}${company.quotesEnabled ? ' sowie Angebote' : ''}.`
        : 'Offene oder angenommene Angebote mit ihren Positionen.',
      help: company.jobTrackingEnabled
        ? 'Bereits abgerechnete Termine können als abgerechnet übernommen werden. Wiederholungen legen Serien an.'
        : undefined,
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

  const completeTakeover = async () => {
    if (!takeover?.session || takeover.session.status !== 'open') return;
    const accepted = await confirm({
      title: takeover.session.legacyBackfill ? 'Historischen Marker schließen?' : 'Umzug abschließen?',
      message: takeover.session.legacyBackfill
        ? 'Der historische Sitzungsmarker wird endgültig geschlossen. Frühere Importläufe werden dabei weder bestätigt noch gelöscht und bleiben separat verwaltbar. Der einmalige Start bleibt dauerhaft verbraucht.'
        : 'Damit wird die Umzugssitzung endgültig abgeschlossen. Noch offene Importe werden bestätigt und können danach nicht mehr rückgängig gemacht werden. Der einmalige Start bleibt dauerhaft verbraucht.',
      confirmText: takeover.session.legacyBackfill ? 'Marker schließen' : 'Umzug abschließen',
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
    setScannedEuerEntries([]);
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
      const candidates = detectImportResources(parsed);
      const euerEntries = candidates.some(candidate => ['invoicePayments', 'euerEntries'].includes(candidate.resource))
        ? await apiService.getEuerEntries()
        : [];
      setScannedFile(file);
      setScanResult(parsed);
      setScanCandidates(candidates);
      setScannedEuerEntries(euerEntries);
      setSkippedCategories([]);
      setDependencyOrder([]);
      setEditedCustomerNames({});
      setManualScanResource('');
    } catch (error) {
      setScannedFile(null);
      setScanResult(null);
      setScanCandidates([]);
      setScannedEuerEntries([]);
      setScanError(error instanceof Error ? error.message : 'Die Datei konnte nicht geprüft werden.');
    } finally {
      setScanBusy(false);
    }
  };

  const openCandidate = (resource: ImportResource) => {
    if (!scannedFile || takeover?.session?.status !== 'open' || takeover.session.legacyBackfill) return;
    const node = dependencyPlan?.nodes.find(item => item.resource === resource && !item.synthetic);
    if (node?.blockedReason) {
      notify({ variant: 'error', title: 'Kategorie noch gesperrt', message: node.blockedReason });
      return;
    }
    const unmetDependency = node?.dependencies.find(dependency => {
      if (dependency === 'suggestedCustomers') return false;
      return !completedCategory(dependency as ImportResource);
    });
    if (unmetDependency) {
      const label = getImportDefinition(unmetDependency as ImportResource).label;
      notify({ variant: 'error', title: 'Kategorie noch gesperrt', message: `Übernehmen Sie zuerst die Voraussetzung „${label}“.` });
      return;
    }
    const candidate = scanCandidates.find(item => item.resource === resource);
    setWizardSourceFile(scannedFile);
    setWizardSheet(scanResult?.sheet);
    setWizardSelectedRowNumbers(candidate?.matchedRowNumbers.length ? candidate.matchedRowNumbers : undefined);
    setWizardResource(resource);
  };

  const dependencyPlan = useMemo(() => {
    if (!scanResult || !scanCandidates.length) return null;
    const categories = scanCandidates.map(candidate => {
      const definition = getImportDefinition(candidate.resource);
      const mapping = analyseHeaderMapping(scanResult.headers, definition).mapping;
      const rows = scanResult.rows.map((sourceRow, index) => {
        const mapped: Record<string, string | number> = { _rowNumber: scanResult.rowNumbers?.[index] ?? index + 2 };
        for (const [field, header] of Object.entries(mapping)) {
          if (sourceRow[header] !== undefined) mapped[field] = sourceRow[header];
        }
        return mapped;
      });
      return { resource: candidate.resource, label: candidate.label, rows };
    });
    return planTakeoverDependencies(categories, {
      entityLabel: terminology.entity.singular,
      workLabel: terminology.work.singular,
      customers: customers as unknown as Array<Record<string, unknown>>,
      invoices: invoices as unknown as Array<Record<string, unknown>>,
      euerEntries: scannedEuerEntries as unknown as Array<Record<string, unknown>>,
      jobs: jobEntries as unknown as Array<Record<string, unknown>>,
      quotes: quotes as unknown as Array<Record<string, unknown>>,
    }, skippedCategories);
  }, [customers, invoices, jobEntries, quotes, scanCandidates, scanResult, scannedEuerEntries, skippedCategories, terminology]);

  const dependencyNodes = useMemo(() => {
    if (!dependencyPlan) return [];
    const order = dependencyOrder.length && isValidTakeoverOrder(dependencyPlan.nodes, dependencyOrder)
      ? dependencyOrder
      : dependencyPlan.nodes.map(node => node.id);
    return [...dependencyPlan.nodes].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }, [dependencyOrder, dependencyPlan]);

  const moveDependency = (nodeId: string, offset: -1 | 1) => {
    const current = dependencyNodes.map(node => node.id);
    const from = current.indexOf(nodeId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= current.length) return;
    [current[from], current[to]] = [current[to], current[from]];
    if (dependencyPlan && isValidTakeoverOrder(dependencyPlan.nodes, current)) setDependencyOrder(current);
  };

  const allUnclearColumns = scanResult
    ? scanResult.headers.filter(header => !scanCandidates.some(candidate => candidate.matchedColumns.includes(header)))
    : [];
  const hasImportPermission = (resource: ImportResource) => canWrite && (!steps.find(step => step.resources.some(item => item.resource === resource))?.adminOnly || canAdmin);
  const canImportResource = (resource: ImportResource) => hasImportPermission(resource) && takeover?.session?.status === 'open' && !takeover.session.legacyBackfill;
  const completedCategory = (resource: ImportResource) => runs.some(run => run.migrationSessionId === takeover?.session?.id && run.resource === resource && run.status !== 'reverted');
  const categoryBlockReason = (resource: ImportResource) => {
    const node = dependencyPlan?.nodes.find(item => item.resource === resource && !item.synthetic);
    if (node?.blockedReason) return node.blockedReason;
    const dependency = node?.dependencies.find(item => item !== 'suggestedCustomers' && !completedCategory(item as ImportResource));
    return dependency ? `Übernehmen Sie zuerst die Voraussetzung „${getImportDefinition(dependency as ImportResource).label}“.` : null;
  };
  const activeCategories = scanCandidates.filter(candidate => !skippedCategories.includes(candidate.resource) || completedCategory(candidate.resource));
  const completedCategoryCount = activeCategories.filter(candidate => completedCategory(candidate.resource)).length;
  const nextOpenCategory = dependencyNodes.find(node => !node.synthetic && !node.skipped && !completedCategory(node.resource) && canImportResource(node.resource) && !categoryBlockReason(node.resource));

  return (
    <div className="page-root space-y-6">
      <PageHeader title="Datenübernahme" />

      {takeover && <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Umzugsstatus">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">Umzugsstatus</h2>
            {takeover.demoMode && <p className="mt-1 text-xs font-medium text-amber-800">Demo: Status nur in dieser Browser-Sitzung.</p>}
            {takeover.session?.status === 'completed'
              ? <p className="mt-1 text-sm text-gray-600">{takeover.session.legacyBackfill ? 'Historischer Marker geschlossen.' : `Abgeschlossen am ${formatDateTime(takeover.session.completedAt)}.`} Kein neuer Umzug möglich.</p>
              : takeover.session?.legacyBackfill
                ? <p className="mt-1 text-sm text-gray-600">Altbestand belegt den einmaligen Start. Marker kann geschlossen werden.</p>
                : takeover.session?.status === 'open'
                ? <p className="mt-1 text-sm text-gray-600">Offen seit {formatDateTime(takeover.session.startedAt)}.</p>
                : <p className="mt-1 text-sm text-gray-600">Noch nicht gestartet. Sie können Ihre Datei zuerst prüfen.</p>}
          </div>
          {!takeover.session && canAdmin && <button type="button" onClick={startTakeover} disabled={busyId !== null} className="btn-primary inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium disabled:opacity-50">
            {busyId === 'takeover-start' && <Loader2 className="h-4 w-4 animate-spin" />}Datenübernahme starten
          </button>}
          {takeover.session?.status === 'open' && canAdmin && <button type="button" onClick={completeTakeover} disabled={busyId !== null} className="btn-primary inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium disabled:opacity-50">
            {busyId === 'takeover' && <Loader2 className="h-4 w-4 animate-spin" />}{takeover.session.legacyBackfill ? 'Altbestandsmarker schließen' : 'Umzug abschließen'}
          </button>}
        </div>
      </section>}

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="takeover-scan-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 id="takeover-scan-title" className="text-lg font-semibold text-gray-900">1. Datei prüfen</h2>
            <p className="mt-1 text-sm text-gray-600">Datei lokal lesen und serverseitig prüfen – ohne Fachdaten zu speichern.</p>
          </div>
          <button type="button" onClick={() => scanInputRef.current?.click()} disabled={scanBusy} className="btn-primary inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium disabled:opacity-50">
            {scanBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}{scanBusy ? 'Datei wird geprüft …' : scannedFile ? 'Andere Datei prüfen' : 'Datei auswählen und prüfen'}
          </button>
          <input ref={scanInputRef} className="hidden" aria-label="Datei für die Datenübernahme" type="file" accept=".csv,.tsv,.txt,.json,.xlsx,.xlsm,.xls,.ods,.numbers" onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void scanFile(file);
          }} />
        </div>
        {takeover?.session?.status === 'open' && !takeover.session.legacyBackfill && !scanResult && (
          <p className="mt-3 text-sm text-gray-600">Wählen Sie die Datei erneut aus, um fortzufahren.</p>
        )}
        {scanError && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{scanError}</p>}
        {scanResult && scannedFile && <div key={`${scanResult.hash}-${scanResult.sheet}`} className="mt-4 space-y-4 border-t border-gray-100 pt-4">
          <div className="grid gap-3 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Datei</p><p className="mt-0.5 truncate font-medium" title={scanResult.fileName}>{scanResult.fileName}</p></div>
            <div><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Typ / Größe</p><p className="mt-0.5">{scanResult.format.toUpperCase()} · {(scannedFile.size / 1024).toLocaleString('de-DE', { maximumFractionDigits: 0 })} KB</p></div>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Blatt</p>
              {scanResult.sheets && scanResult.sheets.length > 1
                ? <select aria-label="Tabellenblatt auswählen" value={scanResult.sheet} onChange={event => void scanFile(scannedFile, event.target.value)} className="form-input mt-0.5 w-full py-1.5 text-sm">{scanResult.sheets.map(name => <option key={name} value={name}>{name}</option>)}</select>
                : <p className="mt-0.5">{scanResult.sheet || '–'}</p>}
            </div>
            <div><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Inhalt</p><p className="mt-0.5">{scanResult.headers.length} Spalten · {scanResult.rows.length.toLocaleString('de-DE')} Zeilen</p></div>
          </div>
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer select-none font-medium text-gray-600 hover:text-gray-800">Technische Dateidetails</summary>
            <p className="mt-2 break-all"><span className="font-medium">SHA-256:</span> {scanResult.hash || 'nicht verfügbar'}</p>
          </details>
          {scanResult.warnings.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-medium">Hinweise zur Datei</p><ul className="mt-1 list-disc pl-5">{scanResult.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>}

          <div>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="font-semibold text-gray-900">Erkannte Kategorien</h3>
                {takeover?.session?.status === 'open' && !takeover.session.legacyBackfill && (
                  <p className="mt-1 text-sm text-gray-600">{completedCategoryCount} von {activeCategories.length} übernommen · jede Kategorie einzeln prüfen und freigeben</p>
                )}
              </div>
            </div>
            {scanCandidates.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">Keine Kategorie sicher erkannt. Kopfzeile prüfen oder unten manuell zuordnen.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {scanCandidates.map(candidate => {
                  const blocked = categoryBlockReason(candidate.resource);
                  const completed = completedCategory(candidate.resource);
                  const skipped = skippedCategories.includes(candidate.resource) && !completed;
                  const isNext = nextOpenCategory?.resource === candidate.resource;
                  const status = categoryStatus({ completed, skipped, blocked, isNext });
                  const confidence = confidencePresentation[candidate.confidence];
                  const actionLabel = completed ? 'Übernommen'
                    : skipped ? 'Übersprungen'
                    : !hasImportPermission(candidate.resource) ? 'Keine Berechtigung'
                    : blocked ? 'Voraussetzung fehlt'
                    : 'Zuordnung prüfen';
                  const summaryParts = [
                    `${candidate.matchedRowCount.toLocaleString('de-DE')} passende Zeilen`,
                    candidate.matchedColumns.length ? `${candidate.matchedColumns.length} Spalten` : null,
                    candidate.overlaps.length ? `${candidate.overlaps.length} Überschneidung${candidate.overlaps.length === 1 ? '' : 'en'}` : null,
                  ].filter(Boolean);
                  return (
                    <li key={candidate.resource} className={`rounded-xl border p-4 ${isNext ? 'border-primary-custom bg-[var(--accent-tint)]' : 'border-gray-200 bg-white'}`}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-base font-semibold text-gray-900">{candidate.label}</h4>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${confidence.className}`}>{confidence.label}</span>
                            <span className={`text-xs font-semibold ${status.className}`}>{status.label}</span>
                          </div>
                          {blocked && !completed && !skipped && <p className="text-sm text-red-800">{blocked}</p>}
                          {skipped && <p className="text-sm text-gray-600">Unter „Reihenfolge und Abhängigkeiten“ wieder aktivieren.</p>}
                          <p className="text-sm text-gray-600">{summaryParts.join(' · ')}</p>
                          <details className="text-xs text-gray-600">
                            <summary className="w-fit cursor-pointer rounded font-medium hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-color)]">Details</summary>
                            <div className="mt-2 space-y-2 break-words rounded-lg border border-gray-100 bg-gray-50 p-3">
                              <p>{candidate.reason}</p>
                              <p>Zeilen mit passenden Werten: {candidate.matchedRowCount.toLocaleString('de-DE')} von {scanResult.rows.length.toLocaleString('de-DE')}{candidate.matchedRowNumbers.length > 0 ? ` · Beispiele: ${candidate.matchedRowNumbers.slice(0, 8).join(', ')}` : ''}</p>
                              <p>Passende Spalten: {candidate.matchedColumns.join(', ') || 'keine'}</p>
                              {candidate.unclearColumns.length > 0 && <p className="text-amber-800">Unklar: {candidate.unclearColumns.join(', ')}</p>}
                              {candidate.overlaps.length > 0 && (
                                <div className="text-amber-900">
                                  <p className="font-medium">Überschneidung mit:</p>
                                  <ul className="mt-1 list-disc pl-4">
                                    {candidate.overlaps.map(resource => (
                                      <li key={resource}>
                                        {getImportDefinition(resource).label}
                                        {candidate.overlapRows[resource]?.length
                                          ? ` · ${candidate.overlapRows[resource]!.length.toLocaleString('de-DE')} gemeinsame Zeilen`
                                          : ''}
                                      </li>
                                    ))}
                                  </ul>
                                  <p className="mt-1">{['euerEntries', 'invoicePayments', 'invoices'].includes(candidate.resource) ? 'Geldzeilen werden nicht automatisch doppelt vorgeschlagen.' : 'Bitte prüfen, welche Zuordnung zu den gemeinsamen Zeilen passt.'}</p>
                                </div>
                              )}
                            </div>
                          </details>
                        </div>
                        <button
                          type="button"
                          onClick={() => openCandidate(candidate.resource)}
                          disabled={!canImportResource(candidate.resource) || completed || skipped || Boolean(blocked)}
                          aria-label={`${actionLabel}: ${candidate.label}`}
                          className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-color)] disabled:cursor-not-allowed disabled:opacity-50 ${completed ? 'border border-green-200 bg-green-50 text-green-800' : blocked || skipped ? 'border border-gray-200 bg-gray-100 text-gray-500' : 'btn-primary'}`}
                        >
                          {completed && <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}{actionLabel}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {dependencyPlan && <details className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <summary className="cursor-pointer select-none font-semibold text-gray-900">Reihenfolge und Abhängigkeiten</summary>
            <p className="mt-2 text-sm text-gray-600">Reihenfolge anpassen und Kategorien bei Bedarf überspringen. Voraussetzungen bleiben dabei erhalten.</p>
            <ol className="mt-3 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
              {dependencyNodes.map((node, index) => {
                const prerequisiteLabels = node.dependencies.map(dependency => dependencyNodes.find(item => item.id === dependency)?.label || dependency);
                return <li key={node.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-gray-500">{index + 1}.</span>
                      <span className="font-medium text-gray-900">{node.label}</span>
                      {node.skipped && <span className="text-xs font-medium text-gray-600">Übersprungen</span>}
                      {node.dependencies.length > 0 && <span className="text-xs text-gray-600">Voraussetzung: {prerequisiteLabels.join(', ')}</span>}
                    </div>
                    {node.blockedReason && <p className="mt-1 text-sm text-red-800">Blockiert: {node.blockedReason}</p>}
                    {node.id === 'suggestedCustomers' && <p className="mt-1 text-sm text-gray-600">Namen aus anderen Kategorien, die keinem vorhandenen Kunden zugeordnet werden konnten.</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {!node.synthetic && <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={node.skipped} onChange={event => setSkippedCategories(current => event.target.checked
                        ? [...new Set([...current, node.resource])]
                        : current.filter(resource => resource !== node.resource))} />
                      Überspringen
                    </label>}
                    <div className="flex gap-1">
                      <button type="button" onClick={() => moveDependency(node.id, -1)} disabled={index === 0} aria-label={`${node.label} nach oben verschieben`} className="rounded border border-gray-300 p-2 text-gray-700 disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>
                      <button type="button" onClick={() => moveDependency(node.id, 1)} disabled={index === dependencyNodes.length - 1} aria-label={`${node.label} nach unten verschieben`} className="rounded border border-gray-300 p-2 text-gray-700 disabled:opacity-40"><ArrowDown className="h-4 w-4" /></button>
                    </div>
                  </div>
                </li>;
              })}
            </ol>
            {dependencyPlan.proposedCustomers.length > 0 && <div className="mt-4 border-t border-gray-200 pt-3">
              <h4 className="font-medium text-gray-900">Kunden aus Folgedaten</h4>
              <p className="mt-1 text-sm text-gray-600">Prüfen Sie die vorgeschlagenen Namen vor der Übernahme.</p>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {dependencyPlan.proposedCustomers.map(customer => <li key={customer.key} className="rounded-lg border border-gray-200 bg-white p-3">
                  <label className="block text-sm font-medium text-gray-700">Name
                    <input type="text" value={editedCustomerNames[customer.key] ?? customer.name} onChange={event => setEditedCustomerNames(current => ({ ...current, [customer.key]: event.target.value }))} className="form-input mt-1 block w-full" />
                  </label>
                  <p className="mt-1 text-xs text-gray-500">Quelle: {customer.sources.map(source => getImportDefinition(source as ImportResource).label).join(', ')}</p>
                </li>)}
              </ul>
            </div>}
          </details>}

          <div className="grid gap-3 border-t border-gray-100 pt-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="block text-sm font-medium text-gray-700">Andere Kategorie manuell prüfen
              <select value={manualScanResource} onChange={event => setManualScanResource(event.target.value as ImportResource | '')} className="form-input mt-1 block w-full">
                <option value="">Kategorie auswählen …</option>
                {steps.flatMap(step => step.resources).map(item => <option key={item.resource} value={item.resource} disabled={!hasImportPermission(item.resource)}>{item.label}{!hasImportPermission(item.resource) ? ' (keine Berechtigung)' : ''}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => manualScanResource && openCandidate(manualScanResource)} disabled={!manualScanResource || !canImportResource(manualScanResource)} className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50">Zuordnung öffnen</button>
          </div>
          {allUnclearColumns.length > 0 && (
            <details className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <summary className="cursor-pointer font-medium">Noch nicht erkannte Spalten ({allUnclearColumns.length})</summary>
              <p className="mt-2">{allUnclearColumns.join(', ')}</p>
              <p className="mt-1 text-xs">Im Assistenten zuordnen oder freilassen.</p>
            </details>
          )}
        </div>}
      </section>

      <details className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <summary className="cursor-pointer rounded text-base font-semibold text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-color)]">Kurzanleitung</summary>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-gray-700">
            <li>Datei prüfen, dann jede erkannte Kategorie einzeln zuordnen.</li>
            <li>Summenkontrolle mit Ihrer Tabelle abgleichen.</li>
            <li>Umzug abschließen, wenn alles passt. Bis dahin lassen sich offene Importe rückgängig machen.</li>
          </ol>
      </details>

      {loadError && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{loadError}</div>}

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <InfoTooltip align="start" label="Hinweis zum Stichtag" text="Buchungen und Rechnungen ab dem Stichtag werden in der Vorschau markiert, damit nichts doppelt erfasst wird. Übernehmen Sie für eine vollständige EÜR auch die Daten des laufenden Jahres vor dem Stichtag." />
              Stichtag
            </h2>
            <p className="mt-1 text-sm text-gray-600">Ab diesem Datum arbeiten Sie mit SoloOffice.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm font-medium text-gray-700">
              Datum
              <LocalizedDateInput aria-label="Stichtag" value={cutoverDate} onChange={setCutoverDate} locale={company.locale || 'de-DE'} dateFormat={company.dateFormat} className="form-input mt-1 w-44" />
            </label>
            <button type="button" onClick={saveCutover} disabled={!canAdmin || cutoverDate === savedCutoverDate} className="btn-primary min-h-11 rounded-lg px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50" title={canAdmin ? undefined : 'Nur Administratoren können den Stichtag festlegen'}>
              Speichern
            </button>
          </div>
        </div>
      </section>

      <section aria-labelledby="import-steps-title">
        <div className="mb-3 flex items-center gap-2">
          <InfoTooltip align="start" label="Hinweis zu Importvorlagen" text="CSV-Vorlagen zum Ausfüllen, auch in Excel. Sie können ebenso Ihre eigene Datei prüfen." />
          <h2 id="import-steps-title" className="text-lg font-semibold text-gray-900">Vorlagen</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[...steps].sort((a, b) => a.title.localeCompare(b.title, 'de')).map(step => {
            const imported = step.resources.reduce((sum, item) => sum + importedCount(item.resource), 0);
            return (
              <article key={step.id} className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <h3 className="font-semibold text-gray-900">{step.title}</h3>
                <p className="mt-1 text-sm text-gray-600">{step.description}</p>
                {step.help && <details className="mt-2 text-xs text-gray-600">
                  <summary className="w-fit cursor-pointer rounded font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-color)]">Hinweise</summary>
                  <p className="mt-1">{step.help}</p>
                </details>}
                <div className="mt-auto pt-4">
                  {imported > 0 && <p className="mb-2 text-xs text-gray-500">Bisher übernommen: {imported.toLocaleString('de-DE')}</p>}
                  <div className="flex flex-wrap gap-2">
                    {step.resources.map(item => (
                      <button
                        key={item.resource}
                        type="button"
                        onClick={() => templateFor(item.resource, item.label)}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-color)]"
                        aria-label={`Vorlage für ${item.label} herunterladen`}
                        title={`Vorlage für ${item.label} herunterladen`}
                      >
                        <Download className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
                        {item.label}
                      </button>
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
          initialSelectedRowNumbers={wizardSelectedRowNumbers}
          takeoverSessionId={takeover?.session?.status === 'open' && !takeover.session.legacyBackfill ? takeover.session.id : undefined}
          onClose={() => { setWizardResource(null); setWizardSourceFile(null); setWizardSheet(undefined); setWizardSelectedRowNumbers(undefined); }}
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
