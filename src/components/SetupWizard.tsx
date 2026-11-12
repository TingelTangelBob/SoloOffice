import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { apiService } from '../services/api';
import type { Company, WorkspaceSetup, WorkspaceMigrationChoice, TakeoverStatus } from '../types';
import { ColorPicker } from './ColorPicker';
import { InfoTooltip } from './InfoTooltip';
import { PageHeader } from './PageHeader';
import { getTerminology, terminologyProfiles } from '../utils/terminology';
import { normalizeIdentifier, validateCompanyFormats, validateCompanyRequiredFields } from '../../backend/shared/companyValidation.js';

const steps = ['Betrieb & Kontakt', 'Steuer & Rechnung', 'Zahlung & Auftritt', 'Module & Prüfung', 'Datenübernahme'];

// Bezeichnungen wie in den Einstellungen (Arbeitsbereich > Module).
const MODULE_OPTIONS = [
  ['quotesEnabled', 'Angebote', 'Angebote erstellen und nachverfolgen'],
  ['jobTrackingEnabled', '', ''],
  ['reportingEnabled', 'Reporting & Auswertungen', 'Umsatz und Kennzahlen einsehen'],
  ['discountsEnabled', 'Rabatt-Funktion', 'Rabatte in Belegen nutzen'],
] as const;

// Pflichtfelder von Schritt 1 und Prüfreihenfolge aller Felder (für Fokus auf das erste fehlerhafte Feld).
const REQUIRED_FIELDS = ['name', 'address', 'postalCode', 'city', 'country', 'phone', 'email'];
const FIELD_ORDER = ['name', 'email', 'address', 'postalCode', 'city', 'country', 'phone', 'website', 'taxBusinessType', 'legalForm', 'taxId', 'taxIdentificationNumber', 'invoiceStartNumber', 'bankAccount', 'bic'];
const IDENTIFIER_FIELDS = ['taxId', 'bic', 'bankAccount'];

function stepOfField(field: string): number {
  if (['name', 'address', 'postalCode', 'city', 'country', 'phone', 'email', 'website'].includes(field)) return 1;
  if (['taxBusinessType', 'legalForm', 'taxId', 'taxIdentificationNumber', 'invoiceStartNumber'].includes(field)) return 2;
  return 3;
}

/** IBAN, BIC und USt-IdNr. ohne Leerzeichen und in Großbuchstaben, bevor sie geprüft werden. */
function normalizeCompany(data: Partial<Company>): Partial<Company> {
  const result: Partial<Company> = { ...data };
  if (typeof result.taxId === 'string') result.taxId = normalizeIdentifier(result.taxId);
  if (typeof result.bic === 'string') result.bic = normalizeIdentifier(result.bic);
  if (typeof result.bankAccount === 'string') result.bankAccount = normalizeIdentifier(result.bankAccount);
  if (result.paymentInformation) {
    const info = { ...result.paymentInformation };
    if (typeof info.bankAccount === 'string') info.bankAccount = normalizeIdentifier(info.bankAccount);
    if (typeof info.bic === 'string') info.bic = normalizeIdentifier(info.bic);
    result.paymentInformation = info;
  }
  return result;
}

function selectionCardClass(selected: boolean): string {
  return `rounded-xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-color)] ${selected
    ? 'border-primary-custom bg-[var(--accent-tint)] ring-1 ring-[var(--primary-color)]'
    : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'}`;
}

interface SetupWizardProps {
  onNavigate: (page: string, filter?: string) => void;
}

export function SetupWizard({ onNavigate }: SetupWizardProps) {
  const { company, updateCompany } = useCompany();
  const [setup, setSetup] = useState<WorkspaceSetup | null>(null);
  const [takeover, setTakeover] = useState<TakeoverStatus | null>(null);
  // Der einmalige Umzug ist laut Sitzungsstatus bereits abgeschlossen.
  const migrationDone = takeover?.session?.status === 'completed';
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Partial<Company>>({});
  const [choice, setChoice] = useState<WorkspaceMigrationChoice>('undecided');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const merged = normalizeCompany({ ...company, ...draft });
  const formatErrors = validateCompanyFormats(merged) as Record<string, string | undefined>;
  const requiredErrors = validateCompanyRequiredFields({
    name: merged.name ?? '', address: merged.address ?? '', postalCode: merged.postalCode ?? '', city: merged.city ?? '',
    country: merged.country ?? '', phone: merged.phone ?? '', email: merged.email ?? '',
    taxBusinessType: merged.taxBusinessType ?? '', legalForm: merged.legalForm ?? '',
  }) as Record<string, string | undefined>;
  // Fehler je Feld: Formatfehler sofort, fehlende Pflichtangaben nach dem ersten Versuch weiterzugehen.
  const fieldErrors: Record<string, string | undefined> = {
    ...(showErrors ? requiredErrors : {}),
    ...formatErrors,
    bankAccount: formatErrors.bankAccount || formatErrors['paymentInformation.bankAccount'],
    bic: formatErrors.bic || formatErrors['paymentInformation.bic'],
  };
  const terminology = getTerminology(merged.terminologyProfile);

  // Beim Schrittwechsel Überschrift fokussieren und nach oben scrollen.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  useEffect(() => {
    let active = true;
    apiService.getWorkspaceSetup().then(value => {
      if (!active) return;
      setSetup(value);
      setStep(value.currentStep);
      setChoice(value.migrationChoice);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Einrichtungsstand konnte nicht geladen werden.');
    });
    apiService.getTakeoverStatus().then(value => { if (active) setTakeover(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const field = <K extends keyof Company>(key: K, label: string, type = 'text', extra: { autoComplete?: string; inputMode?: 'numeric' | 'url' | 'tel' | 'email'; min?: number; max?: number } = {}) => {
    const name = String(key);
    const fieldError = fieldErrors[name];
    const required = REQUIRED_FIELDS.includes(name);
    return (
    <label className="block space-y-1.5 text-sm font-medium text-gray-700" key={name}>
      <span className="inline-flex items-center gap-1">
        {label}
        {required && <span className="text-red-600" aria-hidden="true">*</span>}
      </span>
      <input
        id={`setup-${name}`}
        type={type}
        required={required}
        autoComplete={extra.autoComplete}
        inputMode={extra.inputMode}
        min={extra.min}
        max={extra.max}
        aria-invalid={Boolean(fieldError)}
        aria-describedby={fieldError ? `setup-${name}-error` : undefined}
        value={String(key === 'bankAccount'
          ? draft.paymentInformation?.bankAccount ?? draft.bankAccount ?? company.paymentInformation?.bankAccount ?? company.bankAccount ?? ''
          : key === 'invoiceStartNumber'
            ? (draft.invoiceStartNumber ?? company.invoiceStartNumber ?? '')
            : draft[key] ?? company[key] ?? '')}
        onChange={event => setDraft(previous => ({
          ...previous,
          [key]: (type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value) as Company[K],
          ...(key === 'bankAccount' ? { paymentInformation: { ...company.paymentInformation, ...previous.paymentInformation, bankAccount: event.target.value } } : {}),
        }))}
        onBlur={() => {
          if (!IDENTIFIER_FIELDS.includes(name)) return;
          setDraft(previous => {
            const normalized = normalizeCompany({ ...company, ...previous });
            return {
              ...previous,
              [key]: normalized[key],
              ...(key === 'bankAccount' ? { paymentInformation: { ...company.paymentInformation, ...previous.paymentInformation, bankAccount: normalized.bankAccount } } : {}),
            };
          });
        }}
        className="form-input w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900"
      />
      {fieldError && <span id={`setup-${name}-error`} className="block text-xs text-red-600">{fieldError}</span>}
    </label>
    );
  };

  const select = <K extends keyof Company>(
    key: K,
    label: string,
    options: Array<[string, string]>,
    optionsConfig?: { required?: boolean },
  ) => {
    const required = optionsConfig?.required ?? false;
    const placeholder = 'Bitte wählen…';
    const value = String(draft[key] ?? company[key] ?? '');
    const selectError = fieldErrors[String(key)];
    return (
      <label className="block space-y-1.5 text-sm font-medium text-gray-700" key={String(key)}>
        <span className="inline-flex items-center gap-1">
          {label}
          {required && <span className="text-red-600" aria-hidden="true">*</span>}
        </span>
        <select
          id={String(key)}
          required={required}
          aria-invalid={Boolean(selectError)}
          aria-describedby={selectError ? `${String(key)}-error` : undefined}
          value={value}
          onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value as Company[K] }))}
          className="form-input w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900"
        >
          {(required || !value) && <option value="" disabled>{placeholder}</option>}
          {options.map(([optionValue, title]) => <option value={optionValue} key={optionValue}>{title}</option>)}
        </select>
        {selectError && <span id={`${String(key)}-error`} className="block text-xs text-red-600">{selectError}</span>}
      </label>
    );
  };

  const focusField = (name: string) => window.setTimeout(() => {
    (document.getElementById(`setup-${name}`) ?? document.getElementById(name))?.focus();
  }, 0);

  // Gültige Teile des Entwurfs; ungültige oder leere Pflichtangaben werden nicht gespeichert.
  const validDraft = (): Partial<Company> => {
    const result = normalizeCompany(draft);
    const rest: Partial<Company> = {};
    const invalid = new Set<string>([...Object.keys(formatErrors), ...Object.keys(requiredErrors)].map(key => key.replace('paymentInformation.', '')));
    for (const [key, value] of Object.entries(result)) {
      if (key === 'paymentInformation') {
        if (!invalid.has('bankAccount') && !invalid.has('bic')) (rest as Record<string, unknown>)[key] = value;
      } else if (!(invalid.has(key) && key in draft)) {
        (rest as Record<string, unknown>)[key] = value;
      }
    }
    return rest;
  };

  /** mode: 'next' prüft den aktuellen Schritt, 'complete' alle Schritte, 'back' und 'later' speichern nur Gültiges. */
  const save = async (nextStep: number, mode: 'next' | 'back' | 'later' | 'complete' = 'next') => {
    const complete = mode === 'complete';
    if (mode === 'next' || complete) {
      const all = { ...requiredErrors, ...formatErrors };
      const names = Object.keys(all).map(key => key.replace('paymentInformation.', ''));
      const failing = FIELD_ORDER.filter(name => names.includes(name) && (complete || stepOfField(name) === step));
      if (failing.length) {
        const messages = failing.map(name => (all[name] ?? all[`paymentInformation.${name}`]) as string);
        setShowErrors(true);
        setError([...new Set(messages)].join(' '));
        if (stepOfField(failing[0]) !== step) setStep(stepOfField(failing[0]));
        focusField(failing[0]);
        return false;
      }
    }
    setBusy(true);
    setError('');
    try {
      // Beim Weitergehen nur Gültiges speichern: ungültige Angaben anderer Schritte (nach „Zurück“) blockieren sonst den Server.
      const toSave = complete ? normalizeCompany(draft) : validDraft();
      if (Object.keys(toSave).length) await updateCompany(toSave);
      // Die Einrichtung hält nur die Entscheidung fest. Den einmaligen
      // Umzug-Start verbraucht erst die Datenübernahme selbst – mit der ersten
      // Datei oder über „Umzug jetzt starten“.
      const updated = await apiService.updateWorkspaceSetup({
        currentStep: nextStep,
        ...(complete ? { migrationChoice: migrationDone ? 'takeover' : choice, complete: true } : {}),
      });
      window.dispatchEvent(new CustomEvent('solooffice:workspace-setup-changed', { detail: updated }));
      setSetup(updated);
      setDraft(complete ? {} : previous => {
        const kept: Record<string, unknown> = {};
        const saved = toSave as Record<string, unknown>;
        for (const key of Object.keys(previous)) if (!(key in saved)) kept[key] = (previous as Record<string, unknown>)[key];
        return kept as Partial<Company>;
      });
      setShowErrors(false);
      setStep(updated.currentStep);
      if (complete && choice === 'takeover' && takeover?.session?.status !== 'completed') onNavigate('data-import');
      else if (complete) onNavigate('dashboard');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Änderungen konnten nicht gespeichert werden.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleLogoFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 1024 * 1024) {
      setError('Bitte ein Bild mit höchstens 1 MB auswählen.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setDraft(previous => ({ ...previous, logo: String(reader.result) }));
    reader.onerror = () => setError('Das Bild konnte nicht gelesen werden.');
    reader.readAsDataURL(file);
  };

  const fieldGrid = (children: ReactNode) => <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
  const currentCompany = { ...company, ...draft };
  const isSmallBusiness = Boolean(draft.isSmallBusiness ?? company.isSmallBusiness ?? false);
  const optionsLabel = (key: string, label: string, description: string): [string, string] => key === 'jobTrackingEnabled'
    ? [terminology.work.managementLabel, `${terminology.work.plural} und Termine planen`] : [label, description];
  const terminologyColor = terminologyProfiles.find(profile => profile.id === currentCompany.terminologyProfile) || terminologyProfiles[0];
  const accentColor = (currentCompany.terminologyColorSource || 'profile') === 'profile'
    ? terminologyColor.preview.accent
    : String(currentCompany.primaryColor ?? '#15803d');
  // Der Text benennt das Ziel, das auch nach dem Speichern geöffnet wird.
  const shouldContinueToTakeover = choice === 'takeover' && takeover?.session?.status !== 'completed';
  const finalActionLabel = !shouldContinueToTakeover
    ? 'Einrichtung abschließen'
    : takeover?.session?.status === 'open'
      ? 'Datenübernahme fortsetzen'
      : 'Weiter zur Datenübernahme';

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <PageHeader title="Ersteinrichtung" />
      <header className="mb-6">
        <p className="text-sm font-semibold text-primary-custom">Ersteinrichtung</p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">SoloOffice auf Ihren Betrieb abstimmen</h1>
        <p className="mt-2 max-w-2xl text-sm text-gray-600">Ihre Angaben werden in den Firmendaten gespeichert und bleiben dort auch später bearbeitbar.</p>
      </header>

      <nav aria-label="Einrichtungsschritte" className="mb-6 grid grid-cols-5 gap-2">
        {steps.map((title, index) => {
          const number = index + 1;
          return <div key={title} aria-current={number === step ? 'step' : undefined} className={`min-w-0 border-t-2 pt-2 ${number <= step ? 'border-primary-custom' : 'border-gray-200'}`}>
            <span className="text-xs font-semibold text-gray-500">Schritt {number}</span>
            <p className="mt-1 hidden text-sm font-medium text-gray-800 sm:block">{title}</p>
          </div>;
        })}
      </nav>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <form noValidate onSubmit={event => { event.preventDefault(); if (step < 5) void save(step + 1); }}>
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-gray-900 outline-none">{steps[step - 1]}</h2>
        {step === 1 && <div className="mt-5 space-y-4">
          {fieldGrid(<>{field('name', terminology.organization.nameLabel, 'text', { autoComplete: 'organization' })}{field('email', 'E-Mail-Adresse', 'email', { autoComplete: 'email' })}{field('address', 'Adresse', 'text', { autoComplete: 'street-address' })}{field('postalCode', 'Postleitzahl', 'text', { autoComplete: 'postal-code', inputMode: 'numeric' })}{field('city', 'Stadt', 'text', { autoComplete: 'address-level2' })}{field('country', 'Land', 'text', { autoComplete: 'country-name' })}{field('phone', 'Telefon', 'tel', { autoComplete: 'tel' })}{field('website', 'Website', 'url', { autoComplete: 'url' })}</>)}
        </div>}
        {step === 2 && <div className="mt-5 space-y-4">
          <p className="text-sm text-gray-600">Nur Angaben wählen, die Sie sicher kennen. Ein Steuerprofil wird nicht automatisch angelegt.</p>
          {fieldGrid(<>
            {select('taxBusinessType', 'Betriebsart', [['freelance', 'Freiberuflich'], ['commercial', 'Gewerblich'], ['agriculture', 'Land- und Forstwirtschaft'], ['nonprofit', 'Gemeinnützig'], ['other', 'Sonstige']], { required: true })}
            {select('legalForm', 'Rechtsform', [['sole_proprietorship', 'Einzelunternehmen'], ['partnership', 'Personengesellschaft'], ['gbr', 'GbR'], ['ug', 'UG'], ['gmbh', 'GmbH'], ['ag', 'AG'], ['eg', 'eG'], ['nonprofit', 'Gemeinnützig'], ['other', 'Sonstige']], { required: true })}
            {field('taxId', 'Umsatzsteuer-ID')}
            {field('taxIdentificationNumber', 'Steuernummer')}
            {field('invoiceStartNumber', 'Nächste Rechnungsnummer', 'number', { min: 1, max: 999999 })}
          </>)}
          <div className="relative">
            <button
              type="button"
              aria-pressed={isSmallBusiness}
              onClick={() => setDraft(previous => ({ ...previous, isSmallBusiness: !(previous.isSmallBusiness ?? company.isSmallBusiness ?? false) }))}
              className={`${selectionCardClass(isSmallBusiness)} flex w-full items-start gap-3 pr-12`}
            >
              <span className="mt-0.5 shrink-0">
                {isSmallBusiness
                  ? <CheckCircle2 className="h-5 w-5 text-primary-custom" aria-hidden="true" />
                  : <Circle className="h-5 w-5 text-gray-300" aria-hidden="true" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-900">Kleinunternehmer (§ 19 UStG)</span>
                <span className="mt-1 block text-sm text-gray-600">
                  {isSmallBusiness
                    ? 'Aktiv: Rechnungen ohne Umsatzsteuerausweis.'
                    : 'Nicht aktiv – zum Einschalten auswählen.'}
                </span>
              </span>
            </button>
            <span className="absolute right-3 top-3">
              <InfoTooltip
                align="end"
                label="Hinweis zur Kleinunternehmerregelung"
                text="Wenn Sie die Kleinunternehmerregelung anwenden, weisen Sie auf Rechnungen keine Umsatzsteuer aus. Hinterlegen Sie hier nur, ob Sie sie anwenden."
              />
            </span>
          </div>
        </div>}
        {step === 3 && <div className="mt-5 space-y-5">
          {fieldGrid(<>
            {field('bankAccount', 'IBAN')}
            {field('bic', 'BIC')}
            {select('terminologyProfile', 'Begriffe (Kunden, Aufträge usw.)', [['customers', 'Kunden'], ['mandants', 'Mandanten'], ['patients', 'Patienten'], ['students', 'Schüler'], ['clients', 'Klienten']])}
            <ColorPicker
              label="Akzentfarbe"
              value={accentColor}
              defaultColor="#15803d"
              hint="Farbe für Links und Hervorhebungen."
              onChange={color => setDraft(previous => ({ ...previous, primaryColor: color, terminologyColorSource: 'appearance' }))}
            />
          </>)}
          <label className="block space-y-2 text-sm font-medium text-gray-700">
            <span>Logo (optional)</span>
            <input type="file" accept="image/*" onChange={event => handleLogoFile(event.target.files?.[0])} className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:font-medium" />
            {(draft.logo ?? company.logo) && <img src={String(draft.logo ?? company.logo)} alt="Vorschau des Firmenlogos" className="max-h-16 max-w-48 rounded border border-gray-200 object-contain p-1" />}
          </label>
          <p className="text-xs text-gray-500">
            Zahlungsziel, Zahlungshinweis und Vorlagen können Sie später in den Einstellungen anpassen.
          </p>
        </div>}
        {step === 4 && <div className="mt-5 space-y-4">
          <p className="text-sm text-gray-600">Bereiche aktivieren, die Sie nutzen möchten. Später jederzeit änderbar.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {MODULE_OPTIONS.map(([key, rawLabel, rawDescription]) => {
              const [label, description] = optionsLabel(key, rawLabel, rawDescription);
              const enabled = key === 'discountsEnabled' ? (draft[key] ?? company[key]) !== false : Boolean(draft[key] ?? company[key]);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={enabled}
                  onClick={() => setDraft(previous => ({ ...previous, [key]: !enabled }))}
                  className={`${selectionCardClass(enabled)} flex items-start gap-3`}
                >
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${enabled ? 'border-primary-custom bg-primary-custom text-white' : 'border-gray-300 bg-white text-transparent'}`}>
                    <Check className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-900">{label}</span>
                    <span className="mt-0.5 block text-xs text-gray-600">{description}</span>
                    <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${enabled ? 'bg-[var(--accent-tint)] text-primary-custom' : 'bg-gray-100 text-gray-500'}`}>
                      {enabled ? 'Aktiv' : 'Aus'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
            <strong>{currentCompany.name || 'Betriebsname ergänzen'}</strong>
            <p>{[currentCompany.address, [currentCompany.postalCode, currentCompany.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Adresse ergänzen'}</p>
            <p>{currentCompany.email || 'E-Mail-Adresse ergänzen'} · {currentCompany.bankAccount ? 'IBAN hinterlegt' : 'IBAN noch offen'}</p>
            <p className="mt-2 text-xs text-gray-500">Offene Angaben lassen sich später in Einstellungen ergänzen.</p>
          </div>
        </div>}
        {step === 5 && migrationDone && <div className="mt-5 space-y-2 rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="font-semibold text-green-900">Datenübernahme abgeschlossen</p>
          <p className="text-sm text-green-900">Der einmalige Umzug ist bereits erledigt. Den Verlauf sehen Sie in der Datenübernahme.</p>
          <a href="#data-import" onClick={event => { event.preventDefault(); onNavigate('data-import'); }} className="inline-block text-sm font-medium text-green-900 underline">Importverlauf ansehen</a>
        </div>}
        {step === 5 && !migrationDone && <div className="mt-5 space-y-3">
          <p className="text-sm text-gray-600">Die Datenübernahme starten Sie auf der nächsten Seite mit Ihrer ersten Datei. Der Umzug lässt sich nur einmal starten; „Keine Altdaten“ hält ihn offen.</p>
          <button type="button" aria-pressed={choice === 'takeover'} onClick={() => setChoice('takeover')} className={`${selectionCardClass(choice === 'takeover')} w-full`}>
            <span className="block font-semibold text-gray-900">Daten übernehmen</span><span className="mt-1 block text-sm text-gray-600">Nach dem Abschluss geht es direkt zur Datenübernahme: Datei hochladen und Schritt für Schritt prüfen.</span>
          </button>
          <button type="button" aria-pressed={choice === 'no_legacy_data'} onClick={() => setChoice('no_legacy_data')} className={`${selectionCardClass(choice === 'no_legacy_data')} w-full`}>
            <span className="block font-semibold text-gray-900">Keine Altdaten</span><span className="mt-1 block text-sm text-gray-600">Ich beginne ohne Übernahme aus einem anderen System.</span>
          </button>
          {setup?.completedAt && <p className="text-xs text-gray-500">Einrichtung abgeschlossen. Diese Prüfung kann erneut geöffnet werden.</p>}
          {takeover?.demoMode && <p className="text-xs font-medium text-amber-800">Demo: Der Start wird nur in dieser Browser-Sitzung simuliert.</p>}
          {takeover?.session?.status === 'open' && <p className="text-sm text-gray-600">Es gibt bereits eine offene Umzugssitzung. Sie können sie in der Datenübernahme fortsetzen.</p>}
          {takeover?.session?.status === 'completed' && <p className="text-sm text-gray-600">Der einmalige Umzug wurde bereits abgeschlossen.</p>}
        </div>}

        {error && <p id="setup-error" role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <footer className="mt-6 flex flex-col-reverse gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          {step > 1
            ? <button type="button" onClick={() => void save(step - 1, 'back')} disabled={busy} className="btn-secondary inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium"><ArrowLeft className="h-4 w-4" />Zurück</button>
            : <span className="hidden sm:block" />}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
            <button type="button" onClick={() => void save(step, 'later').then(saved => { if (saved) onNavigate('dashboard'); })} disabled={busy} className="btn-secondary inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium">Später fortsetzen</button>
            {step < 5 ? <button type="submit" disabled={busy} className="btn-primary inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Speichern und weiter<ArrowRight className="h-4 w-4" /></button>
              : <button type="button" onClick={() => void save(5, 'complete')} disabled={busy || (choice === 'undecided' && !migrationDone)} aria-describedby={choice === 'undecided' && !migrationDone ? 'setup-complete-hint' : undefined} className="btn-primary inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{finalActionLabel}</button>}
          </div>
        </footer>
        {step === 5 && choice === 'undecided' && !migrationDone && <p id="setup-complete-hint" className="mt-2 text-right text-sm text-gray-600">Bitte wählen Sie oben, ob Sie Altdaten übernehmen möchten.</p>}
        </form>
      </section>
    </main>
  );
}
