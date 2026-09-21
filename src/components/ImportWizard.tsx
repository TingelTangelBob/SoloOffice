import { useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, FileUp, Link2, Loader2, RefreshCw, Upload, X } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { apiService } from '../services/api';
import type { ImportDuplicateMode, ImportResource, ImportResponse } from '../types';
import {
  analyseHeaderMapping,
  getImportDefinition,
  mapImportRows,
  parseImportFile,
  type ParsedImportFile,
} from '../utils/importParser';
import { getTerminology, type TerminologyDefinition } from '../utils/terminology';

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

function localizeImportDefinition(definition: ReturnType<typeof getImportDefinition>, terminology: TerminologyDefinition) {
  const entityNameLabel = `${terminology.entity.genitive}name`;
  const entityEmailLabel = `${terminology.entity.genitive}-E-Mail`;
  const entityLabels: Record<string, string> = {
    customerId: `${terminology.entity.genitive}-ID`,
    customerNumber: terminology.entity.numberLabel,
    customerName: entityNameLabel,
    customerEmail: entityEmailLabel,
    customerAddress: terminology.entity.addressLabel,
    customerType: `${terminology.entity.genitive}art`,
    name: entityNameLabel,
    email: entityEmailLabel,
    address: terminology.entity.addressLabel,
  };
  const resourceLabel = definition.resource === 'customers'
    ? terminology.entity.plural
    : definition.resource === 'jobs'
      ? terminology.work.plural
      : definition.label;
  const description = definition.resource === 'jobs'
    ? `${terminology.work.plural} importieren und ${terminology.entity.singular} über ID, Nummer, E-Mail oder Name zuordnen.`
    : definition.resource === 'customers'
      ? `${terminology.entity.plural} aus CSV, TSV oder JSON übernehmen und bestehende ${terminology.entity.plural.toLocaleLowerCase('de-DE')} automatisch erkennen.`
      : definition.description.replace(/Kunden/gi, terminology.entity.plural).replace(/Kunde/gi, terminology.entity.singular);

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

export function ImportWizard({ resource, isOpen, onClose, onImported }: ImportWizardProps) {
  const { company } = useCompany();
  const baseDefinition = getImportDefinition(resource);
  const terminology = getTerminology(company.terminologyProfile);
  const definition = useMemo(
    () => localizeImportDefinition(baseDefinition, terminology),
    [baseDefinition, terminology],
  );
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
  const mappingAnalysis = useMemo(
    () => parsedFile ? analyseHeaderMapping(parsedFile.headers, definition) : null,
    [definition, parsedFile]
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
      setMapping(analyseHeaderMapping(parsed.headers, definition).mapping);
      setStep('mapping');
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Die Datei konnte nicht gelesen werden.');
    } finally {
      setIsBusy(false);
    }
  };

  const setTargetMapping = (targetField: string, sourceHeader: string) => {
    setMapping(previous => {
      const next = { ...previous };
      if (sourceHeader) next[targetField] = sourceHeader;
      else delete next[targetField];
      return next;
    });
    setPreview(null);
    setError(null);
  };

  const runPreview = async () => {
    if (!parsedFile || mappedRows.length === 0) {
      setError('Es wurden keine Datenzeilen gefunden.');
      return;
    }
    const missingRequired = definition.fields
      .filter(field => field.required && !mapping[field.key])
      .map(field => field.label);
    const missingGroups = (definition.requiredGroups || [])
      .filter(group => group.fields.every(fieldKey => !mapping[fieldKey]))
      .map(group => `mindestens eine Spalte für ${group.label}`);
    if (missingRequired.length > 0 || missingGroups.length > 0) {
      setError(`Bitte ordnen Sie noch zu: ${[...missingRequired, ...missingGroups].join(', ')}.`);
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
  const mappedFieldCount = definition.fields.filter(field => mapping[field.key]).length;
  const ambiguousFieldCount = definition.fields.filter(field => mappingAnalysis?.fields[field.key]?.confidence === 'ambiguous').length;
  const missingRequiredFields = definition.fields.filter(field => field.required && !mapping[field.key]);
  const missingRequiredGroups = (definition.requiredGroups || []).filter(group => group.fields.every(fieldKey => !mapping[fieldKey]));
  const requiredMappingIssueCount = missingRequiredFields.length + missingRequiredGroups.length;
  const orderedMappingFields = [...definition.fields].sort((left, right) => {
    const leftRequired = left.required || definition.requiredGroups?.some(group => group.fields.includes(left.key)) || false;
    const rightRequired = right.required || definition.requiredGroups?.some(group => group.fields.includes(right.key)) || false;
    if (leftRequired !== rightRequired) return leftRequired ? -1 : 1;

    const leftMapped = Boolean(mapping[left.key]);
    const rightMapped = Boolean(mapping[right.key]);
    if (leftMapped !== rightMapped) return leftMapped ? -1 : 1;

    return definition.fields.indexOf(left) - definition.fields.indexOf(right);
  });
  const mappedSourceHeaders = new Set(Object.values(mapping).filter(Boolean));
  const unmappedSourceHeaders = parsedFile
    ? parsedFile.headers.filter(header => !mappedSourceHeaders.has(header))
    : [];

  return (
    <div className="dialog-overlay fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-3 sm:p-6" onClick={event => event.target === event.currentTarget && close()}>
      <div className="form-consistent-fields flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="import-wizard-title">
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
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,.json,text/csv,application/json"
                  className="hidden"
                  onChange={event => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    void handleFile(file);
                  }}
                  disabled={isBusy}
                />
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
                <button type="button" onClick={() => { setParsedFile(null); setMapping({}); setPreview(null); setError(null); setStep('file'); }} className="text-sm font-medium text-primary-custom hover:underline">Andere Datei wählen</button>
              </div>

              {parsedFile.warnings.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{parsedFile.warnings.join(' ')}</div>}

              <div>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">Spalten zuordnen</h3>
                    <p className="text-sm text-gray-500">Die Zuordnung ist auf diesen Importbereich zugeschnitten und kann vor der Prüfung angepasst werden.</p>
                  </div>
                  <label className="text-sm text-gray-700">
                    <span className="mr-2 font-medium">Duplikate</span>
                    <select value={duplicateMode} onChange={event => setDuplicateMode(event.target.value as ImportDuplicateMode)} disabled={!canUpdate} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-100">
                      <option value="skip">überspringen</option>
                      {canUpdate && <option value="update">Stammdaten aktualisieren</option>}
                    </select>
                  </label>
                </div>
                <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
                  <p className="font-semibold">Automatische Spaltenzuordnung</p>
                  <p className="mt-1 leading-5">Die Quellspalten Ihrer Datei stehen oben, die Zielfelder des Workspace rechts daneben. Eine bestehende Zuordnung ändern Sie über „Entfernen“; weitere freie Zielfelder ordnen Sie unten zu.</p>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-medium text-blue-800">
                    <span>{mappedFieldCount} von {definition.fields.length} Zielfeldern zugeordnet</span>
                    {ambiguousFieldCount > 0 && <span className="text-amber-800">{ambiguousFieldCount} bitte manuell prüfen</span>}
                    {requiredMappingIssueCount > 0 && <span className="text-red-800">{requiredMappingIssueCount} Pflichtangaben fehlen</span>}
                    {definition.requiredGroups && definition.requiredGroups.length > 0 && <span>* Pflichtfeld · † eine Spalte je Bereich genügt</span>}
                  </div>
                </div>
                {mappingAnalysis && mappingAnalysis.warnings.length > 0 && (
                  <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    {mappingAnalysis.warnings.map(warning => <p key={warning}>{warning}</p>)}
                  </div>
                )}
                <div className="space-y-3">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Zielfelder für diesen Import</h4>
                      <p className="mt-1 text-sm text-gray-500">Links stehen die benötigten Felder im Workspace, rechts die passende Spalte aus Ihrer Datei.</p>
                    </div>
                    <span className="hidden text-xs text-gray-400 sm:inline">{definition.fields.length} Zielfelder</span>
                  </div>
                  <div className="space-y-2">
                    {orderedMappingFields.map(field => {
                      const sourceHeader = mapping[field.key];
                      const isRequired = field.required || definition.requiredGroups?.some(group => group.fields.includes(field.key));
                      const confidence = mappingAnalysis?.fields[field.key]?.confidence;
                      const samples = sourceHeader
                        ? parsedFile.rows.slice(0, 2).map(row => String(row[sourceHeader] ?? '').trim()).filter(Boolean)
                        : [];
                      return (
                        <div key={field.key} className={`rounded-xl border p-3 sm:p-4 ${sourceHeader ? 'border-blue-100 bg-white' : isRequired ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200 bg-gray-50'}`}>
                          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] sm:items-center sm:gap-5">
                            <div className="min-w-0">
                              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Zielfeld im Workspace</span>
                              <div className="flex items-center gap-2">
                                <span className={`h-2 w-2 shrink-0 rounded-full ${isRequired ? 'bg-amber-500' : 'bg-gray-300'}`} />
                                <p className="truncate font-semibold text-gray-900" title={field.label}>{field.label}{field.required ? ' *' : definition.requiredGroups?.some(group => group.fields.includes(field.key)) ? ' †' : ''}</p>
                              </div>
                              <p className={`mt-1 pl-4 text-xs ${isRequired ? 'text-amber-800' : 'text-gray-500'}`}>
                                {field.required ? 'Pflichtfeld' : definition.requiredGroups?.some(group => group.fields.includes(field.key)) ? 'Pflichtbereich: mindestens eine Spalte genügt' : 'Optional'}
                              </p>
                            </div>
                            <div className="min-w-0">
                              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Spalte aus Ihrer Datei</span>
                              {sourceHeader ? (
                                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                                  <div className="flex items-center gap-2">
                                    <Link2 className="h-4 w-4 shrink-0 text-primary-custom" />
                                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-blue-950" title={sourceHeader}>{sourceHeader}</span>
                                    <button type="button" onClick={() => setTargetMapping(field.key, '')} className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100">Entfernen</button>
                                  </div>
                                  <p className="mt-1 truncate pl-6 text-xs text-blue-800" title={samples.join(' · ') || 'Keine Beispielwerte'}>
                                    {samples.length > 0 ? `Beispiel: ${samples.join(' · ')}` : 'Keine Beispielwerte'}
                                  </p>
                                </div>
                              ) : (
                                <>
                                  <select aria-label={`Spalte aus Datei für ${field.label}`} value="" onChange={event => setTargetMapping(field.key, event.target.value)} className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-primary-custom focus:outline-none focus:ring-2 focus:ring-primary-custom/20">
                                    <option value="">Keine passende Spalte gefunden</option>
                                    {parsedFile.headers.map(header => <option key={header} value={header}>{header}</option>)}
                                  </select>
                                  <p className={`mt-1 text-xs ${isRequired ? 'font-medium text-amber-800' : 'text-gray-500'}`}>
                                    {field.required ? 'Bitte manuell zuordnen.' : definition.requiredGroups?.some(group => group.fields.includes(field.key)) ? 'Mindestens eine Spalte aus diesem Bereich muss zugeordnet sein.' : 'Kann bei Bedarf manuell zugeordnet werden.'}
                                  </p>
                                </>
                              )}
                              {confidence === 'ambiguous' && <p className="mt-1 text-xs font-medium text-amber-700">Mehrere passende Spalten erkannt – bitte prüfen.</p>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="my-6 border-t border-dashed border-gray-300" />

                <div>
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Weitere Spalten aus Ihrer Datei</h4>
                      <p className="mt-1 text-sm text-gray-500">Für diese Spalten wurde kein Zielfeld automatisch gefunden. Sie werden nur importiert, wenn Sie sie oben manuell zuordnen.</p>
                    </div>
                    <span className="text-xs text-gray-400">{unmappedSourceHeaders.length} nicht zugeordnet</span>
                  </div>
                  {unmappedSourceHeaders.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {unmappedSourceHeaders.map(header => {
                        const samples = parsedFile.rows.slice(0, 2).map(row => String(row[header] ?? '').trim()).filter(Boolean);
                        return (
                          <div key={header} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                            <p className="truncate text-sm font-medium text-gray-800" title={header}>{header}</p>
                            <p className="mt-1 truncate text-xs text-gray-500" title={samples.join(' · ') || 'Keine Beispielwerte'}>
                              {samples.length > 0 ? `Beispiel: ${samples.join(' · ')}` : 'Keine Beispielwerte'}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">Alle Spalten Ihrer Datei sind bereits einem Zielfeld zugeordnet.</p>
                  )}
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
                <p>{terminology.entity.plural}, Pflichtfelder, Datums- und Zahlenwerte sowie vorhandene Namen/Nummern wurden serverseitig geprüft. Fehlerhafte und doppelte Zeilen werden nicht übernommen.</p>
              </div>
              {preview.summary.errors > 0 && (
                <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">Einige Zeilen benötigen eine Korrektur.</p>
                    <p className="mt-1">Ändern Sie die Zuordnung und prüfen Sie die Datei erneut. Übernommen werden nur fehlerfreie Zeilen.</p>
                  </div>
                  <button type="button" onClick={() => { setPreview(null); setStep('mapping'); }} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 font-medium text-amber-900 hover:bg-amber-100">
                    <ArrowLeft className="h-4 w-4" /> Zuordnung ändern
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
          <button type="button" onClick={step === 'file' || step === 'result' ? close : () => { setPreview(null); setError(null); setStep(step === 'mapping' ? 'file' : 'mapping'); }} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
            {step === 'file' || step === 'result' ? <X className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
            {step === 'file' || step === 'result' ? 'Schließen' : step === 'preview' ? 'Zuordnung ändern' : 'Zurück'}
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
