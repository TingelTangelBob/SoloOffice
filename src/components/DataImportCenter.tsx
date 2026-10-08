import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CheckCircle2, Download, FileText, History, Loader2, RotateCcw, SkipForward, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import { useCustomers } from '../context/CustomerContext';
import { useFeedback } from '../context/FeedbackContext';
import { useInvoices } from '../context/InvoiceContext';
import { useJobs } from '../context/JobContext';
import { useQuotes } from '../context/QuoteContext';
import { apiService } from '../services/api';
import type { EuerEntry, ImportResource, ImportRun, TakeoverStatus } from '../types';
import {
  buildCombinedImportTemplate,
  buildImportTemplate,
  describeCombinedImportTemplate,
  detectImportResources,
  getImportDefinition,
  mapImportCandidateRows,
  parseImportFile,
  type ImportResourceCandidate,
  type ParsedImportFile,
} from '../utils/importParser';
import { getImportTemplateDocs, type ImportTemplateColumnDoc } from '../utils/importTemplateDocs';
import { getTerminology } from '../utils/terminology';
import { planTakeoverDependencies, takeoverOrderConflict } from '../../backend/utils/takeoverDependencies.js';
import { DialogShell } from './DialogShell';
import { ImportResultTable, ImportWizard } from './ImportWizard';
import { ImportStepIllustration, type ImportIllustrationStep } from './ImportStepIllustration';
import { LocalizedDateInput } from './LocalizedDateInput';
import { InfoTooltip } from './InfoTooltip';
import { PageHeader } from './PageHeader';

interface DataImportCenterProps {
  onNavigate?: (page: string, filter?: string) => void;
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

const guideSteps: Array<{ step: ImportIllustrationStep; title: string; text: string }> = [
  { step: 'upload', title: '1. Datei hochladen', text: 'Excel, CSV, TSV oder JSON. Die Datei wird im Browser gelesen und nur zur Prüfung an den Server geschickt.' },
  { step: 'detect', title: '2. Kategorien erkennen', text: 'SoloOffice erkennt, welche Kategorien in der Datei stecken, und bringt sie in die richtige Reihenfolge.' },
  { step: 'check', title: '3. Schritt für Schritt prüfen', text: 'Je Schritt Spalten prüfen, Vorschau und Summen vergleichen, dann übernehmen – oder den Schritt überspringen.' },
  { step: 'finish', title: '4. Umzug abschließen', text: 'Offene Importe können Sie vorher in umgekehrter Reihenfolge zurücknehmen. Nach dem Abschluss bleiben die übernommenen Daten bestehen.' },
];

/** Kennzeichnung einer Kategorie im Schritt-für-Schritt-Formular. */
function stepState(opts: { completed: boolean; skipped: boolean; blocked: string | null }): { label: string; className: string } {
  if (opts.completed) return { label: 'Übernommen', className: 'bg-green-100 text-green-800' };
  if (opts.skipped) return { label: 'Übersprungen', className: 'bg-gray-100 text-gray-600' };
  if (opts.blocked) return { label: 'Prüfung nötig', className: 'bg-red-100 text-red-800' };
  return { label: 'Offen', className: 'bg-amber-100 text-amber-800' };
}

function downloadCsvText(fileName: string, content: string) {
  // Byte Order Mark, damit Excel die Datei als UTF-8 öffnet.
  const blob = new Blob(['\ufeff', content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileSlug(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
  const [dragActive, setDragActive] = useState(false);
  const [scannedFile, setScannedFile] = useState<File | null>(null);
  const [scanResult, setScanResult] = useState<ParsedImportFile | null>(null);
  const [scanCandidates, setScanCandidates] = useState<ImportResourceCandidate[]>([]);
  const [scannedEuerEntries, setScannedEuerEntries] = useState<EuerEntry[]>([]);
  const [skippedCategories, setSkippedCategories] = useState<ImportResource[]>([]);
  const [dependencyOrder, setDependencyOrder] = useState<string[]>([]);
  const [orderNotice, setOrderNotice] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
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
    if (!resource || ['invoices', 'invoicePayments', 'euerEntries'].includes(resource)) tasks.push(apiService.getEuerEntries().then(setScannedEuerEntries));
    if (!resource || resource === 'jobs') tasks.push(refreshJobEntries());
    if (!resource || resource === 'quotes') tasks.push(refreshQuotes());
    if (!resource || resource === 'hourlyRates') tasks.push(apiService.getHourlyRates().then(setHourlyRates));
    if (!resource || resource === 'materials') tasks.push(apiService.getMaterialTemplates().then(setMaterialTemplates));
    if (!resource || resource === 'positions') tasks.push(apiService.getCompany().then(setCompany));
    await Promise.allSettled(tasks);
  }, [refreshCustomers, refreshInvoices, refreshJobEntries, refreshQuotes, setCompany, setHourlyRates, setMaterialTemplates]);

  /** Nur Kategorien, die zu den aktiven Modulen des Workspace passen. */
  const availableResources = useMemo<ImportResource[]>(() => ([
    'customers', 'positions', 'hourlyRates', 'materials', 'invoices', 'invoicePayments', 'euerEntries',
    ...(company.jobTrackingEnabled ? ['jobs' as const] : []),
    ...(company.quotesEnabled ? ['quotes' as const] : []),
  ]), [company.jobTrackingEnabled, company.quotesEnabled]);
  const settingsResources: ImportResource[] = ['positions', 'hourlyRates', 'materials'];

  const resourceLabel = useCallback((resource: ImportResource) => {
    if (resource === 'customers') return terminology.entity.plural;
    if (resource === 'jobs') return terminology.work.plural;
    return getImportDefinition(resource).label;
  }, [terminology]);

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
    if (loading || loadError || takeover?.takeoverUsed) return null;
    setBusyId('takeover-start');
    try {
      const status = await apiService.startTakeover();
      setTakeover(status);
      window.dispatchEvent(new Event('solooffice-takeover-status-changed'));
      notify({ variant: 'success', message: 'Die Umzugssitzung wurde gestartet.' });
      return status;
    } catch (error) {
      notify({ variant: 'error', message: error instanceof Error ? error.message : 'Der Umzug konnte nicht gestartet werden.' });
      await load();
      return null;
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

  const templateFor = (resource: ImportResource) => {
    downloadCsvText(`Vorlage-${fileSlug(resourceLabel(resource))}.csv`, buildImportTemplate(getImportDefinition(resource)));
  };

  const scanFile = async (file: File, sheet?: string) => {
    if (scanBusy || busyId !== null || loading || loadError) return;
    setScanBusy(true);
    setScanError('');
    setScannedFile(null);
    setScanResult(null);
    setScanCandidates([]);
    setScannedEuerEntries([]);
    try {
      const parsed = await parseImportFile(file, { sheet });
      if (parsed.rows.length > 5000) throw new Error('Für die Prüfung sind höchstens 5.000 Datenzeilen zulässig. Bitte teilen Sie die Datei auf.');
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
      const candidates = detectImportResources(parsed).filter(candidate => availableResources.includes(candidate.resource));
      const euerEntries = candidates.some(candidate => ['invoicePayments', 'euerEntries'].includes(candidate.resource))
        ? await apiService.getEuerEntries()
        : [];
      setScannedFile(file);
      setScanResult(parsed);
      setScanCandidates(candidates);
      setScannedEuerEntries(euerEntries);
      setSkippedCategories([]);
      setDependencyOrder([]);
      setOrderNotice('');
      setStepIndex(0);
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

  const chooseFile = (file?: File | null) => {
    if (file) void scanFile(file);
  };

  const dependencyPlan = useMemo(() => {
    if (!scanResult || !scanCandidates.length) return null;
    const categories = scanCandidates.map(candidate => ({
      resource: candidate.resource, label: resourceLabel(candidate.resource),
      rows: mapImportCandidateRows(scanResult, candidate),
    }));
    return planTakeoverDependencies(categories, {
      entityLabel: terminology.entity.singular,
      workLabel: terminology.work.singular,
      customers: customers as unknown as Array<Record<string, unknown>>,
      invoices: invoices as unknown as Array<Record<string, unknown>>,
      euerEntries: scannedEuerEntries as unknown as Array<Record<string, unknown>>,
      jobs: jobEntries as unknown as Array<Record<string, unknown>>,
      quotes: quotes as unknown as Array<Record<string, unknown>>,
    }, skippedCategories);
  }, [customers, invoices, jobEntries, quotes, resourceLabel, scanCandidates, scanResult, scannedEuerEntries, skippedCategories, terminology]);

  const dependencyNodes = useMemo(() => {
    if (!dependencyPlan) return [];
    const retainedOrder = dependencyOrder.filter(id => dependencyPlan.nodes.some(node => node.id === id));
    const proposedOrder = [...retainedOrder, ...dependencyPlan.nodes.map(node => node.id).filter(id => !retainedOrder.includes(id))];
    const order = dependencyOrder.length && takeoverOrderConflict(dependencyPlan.nodes, proposedOrder) === null
      ? proposedOrder
      : dependencyPlan.nodes.map(node => node.id);
    return [...dependencyPlan.nodes].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }, [dependencyOrder, dependencyPlan]);

  const moveDependency = (nodeId: string, offset: -1 | 1) => {
    const current = dependencyNodes.map(node => node.id);
    const from = current.indexOf(nodeId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= current.length) return;
    [current[from], current[to]] = [current[to], current[from]];
    const conflict = dependencyPlan ? takeoverOrderConflict(dependencyPlan.nodes, current) : 'Die Reihenfolge ist nicht bekannt.';
    if (conflict) {
      setOrderNotice(`Diese Reihenfolge ist nicht möglich: ${conflict}`);
      return;
    }
    setOrderNotice('');
    setDependencyOrder(current);
    setStepIndex(to);
  };

  const hasImportPermission = (resource: ImportResource) => canWrite && (!settingsResources.includes(resource) || canAdmin);
  const takeoverOpen = takeover?.session?.status === 'open' && !takeover.session.legacyBackfill;
  const canStartTakeover = !loading && !loadError && canAdmin && !takeover?.takeoverUsed;
  const canOpenImport = (resource: ImportResource) => hasImportPermission(resource) && (takeoverOpen || canStartTakeover);
  const completedCategory = (resource: ImportResource) => runs.some(run => run.migrationSessionId === takeover?.session?.id && run.resource === resource && run.status !== 'reverted');
  const categoryPrerequisiteReason = (resource: ImportResource) => {
    const node = dependencyPlan?.nodes.find(item => item.resource === resource && !item.synthetic);
    const dependency = node?.dependencies.find(item => item !== 'suggestedCustomers' && !completedCategory(item as ImportResource));
    return dependency ? `Übernehmen Sie zuerst die Voraussetzung „${resourceLabel(dependency as ImportResource)}“.` : null;
  };
  const categoryBlockReason = (resource: ImportResource) => categoryPrerequisiteReason(resource)
    || dependencyPlan?.nodes.find(item => item.resource === resource && !item.synthetic)?.blockedReason || null;

  /** Schritte des Formulars in der aktuell gültigen Reihenfolge. */
  const formSteps = dependencyNodes.map((node, index) => {
    const candidate = scanCandidates.find(item => item.resource === node.resource && !node.synthetic);
    const completed = !node.synthetic && completedCategory(node.resource);
    const skipped = Boolean(node.skipped) && !completed;
    const blocked = node.synthetic ? null : (node.blockedReason || categoryBlockReason(node.resource));
    return { node, candidate, completed, skipped, blocked, position: index + 1 };
  });

  const activeStep = formSteps[Math.min(stepIndex, Math.max(formSteps.length - 1, 0))];
  const completedSteps = formSteps.filter(step => step.completed).length;
  const openSteps = formSteps.filter(step => !step.completed && !step.skipped && !step.node.synthetic);

  useEffect(() => {
    // Nach einer Übernahme auf den nächsten offenen Schritt springen.
    if (!formSteps.length) return;
    if (!activeStep || activeStep.completed || activeStep.skipped) {
      const next = formSteps.findIndex(step => !step.completed && !step.skipped);
      if (next >= 0 && next !== stepIndex) setStepIndex(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedSteps, formSteps.length, skippedCategories.length]);

  const openCategory = async (resource: ImportResource, rowNumbers?: number[]) => {
    if (!scannedFile || busyId !== null || loading || loadError) return;
    // Datenhinweise dürfen die Zuordnung nicht sperren: fehlende Bezüge und
    // Spalten werden dort korrigiert. Nur noch offene Kategorien stehen davor.
    const blocked = categoryPrerequisiteReason(resource);
    if (blocked) {
      notify({ variant: 'error', title: 'Kategorie noch gesperrt', message: blocked });
      return;
    }
    let status = takeover;
    if (!status?.session && canAdmin) {
      const accepted = await confirm({
        title: 'Datenübernahme jetzt starten?',
        message: 'Die Übernahme beginnt mit dieser Datei. Der einmalige Umzug-Start wird dabei verbraucht; bis zum Abschluss lässt sich jeder Import zurücknehmen.',
        confirmText: 'Übernahme starten',
      });
      if (!accepted) return;
      status = await startTakeover();
      if (!status) return;
    }
    // Den Rückgabestatus verwenden: React hat den gestarteten Zustand in
    // diesem Ereignishandler noch nicht erneut gerendert.
    if (!hasImportPermission(resource) || status?.session?.status !== 'open' || status.session.legacyBackfill) {
      notify({ variant: 'warning', message: 'Für diese Kategorie fehlt die Berechtigung oder es ist keine Umzugssitzung offen.' });
      return;
    }
    setWizardSourceFile(scannedFile);
    setWizardSheet(scanResult?.sheet);
    setWizardSelectedRowNumbers(rowNumbers?.length ? rowNumbers : undefined);
    setWizardResource(resource);
  };

  const toggleSkip = (resource: ImportResource, skip: boolean) => {
    setOrderNotice('');
    setSkippedCategories(current => skip ? [...new Set([...current, resource])] : current.filter(item => item !== resource));
  };

  const allUnclearColumns = scanResult
    ? scanResult.headers.filter(header => !scanCandidates.some(candidate => candidate.matchedColumns.includes(header)))
    : [];
  const templateDocs = useMemo(() => getImportTemplateDocs(availableResources), [availableResources]);
  const combinedColumns = useMemo(() => describeCombinedImportTemplate(), []);

  return (
    <div className="page-root space-y-6">
      <PageHeader title="Datenübernahme" subtitle="Daten aus Ihrer bisherigen Lösung in einem geführten Durchgang übernehmen." />

      {loadError && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{loadError}</div>}

      {/* 1. Datei: der Einstieg in die Übernahme */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="takeover-upload-title">
        <div className="flex flex-col gap-1">
          <h2 id="takeover-upload-title" className="text-lg font-semibold text-gray-900">Datei hochladen</h2>
          <p className="text-sm text-gray-600">
            Excel (.xlsx), CSV, TSV oder JSON bis 10 MB. Die Datei wird im Browser gelesen; der Server prüft nur die Struktur und speichert dabei keine Fachdaten.
          </p>
        </div>

        <div
          onDragOver={event => { event.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={event => { event.preventDefault(); setDragActive(false); chooseFile(event.dataTransfer.files?.[0]); }}
          className={`mt-4 rounded-xl border-2 border-dashed p-6 text-center transition ${dragActive ? 'border-primary-custom bg-[var(--accent-tint)]' : 'border-gray-300 bg-gray-50'}`}
        >
          {scanBusy
            ? <Loader2 className="mx-auto h-9 w-9 animate-spin text-primary-custom" />
            : <Upload className="mx-auto h-9 w-9 text-primary-custom" aria-hidden="true" />}
          <p className="mt-3 font-semibold text-gray-900">{scanBusy ? 'Datei wird geprüft …' : 'Datei hierher ziehen oder auswählen'}</p>
          <p className="mt-1 text-sm text-gray-600">Nach der Prüfung führt Sie ein Formular Schritt für Schritt durch alles, was in der Datei erkannt wurde.</p>
          <button
            type="button"
            onClick={() => scanInputRef.current?.click()}
            disabled={scanBusy || busyId !== null || loading || Boolean(loadError)}
            className="btn-primary mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold disabled:opacity-50"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />{scannedFile ? 'Andere Datei auswählen' : 'Datei auswählen'}
          </button>
          <input ref={scanInputRef} className="hidden" aria-label="Datei für die Datenübernahme" type="file" accept=".csv,.tsv,.txt,.json,.xlsx,.xlsm,.xls,.ods,.numbers" onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            chooseFile(file);
          }} />
        </div>

        {scanError && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{scanError}</p>}

        {scanResult && scannedFile && <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
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
          {scanResult.warnings.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-medium">Hinweise zur Datei</p><ul className="mt-1 list-disc pl-5">{scanResult.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>}
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer select-none font-medium text-gray-600 hover:text-gray-800">Technische Dateidetails</summary>
            <p className="mt-2 break-all"><span className="font-medium">SHA-256:</span> {scanResult.hash || 'nicht verfügbar'}</p>
          </details>
        </div>}
      </section>

      {/* 2. Schritt-für-Schritt-Formular aus der hochgeladenen Datei */}
      {scanResult && scannedFile && (
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="takeover-steps-title">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 id="takeover-steps-title" className="text-lg font-semibold text-gray-900">Schritt für Schritt übernehmen</h2>
              <p className="mt-1 text-sm text-gray-600">
                {formSteps.length === 0
                  ? 'In dieser Datei wurde keine Kategorie sicher erkannt.'
                  : `${completedSteps} von ${formSteps.filter(step => !step.node.synthetic).length} Kategorien übernommen · ${openSteps.length} offen`}
              </p>
            </div>
            {canStartTakeover && formSteps.length > 0 && (
              <button type="button" onClick={() => void startTakeover()} disabled={busyId !== null} className="btn-primary inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium disabled:opacity-50">
                {busyId === 'takeover-start' && <Loader2 className="h-4 w-4 animate-spin" />}Übernahme mit dieser Datei starten
              </button>
            )}
          </div>

          {formSteps.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
              Prüfen Sie die Kopfzeile Ihrer Datei oder wählen Sie unten eine Kategorie von Hand. Welche Spalten je Kategorie gesucht werden, steht unter „Vorlagen und gesuchte Spalten“.
            </p>
          ) : (
            <>
              <ol className="mt-4 flex flex-wrap gap-2" aria-label="Erkannte Kategorien in der Übernahmereihenfolge">
                {formSteps.map((step, index) => {
                  const state = stepState(step);
                  const isActive = index === stepIndex;
                  return (
                    <li key={step.node.id}>
                      <button
                        type="button"
                        onClick={() => { setStepIndex(index); setOrderNotice(''); }}
                        aria-current={isActive ? 'step' : undefined}
                        className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm transition ${isActive ? 'border-primary-custom bg-[var(--accent-tint)] font-semibold text-gray-900' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                      >
                        <span className="text-xs font-semibold text-gray-500">{step.position}</span>
                        <span className="max-w-[min(13rem,60vw)] whitespace-normal break-words text-left leading-tight" title={step.node.label}>{step.node.label}</span>
                        {step.completed && <CheckCircle2 className="h-4 w-4 text-green-700" aria-hidden="true" />}
                        <span className="sr-only">{state.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              {orderNotice && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">{orderNotice}</p>}

              {activeStep && (
                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-primary-custom">Schritt {activeStep.position} von {formSteps.length}</p>
                      <h3 className="mt-1 text-base font-semibold text-gray-900">{activeStep.node.label}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stepState(activeStep).className}`}>{stepState(activeStep).label}</span>
                        {activeStep.candidate && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${confidencePresentation[activeStep.candidate.confidence].className}`}>{confidencePresentation[activeStep.candidate.confidence].label}</span>}
                        {activeStep.node.dependencies.length > 0 && (
                          <span className="text-xs text-gray-600">Voraussetzung: {activeStep.node.dependencies.map(dependency => formSteps.find(step => step.node.id === dependency)?.node.label || dependency).join(', ')}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" onClick={() => moveDependency(activeStep.node.id, -1)} disabled={stepIndex === 0} aria-label={`${activeStep.node.label} einen Schritt früher übernehmen`} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>
                      <button type="button" onClick={() => moveDependency(activeStep.node.id, 1)} disabled={stepIndex >= formSteps.length - 1} aria-label={`${activeStep.node.label} einen Schritt später übernehmen`} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40"><ArrowDown className="h-4 w-4" /></button>
                    </div>
                  </div>

                  {activeStep.node.synthetic ? (
                    <div className="mt-3 space-y-2 text-sm text-gray-700">
                      <p>Diese Namen stehen in Folgezeilen Ihrer Datei, aber noch nicht in Ihrem Workspace. Sie werden mit der Kategorie angelegt, die sie braucht – dort im Assistenten „Fehlende {terminology.entity.plural} anlegen“ aktiviert lassen.</p>
                      {dependencyPlan && dependencyPlan.proposedCustomers.length > 0 && (
                        <ul className="flex flex-wrap gap-2">
                          {dependencyPlan.proposedCustomers.slice(0, 40).map(customer => (
                            <li key={customer.key} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-sm text-gray-800" title={`Quelle: ${customer.sources.map(source => resourceLabel(source as ImportResource)).join(', ')}`}>{customer.name}</li>
                          ))}
                          {dependencyPlan.proposedCustomers.length > 40 && <li className="px-2.5 py-1 text-sm text-gray-500">… und {dependencyPlan.proposedCustomers.length - 40} weitere</li>}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {activeStep.blocked && !activeStep.completed && !activeStep.skipped && <p className="text-sm text-red-800">{activeStep.blocked}</p>}
                      {activeStep.candidate && (
                        <p className="text-sm text-gray-700">
                          {[
                            `${activeStep.candidate.matchedRowCount.toLocaleString('de-DE')} passende Zeilen`,
                            activeStep.candidate.matchedColumns.length ? `${activeStep.candidate.matchedColumns.length} Spalten` : null,
                            activeStep.candidate.overlaps.length ? `${activeStep.candidate.overlaps.length} Überschneidung${activeStep.candidate.overlaps.length === 1 ? '' : 'en'}` : null,
                          ].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {activeStep.candidate && (
                        <details className="text-sm text-gray-600">
                          <summary className="w-fit cursor-pointer rounded font-medium hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-color)]">Erkannte Spalten und Hinweise</summary>
                          <div className="mt-2 space-y-2 break-words rounded-lg border border-gray-200 bg-white p-3 text-sm">
                            <p>{activeStep.candidate.reason}</p>
                            <p>Passende Spalten: {activeStep.candidate.matchedColumns.join(', ') || 'keine'}</p>
                            {activeStep.candidate.unclearColumns.length > 0 && <p className="text-amber-800">Für diese Kategorie unklar: {activeStep.candidate.unclearColumns.join(', ')}</p>}
                            {activeStep.candidate.overlaps.length > 0 && (
                              <div className="text-amber-900">
                                <p className="font-medium">Dieselben Zeilen passen auch zu:</p>
                                <ul className="mt-1 list-disc pl-4">
                                  {activeStep.candidate.overlaps.map(resource => (
                                    <li key={resource}>
                                      {resourceLabel(resource)}
                                      {activeStep.candidate?.overlapRows[resource]?.length ? ` · ${activeStep.candidate.overlapRows[resource]!.length.toLocaleString('de-DE')} gemeinsame Zeilen` : ''}
                                    </li>
                                  ))}
                                </ul>
                                <p className="mt-1">{['euerEntries', 'invoicePayments', 'invoices'].includes(activeStep.candidate.resource) ? 'Geldzeilen werden nicht automatisch doppelt vorgeschlagen.' : 'Bitte prüfen, welche Zuordnung zu den gemeinsamen Zeilen passt.'}</p>
                              </div>
                            )}
                          </div>
                        </details>
                      )}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3">
                    {!activeStep.node.synthetic && (
                      <>
                        <button
                          type="button"
                          onClick={() => void openCategory(activeStep.node.resource, activeStep.candidate?.matchedRowNumbers)}
                          disabled={activeStep.completed || activeStep.skipped || Boolean(categoryPrerequisiteReason(activeStep.node.resource)) || !canOpenImport(activeStep.node.resource) || busyId !== null}
                          className="btn-primary inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {activeStep.completed ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                          {activeStep.completed ? 'Übernommen' : hasImportPermission(activeStep.node.resource) ? 'Zuordnung prüfen und übernehmen' : 'Keine Berechtigung'}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleSkip(activeStep.node.resource, !activeStep.skipped)}
                          disabled={activeStep.completed}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <SkipForward className="h-4 w-4" aria-hidden="true" />{activeStep.skipped ? 'Wieder aufnehmen' : 'Überspringen'}
                        </button>
                      </>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      <button type="button" onClick={() => setStepIndex(index => Math.max(0, index - 1))} disabled={stepIndex === 0} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"><ArrowLeft className="h-4 w-4" />Zurück</button>
                      <button type="button" onClick={() => setStepIndex(index => Math.min(formSteps.length - 1, index + 1))} disabled={stepIndex >= formSteps.length - 1} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">Weiter<ArrowRight className="h-4 w-4" /></button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="mt-4 grid gap-3 border-t border-gray-100 pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="block text-sm font-medium text-gray-700">Weitere Kategorie aus dieser Datei
              <select value={manualScanResource} onChange={event => setManualScanResource(event.target.value as ImportResource | '')} className="form-input mt-1 block w-full">
                <option value="">Kategorie auswählen …</option>
                {availableResources.map(resource => <option key={resource} value={resource} disabled={!hasImportPermission(resource)}>{resourceLabel(resource)}{!hasImportPermission(resource) ? ' (keine Berechtigung)' : ''}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => manualScanResource && void openCategory(manualScanResource)} disabled={!manualScanResource || !canOpenImport(manualScanResource as ImportResource) || busyId !== null} className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50">Zuordnung öffnen</button>
          </div>
          {allUnclearColumns.length > 0 && (
            <details className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <summary className="cursor-pointer font-medium">Noch keiner Kategorie zugeordnete Spalten ({allUnclearColumns.length})</summary>
              <p className="mt-2">{allUnclearColumns.join(', ')}</p>
              <p className="mt-1 text-xs">Im Assistenten zuordnen oder freilassen.</p>
            </details>
          )}
        </section>
      )}

      {/* 3. Umzug und Stichtag gehören zusammen: beide beschreiben denselben Wechsel */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="takeover-status-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 id="takeover-status-title" className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              Umzug und Stichtag
              <InfoTooltip align="start" label="Hinweis zu Umzug und Stichtag" text="Der Umzug ist der einmalige Wechsel nach SoloOffice. Der Stichtag sagt, ab wann Sie hier arbeiten: Buchungen und Rechnungen ab diesem Tag werden in der Vorschau markiert, damit nichts doppelt erfasst wird. Für eine vollständige EÜR übernehmen Sie auch das laufende Jahr vor dem Stichtag." />
            </h2>
            {takeover?.demoMode && <p className="mt-1 text-xs font-medium text-amber-800">Demo: Status nur in dieser Browser-Sitzung.</p>}
            <p className="mt-1 text-sm text-gray-600">
              {!takeover?.session
                ? 'Noch nicht gestartet. Die Übernahme beginnt mit Ihrer ersten Datei.'
                : takeover.session.status === 'completed'
                  ? `${takeover.session.legacyBackfill ? 'Historischer Marker geschlossen.' : `Abgeschlossen am ${formatDateTime(takeover.session.completedAt)}.`} Kein neuer Umzug möglich.`
                  : takeover.session.legacyBackfill
                    ? 'Altbestand belegt den einmaligen Start. Der Marker kann geschlossen werden.'
                    : `Offen seit ${formatDateTime(takeover.session.startedAt)}.`}
            </p>
          </div>
          {takeover?.session?.status === 'open' && canAdmin && (
            <button type="button" onClick={completeTakeover} disabled={busyId !== null} className="btn-primary inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium disabled:opacity-50">
              {busyId === 'takeover' && <Loader2 className="h-4 w-4 animate-spin" />}{takeover.session.legacyBackfill ? 'Altbestandsmarker schließen' : 'Umzug abschließen'}
            </button>
          )}
          {canStartTakeover && (
            <button type="button" onClick={() => void startTakeover()} disabled={busyId !== null} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50">
              {busyId === 'takeover-start' && <Loader2 className="h-4 w-4 animate-spin" />}Umzug jetzt starten
            </button>
          )}
        </div>
        <div className="mt-4 flex min-w-0 flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="w-full min-w-0 text-sm font-medium text-gray-700 sm:w-auto">
            Stichtag
            <LocalizedDateInput aria-label="Stichtag" value={cutoverDate} onChange={setCutoverDate} disabled={!canAdmin} locale={company.locale || 'de-DE'} dateFormat={company.dateFormat} className="mt-1 w-full sm:w-44" />
          </label>
          <button type="button" onClick={saveCutover} disabled={!canAdmin || cutoverDate === savedCutoverDate} className="btn-primary min-h-11 w-full rounded-lg px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto" title={canAdmin ? undefined : 'Nur Administratoren können den Stichtag festlegen'}>
            Speichern
          </button>
          <p className="min-w-0 w-full text-sm text-gray-600 sm:w-auto sm:flex-1">Ab diesem Datum arbeiten Sie mit SoloOffice.{savedCutoverDate ? '' : ' Noch kein Stichtag gesetzt.'}</p>
        </div>
        {onNavigate && <p className="mt-3 text-sm text-gray-600">Prüfen Sie vor der Übernahme Ihre <button type="button" className="font-medium text-primary-custom hover:underline" onClick={() => onNavigate('settings')}>Firmendaten in den Einstellungen</button>.</p>}
      </section>

      {/* 4. Kurzanleitung: offen, solange noch keine Datei geprüft wurde */}
      <details key={scanResult ? 'guide-scanned' : 'guide-empty'} open={!scanResult} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <summary className="cursor-pointer rounded text-base font-semibold text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-color)]">So läuft die Datenübernahme</summary>
        <ol className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {guideSteps.map(item => (
            <li key={item.step} className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <ImportStepIllustration step={item.step} className="h-14 w-20 text-gray-500" />
              <p className="font-semibold text-gray-900">{item.title}</p>
              <p className="text-sm text-gray-600">{item.text}</p>
            </li>
          ))}
        </ol>
      </details>

      {/* 5. Vorlagen mit den gesuchten Spalten */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="import-templates-title">
        <h2 id="import-templates-title" className="text-lg font-semibold text-gray-900">Vorlagen und gesuchte Spalten</h2>
        <p className="mt-1 text-sm text-gray-600">Vorlagen zum Ausfüllen, auch in Excel. Aufklappen zeigt, welche Spalten und Angaben je Kategorie gesucht werden; eine eigene Datei mit anderen Spaltennamen funktioniert ebenso.</p>

        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900">Komplettvorlage: eine Datei, mehrere Schritte</p>
            <p className="mt-1 text-sm text-gray-600">Kundenangaben und Rechnungen stehen in denselben Zeilen. Beim Hochladen entstehen daraus zwei Schritte: zuerst {terminology.entity.plural}, dann Rechnungen.</p>
          </div>
          <button type="button" onClick={() => downloadCsvText('Vorlage-Komplettuebernahme.csv', buildCombinedImportTemplate())} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 hover:bg-gray-50">
            <Download className="h-4 w-4 text-gray-500" aria-hidden="true" />Komplettvorlage
          </button>
        </div>
        <details className="mt-2 rounded-lg border border-gray-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-800">Spalten der Komplettvorlage ({combinedColumns.length})</summary>
          <ul className="mt-2 grid min-w-0 gap-2 text-sm text-gray-700 sm:grid-cols-2">
            {combinedColumns.map(column => (
              <li key={column.header} className="min-w-0 rounded-md bg-gray-50 px-2 py-1.5">
                <span className="block break-words font-medium">{column.header}</span>
                <span className="mt-0.5 block break-words text-xs text-gray-500">{column.resourceLabel}{column.example ? ` · z. B. ${column.example}` : ''}</span>
              </li>
            ))}
          </ul>
        </details>

        <div className="mt-4 space-y-2">
          {templateDocs.map(doc => {
            const imported = importedCount(doc.resource);
            return (
              <details key={doc.resource} className="rounded-lg border border-gray-200 bg-white">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-3 text-sm font-semibold text-gray-900">
                  <span className="min-w-0">{resourceLabel(doc.resource)}</span>
                  <span className="shrink-0 text-xs font-normal text-gray-500">
                    {doc.columns.filter(column => column.inTemplate).length} Spalten in der Vorlage
                    {imported > 0 ? ` · bisher ${imported.toLocaleString('de-DE')} übernommen` : ''}
                    {settingsResources.includes(doc.resource) ? ' · nur Administratoren' : ''}
                  </span>
                </summary>
                <div className="border-t border-gray-200 p-3">
                  <p className="text-sm text-gray-600">{doc.description}</p>
                  {doc.requiredGroups.length > 0 && (
                    <p className="mt-2 text-sm text-gray-700">
                      {doc.requiredGroups.map(group => `${group.label}: mindestens eine Spalte aus ${group.fieldLabels.join(', ')}`).join(' · ')}
                    </p>
                  )}
                  <ul className="mt-3 space-y-2">
                    {doc.columns.map(column => <TemplateColumnRow key={column.key} column={column} />)}
                  </ul>
                  <button type="button" onClick={() => templateFor(doc.resource)} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50">
                    <Download className="h-4 w-4 text-gray-500" aria-hidden="true" />Vorlage für {resourceLabel(doc.resource)}
                  </button>
                </div>
              </details>
            );
          })}
        </div>
      </section>

      {/* 6. Verlauf */}
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
                      {!run.migrationSessionId && <button type="button" onClick={() => void confirmRun(run)} disabled={busyId !== null} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">Abschließen</button>}
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
          takeoverSessionId={takeoverOpen ? takeover?.session?.id : undefined}
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

/** Eine Zielspalte einer Vorlage samt Format, Pflichtgrad und erkannten Namen. */
function TemplateColumnRow({ column }: { column: ImportTemplateColumnDoc }) {
  const requirementClass = column.requirement === 'required'
    ? 'bg-red-100 text-red-800'
    : column.requirement === 'group'
      ? 'bg-amber-100 text-amber-900'
      : 'bg-gray-100 text-gray-600';
  return (
    <li className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-900">{column.label}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${requirementClass}`}>{column.requirementLabel}</span>
        <span className="text-xs text-gray-500">{column.typeLabel}</span>
        {column.inTemplate && <span className="text-xs text-gray-500">in der Vorlage</span>}
        {column.allowsConstant && <span className="text-xs text-gray-500">fester Wert möglich</span>}
      </div>
      <p className="mt-1 text-xs text-gray-600">
        Erkannte Spaltennamen: {column.recognisedHeaders.join(', ')}
        {column.example ? ` · Beispiel: ${column.example}` : ''}
      </p>
      {column.options.length > 0 && <p className="mt-0.5 text-xs text-gray-600">Mögliche Werte: {column.options.join(', ')}</p>}
    </li>
  );
}
