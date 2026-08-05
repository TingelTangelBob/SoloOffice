import { useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, FileUp, Loader2, RefreshCw, Upload, X } from 'lucide-react';
import { apiService } from '../services/api';
import type { ImportDuplicateMode, ImportResource, ImportResponse } from '../types';
import {
  autoMapHeaders,
  getImportDefinition,
  mapImportRows,
  parseImportFile,
  type ParsedImportFile,
} from '../utils/importParser';

interface ImportWizardProps {
  resource: ImportResource;
  isOpen: boolean;
  onClose: () => void;
  onImported?: () => void | Promise<void>;
}

type ImportStep = 'file' | 'mapping' | 'preview' | 'result';

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

export function ImportWizard({ resource, isOpen, onClose, onImported }: ImportWizardProps) {
  const definition = getImportDefinition(resource);
  const canUpdate = updateResources.includes(resource);
  const [step, setStep] = useState<ImportStep>('file');
  const [parsedFile, setParsedFile] = useState<ParsedImportFile | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [duplicateMode, setDuplicateMode] = useState<ImportDuplicateMode>('skip');
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mappedRows = useMemo(
    () => parsedFile ? mapImportRows(parsedFile, mapping) : [],
    [mapping, parsedFile]
  );

  if (!isOpen) return null;

  const reset = () => {
    setStep('file');
    setParsedFile(null);
    setMapping({});
    setDuplicateMode('skip');
    setPreview(null);
    setResult(null);
    setIsBusy(false);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setIsBusy(true);
    setError(null);
    try {
      const parsed = await parseImportFile(file);
      setParsedFile(parsed);
      setMapping(autoMapHeaders(parsed.headers, definition));
      setStep('mapping');
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Die Datei konnte nicht gelesen werden.');
    } finally {
      setIsBusy(false);
    }
  };

  const runPreview = async () => {
    if (!parsedFile || mappedRows.length === 0) {
      setError('Es wurden keine Datenzeilen gefunden.');
      return;
    }
    const missingRequired = definition.fields
      .filter(field => field.required && !mapping[field.key])
      .map(field => field.label);
    if (missingRequired.length > 0) {
      setError(`Bitte ordnen Sie noch zu: ${missingRequired.join(', ')}.`);
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      const response = await apiService.importData(resource, mappedRows, { dryRun: true, duplicateMode });
      setPreview(response);
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
      const response = await apiService.importData(resource, mappedRows, { dryRun: false, duplicateMode });
      setResult(response);
      setStep('result');
      await onImported?.();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Der Import konnte nicht gespeichert werden.');
    } finally {
      setIsBusy(false);
    }
  };

  const stepIndex = { file: 1, mapping: 2, preview: 3, result: 4 }[step];
  const usableRows = preview ? preview.summary.valid + preview.summary.updated : 0;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-3 sm:p-6" onClick={event => event.target === event.currentTarget && close()}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="import-wizard-title">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary-custom">
              <Upload className="h-4 w-4" /> Importassistent · Schritt {stepIndex} von 4
            </div>
            <h2 id="import-wizard-title" className="mt-1 truncate text-xl font-semibold text-gray-900">{definition.label} importieren</h2>
            <p className="mt-1 hidden text-sm text-gray-500 sm:block">{definition.description}</p>
          </div>
          <button type="button" onClick={close} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Importassistent schließen">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {error && (
            <div className="mb-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {step === 'file' && (
            <div className="space-y-5">
              <label className="flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 p-6 text-center transition hover:border-primary-custom hover:bg-blue-50">
                {isBusy ? <Loader2 className="mb-3 h-10 w-10 animate-spin text-primary-custom" /> : <FileUp className="mb-3 h-10 w-10 text-primary-custom" />}
                <span className="font-semibold text-gray-900">Datei auswählen</span>
                <span className="mt-1 text-sm text-gray-500">CSV, TSV oder JSON · maximal 10 MB</span>
                <span className="mt-3 rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white">Durchsuchen</span>
                <input type="file" accept=".csv,.tsv,.txt,.json,text/csv,application/json" className="hidden" onChange={event => handleFile(event.target.files?.[0])} disabled={isBusy} />
              </label>
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
                <p className="font-semibold">Erkannte Formate</p>
                <p>Trennzeichen, UTF-8-BOM, deutsche/englische Spaltennamen, Dezimal-Komma und JSON-Listen werden automatisch erkannt. Excel-Dateien bitte als CSV UTF-8 exportieren.</p>
              </div>
            </div>
          )}

          {step === 'mapping' && parsedFile && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <FileUp className="h-5 w-5 shrink-0 text-primary-custom" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-900">{parsedFile.fileName}</p>
                    <p className="text-sm text-gray-500">{parsedFile.format.toUpperCase()} · {parsedFile.rows.length} Datenzeilen · {parsedFile.headers.length} Spalten</p>
                  </div>
                </div>
                <button type="button" onClick={() => { setParsedFile(null); setMapping({}); setStep('file'); }} className="text-sm font-medium text-primary-custom hover:underline">Andere Datei wählen</button>
              </div>

              {parsedFile.warnings.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{parsedFile.warnings.join(' ')}</div>}

              <div>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">Spalten zuordnen</h3>
                    <p className="text-sm text-gray-500">Die Vorschläge basieren auf deutschen und englischen Feldnamen und können angepasst werden.</p>
                  </div>
                  <label className="text-sm text-gray-700">
                    <span className="mr-2 font-medium">Duplikate</span>
                    <select value={duplicateMode} onChange={event => setDuplicateMode(event.target.value as ImportDuplicateMode)} disabled={!canUpdate} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-100">
                      <option value="skip">überspringen</option>
                      {canUpdate && <option value="update">Stammdaten aktualisieren</option>}
                    </select>
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {definition.fields.map(field => (
                    <label key={field.key} className="rounded-lg border border-gray-200 bg-white p-3">
                      <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">{field.label}{field.required ? ' *' : ''}</span>
                      <select value={mapping[field.key] || ''} onChange={event => setMapping(previous => ({ ...previous, [field.key]: event.target.value }))} className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm text-gray-800 focus:border-primary-custom focus:outline-none focus:ring-2 focus:ring-primary-custom/20">
                        <option value="">Nicht importieren</option>
                        {parsedFile.headers.map(header => <option key={header} value={header}>{header}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-3 py-2">Zeile</th>{definition.fields.filter(field => mapping[field.key]).slice(0, 5).map(field => <th key={field.key} className="px-3 py-2">{field.label}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {mappedRows.slice(0, 5).map(row => <tr key={String(row._rowNumber)}><td className="px-3 py-2 text-gray-500">{String(row._rowNumber)}</td>{definition.fields.filter(field => mapping[field.key]).slice(0, 5).map(field => <td key={field.key} className="max-w-xs truncate px-3 py-2 text-gray-800">{String(row[field.key] ?? '')}</td>)}</tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 'preview' && preview && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <SummaryCard label="Zeilen" value={preview.summary.total} />
                <SummaryCard label="Bereit" value={preview.summary.valid} tone="green" />
                <SummaryCard label="Duplikate" value={preview.summary.duplicates} tone="gray" />
                <SummaryCard label="Warnungen" value={preview.summary.warnings} tone="amber" />
                <SummaryCard label="Fehler" value={preview.summary.errors} tone="red" />
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
                <p className="font-semibold">Vor dem Speichern geprüft</p>
                <p>Kundenbezüge, Pflichtfelder, Datums- und Zahlenwerte sowie vorhandene Namen/Nummern wurden serverseitig geprüft. Fehlerhafte und doppelte Zeilen werden nicht übernommen.</p>
              </div>
              <ImportResultTable rows={preview.rows} />
            </div>
          )}

          {step === 'result' && result && (
            <div className="space-y-5">
              <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-center text-green-900">
                <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
                <h3 className="mt-3 text-lg font-semibold">Import abgeschlossen</h3>
                <p className="mt-1 text-sm">{result.summary.imported} {result.summary.imported === 1 ? 'Eintrag wurde' : 'Einträge wurden'} gespeichert.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SummaryCard label="Gespeichert" value={result.summary.imported} tone="green" />
                <SummaryCard label="Duplikate" value={result.summary.duplicates} tone="gray" />
                <SummaryCard label="Fehler" value={result.summary.errors} tone="red" />
                <SummaryCard label="Übersprungen" value={result.summary.skipped} tone="amber" />
              </div>
              <ImportResultTable rows={result.rows} />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-5 py-4 sm:px-6">
          <button type="button" onClick={step === 'file' || step === 'result' ? close : () => setStep(step === 'mapping' ? 'file' : 'mapping')} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
            {step === 'file' || step === 'result' ? <X className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
            {step === 'file' || step === 'result' ? 'Schließen' : 'Zurück'}
          </button>
          {step === 'mapping' && <button type="button" onClick={runPreview} disabled={isBusy || mappedRows.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50">{isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Vorschau prüfen</button>}
          {step === 'preview' && <div className="flex items-center gap-2"><button type="button" onClick={runPreview} disabled={isBusy} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${isBusy ? 'animate-spin' : ''}`} />Neu prüfen</button><button type="button" onClick={commitImport} disabled={isBusy || usableRows === 0} className="inline-flex items-center gap-2 rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50">{isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {usableRows} übernehmen</button></div>}
        </div>
      </div>
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

function ImportResultTable({ rows }: { rows: ImportResponse['rows'] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-800">Zeilenstatus</div>
      <div className="max-h-72 overflow-y-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-2">Zeile</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Hinweis</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(row => <tr key={`${row.rowNumber}-${row.status}`}><td className="px-4 py-2 text-gray-500">{row.rowNumber}</td><td className="px-4 py-2"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusClasses[row.status] || statusClasses.error}`}>{statusLabels[row.status] || row.status}</span></td><td className="px-4 py-2 text-gray-700">{row.message}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
