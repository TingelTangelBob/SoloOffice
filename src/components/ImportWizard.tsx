import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Download, FileUp, History, Link2, Loader2, PenLine, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { apiService } from '../services/api';
import type { DateFormat, ImportDuplicateMode, ImportResource, ImportResponse, ImportRowResult, ImportRun, ImportTotals, NumberFormat } from '../types';
import {
  analyseColumnFormat,
  analyseHeaderMapping,
  buildImportTemplate,
  buildIssueList,
  distinctColumnValues,
  getImportDefinition,
  headerSignature,
  mapImportRows,
  parseImportFile,
  suggestEnumValue,
  valueMappingKey,
  type ColumnFormat,
  type ImportDefinition,
  type ImportFieldDefinition,
  type ParsedImportFile,
} from '../utils/importParser';
import { formatCurrency } from '../utils/formatters';
import { getTerminology, type TerminologyDefinition } from '../utils/terminology';
import { LocalizedDateInput } from './LocalizedDateInput';

interface ImportWizardProps {
  resource: ImportResource;
  isOpen: boolean;
  onClose: () => void;
  onImported?: () => void | Promise<void>;
  /** Feste Werte beim Öffnen, z. B. Art „Ausgabe“ auf der Belegseite. */
  initialConstants?: Record<string, string>;
  /** Abweichender Titel, z. B. „Ausgaben“. */
  title?: string;
  /** Bereits im Datenübernahme-Scan geprüfte Datei. */
  initialFile?: File;
  initialSheet?: string;
  initialSelectedRowNumbers?: number[];
  takeoverSessionId?: string;
}

type ImportStep = 'file' | 'mapping' | 'preview' | 'result';
type RowFilter = 'problems' | 'all' | 'error' | 'warning' | 'duplicate' | 'ready';

const CONSTANT_OPTION = '__constant__';
const ROW_PAGE_SIZE = 200;
const updateResources: ImportResource[] = ['customers', 'positions', 'hourlyRates', 'materials'];

const statusLabels: Record<string, string> = {
  valid: 'Bereit',
  update: 'Aktualisierung',
  duplicate: 'Duplikat',
  warning: 'Warnung',
  error: 'Fehler',
  imported: 'Importiert',
};

const statusClasses: Record<string, string> = {
  valid: 'bg-green-100 text-green-800',
  update: 'bg-blue-100 text-blue-800',
  duplicate: 'bg-gray-100 text-gray-700',
  warning: 'bg-amber-100 text-amber-800',
  error: 'bg-red-100 text-red-800',
  imported: 'bg-emerald-100 text-emerald-800',
};

function localizeImportDefinition(definition: ImportDefinition, terminology: TerminologyDefinition, title?: string): ImportDefinition {
  const entityNameLabel = `${terminology.entity.genitive}name`;
  const entityEmailLabel = `${terminology.entity.genitive}-E-Mail`;
  const entityLabels: Record<string, string> = {
    customerId: `${terminology.entity.genitive}-ID`,
    customerNumber: terminology.entity.numberLabel,
    customerName: entityNameLabel,
    customerEmail: entityEmailLabel,
    customerAddress: terminology.entity.addressLabel,
    customerType: `${terminology.entity.genitive}art`,
  };
  if (definition.resource === 'customers') {
    Object.assign(entityLabels, { name: entityNameLabel, email: entityEmailLabel });
  }
  const resourceLabel = title
    || (definition.resource === 'customers' ? terminology.entity.plural
      : definition.resource === 'jobs' ? terminology.work.plural
        : definition.label);
  const description = definition.resource === 'jobs'
    ? `${terminology.work.plural} importieren und ${terminology.entity.singular} über ID, Nummer, E-Mail oder Name zuordnen. Wiederholungen legen Serien an.`
    : definition.resource === 'customers'
      ? `${terminology.entity.plural} aus Excel, CSV oder JSON übernehmen und bestehende ${terminology.entity.plural} automatisch erkennen.`
      : definition.description.replace(/Kunden/g, terminology.entity.plural).replace(/Kunde/g, terminology.entity.singular);

  return {
    ...definition,
    label: resourceLabel,
    description,
    requiredGroups: definition.requiredGroups?.map(group => ({
      ...group,
      label: group.label === 'Kundenbezug' ? `${terminology.entity.singular}-Bezug` : group.label,
    })),
    fields: definition.fields.map(field => ({
      ...field,
      label: entityLabels[field.key] || field.label,
    })),
  };
}

function formatIsoDate(value: unknown): string {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value ?? '');
}

function formatMonth(value: string): string {
  const [year, month] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('de-DE', { month: 'short', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

function downloadText(fileName: string, content: string) {
  const blob = new Blob([`\ufeff${content.replace(/^\ufeff/, '')}`], { type: 'text/csv;charset=utf-8' });
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

export function ImportWizard({ resource, isOpen, onClose, onImported, initialConstants, title, initialFile, initialSheet, initialSelectedRowNumbers, takeoverSessionId }: ImportWizardProps) {
  const { company } = useCompany();
  const baseDefinition = getImportDefinition(resource);
  const terminology = getTerminology(company.terminologyProfile);
  const definition = useMemo(
    () => localizeImportDefinition(baseDefinition, terminology, title),
    [baseDefinition, terminology, title],
  );
  const canUpdate = updateResources.includes(resource);
  const [step, setStep] = useState<ImportStep>('file');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [parsedFile, setParsedFile] = useState<ParsedImportFile | null>(null);
  const [selectedRowIndexes, setSelectedRowIndexes] = useState<number[] | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [constants, setConstants] = useState<Record<string, string>>(initialConstants || {});
  const [valueOverrides, setValueOverrides] = useState<Record<string, Record<string, string>>>({});
  const [duplicateMode, setDuplicateMode] = useState<ImportDuplicateMode>('skip');
  const [createMissingCustomers, setCreateMissingCustomers] = useState(false);
  const [matchOpenInvoices, setMatchOpenInvoices] = useState(true);
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const mappingScrollRef = useRef<HTMLDivElement>(null);
  const mappingScrollTopRef = useRef<number | null>(null);

  const fieldByKey = useMemo(() => new Map(definition.fields.map(field => [field.key, field])), [definition]);
  const columnFormats = useMemo(() => {
    const formats: Record<string, ColumnFormat | null> = {};
    if (!parsedFile) return formats;
    Object.entries(mapping).forEach(([key, header]) => {
      if (header) formats[key] = analyseColumnFormat(parsedFile, header, fieldByKey.get(key)?.type);
    });
    return formats;
  }, [fieldByKey, mapping, parsedFile]);

  // Werte-Zuordnung: automatische Vorschläge, von Hand überschreibbar.
  const enumValues = useMemo(() => {
    const values: Record<string, Array<{ value: string; count: number; key: string; suggestion: string | null }>> = {};
    if (!parsedFile) return values;
    definition.fields.filter(field => field.type === 'enum' && mapping[field.key]).forEach(field => {
      values[field.key] = distinctColumnValues(parsedFile, mapping[field.key]).map(item => ({
        ...item,
        key: valueMappingKey(item.value),
        suggestion: suggestEnumValue(resource, field.key, item.value),
      }));
    });
    return values;
  }, [definition, mapping, parsedFile, resource]);
  const valueMappings = useMemo(() => {
    const result: Record<string, Record<string, string>> = {};
    Object.entries(enumValues).forEach(([fieldKey, items]) => {
      result[fieldKey] = {};
      items.forEach(item => {
        const selected = valueOverrides[fieldKey]?.[item.key] ?? item.suggestion ?? '';
        if (selected) result[fieldKey][item.key] = selected;
      });
    });
    return result;
  }, [enumValues, valueOverrides]);

  const mappedRows = useMemo(
    () => {
      if (!parsedFile) return [];
      const selected = selectedRowIndexes === null ? parsedFile.rows.map((_, index) => index) : selectedRowIndexes;
      const selectedFile: ParsedImportFile = {
        ...parsedFile,
        rows: selected.map(index => parsedFile.rows[index]).filter(Boolean),
        rowNumbers: parsedFile.rowNumbers ? selected.map(index => parsedFile.rowNumbers?.[index] ?? index + 2) : undefined,
      };
      return mapImportRows(selectedFile, mapping, { definition, constants, valueMappings });
    },
    [constants, definition, mapping, parsedFile, selectedRowIndexes, valueMappings],
  );
  const mappingAnalysis = useMemo(
    () => parsedFile ? analyseHeaderMapping(parsedFile.headers, definition) : null,
    [definition, parsedFile],
  );

  useLayoutEffect(() => {
    if (mappingScrollTopRef.current === null || !mappingScrollRef.current) return;
    mappingScrollRef.current.scrollTop = mappingScrollTopRef.current;
    mappingScrollTopRef.current = null;
  }, [mapping, constants]);

  // Escape schließt den Dialog wie „Schließen“, solange nichts gespeichert wird.
  const closeRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy) {
        event.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isBusy, isOpen]);

  const reset = () => {
    setStep('file');
    setSourceFile(null);
    setParsedFile(null);
    setSelectedRowIndexes(null);
    setMapping({});
    setConstants(initialConstants || {});
    setValueOverrides({});
    setDuplicateMode('skip');
    setCreateMissingCustomers(false);
    setMatchOpenInvoices(true);
    setPreview(null);
    setResult(null);
    setIsBusy(false);
    setError(null);
    setNotices([]);
  };

  const close = () => {
    reset();
    onClose();
  };
  closeRef.current = close;

  const applyPreviousRun = (parsed: ParsedImportFile, runs: ImportRun[]) => {
    const messages: string[] = [];
    const sameFile = parsed.hash ? runs.find(run => run.fileHash === parsed.hash && run.status !== 'reverted') : undefined;
    if (sameFile) {
      messages.push(`Diese Datei wurde am ${new Date(sameFile.createdAt).toLocaleDateString('de-DE')} bereits importiert. Bereits übernommene Zeilen werden als Duplikat erkannt.`);
    }
    const signature = headerSignature(parsed.headers);
    const previous = runs.find(run => run.resource === resource && run.status !== 'reverted' && headerSignature(run.sourceHeaders || []) === signature);
    if (!previous?.settings?.mapping) return { mapping: null, messages };
    const headerSet = new Set(parsed.headers);
    const restored = Object.fromEntries(Object.entries(previous.settings.mapping).filter(([key, header]) => fieldByKey.has(key) && headerSet.has(header)));
    if (Object.keys(restored).length === 0) return { mapping: null, messages };
    const options = previous.settings.options || {};
    setConstants({ ...(previous.settings.constants || {}), ...(initialConstants || {}) });
    setValueOverrides(previous.settings.valueMappings || {});
    if (options.duplicateMode === 'update' && canUpdate) setDuplicateMode('update');
    if (typeof options.createMissingCustomers === 'boolean') setCreateMissingCustomers(options.createMissingCustomers);
    if (typeof options.matchOpenInvoices === 'boolean') setMatchOpenInvoices(options.matchOpenInvoices);
    messages.push(`Die Zuordnung vom Import am ${new Date(previous.createdAt).toLocaleDateString('de-DE')} wurde übernommen. Bitte kurz prüfen.`);
    return { mapping: restored, messages };
  };

  const loadFile = async (file: File, sheet?: string, selectedRowNumbers?: number[]) => {
    setIsBusy(true);
    setError(null);
    try {
      const parsed = await parseImportFile(file, { sheet });
      const runs = await apiService.getImportRuns().catch(() => [] as ImportRun[]);
      const previous = applyPreviousRun(parsed, runs);
      setSourceFile(file);
      setParsedFile(parsed);
      setSelectedRowIndexes(selectedRowNumbers?.length
        ? parsed.rows.map((_, index) => index).filter(index => selectedRowNumbers.includes(parsed.rowNumbers?.[index] ?? index + 2))
        : null);
      setMapping(previous.mapping || analyseHeaderMapping(parsed.headers, definition).mapping);
      setNotices(previous.messages);
      setPreview(null);
      setStep('mapping');
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Die Datei konnte nicht gelesen werden.');
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    if (isOpen && initialFile) void loadFile(initialFile, initialSheet, initialSelectedRowNumbers);
    // One scan result opens one wizard instance; subsequent file/sheet changes
    // are handled by the wizard's own controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile, initialSheet, isOpen]);

  if (!isOpen) return null;

  const rememberScroll = () => {
    mappingScrollTopRef.current = mappingScrollRef.current?.scrollTop ?? null;
  };

  const setTargetMapping = (targetField: string, sourceHeader: string) => {
    rememberScroll();
    if (sourceHeader === CONSTANT_OPTION) {
      const field = fieldByKey.get(targetField);
      setConstants(previous => ({ ...previous, [targetField]: previous[targetField] ?? (field?.options?.[0]?.value || '') }));
      setMapping(previous => {
        const next = { ...previous };
        delete next[targetField];
        return next;
      });
    } else {
      setMapping(previous => {
        const next = { ...previous };
        if (sourceHeader) next[targetField] = sourceHeader;
        else delete next[targetField];
        return next;
      });
      if (sourceHeader) {
        setConstants(previous => {
          if (!(targetField in previous)) return previous;
          const next = { ...previous };
          delete next[targetField];
          return next;
        });
      }
    }
    setPreview(null);
    setError(null);
  };

  const setConstant = (targetField: string, value: string | null) => {
    rememberScroll();
    setConstants(previous => {
      const next = { ...previous };
      if (value === null) delete next[targetField];
      else next[targetField] = value;
      return next;
    });
    setPreview(null);
  };

  const setValueOverride = (fieldKey: string, valueKey: string, target: string) => {
    rememberScroll();
    setValueOverrides(previous => ({ ...previous, [fieldKey]: { ...(previous[fieldKey] || {}), [valueKey]: target } }));
    setPreview(null);
  };

  const isSatisfied = (key: string) => Boolean(mapping[key]) || Boolean(String(constants[key] ?? '').trim());
  const missingRequiredFields = definition.fields.filter(field => field.required && !isSatisfied(field.key));
  const missingRequiredGroups = (definition.requiredGroups || []).filter(group => group.fields.every(fieldKey => !isSatisfied(fieldKey)));

  const importOptions = (dryRun: boolean, phase: 'preview' | 'execute' = 'preview') => ({
    dryRun,
    duplicateMode,
    createMissingCustomers,
    matchOpenInvoices,
    file: parsedFile ? { name: parsedFile.fileName, hash: parsedFile.hash ?? null, headers: parsedFile.headers } : undefined,
    settings: {
      mapping,
      constants,
      valueMappings: Object.fromEntries(Object.entries(valueOverrides).filter(([key]) => mapping[key])),
      sheet: parsedFile?.sheet,
      selectedRows: mappedRows.map(row => Number(row._rowNumber)),
      options: { duplicateMode, createMissingCustomers, matchOpenInvoices },
    },
    ...(takeoverSessionId ? {
      takeover: dryRun
        ? { sessionId: takeoverSessionId, phase }
        : { sessionId: takeoverSessionId, phase, categoryId: preview?.categoryId, previewDigest: preview?.previewDigest, idempotencyKey },
    } : {}),
  });

  const runPreview = async () => {
    if (!parsedFile || mappedRows.length === 0) {
      setError('Es wurden keine Datenzeilen gefunden.');
      return;
    }
    if (missingRequiredFields.length > 0 || missingRequiredGroups.length > 0) {
      setError(`Bitte ordnen Sie noch zu: ${[
        ...missingRequiredFields.map(field => field.label),
        ...missingRequiredGroups.map(group => `mindestens eine Spalte für ${group.label}`),
      ].join(', ')}.`);
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      const response = await apiService.importData(resource, mappedRows, importOptions(true, 'preview'));
      setPreview(response);
      setIdempotencyKey(crypto.randomUUID());
      setStep('preview');
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Die Vorschau konnte nicht erstellt werden.');
    } finally {
      setIsBusy(false);
    }
  };

  const commitImport = async () => {
    if (!preview || (preview.summary.valid + preview.summary.updated) === 0) return;
    setIsBusy(true);
    setError(null);
    try {
      const response = await apiService.importData(resource, mappedRows, importOptions(false, 'execute'));
      setResult(response);
      setStep('result');
      await onImported?.();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Der Import konnte nicht gespeichert werden.');
    } finally {
      setIsBusy(false);
    }
  };

  const downloadTemplate = () => downloadText(`Vorlage-${fileSlug(definition.label)}.csv`, buildImportTemplate(definition));
  const downloadIssues = (rows: ImportRowResult[]) => {
    if (!parsedFile) return;
    downloadText(`Hinweise-${fileSlug(parsedFile.fileName.replace(/\.[^.]+$/, ''))}.csv`, buildIssueList(parsedFile, rows));
  };

  const stepIndex = { file: 1, mapping: 2, preview: 3, result: 4 }[step];
  const usableRows = preview ? preview.summary.valid + preview.summary.updated : 0;
  const usableRecords = preview ? (preview.summary.records ?? usableRows) : 0;
  const mappedFieldCount = definition.fields.filter(field => isSatisfied(field.key)).length;
  const ambiguousFieldCount = definition.fields.filter(field => !isSatisfied(field.key) && mappingAnalysis?.fields[field.key]?.confidence === 'ambiguous').length;
  const requiredMappingIssueCount = missingRequiredFields.length + missingRequiredGroups.length;
  const mappedSourceHeaders = new Set(Object.values(mapping).filter(Boolean));
  const unmappedSourceHeaders = parsedFile ? parsedFile.headers.filter(header => !mappedSourceHeaders.has(header)) : [];
  const previewFields = definition.fields.filter(field => isSatisfied(field.key)).slice(0, 8);
  const entityPlural = terminology.entity.plural;

  return (
    <div className="dialog-overlay fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-3 sm:p-6" onClick={event => event.target === event.currentTarget && !isBusy && close()}>
      <div className="form-consistent-fields flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="import-wizard-title">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary-custom">
              <Upload className="h-4 w-4" /> Importassistent · Schritt {stepIndex} von 4
            </div>
            <h2 id="import-wizard-title" className="mt-1 truncate text-xl font-semibold text-gray-900">{definition.label} importieren</h2>
            <p className="mt-1 hidden text-sm text-gray-500 sm:block">{definition.description}</p>
          </div>
          <button type="button" onClick={close} disabled={isBusy} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50" aria-label="Importassistent schließen">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div ref={mappingScrollRef} className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {error && (
            <div className="mb-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {step === 'file' && (
            <div className="space-y-5">
              <label className="flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 p-6 text-center transition hover:border-primary-custom hover:bg-gray-50">
                {isBusy ? <Loader2 className="mb-3 h-10 w-10 animate-spin text-primary-custom" /> : <FileUp className="mb-3 h-10 w-10 text-primary-custom" />}
                <span className="font-semibold text-gray-900">Datei auswählen</span>
                <span className="mt-1 text-sm text-gray-500">Excel (.xlsx), CSV, TSV oder JSON · maximal 10 MB</span>
                <span className="mt-3 rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white">Durchsuchen</span>
                <input
                  type="file"
                  accept=".xlsx,.xlsm,.csv,.tsv,.txt,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={event => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void loadFile(file);
                  }}
                  disabled={isBusy}
                />
              </label>
              <div className="import-guidance-panel flex flex-col gap-3 rounded-xl p-4 text-sm leading-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">So wird Ihre Datei gelesen</p>
                  <p>Kopfzeile, Trennzeichen, Umlaute, Dezimal-Komma und Datumsformate werden automatisch erkannt. Spalten ordnen Sie im nächsten Schritt zu; es wird erst nach der Vorschau gespeichert.</p>
                </div>
                <button type="button" onClick={downloadTemplate} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  <Download className="h-4 w-4" /> Vorlage herunterladen
                </button>
              </div>
            </div>
          )}

          {step === 'mapping' && parsedFile && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <FileUp className="h-5 w-5 shrink-0 text-primary-custom" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-900">{parsedFile.fileName}</p>
                    <p className="text-sm text-gray-500">
                      {parsedFile.format.toUpperCase()} · {mappedRows.length} von {parsedFile.rows.length} Zeilen ausgewählt · {parsedFile.headers.length} Spalten
                      {parsedFile.encoding && parsedFile.encoding !== 'UTF-8' ? ` · ${parsedFile.encoding}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                  {parsedFile.sheets && parsedFile.sheets.length > 1 && sourceFile && (
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <span className="font-medium">Tabellenblatt</span>
                    <select value={parsedFile.sheet} onChange={event => void loadFile(sourceFile, event.target.value)} disabled={isBusy} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                        {parsedFile.sheets.map(sheet => <option key={sheet} value={sheet}>{sheet}</option>)}
                      </select>
                    </label>
                  )}
                  {canUpdate && (
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <span className="font-medium">Vorhandene</span>
                      <select value={duplicateMode} onChange={event => { setDuplicateMode(event.target.value as ImportDuplicateMode); setPreview(null); }} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                        <option value="skip">überspringen</option>
                        <option value="update">mit Dateiwerten aktualisieren</option>
                      </select>
                    </label>
                  )}
                  <button type="button" onClick={() => { setParsedFile(null); setSourceFile(null); setMapping({}); setPreview(null); setError(null); setNotices([]); setStep('file'); }} className="text-sm font-medium text-primary-custom hover:underline">Andere Datei wählen</button>
                </div>
              </div>

              {[...parsedFile.warnings, ...notices].length > 0 && (
                <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  {[...parsedFile.warnings, ...notices].map(message => <p key={message}>{message}</p>)}
                </div>
              )}

              {(definition.canCreateCustomers || definition.canMatchInvoices) && (
                <div className="flex flex-col gap-2 rounded-xl border border-gray-200 p-4 text-sm text-gray-700">
                  {definition.canCreateCustomers && (
                    <label className="flex items-start gap-3">
                      <input type="checkbox" className="custom-checkbox mt-0.5 shrink-0" checked={createMissingCustomers} onChange={event => { setCreateMissingCustomers(event.target.checked); setPreview(null); }} />
                      <span><span className="font-medium text-gray-900">Fehlende {entityPlural} anlegen</span><span className="block text-gray-500">Unbekannte Namen werden einmalig neu angelegt statt als Fehler gemeldet.</span></span>
                    </label>
                  )}
                  {definition.canMatchInvoices && (
                    <label className="flex items-start gap-3">
                      <input type="checkbox" className="custom-checkbox mt-0.5 shrink-0" checked={matchOpenInvoices} onChange={event => { setMatchOpenInvoices(event.target.checked); setPreview(null); }} />
                      <span><span className="font-medium text-gray-900">Einnahmen offenen Rechnungen zuordnen</span><span className="block text-gray-500">Passt eine Einnahme nach {terminology.entity.singular} und Betrag zu einer offenen Rechnung, wird sie als deren Zahlung gebucht. So zählt kein Geldeingang doppelt.</span></span>
                    </label>
                  )}
                </div>
              )}

              {resource === 'euerEntries' && !isSatisfied('entryType') && !mapping.incomeAmount && !mapping.expenseAmount && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Legen Sie fest, ob die Zeilen Einnahmen oder Ausgaben sind: Ordnen Sie eine Spalte „Art“ zu oder wählen Sie bei „Art“ einen festen Wert. Ohne diese Angabe werden nur negative Beträge als Ausgabe erkannt.
                </p>
              )}

              <div>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <h3 className="font-semibold text-gray-900">Spalten zuordnen</h3>
                </div>
                <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-200 pb-3 text-sm">
                  <span className="font-medium text-gray-700">{mappedFieldCount}/{definition.fields.length} zugeordnet</span>
                  {ambiguousFieldCount > 0 && <span className="import-mapping-warning">{ambiguousFieldCount} prüfen</span>}
                  {requiredMappingIssueCount > 0 && <span className="import-mapping-warning">{requiredMappingIssueCount} Pflichtzuordnung{requiredMappingIssueCount === 1 ? ' fehlt' : 'en fehlen'}</span>}
                  <span className="text-xs text-gray-500">* Pflichtfeld{definition.requiredGroups && definition.requiredGroups.length > 0 ? ' · † eines davon nötig' : ''}</span>
                </div>
                <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-5 px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 sm:grid sm:px-4">
                  <span>Zielfeld im Workspace</span>
                  <span>Spalte aus Ihrer Datei oder fester Wert</span>
                </div>
                <div className="space-y-2">
                  {definition.fields.map(field => (
                    <FieldMappingCard
                      key={field.key}
                      field={field}
                      definition={definition}
                      parsedFile={parsedFile}
                      sourceHeader={mapping[field.key]}
                      constant={constants[field.key]}
                      format={columnFormats[field.key] ?? null}
                      ambiguous={!isSatisfied(field.key) && mappingAnalysis?.fields[field.key]?.confidence === 'ambiguous'}
                      enumValues={enumValues[field.key]}
                      valueMapping={valueMappings[field.key] || {}}
                      onMap={header => setTargetMapping(field.key, header)}
                      onConstant={value => setConstant(field.key, value)}
                      onValueOverride={(valueKey, target) => setValueOverride(field.key, valueKey, target)}
                      locale={company.locale || 'de-DE'}
                      dateFormat={company.dateFormat}
                    />
                  ))}
                </div>

                <div className="my-6 border-t border-dashed border-gray-300" />

                <div>
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Nicht zugeordnete Dateispalten</h4>
                    <span className="text-xs text-gray-400">{unmappedSourceHeaders.length} nicht zugeordnet</span>
                  </div>
                  {unmappedSourceHeaders.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {unmappedSourceHeaders.map(header => (
                        <span key={header} className="max-w-full truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700" title={header}>{header}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">Alle Spalten Ihrer Datei sind einem Zielfeld zugeordnet.</p>
                  )}
                </div>
              </div>

              {previewFields.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-700">So werden die ersten Zeilen gelesen</h4>
                  <div className="overflow-x-auto rounded-xl border border-gray-200">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-3 py-2">Zeile</th>{previewFields.map(field => <th key={field.key} className="whitespace-nowrap px-3 py-2">{field.label}</th>)}</tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {mappedRows.slice(0, 5).map(row => (
                          <tr key={String(row._rowNumber)}>
                            <td className="px-3 py-2 text-gray-500">{String(row._rowNumber)}</td>
                            {previewFields.map(field => <td key={field.key} className="max-w-xs truncate px-3 py-2 text-gray-800">{displayValue(field, row[field.key])}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <section className="rounded-xl border border-gray-200 p-4" aria-label="Zeilenauswahl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><h4 className="font-semibold text-gray-900">Zeilen für diese Kategorie</h4><p className="mt-1 text-sm text-gray-600">{mappedRows.length} von {parsedFile.rows.length} ausgewählt. Festwerte und Freigabe gelten nur für diese Zeilen.</p></div>
                  <div className="flex gap-2"><button type="button" onClick={() => { setSelectedRowIndexes(null); setPreview(null); }} className="text-sm font-medium text-primary-custom hover:underline">Alle auswählen</button><button type="button" onClick={() => { setSelectedRowIndexes([]); setPreview(null); }} className="text-sm font-medium text-primary-custom hover:underline">Alle abwählen</button></div>
                </div>
                <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-gray-200">
                  <table className="min-w-full text-left text-sm"><thead className="sticky top-0 bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-3 py-2">Übernehmen</th><th className="px-3 py-2">Zeile</th>{parsedFile.headers.slice(0, 3).map(header => <th key={header} className="max-w-48 truncate px-3 py-2">{header}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">
                    {parsedFile.rows.slice(0, 200).map((row, index) => {
                      const checked = selectedRowIndexes === null || selectedRowIndexes.includes(index);
                      return <tr key={index}><td className="px-3 py-2"><input type="checkbox" checked={checked} aria-label={`Zeile ${parsedFile.rowNumbers?.[index] ?? index + 2} übernehmen`} onChange={event => {
                        setSelectedRowIndexes(current => {
                          const all = parsedFile.rows.map((_, rowIndex) => rowIndex);
                          const next = new Set(current === null ? all : current);
                          if (event.target.checked) next.add(index); else next.delete(index);
                          return [...next].sort((a, b) => a - b);
                        });
                        setPreview(null);
                      }} /></td><td className="px-3 py-2 text-gray-500">{parsedFile.rowNumbers?.[index] ?? index + 2}</td>{parsedFile.headers.slice(0, 3).map(header => <td key={header} className="max-w-48 truncate px-3 py-2 text-gray-700">{String(row[header] ?? '')}</td>)}</tr>;
                    })}
                  </tbody></table>
                </div>
                {parsedFile.rows.length > 200 && <p className="mt-2 text-xs text-gray-500">Die ersten 200 Zeilen sind einzeln auswählbar; „Alle auswählen“ und „Alle abwählen“ gelten für die gesamte Datei.</p>}
              </section>
            </div>
          )}

          {step === 'preview' && preview && (
            <div className="space-y-5">
              {preview.demoMode && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Demo: Vorschau und Freigabe werden in diesem Browser simuliert. Es werden keine Serverdaten geändert.</p>}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <SummaryCard label="Zeilen" value={preview.summary.total} />
                <SummaryCard label={preview.summary.updated > 0 ? 'Bereit / Aktual.' : 'Bereit'} value={preview.summary.valid + preview.summary.updated} tone="green" />
                <SummaryCard label="Duplikate" value={preview.summary.duplicates} tone="gray" />
                <SummaryCard label="Warnungen" value={preview.summary.warnings} tone="amber" />
                <SummaryCard label="Fehler" value={preview.summary.errors} tone="red" />
              </div>
              {preview.newCustomers && preview.newCustomers.length > 0 && (
                <div className="rounded-xl border border-gray-200 p-4 text-sm text-gray-700">
                  <p className="font-semibold text-gray-900">{preview.newCustomers.length === 1 ? `Ein ${terminology.entity.singular} wird neu angelegt` : `${preview.newCustomers.length} ${entityPlural} werden neu angelegt`}</p>
                  <p className="mt-1 text-gray-600">{preview.newCustomers.slice(0, 12).map(customer => customer.name).join(', ')}{preview.newCustomers.length > 12 ? ' …' : ''}</p>
                </div>
              )}
              {preview.totals && preview.totals.byMonth.length > 0 && <TotalsTable totals={preview.totals} resource={resource} locale={company.locale || 'de-DE'} numberFormat={company.numberFormat} currency={company.currency} />}
              {preview.summary.errors > 0 && (
                <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">Einige Zeilen benötigen eine Korrektur.</p>
                    <p className="mt-1">Übernommen werden nur fehlerfreie Zeilen. Passen Sie die Zuordnung an (unten „Zuordnung ändern“) oder laden Sie die betroffenen Zeilen herunter, um sie in Ihrer Tabelle zu korrigieren.</p>
                  </div>
                  <button type="button" onClick={() => downloadIssues(preview.rows)} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 font-medium text-amber-900 hover:bg-amber-100">
                    <Download className="h-4 w-4" /> Hinweise herunterladen
                  </button>
                </div>
              )}
              <ImportResultTable rows={preview.rows} />
            </div>
          )}

          {step === 'result' && result && (
            <div className="space-y-5">
              <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-center text-green-900">
                <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
                <h3 className="mt-3 text-lg font-semibold">Import abgeschlossen</h3>
                <p className="mt-1 text-sm">{result.demoMode ? 'Simulation: ' : ''}{result.summary.imported} {result.summary.imported === 1 ? 'Eintrag wurde' : 'Einträge wurden'} {result.demoMode ? 'in der Demo simuliert' : 'gespeichert'}{result.summary.newCustomers ? `; dabei ${result.summary.newCustomers === 1 ? `wurde ein neuer ${terminology.entity.singular}` : `wurden ${result.summary.newCustomers} neue ${entityPlural}`} angelegt` : ''}.</p>
                {takeoverSessionId && <p className="mt-2 text-sm">Die Kategorie ist freigegeben. Schließen Sie dieses Fenster und prüfen Sie danach die nächste offene Kategorie.</p>}
                {result.runId && (
                  <p className="mt-3 text-sm">
                    Bis zum Abschluss des Umzugs können Sie diesen Import unter{' '}
                    <button type="button" onClick={() => { close(); window.location.hash = 'data-import'; }} className="inline-flex items-center gap-1 font-semibold underline">
                      <History className="h-3.5 w-3.5" /> Datenübernahme
                    </button>{' '}
                    vollständig rückgängig machen.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SummaryCard label="Gespeichert" value={result.summary.imported} tone="green" />
                <SummaryCard label="Duplikate" value={result.summary.duplicates} tone="gray" />
                <SummaryCard label="Fehler" value={result.summary.errors} tone="red" />
                <SummaryCard label="Übersprungen" value={result.summary.skipped} tone="amber" />
              </div>
              {result.summary.skipped > 0 && (
                <button type="button" onClick={() => downloadIssues(result.rows)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  <Download className="h-4 w-4" /> Nicht übernommene Zeilen herunterladen
                </button>
              )}
              <ImportResultTable rows={result.rows} />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-5 py-4 sm:px-6">
          <button type="button" disabled={isBusy} onClick={step === 'file' || step === 'result' ? close : () => { setPreview(null); setError(null); setStep(step === 'mapping' ? 'file' : 'mapping'); }} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">
            {step === 'file' || step === 'result' ? <X className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
            {step === 'file' || step === 'result' ? 'Schließen' : step === 'preview' ? 'Zuordnung ändern' : 'Zurück'}
          </button>
          {step === 'mapping' && <button type="button" onClick={runPreview} disabled={isBusy || mappedRows.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50">{isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Vorschau prüfen</button>}
          {step === 'preview' && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={runPreview} disabled={isBusy} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${isBusy ? 'animate-spin' : ''}`} />Neu prüfen</button>
              <button type="button" onClick={commitImport} disabled={isBusy || usableRows === 0} className="inline-flex items-center gap-2 rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50">{isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {takeoverSessionId ? 'Diese Kategorie übernehmen' : `${usableRecords} übernehmen`}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function displayValue(field: ImportFieldDefinition, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (field.type === 'date') return formatIsoDate(value);
  if (field.type === 'number' && typeof value === 'number') return value.toLocaleString('de-DE', { maximumFractionDigits: 4 });
  if (field.type === 'enum') return field.options?.find(option => option.value === value)?.label || String(value);
  return String(value);
}

interface FieldMappingCardProps {
  field: ImportFieldDefinition;
  definition: ImportDefinition;
  parsedFile: ParsedImportFile;
  sourceHeader?: string;
  constant?: string;
  format: ColumnFormat | null;
  ambiguous: boolean;
  enumValues?: Array<{ value: string; count: number; key: string; suggestion: string | null }>;
  valueMapping: Record<string, string>;
  onMap: (header: string) => void;
  onConstant: (value: string | null) => void;
  onValueOverride: (valueKey: string, target: string) => void;
  locale: string;
  dateFormat?: DateFormat;
}

function FieldMappingCard({ field, definition, parsedFile, sourceHeader, constant, format, ambiguous, enumValues, valueMapping, onMap, onConstant, onValueOverride, locale, dateFormat }: FieldMappingCardProps) {
  const inGroup = definition.requiredGroups?.some(group => group.fields.includes(field.key));
  const isRequired = field.required || inGroup;
  const hasConstant = constant !== undefined;
  // Excel liefert Datumswerte als JJJJ-MM-TT und Zahlen ohne Format; die
  // Beispiele werden wie in der Vorschau deutsch angezeigt.
  const samples = sourceHeader
    ? parsedFile.rows
      .map(row => row[sourceHeader])
      .filter(value => value !== undefined && value !== null && String(value).trim() !== '')
      .slice(0, 2)
      .map(value => (typeof value === 'number' ? value.toLocaleString('de-DE', { maximumFractionDigits: 4 }) : formatIsoDate(String(value).trim())))
    : [];
  const unresolved = enumValues?.filter(item => !valueMapping[item.key]).length || 0;
  const [valuesOpen, setValuesOpen] = useState(unresolved > 0);

  return (
    <div className={`import-mapping-card ${sourceHeader || hasConstant ? 'import-mapping-card--mapped' : isRequired ? 'import-mapping-card--required' : ''}`}>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] sm:items-center sm:gap-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`import-mapping-dot ${isRequired ? 'import-mapping-dot--required' : ''}`} />
            <p className="truncate font-semibold text-gray-900" title={field.label}>{field.label}{field.required ? ' *' : inGroup ? ' †' : ''}</p>
          </div>
        </div>
        <div className="min-w-0">
          {sourceHeader ? (
            <div className="import-mapping-source">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 shrink-0 text-primary-custom" />
                <div className="min-w-0 flex-1">
                  <p className="import-mapping-source-title truncate text-sm font-semibold" title={sourceHeader}>{sourceHeader}</p>
                  <p className="import-mapping-sample truncate text-xs" title={samples.join(' · ') || 'Keine Beispielwerte'}>
                    {samples.length > 0 ? `Beispiel: ${samples.join(' · ')}` : 'Keine Beispielwerte'}
                    {format ? ` · ${format.label}` : ''}
                  </p>
                </div>
                <button type="button" onClick={() => onMap('')} className="import-mapping-remove inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md" aria-label={`Verknüpfung für ${field.label} entfernen`} title="Verknüpfung entfernen">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {format && format.invalid > 0 && (
                <p className="import-mapping-warning mt-1 text-xs">{format.invalid} von {format.total} Werten sind nicht lesbar und werden in der Vorschau als Fehler gemeldet.</p>
              )}
            </div>
          ) : hasConstant ? (
            <div className="import-mapping-source">
              <div className="flex items-center gap-2">
                <PenLine className="h-4 w-4 shrink-0 text-primary-custom" />
                <span className="import-mapping-source-title shrink-0 text-xs font-semibold uppercase tracking-wide">Fester Wert</span>
                <div className="min-w-0 flex-1">
                  <ConstantInput field={field} value={constant || ''} onChange={onConstant} locale={locale} dateFormat={dateFormat} />
                </div>
                <button type="button" onClick={() => onConstant(null)} className="import-mapping-remove inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md" aria-label={`Festen Wert für ${field.label} entfernen`} title="Festen Wert entfernen">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <select aria-label={`Spalte aus Datei für ${field.label}`} value="" onChange={event => onMap(event.target.value)} className="import-mapping-select w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-custom/20">
              <option value="">Keine Spalte zugeordnet</option>
              {parsedFile.headers.map(header => <option key={header} value={header}>{header}</option>)}
              {field.constant && <option value={CONSTANT_OPTION}>Festen Wert für alle Zeilen verwenden …</option>}
            </select>
          )}
          {ambiguous && <p className="import-mapping-warning mt-1 text-xs">Mehrere passende Spalten erkannt – bitte prüfen.</p>}
        </div>
      </div>
      {sourceHeader && enumValues && enumValues.length > 0 && (
        <div className="mt-3 border-t border-gray-200 pt-2">
          <button type="button" onClick={() => setValuesOpen(open => !open)} className="inline-flex items-center gap-1 text-sm font-medium text-gray-700" aria-expanded={valuesOpen}>
            {valuesOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Werte zuordnen ({enumValues.length - unresolved} von {enumValues.length} erkannt)
          </button>
          {unresolved > 0 && !valuesOpen && <span className="import-mapping-warning ml-2 text-xs">{unresolved} ohne Zuordnung</span>}
          {valuesOpen && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {enumValues.map(item => (
                <label key={item.key} className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-gray-800" title={item.value}>{item.value} <span className="text-gray-400">({item.count}×)</span></span>
                  <select value={valueMapping[item.key] || ''} onChange={event => onValueOverride(item.key, event.target.value)} className="import-mapping-select w-44 shrink-0 rounded-lg px-2 py-1.5 text-sm">
                    <option value="">{field.key === 'category' ? 'Sonstige (Standard)' : 'Nicht zugeordnet'}</option>
                    {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConstantInput({ field, value, onChange, locale, dateFormat }: { field: ImportFieldDefinition; value: string; onChange: (value: string) => void; locale: string; dateFormat?: DateFormat }) {
  const className = 'import-mapping-select w-full rounded-md px-2 py-1 text-sm';
  if (field.type === 'enum') {
    return (
      <select aria-label={`Fester Wert für ${field.label}`} value={value} onChange={event => onChange(event.target.value)} className={className}>
        {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    );
  }
  if (field.type === 'date') {
    return <LocalizedDateInput aria-label={`Fester Wert für ${field.label}`} value={value} onChange={onChange} locale={locale} dateFormat={dateFormat} className={className} />;
  }
  return (
    <input
      aria-label={`Fester Wert für ${field.label}`}
      value={value}
      onChange={event => onChange(event.target.value)}
      inputMode={field.type === 'number' ? 'decimal' : undefined}
      placeholder={field.type === 'number' ? 'z. B. 19' : 'Wert für alle Zeilen'}
      className={className}
    />
  );
}

function TotalsTable({ totals, resource, locale, numberFormat, currency }: { totals: ImportTotals; resource: ImportResource; locale: string; numberFormat?: NumberFormat; currency?: string }) {
  const money = (value: number) => formatCurrency(value, locale, numberFormat, currency);
  const showIncome = totals.income !== 0 || resource === 'euerEntries';
  const showExpense = totals.expense !== 0;
  const showPayments = totals.invoicePayments !== 0 || resource === 'invoicePayments';
  const showInvoiced = resource === 'invoices';
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <p className="text-sm font-semibold text-gray-800">Summenkontrolle</p>
        <p className="text-xs text-gray-500">Vergleichen Sie diese Summen mit Ihrer Tabelle, bevor Sie übernehmen. Gezählt werden nur übernehmbare Zeilen.</p>
      </div>
      <div className="max-h-64 overflow-auto">
        <table className="min-w-full text-right text-sm">
          <thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Monat</th>
              {showInvoiced && <th className="px-4 py-2">Rechnungen</th>}
              {showIncome && <th className="px-4 py-2">Einnahmen ohne Rechnung</th>}
              {showPayments && <th className="px-4 py-2">Zahlungen zu Rechnungen</th>}
              {showExpense && <th className="px-4 py-2">Ausgaben</th>}
              <th className="px-4 py-2">Zeilen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {totals.byMonth.map(month => (
              <tr key={month.month}>
                <td className="px-4 py-2 text-left text-gray-700">{formatMonth(month.month)}</td>
                {showInvoiced && <td className="px-4 py-2 text-gray-900">{money(month.invoiced)}</td>}
                {showIncome && <td className="px-4 py-2 text-emerald-700">{money(month.income)}</td>}
                {showPayments && <td className="px-4 py-2 text-emerald-700">{money(month.invoicePayments)}</td>}
                {showExpense && <td className="px-4 py-2 text-rose-700">{money(month.expense)}</td>}
                <td className="px-4 py-2 text-gray-500">{month.count}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 border-t border-gray-200 bg-gray-50 font-semibold">
            <tr>
              <td className="px-4 py-2 text-left text-gray-900">Gesamt</td>
              {showInvoiced && <td className="px-4 py-2 text-gray-900">{money(totals.invoiced)}</td>}
              {showIncome && <td className="px-4 py-2 text-emerald-700">{money(totals.income)}</td>}
              {showPayments && <td className="px-4 py-2 text-emerald-700">{money(totals.invoicePayments)}</td>}
              {showExpense && <td className="px-4 py-2 text-rose-700">{money(totals.expense)}</td>}
              <td className="px-4 py-2 text-gray-500">{totals.byMonth.reduce((sum, month) => sum + month.count, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {showInvoiced && totals.openAmount > 0 && <p className="border-t border-gray-200 px-4 py-2 text-sm text-gray-700">Davon offen: <strong>{money(totals.openAmount)}</strong></p>}
    </div>
  );
}

function SummaryCard({ label, value, tone = 'gray' }: { label: string; value: number; tone?: 'gray' | 'green' | 'amber' | 'red' }) {
  const tones = {
    gray: 'border-gray-200 bg-white text-gray-900',
    green: 'border-green-200 bg-green-50 text-green-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-900',
  };
  return <div className={`rounded-xl border p-3 ${tones[tone]}`}><p className="text-xs uppercase tracking-wide opacity-70">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>;
}

export function ImportResultTable({ rows }: { rows: ImportRowResult[] }) {
  const counts = useMemo(() => rows.reduce<Record<string, number>>((result, row) => {
    result[row.status] = (result[row.status] || 0) + 1;
    return result;
  }, {}), [rows]);
  const problemCount = (counts.error || 0) + (counts.warning || 0) + (counts.duplicate || 0);
  const [filter, setFilter] = useState<RowFilter>(problemCount > 0 ? 'problems' : 'all');
  const [visible, setVisible] = useState(ROW_PAGE_SIZE);
  const filtered = rows.filter(row => {
    if (filter === 'all') return true;
    if (filter === 'problems') return row.status === 'error' || row.status === 'warning' || row.status === 'duplicate';
    if (filter === 'ready') return row.status === 'valid' || row.status === 'update' || row.status === 'imported';
    return row.status === filter;
  });
  const filters: Array<{ id: RowFilter; label: string; count: number }> = [
    { id: 'problems', label: 'Mit Hinweis', count: problemCount },
    { id: 'error', label: 'Fehler', count: counts.error || 0 },
    { id: 'warning', label: 'Warnungen', count: counts.warning || 0 },
    { id: 'duplicate', label: 'Duplikate', count: counts.duplicate || 0 },
    { id: 'ready', label: counts.imported ? 'Importiert' : 'Bereit', count: (counts.valid || 0) + (counts.update || 0) + (counts.imported || 0) },
    { id: 'all', label: 'Alle', count: rows.length },
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3 text-sm">
        <span className="mr-2 font-semibold text-gray-800">Zeilenstatus</span>
        {filters.filter(item => item.count > 0 || item.id === 'all').map(item => (
          <button key={item.id} type="button" onClick={() => { setFilter(item.id); setVisible(ROW_PAGE_SIZE); }} aria-pressed={filter === item.id} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${filter === item.id ? 'border-primary-custom bg-primary-custom text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'}`}>
            {item.label} {item.count}
          </button>
        ))}
      </div>
      <div className="max-h-72 overflow-y-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-2">Zeile</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Hinweis</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.slice(0, visible).map(row => <tr key={`${row.rowNumber}-${row.status}`}><td className="px-4 py-2 align-top text-gray-500">{row.rowNumber}</td><td className="px-4 py-2 align-top"><span className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ${statusClasses[row.status] || statusClasses.error}`}>{statusLabels[row.status] || row.status}</span></td><td className="px-4 py-2 text-gray-700">{row.message}</td></tr>)}
            {filtered.length === 0 && <tr><td colSpan={3} className="px-4 py-4 text-center text-gray-500">Keine Zeilen in dieser Auswahl.</td></tr>}
          </tbody>
        </table>
        {filtered.length > visible && (
          <div className="border-t border-gray-100 p-3 text-center">
            <button type="button" onClick={() => setVisible(count => count + ROW_PAGE_SIZE)} className="text-sm font-medium text-primary-custom hover:underline">Weitere {Math.min(ROW_PAGE_SIZE, filtered.length - visible)} von {filtered.length - visible} anzeigen</button>
          </div>
        )}
      </div>
    </div>
  );
}
