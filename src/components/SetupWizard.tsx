import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { apiService } from '../services/api';
import type { Company, WorkspaceSetup, WorkspaceMigrationChoice, TakeoverStatus } from '../types';
import { ColorPicker } from './ColorPicker';
import { InfoTooltip } from './InfoTooltip';
import { terminologyProfiles } from '../utils/terminology';

const steps = ['Betrieb & Kontakt', 'Steuer & Rechnung', 'Zahlung & Auftritt', 'Module & Prüfung', 'Datenübernahme'];

const MODULE_OPTIONS = [
  ['quotesEnabled', 'Angebote', 'Angebote erstellen und nachverfolgen'],
  ['jobTrackingEnabled', 'Aufträge und Kalender', 'Termine und Aufträge planen'],
  ['reportingEnabled', 'Auswertungen', 'Umsatz und Kennzahlen einsehen'],
  ['discountsEnabled', 'Rabatte', 'Rabatte in Belegen nutzen'],
] as const;

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
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Partial<Company>>({});
  const [choice, setChoice] = useState<WorkspaceMigrationChoice>('undecided');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const taxBusinessTypeRef = useRef<HTMLSelectElement>(null);
  const legalFormRef = useRef<HTMLSelectElement>(null);

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

  const field = <K extends keyof Company>(key: K, label: string, type = 'text') => (
    <label className="block space-y-1.5 text-sm font-medium text-gray-700" key={String(key)}>
      <span>{label}</span>
      <input
        type={type}
        value={String(draft[key] ?? company[key] ?? '')}
        onChange={event => setDraft(previous => ({ ...previous, [key]: (type === 'number' ? Number(event.target.value) : event.target.value) as Company[K] }))}
        className="form-input w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900"
      />
    </label>
  );

  const select = <K extends keyof Company>(
    key: K,
    label: string,
    options: Array<[string, string]>,
    optionsConfig?: { required?: boolean },
  ) => {
    const required = optionsConfig?.required ?? false;
    const placeholder = 'Bitte wählen…';
    const value = String(draft[key] ?? company[key] ?? '');
    return (
      <label className="block space-y-1.5 text-sm font-medium text-gray-700" key={String(key)}>
        <span className="inline-flex items-center gap-1">
          {label}
          {required && <span className="text-red-600" aria-hidden="true">*</span>}
        </span>
        <select
          id={String(key)}
          ref={key === 'taxBusinessType' ? taxBusinessTypeRef : key === 'legalForm' ? legalFormRef : undefined}
          required={required}
          aria-invalid={required && Boolean(error) && !value}
          aria-describedby={required && !value && error ? 'setup-error' : undefined}
          value={value}
          onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value as Company[K] }))}
          className="form-input w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900"
        >
          <option value="" disabled={required}>{placeholder}</option>
          {options.map(([optionValue, title]) => <option value={optionValue} key={optionValue}>{title}</option>)}
        </select>
      </label>
    );
  };

  const validateStep = (current: number): string | null => {
    const merged = { ...company, ...draft };
    if (current === 2) {
      if (!merged.taxBusinessType) return 'Bitte wählen Sie eine Betriebsart.';
      if (!merged.legalForm) return 'Bitte wählen Sie eine Rechtsform.';
    }
    return null;
  };

  const save = async (nextStep: number, complete = false) => {
    if (nextStep > step || complete) {
      const validationStep = complete ? 2 : step;
      const validationError = validateStep(validationStep);
      if (validationError) {
        setError(validationError);
        if (validationStep === 2) {
          setStep(2);
          requestAnimationFrame(() => {
            const merged = { ...company, ...draft };
            (merged.taxBusinessType ? legalFormRef : taxBusinessTypeRef).current?.focus();
          });
        }
        return false;
      }
    }
    setBusy(true);
    setError('');
    try {
      if (Object.keys(draft).length) await updateCompany(draft);
      // „Keine Altdaten“ bleibt eine Setup-Entscheidung und verbraucht den
      // späteren Start nicht. Nur der ausdrückliche Übernahme-Start claimt ihn.
      if (complete && choice === 'takeover' && !takeover?.takeoverUsed) setTakeover(await apiService.startTakeover());
      const updated = await apiService.updateWorkspaceSetup({
        currentStep: nextStep,
        ...(complete ? { migrationChoice: choice, complete: true } : {}),
      });
      setSetup(updated);
      setDraft({});
      setStep(updated.currentStep);
      if (complete && choice === 'takeover') onNavigate('data-import');
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
  const terminologyColor = terminologyProfiles.find(profile => profile.id === currentCompany.terminologyProfile) || terminologyProfiles[0];
  const accentColor = (currentCompany.terminologyColorSource || 'profile') === 'profile'
    ? terminologyColor.preview.accent
    : String(currentCompany.primaryColor ?? '#15803d');
  const finalActionLabel = choice !== 'takeover'
    ? 'Einrichtung abschließen'
    : takeover?.session?.status === 'open'
      ? 'Datenübernahme fortsetzen'
      : takeover?.session?.status === 'completed'
        ? 'Einrichtung abschließen'
        : 'Datenübernahme starten';

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <header className="mb-6">
        <p className="text-sm font-semibold text-primary-custom">Ersteinrichtung</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">SoloOffice auf Ihren Betrieb abstimmen</h1>
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
        <h2 className="text-lg font-semibold text-gray-900">{steps[step - 1]}</h2>
        {step === 1 && <div className="mt-5 space-y-4">
          {fieldGrid(<>{field('name', 'Betriebsname')}{field('email', 'E-Mail-Adresse', 'email')}{field('address', 'Straße und Hausnummer')}{field('postalCode', 'Postleitzahl')}{field('city', 'Ort')}{field('country', 'Land')}{field('phone', 'Telefon')}{field('website', 'Webseite', 'url')}</>)}
        </div>}
        {step === 2 && <div className="mt-5 space-y-4">
          <p className="text-sm text-gray-600">Nur Angaben wählen, die Sie sicher kennen. Ein Steuerprofil wird nicht automatisch angelegt.</p>
          {fieldGrid(<>
            {select('taxBusinessType', 'Betriebsart', [['freelance', 'Freiberuflich'], ['commercial', 'Gewerblich'], ['agriculture', 'Land- und Forstwirtschaft'], ['nonprofit', 'Gemeinnützig'], ['other', 'Sonstige']], { required: true })}
            {select('legalForm', 'Rechtsform', [['sole_proprietorship', 'Einzelunternehmen'], ['partnership', 'Personengesellschaft'], ['gbr', 'GbR'], ['ug', 'UG'], ['gmbh', 'GmbH'], ['ag', 'AG'], ['eg', 'eG'], ['nonprofit', 'Gemeinnützig'], ['other', 'Sonstige']], { required: true })}
            {field('taxId', 'Umsatzsteuer-ID')}
            {field('taxIdentificationNumber', 'Steuernummer')}
            {field('invoiceStartNumber', 'Nächste Rechnungsnummer', 'number')}
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
            {select('terminologyProfile', 'Begriffe', [['customers', 'Kunden'], ['mandants', 'Mandanten'], ['patients', 'Patienten'], ['students', 'Schüler'], ['clients', 'Klienten']])}
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
            {MODULE_OPTIONS.map(([key, label, description]) => {
              const enabled = Boolean(draft[key] ?? company[key]);
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
            <p>{[currentCompany.address, currentCompany.postalCode, currentCompany.city].filter(Boolean).join(', ') || 'Adresse ergänzen'}</p>
            <p>{currentCompany.email || 'E-Mail-Adresse ergänzen'} · {currentCompany.bankAccount ? 'IBAN hinterlegt' : 'IBAN noch offen'}</p>
            <p className="mt-2 text-xs text-gray-500">Offene Angaben lassen sich später in Einstellungen ergänzen.</p>
          </div>
        </div>}
        {step === 5 && <div className="mt-5 space-y-3">
          <p className="text-sm text-gray-600">Entscheidung zur Datenübernahme. „Keine Altdaten“ lässt einen späteren einmaligen Umzug-Start weiterhin zu.</p>
          <button type="button" aria-pressed={choice === 'takeover'} onClick={() => setChoice('takeover')} className={`${selectionCardClass(choice === 'takeover')} w-full`}>
            <span className="block font-semibold text-gray-900">Datenübernahme starten</span><span className="mt-1 block text-sm text-gray-600">Zur bestehenden Datenübernahme wechseln.</span>
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
          <button type="button" onClick={() => step > 1 ? void save(step - 1) : void save(1).then(saved => { if (saved) onNavigate('dashboard'); })} disabled={busy} className="btn-secondary inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium"><ArrowLeft className="h-4 w-4" />{step > 1 ? 'Zurück' : 'Später fortsetzen'}</button>
          {step < 5 ? <button type="button" onClick={() => void save(step + 1)} disabled={busy} className="btn-primary inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Speichern und weiter<ArrowRight className="h-4 w-4" /></button>
            : <button type="button" onClick={() => void save(5, true)} disabled={busy || choice === 'undecided'} className="btn-primary inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{finalActionLabel}</button>}
        </footer>
      </section>
    </main>
  );
}
