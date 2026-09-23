import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { apiService } from '../services/api';
import type { Company, WorkspaceSetup, WorkspaceMigrationChoice, TakeoverStatus } from '../types';

const steps = ['Betrieb & Kontakt', 'Steuer & Rechnung', 'Zahlung & Auftritt', 'Module & Prüfung', 'Datenübernahme'];

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

  const select = <K extends keyof Company>(key: K, label: string, options: Array<[string, string]>) => (
    <label className="block space-y-1.5 text-sm font-medium text-gray-700" key={String(key)}>
      <span>{label}</span>
      <select
        value={String(draft[key] ?? company[key] ?? '')}
        onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value as Company[K] }))}
        className="form-input w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900"
      >
        <option value="">Bitte auswählen</option>
        {options.map(([value, title]) => <option value={value} key={value}>{title}</option>)}
      </select>
    </label>
  );

  const save = async (nextStep: number, complete = false) => {
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
          return <div key={title} className={`min-w-0 border-t-2 pt-2 ${number <= step ? 'border-primary-custom' : 'border-gray-200'}`}>
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
          <p className="text-sm text-gray-600">Wählen Sie nur Angaben, die Sie sicher kennen. Ein Steuerprofil wird nicht automatisch angelegt.</p>
          {fieldGrid(<>{select('taxBusinessType', 'Betriebsart', [['freelance', 'Freiberuflich'], ['commercial', 'Gewerblich'], ['agriculture', 'Land- und Forstwirtschaft'], ['nonprofit', 'Gemeinnützig'], ['other', 'Sonstige']])}{select('legalForm', 'Rechtsform', [['sole_proprietorship', 'Einzelunternehmen'], ['partnership', 'Personengesellschaft'], ['gbr', 'GbR'], ['ug', 'UG'], ['gmbh', 'GmbH'], ['ag', 'AG'], ['eg', 'eG'], ['nonprofit', 'Gemeinnützig'], ['other', 'Sonstige']])}{field('taxId', 'Umsatzsteuer-ID')}{field('taxIdentificationNumber', 'Steuernummer')}{field('invoiceStartNumber', 'Nächste Rechnungsnummer', 'number')}</>)}
          <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 text-sm text-gray-800"><input type="checkbox" checked={Boolean(draft.isSmallBusiness ?? company.isSmallBusiness)} onChange={event => setDraft(previous => ({ ...previous, isSmallBusiness: event.target.checked }))} />Kleinunternehmerregelung ist für meinen Betrieb gewählt</label>
        </div>}
        {step === 3 && <div className="mt-5 space-y-4">
          {fieldGrid(<>{field('bankAccount', 'IBAN')}{field('bic', 'BIC')}{field('defaultPaymentDays', 'Zahlungsziel in Tagen', 'number')}{field('immediatePaymentClause', 'Zahlungshinweis')}{select('terminologyProfile', 'Begriffe', [['customers', 'Kunden'], ['mandants', 'Mandanten'], ['patients', 'Patienten'], ['students', 'Schüler'], ['clients', 'Klienten']])}{field('primaryColor', 'Akzentfarbe (Hexadezimal)')}</>)}
          <label className="block space-y-2 text-sm font-medium text-gray-700"><span>Logo (optional)</span><input type="file" accept="image/*" onChange={event => handleLogoFile(event.target.files?.[0])} className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:font-medium" />{(draft.logo ?? company.logo) && <img src={String(draft.logo ?? company.logo)} alt="Vorschau des Firmenlogos" className="max-h-16 max-w-48 rounded border border-gray-200 object-contain p-1" />}</label>
          <p className="text-xs text-gray-500">Weitere Vorlagen können Sie später in den Einstellungen ergänzen.</p>
        </div>}
        {step === 4 && <div className="mt-5 space-y-4">
          <p className="text-sm text-gray-600">Aktivieren Sie die Bereiche, die Sie verwenden möchten. Sie können diese Auswahl später jederzeit ändern.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {([['quotesEnabled', 'Angebote'], ['jobTrackingEnabled', 'Aufträge und Kalender'], ['reportingEnabled', 'Auswertungen'], ['discountsEnabled', 'Rabatte']] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 text-sm text-gray-800"><input type="checkbox" checked={Boolean(draft[key] ?? company[key])} onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.checked }))} />{label}</label>
            ))}
          </div>
          <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
            <strong>{currentCompany.name || 'Betriebsname ergänzen'}</strong>
            <p>{[currentCompany.address, currentCompany.postalCode, currentCompany.city].filter(Boolean).join(', ') || 'Adresse ergänzen'}</p>
            <p>{currentCompany.email || 'E-Mail-Adresse ergänzen'} · {currentCompany.bankAccount ? 'IBAN hinterlegt' : 'IBAN noch offen'}</p>
            <p className="mt-2 text-xs text-gray-500">Offene Angaben lassen sich später in Einstellungen ergänzen.</p>
          </div>
        </div>}
        {step === 5 && <div className="mt-5 space-y-3">
          <p className="text-sm text-gray-600">Treffen Sie eine Entscheidung zur Datenübernahme. „Keine Altdaten“ lässt einen späteren einmaligen Umzug-Start weiterhin zu.</p>
          <button type="button" aria-pressed={choice === 'takeover'} onClick={() => setChoice('takeover')} className={`w-full rounded-lg border p-4 text-left ${choice === 'takeover' ? 'border-primary-custom bg-primary-custom/5 ring-1 ring-primary-custom' : 'border-gray-200 hover:bg-gray-50'}`}>
            <span className="block font-semibold text-gray-900">Datenübernahme starten</span><span className="mt-1 block text-sm text-gray-600">Zur bestehenden Datenübernahme wechseln.</span>
          </button>
          <button type="button" aria-pressed={choice === 'no_legacy_data'} onClick={() => setChoice('no_legacy_data')} className={`w-full rounded-lg border p-4 text-left ${choice === 'no_legacy_data' ? 'border-primary-custom bg-primary-custom/5 ring-1 ring-primary-custom' : 'border-gray-200 hover:bg-gray-50'}`}>
            <span className="block font-semibold text-gray-900">Keine Altdaten</span><span className="mt-1 block text-sm text-gray-600">Ich beginne ohne Übernahme aus einem anderen System.</span>
          </button>
          {setup?.completedAt && <p className="text-xs text-gray-500">Einrichtung abgeschlossen. Diese Prüfung kann erneut geöffnet werden.</p>}
          {takeover?.demoMode && <p className="text-xs font-medium text-amber-800">Demo: Der Start wird nur in dieser Browser-Sitzung simuliert.</p>}
          {takeover?.session?.status === 'open' && <p className="text-sm text-gray-600">Es gibt bereits eine offene Umzugssitzung. Sie können sie in der Datenübernahme fortsetzen.</p>}
          {takeover?.session?.status === 'completed' && <p className="text-sm text-gray-600">Der einmalige Umzug wurde bereits abgeschlossen.</p>}
        </div>}

        {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <footer className="mt-6 flex flex-col-reverse gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" onClick={() => step > 1 ? void save(step - 1) : void save(1).then(saved => { if (saved) onNavigate('dashboard'); })} disabled={busy} className="btn-secondary inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium"><ArrowLeft className="h-4 w-4" />{step > 1 ? 'Zurück' : 'Später fortsetzen'}</button>
          {step < 5 ? <button type="button" onClick={() => void save(step + 1)} disabled={busy} className="btn-primary inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Speichern und weiter<ArrowRight className="h-4 w-4" /></button>
            : <button type="button" onClick={() => void save(5, true)} disabled={busy || choice === 'undecided'} className="btn-primary inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{finalActionLabel}</button>}
        </footer>
      </section>
    </main>
  );
}
