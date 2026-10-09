import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BookOpenText, Copy, Save } from 'lucide-react';
import { resolveTaxParams } from '../../backend/shared/taxParams/index.js';
import { TAX_TEXTS } from '../../backend/shared/taxTexts.js';
import { defaultTaxProfile } from '../../backend/shared/financeDefaults.js';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import { useFeedback } from '../context/FeedbackContext';
import { financeApi } from '../services/financeApi';
import type { TaxProfile, TaxProfilePayload } from '../types/finance';
import { useExtensions } from '../hooks/useExtensions';
import { formatNumber } from '../utils/formatters';
import { FloatingInfoTooltip } from './InfoTooltip';
import { LocalizedNumberInput } from './LocalizedNumberInput';
import { TaxForecastHelp } from './TaxForecastHelp';
import { ChurchConsentDialog, TaxProfileDisclaimerDialog } from './TaxConsentDialogs';

const currentYear = new Date().getFullYear();
const selectClass = 'form-input w-full min-w-0';
const inputClass = 'form-input w-full min-w-0';

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return <label className="block min-w-0 space-y-1.5"><span className="flex items-center gap-1.5 text-sm font-medium text-gray-800">{label}{hint}</span>{children}</label>;
}

function Step({ number, title, purpose, children }: { number: number; title: string; purpose: string; children: ReactNode }) {
  return <section className="settings-section space-y-4" aria-labelledby={`tax-step-${number}`}><div><p className="text-xs font-semibold uppercase tracking-wide text-primary-custom">Schritt {number} von 5 · überspringbar</p><div className="mt-1 flex items-center gap-1.5"><h3 id={`tax-step-${number}`} className="text-base font-semibold text-gray-900">{title}</h3><FloatingInfoTooltip text={purpose} label={`Warum fragen wir nach ${title.toLocaleLowerCase('de-DE')}?`} /></div></div>{children}</section>;
}

function toPayload(profile: TaxProfile): TaxProfilePayload {
  const metadata = new Set(['id', 'disclaimerAcceptedAt', 'churchTaxConsentAt', 'updatedAt', 'paramsVersion']);
  return Object.fromEntries(Object.entries(profile).filter(([key]) => !metadata.has(key))) as TaxProfilePayload;
}

/** Jahresbezogenes Steuerprofil. Die Fragen sind optional und speichern nur Profilfelder. */
export function TaxProfileSettings({ onNavigate }: { onNavigate?: (page: string, filter?: string) => void }) {
  const { can, workspace } = useAuth();
  const { company } = useCompany();
  const { confirm } = useFeedback();
  const { isEnabled, loading: extensionsLoading, error: extensionsError, refresh: refreshExtensions } = useExtensions();
  const hasSettingsPermission = can('workspace.settings');
  const taxesEnabled = isEnabled('taxes');
  const workspaceId = workspace?.id ?? null;
  const [year, setYear] = useState(currentYear);
  const contextKey = `${workspaceId ?? 'none'}:${year}:${taxesEnabled}:${hasSettingsPermission}`;
  const activeContextKey = useRef(contextKey);
  activeContextKey.current = contextKey;
  const requestVersion = useRef(0);
  const [loadedContextKey, setLoadedContextKey] = useState('');
  const [profile, setProfile] = useState<TaxProfile | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedNotice, setCopiedNotice] = useState<{ year: number; text: string } | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showChurchConsent, setShowChurchConsent] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const dirty = !!profile && JSON.stringify(toPayload(profile)) !== savedSnapshot;
  const resolved = useMemo(() => resolveTaxParams(year), [year]);

  const loadProfile = useCallback(async (selectedYear: number, selectedWorkspaceId = workspaceId) => {
    const key = `${selectedWorkspaceId ?? 'none'}:${selectedYear}:${taxesEnabled}:${hasSettingsPermission}`;
    const version = ++requestVersion.current;
    const isCurrent = () => requestVersion.current === version && activeContextKey.current === key;
    setLoading(true);
    setProfile(null);
    setSavedSnapshot('');
    setError(null);
    if (copiedNotice?.year !== selectedYear) {
      setNotice(null);
      setCopiedNotice(null);
    }
    setShowDisclaimer(false);
    setShowChurchConsent(false);
    setShowHelp(false);
    setLoadedContextKey('');
    setSaving(false);
    if (!selectedWorkspaceId || !taxesEnabled || !hasSettingsPermission) {
      setLoading(false);
      return;
    }
    try {
      const result = await financeApi.getProfile(selectedYear);
      if (!isCurrent()) return;
      setProfile(result);
      setSavedSnapshot(JSON.stringify(toPayload(result)));
    } catch (requestError) {
      if (!isCurrent()) return;
      setProfile(null);
      setSavedSnapshot('');
      setError(requestError instanceof Error ? requestError.message : 'Das Steuerprofil konnte nicht geladen werden.');
    } finally {
      if (isCurrent()) {
        setLoadedContextKey(key);
        setLoading(false);
      }
    }
  }, [workspaceId, taxesEnabled, hasSettingsPermission, copiedNotice]);

  useLayoutEffect(() => {
    void loadProfile(year, workspaceId);
    return () => { requestVersion.current += 1; };
  }, [taxesEnabled, hasSettingsPermission, workspaceId, year, loadProfile]);

  const isCurrentContext = (key: string, version: number) => requestVersion.current === version && activeContextKey.current === key;

  const applyProfile = (next: TaxProfile) => {
    setProfile(next);
    setSavedSnapshot(JSON.stringify(toPayload(next)));
  };

  const save = async () => {
    if (!profile || saving || loadedContextKey !== contextKey || !workspaceId) return;
    const key = contextKey;
    const version = ++requestVersion.current;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await financeApi.saveProfile(year, toPayload(profile));
      if (!isCurrentContext(key, version)) return;
      applyProfile(updated);
      setNotice('Steuerprofil wurde gespeichert.');
    } catch (requestError) {
      if (!isCurrentContext(key, version)) return;
      setError(requestError instanceof Error ? requestError.message : 'Das Steuerprofil konnte nicht gespeichert werden.');
    } finally {
      if (isCurrentContext(key, version)) setSaving(false);
    }
  };

  const saveFromDisclaimer = async () => {
    if (!profile || loadedContextKey !== contextKey || !workspaceId) return;
    const key = contextKey;
    const version = ++requestVersion.current;
    setSaving(true);
    setError(null);
    try {
      const accepted = await financeApi.acceptDisclaimer(year);
      if (!isCurrentContext(key, version)) return;
      const updated = await financeApi.saveProfile(year, toPayload(profile));
      if (!isCurrentContext(key, version)) return;
      applyProfile({ ...updated, disclaimerAcceptedAt: accepted.disclaimerAcceptedAt });
      setShowDisclaimer(false);
      setNotice('Hinweis bestätigt und Steuerprofil gespeichert.');
    } catch (requestError) {
      if (!isCurrentContext(key, version)) return;
      setError(requestError instanceof Error ? requestError.message : 'Hinweis und Steuerprofil konnten nicht gespeichert werden.');
      throw requestError;
    } finally {
      if (isCurrentContext(key, version)) setSaving(false);
    }
  };

  const changeYear = (nextYear: number) => {
    if (!Number.isInteger(nextYear) || nextYear < 2000 || nextYear > 2200 || dirty) return;
    setYear(nextYear);
  };

  const copyFollowingYear = async () => {
    if (!profile || dirty || saving || loadedContextKey !== contextKey || !workspaceId) return;
    const sourceYear = year;
    const targetYear = year + 1;
    const sourceKey = contextKey;
    const version = ++requestVersion.current;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const target = await financeApi.getProfile(targetYear);
      if (!isCurrentContext(sourceKey, version)) return;
      const defaults = defaultTaxProfile(targetYear);
      const targetHasDetails = !!target.id || JSON.stringify(toPayload(target)) !== JSON.stringify(toPayload(defaults));
      if (targetHasDetails) {
        const confirmed = await confirm({
          title: `Profil ${targetYear} ersetzen?`,
          message: `Für ${targetYear} sind bereits Angaben gespeichert. Die Übernahme ersetzt die dortigen Profilangaben zu Tätigkeit, Umsatzsteuer, Versicherungen, persönlichen Angaben und Vorauszahlungen. Eine Kirchensteuerangabe wird aus dem Profil ${sourceYear} nicht übernommen; eine vorhandene Einwilligung in ${targetYear} bleibt bestehen. Möchtest du fortfahren?`,
          confirmText: `Profil ${targetYear} ersetzen`,
        });
        if (!confirmed || !isCurrentContext(sourceKey, version)) return;
      }
      const copied = await financeApi.copyProfile(sourceYear, targetYear);
      if (!isCurrentContext(sourceKey, version)) return;
      setYear(targetYear);
      applyProfile(copied);
      const copyMessage = `Profil für ${targetYear} wurde als Ausgangspunkt angelegt. Die Kirchensteuerangabe aus ${sourceYear} wird nicht übernommen.`;
      setCopiedNotice({ year: targetYear, text: copyMessage });
      setNotice(copyMessage);
    } catch (requestError) {
      if (!isCurrentContext(sourceKey, version)) return;
      setError(requestError instanceof Error ? requestError.message : 'Das Folgejahr konnte nicht angelegt werden.');
    } finally {
      if (isCurrentContext(sourceKey, version)) setSaving(false);
    }
  };

  const submitChurchConsent = async (liable: boolean) => {
    if (loadedContextKey !== contextKey || !workspaceId || saving) return;
    const key = contextKey;
    const version = ++requestVersion.current;
    setSaving(true);
    setError(null);
    try {
      const updated = await financeApi.churchConsent(year, true, liable);
      if (!isCurrentContext(key, version)) return;
      setProfile(current => current ? { ...current, churchTaxLiable: updated.churchTaxLiable, churchTaxConsentAt: updated.churchTaxConsentAt } : current);
      if (!dirty) setSavedSnapshot(JSON.stringify(toPayload(updated)));
      setShowChurchConsent(false);
      setNotice('Kirchensteuerangabe wurde mit Einwilligung gespeichert.');
    } catch (requestError) {
      if (!isCurrentContext(key, version)) return;
      setError(requestError instanceof Error ? requestError.message : 'Die Einwilligung konnte nicht gespeichert werden.');
      throw requestError;
    } finally {
      if (isCurrentContext(key, version)) setSaving(false);
    }
  };

  const withdrawChurchConsent = async () => {
    if (loadedContextKey !== contextKey || !workspaceId || saving) return;
    const key = contextKey;
    const version = ++requestVersion.current;
    setSaving(true);
    setError(null);
    try {
      const updated = await financeApi.churchConsent(year, false);
      if (!isCurrentContext(key, version)) return;
      const cleared = { ...updated, churchTaxLiable: null, churchTaxConsentAt: null };
      setProfile(current => current ? { ...current, churchTaxLiable: null, churchTaxConsentAt: null } : current);
      if (!dirty) setSavedSnapshot(JSON.stringify(toPayload(cleared)));
      setNotice('Kirchensteuerangabe und Einwilligung wurden gelöscht.');
    } catch (requestError) {
      if (!isCurrentContext(key, version)) return;
      setError(requestError instanceof Error ? requestError.message : 'Die Einwilligung konnte nicht widerrufen werden.');
    } finally {
      if (isCurrentContext(key, version)) setSaving(false);
    }
  };

  const update = <K extends keyof TaxProfile>(key: K, value: TaxProfile[K]) => {
    setProfile(current => current ? { ...current, [key]: value } : current);
    setCopiedNotice(null);
    setError(null);
    setNotice(null);
  };

  if (extensionsLoading) return <section className="settings-section"><p role="status" className="text-sm text-gray-600">Erweiterungen werden geladen …</p></section>;
  if (extensionsError) return <section className="settings-section space-y-3"><h2 className="text-lg font-semibold text-gray-900">Steuern &amp; Abgaben</h2><p role="alert" className="text-sm text-red-700">{extensionsError}</p><button type="button" onClick={() => void refreshExtensions()} className="btn-secondary rounded-lg px-4 py-2 text-sm">Erweiterungen erneut laden</button></section>;
  if (!workspaceId) return <section className="settings-section space-y-3"><h2 className="text-lg font-semibold text-gray-900">Steuern &amp; Abgaben</h2><p role="status" className="text-sm text-gray-600">Wähle zuerst einen aktiven Arbeitsbereich aus.</p></section>;
  if (!hasSettingsPermission) return <section className="settings-section space-y-3"><h2 className="text-lg font-semibold text-gray-900">Steuern &amp; Abgaben</h2><p className="text-sm text-gray-600">Zum Bearbeiten des Steuerprofils ist das Recht „Einstellungen verwalten“ erforderlich.</p><button type="button" onClick={() => onNavigate?.('settings', 'extensions')} className="btn-secondary rounded-lg px-4 py-2 text-sm">Zur Erweiterungsverwaltung</button></section>;
  if (!taxesEnabled) return <section className="settings-section space-y-3"><h2 className="text-lg font-semibold text-gray-900">Steuern &amp; Abgaben</h2><p className="text-sm text-gray-600">Aktiviere zuerst die Erweiterung, um ein Steuerprofil zu bearbeiten.</p><button type="button" onClick={() => onNavigate?.('settings', 'extensions')} className="btn-primary rounded-lg px-4 py-2 text-sm">Erweiterung einrichten</button></section>;

  if (loadedContextKey !== contextKey) return <section className="settings-section"><p role="status" className="text-sm text-gray-600">Steuerprofil für {year} wird geladen …</p></section>;
  if (loading) return <section className="settings-section"><p role="status" className="text-sm text-gray-600">Steuerprofil für {year} wird geladen …</p></section>;
  if (!profile) return <section className="settings-section space-y-3"><h2 className="text-lg font-semibold text-gray-900">Steuerprofil {year}</h2><p role="alert" className="text-sm text-red-700">{error || 'Das Steuerprofil ist nicht verfügbar.'}</p><button type="button" onClick={() => void loadProfile(year)} className="btn-secondary rounded-lg px-4 py-2 text-sm">Erneut laden</button></section>;

  const select = (key: keyof TaxProfile, value: string) => {
    const nullable = ['businessKind', 'vatStatus', 'vatAccounting', 'healthInsurance', 'state'].includes(key);
    update(key, (value === '' && nullable ? null : value) as TaxProfile[typeof key]);
  };
  const numeric = (key: keyof TaxProfile, value: string | number, nullable = false) => update(key, (value === '' && nullable ? null : Number(value)) as TaxProfile[typeof key]);
  const numberField = (label: string, key: keyof TaxProfile, nullable = false, min?: number, max?: number, step = '0.01') => <Field label={label}><LocalizedNumberInput className={inputClass} value={profile[key] as number | null} locale={company?.locale || 'de-DE'} numberFormat={company?.numberFormat} min={min} max={max} step={step} onValueChange={value => numeric(key, value, nullable)} /></Field>;
  const isGkv = profile.healthInsurance === 'gkv_voluntary' || profile.healthInsurance === 'gkv_ksk';
  const isPkv = profile.healthInsurance === 'pkv';
  const hasPensionContribution = ['teacher', 'craft', 'single_client', 'ksk', 'voluntary'].includes(profile.pensionStatus);
  const hasKskIncome = profile.healthInsurance === 'gkv_ksk' || profile.pensionStatus === 'ksk';
  const vatParams = resolved.params.vat;
  const vatFieldsVisible = profile.vatStatus === 'regular' || profile.vatStatus === 'education_exempt';
  const formatEuro = (value: number) => `${formatNumber(value, company?.locale || 'de-DE', company?.numberFormat, 0)} €`;
  const expectedVatPeriod = profile.previousYearVatLiability === null ? null
    : profile.previousYearVatLiability > vatParams.monthlyAdvanceThreshold ? 'monthly'
      : profile.previousYearVatLiability <= vatParams.advanceExemptionThreshold ? 'annual' : 'quarterly';
  const vatPeriodLabels: Record<TaxProfile['vatPeriod'], string> = { monthly: 'monatlich', quarterly: 'vierteljährlich', annual: 'jährlich' };

  return (
    <div className="space-y-4">
      <header className="settings-section space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><h2 className="text-lg font-semibold text-gray-900">Steuerprofil</h2><p className="mt-1 text-sm text-gray-600">Freiwillige Angaben als Grundlage für Schätzungen und Prognosen.</p></div>
          <button type="button" onClick={() => setShowHelp(true)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><BookOpenText className="h-4 w-4" />So entstehen die Schätzungen</button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Steuerjahr"><select className={selectClass} value={year} disabled={dirty || saving} onChange={event => changeYear(Number(event.target.value))}>{Array.from({ length: 7 }, (_, index) => currentYear - 2 + index).map(option => <option key={option} value={option}>{option}</option>)}</select></Field>
          <div className="flex flex-col items-start gap-1"><button type="button" disabled={dirty || saving || year >= 2200} onClick={() => void copyFollowingYear()} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"><Copy className="h-4 w-4" />Folgejahr vorbereiten</button>{dirty && <span className="text-xs text-amber-800">Speichere Änderungen, bevor du das Folgejahr vorbereitest.</span>}</div>
          <button type="button" disabled={(!dirty && !!profile.disclaimerAcceptedAt) || saving} onClick={() => profile.disclaimerAcceptedAt ? void save() : setShowDisclaimer(true)} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Speichert …' : 'Profil speichern'}</button>
          <span className="text-xs text-gray-500">{dirty ? 'Ungespeicherte Änderungen' : 'Gespeichert'}</span>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          <strong>Parameterjahr {resolved.parameterYear}</strong> · Version {resolved.params.version} · Stand {resolved.params.asOf} · {resolved.params.sources.length} Quellen
          {resolved.warning && <p role="status" className="mt-2 text-amber-800">{TAX_TEXTS.missingYearNotice(year, resolved.parameterYear, resolved.params.asOf)}</p>}
          <details className="mt-2"><summary className="cursor-pointer font-medium">Quellen ansehen</summary><ul className="mt-2 list-disc space-y-1 pl-5">{resolved.params.sources.map(source => <li key={source.id}><a className="text-primary-custom underline" href={source.url} target="_blank" rel="noreferrer">{source.id}</a> – {source.covers.join(', ')} ({source.status})</li>)}</ul></details>
        </div>
        <p className="text-xs text-gray-600">{TAX_TEXTS.badge}. {TAX_TEXTS.tooltip(year)}</p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
      </header>

      <Step number={1} title="Tätigkeit und Beginn" purpose="Die Tätigkeit ordnet passende Schätzungsbereiche wie Gewerbesteuer oder mögliche Sozialversicherung ein. Sie begründet für sich allein keine Versicherungspflicht.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Art der Tätigkeit"><select className={selectClass} value={profile.businessKind ?? ''} onChange={event => select('businessKind', event.target.value)}><option value="">Bitte auswählen oder überspringen</option><option value="teacher">Unterricht</option><option value="freelance">Freiberuflich, sonstige Tätigkeit</option><option value="commercial">Handel oder sonstiges Gewerbe</option><option value="craft_a">Handwerk, Anlage A</option><option value="craft_b">Handwerk, Anlage B1/B2</option><option value="artist">Künstlerisch oder publizistisch</option></select></Field>
          <Field label="Beginn der Selbstständigkeit"><input className={inputClass} type="date" value={profile.startedOn ?? ''} onChange={event => update('startedOn', event.target.value || null)} /></Field>
        </div>
        {profile.businessKind === 'teacher' && <p className="text-sm text-gray-600">{TAX_TEXTS.pensionNotice} Unterricht oder ein Beruf führt hier nicht automatisch zu einer Pflichtannahme.</p>}
      </Step>

      {(profile.businessKind === 'craft_a' || profile.businessKind === 'craft_b') && <Step number={2} title="Handwerk und mögliche Vorschläge" purpose="Die Kammerangabe hilft, mögliche Kammerbeiträge als Richtwert zu erfassen. Ein Rentenversicherungsstatus wird nur anhand eines passenden Bescheids angegeben.">
        <p className="text-sm text-gray-600">Die Auswahl sagt nichts über eine Pflicht aus. Übernimm einen RV-Status nur, wenn ein Bescheid diesen Status für dich bestätigt.</p>
        <div className="flex flex-wrap gap-2">{profile.businessKind === 'craft_a' && <button type="button" onClick={() => setProfile(current => current ? { ...current, pensionStatus: 'craft', pensionMode: 'standard' } : current)} className="btn-secondary rounded-lg px-3 py-2 text-sm">RV-Pflichtstatus und Regelbeitrag laut Bescheid für Anlage A übernehmen</button>}<button type="button" onClick={() => update('chamber', 'hwk')} className="btn-secondary rounded-lg px-3 py-2 text-sm">Handwerkskammer als Angabe übernehmen</button></div>
      </Step>}

      <Step number={3} title="Umsatzsteuer" purpose="Status, Vorjahresumsatz und Besteuerungsart helfen, Umsatzsteuergrenzen und mögliche Vorauszahlungen einzuordnen.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Umsatzsteuerstatus"><select className={selectClass} value={profile.vatStatus ?? ''} onChange={event => select('vatStatus', event.target.value)}><option value="">Bitte auswählen oder überspringen</option><option value="small_business">Kleinunternehmerregelung</option><option value="regular">Regelbesteuert</option><option value="education_exempt">Unterricht steuerfrei, Bescheinigung prüfen</option></select></Field>
          {profile.vatStatus === 'education_exempt' && <Field label="Bescheinigung gültig bis"><input className={inputClass} type="date" value={profile.educationCertificateUntil ?? ''} onChange={event => update('educationCertificateUntil', event.target.value || null)} /></Field>}
          {numberField('Vorjahresumsatz in Euro', 'previousYearRevenue', true, 0)}
          {vatFieldsVisible && <div className="min-w-0 space-y-1.5">
            <Field label="Versteuerung"><select className={selectClass} value={profile.vatAccounting ?? ''} onChange={event => select('vatAccounting', event.target.value)}><option value="">Standard nach Tätigkeit</option><option value="cash">Ist-Versteuerung (nach vereinnahmten Entgelten)</option><option value="accrual">Soll-Versteuerung (nach vereinbarten Entgelten)</option></select></Field>
            <p className="text-xs text-gray-600">Bei freiberuflicher Tätigkeit wird Ist angenommen, sonst Soll. Die Ist-Versteuerung setzt eine Genehmigung des Finanzamts voraus (§ 20 UStG).</p>
          </div>}
          {vatFieldsVisible && <Field label="Umsatzsteuer-Voranmeldung"><select className={selectClass} value={profile.vatPeriod} onChange={event => select('vatPeriod', event.target.value)}><option value="monthly">Monatlich</option><option value="quarterly">Vierteljährlich</option><option value="annual">Jährlich</option></select></Field>}
        </div>
        {vatFieldsVisible && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-800"><input type="checkbox" checked={profile.vatPermanentExtension} onChange={event => update('vatPermanentExtension', event.target.checked)} className="h-4 w-4 accent-primary-custom" />Dauerfristverlängerung</label>
            <p className="text-xs text-gray-600">Fristen verschieben sich um einen Monat. Bei monatlicher Abgabe ist eine Sondervorauszahlung von 1/{vatParams.specialPrepaymentDivisor} der Vorjahresvorauszahlungen fällig.</p>
          </div>
          {profile.vatPermanentExtension && profile.vatPeriod === 'monthly' && <div className="min-w-0 space-y-1.5">
            {numberField('Sondervorauszahlung laut Anmeldung/Bescheid (optional)', 'vatSpecialPrepayment', true, 0)}
            <p className="text-xs text-gray-600">Leer: SoloOffice schätzt 1/{vatParams.specialPrepaymentDivisor} aus den erfassten Vorjahreswerten, falls vorhanden.</p>
          </div>}
          <div className="min-w-0 space-y-1.5">
            {numberField('USt-Zahllast des Vorjahres (optional)', 'previousYearVatLiability', true, 0)}
            <p className="text-xs text-gray-600">Vorjahreszahllast: über {formatEuro(vatParams.monthlyAdvanceThreshold)} monatlich, bis {formatEuro(vatParams.advanceExemptionThreshold)} ist eine Befreiung möglich, sonst vierteljährlich.</p>
            {expectedVatPeriod && expectedVatPeriod !== profile.vatPeriod && <p className="text-xs text-gray-600">Nach der Vorjahreszahllast wäre {vatPeriodLabels[expectedVatPeriod]} üblich; maßgeblich ist die Festlegung des Finanzamts.</p>}
          </div>
        </div>}
        <p className="text-sm text-gray-600">{TAX_TEXTS.educationNotice}</p>
      </Step>

      <Step number={4} title="Kranken-, Pflege- und Rentenversicherung" purpose="Versicherungsart und Angaben aus Bescheiden beeinflussen die Schätzung von Kranken-, Pflege- und Rentenversicherungsbeiträgen.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Krankenversicherung"><select className={selectClass} value={profile.healthInsurance ?? ''} onChange={event => select('healthInsurance', event.target.value)}><option value="">Bitte auswählen oder überspringen</option><option value="gkv_voluntary">Gesetzlich, freiwillig</option><option value="gkv_ksk">Gesetzlich über KSK</option><option value="pkv">Privat</option><option value="family">Familienversichert</option></select></Field>
          {isGkv && <>{numberField('Zusatzbeitrag der Krankenkasse in Prozent', 'additionalHealthRate', false, 0)}<Field label="Krankengeldanspruch"><select className={selectClass} value={String(profile.sickPay)} onChange={event => update('sickPay', event.target.value === 'true')}><option value="true">Mit Krankengeld</option><option value="false">Ohne Krankengeld</option></select></Field>
          {numberField('KV laut Bescheid pro Monat (optional)', 'healthNoticeMonthly', true, 0)}{numberField('PV laut Bescheid pro Monat (optional)', 'careNoticeMonthly', true, 0)}{numberField('Monatliche Bemessungsgrundlage laut Bescheid (optional)', 'healthNoticeIncomeMonthly', true, 0)}</>}
          {isPkv && <>{numberField('Privater KV-Beitrag pro Monat', 'privateHealthMonthly', false, 0)}{numberField('Privater Pflegebeitrag pro Monat', 'privateCareMonthly', false, 0)}{numberField('KV-Grundtarif pro Monat (optional)', 'privateHealthBasicMonthly', true, 0)}</>}
          <Field label="Rentenversicherungsstatus"><select className={selectClass} value={profile.pensionStatus} onChange={event => select('pensionStatus', event.target.value)}><option value="unclear">Ungeklärt</option><option value="teacher">Pflicht laut Bescheid</option><option value="craft">Handwerk – laut Bescheid</option><option value="single_client">Ein Auftraggeber – laut Bescheid</option><option value="ksk">KSK – laut Bescheid</option><option value="voluntary">Freiwillig versichert</option><option value="none">Nicht versichert</option><option value="exempt">Befreit – laut Bescheid</option></select></Field>
          {hasPensionContribution && <Field label="RV-Beitragsart"><select className={selectClass} value={profile.pensionMode} onChange={event => select('pensionMode', event.target.value)}><option value="income">Einkommensgerecht</option><option value="standard">Regelbeitrag</option><option value="half">Halber Regelbeitrag</option><option value="minimum">Mindestbeitrag</option><option value="notice">Betrag laut Bescheid</option></select></Field>}
          {hasPensionContribution && profile.pensionMode === 'notice' && numberField('RV-Beitrag laut Bescheid pro Monat (optional)', 'pensionNoticeMonthly', true, 0)}
          {numberField('Geburtsjahr', 'birthYear', true, 1900, currentYear, '1')}
          <label className="flex items-center gap-2 self-end text-sm text-gray-800"><input type="checkbox" checked={profile.unemploymentEnabled} onChange={event => update('unemploymentEnabled', event.target.checked)} className="h-4 w-4 accent-primary-custom" />Arbeitslosenversicherung auf Antrag berücksichtigt</label>
          <Field label="Antragsdatum (optional)"><input className={inputClass} type="date" value={profile.unemploymentAppliedOn ?? ''} onChange={event => update('unemploymentAppliedOn', event.target.value || null)} /></Field>
        </div>
        {profile.businessKind === 'teacher' && <div className="space-y-3 rounded-lg border border-gray-200 p-3"><p className="text-sm text-gray-700">Ein möglicher Status hängt von deiner konkreten Situation ab. Übernimm die Angabe nur, wenn ein Bescheid sie bestätigt.</p><button type="button" onClick={() => update('pensionStatus', 'teacher')} className="btn-secondary rounded-lg px-3 py-2 text-sm">RV-Angabe aus Bescheid übernehmen</button></div>}
        {hasKskIncome && numberField('Bei der KSK gemeldetes Jahreseinkommen', 'kskIncomeAnnual', true, 0)}
        <p className="text-sm text-gray-600">{TAX_TEXTS.pensionNotice} {TAX_TEXTS.socialNotice} {TAX_TEXTS.kskNotice}</p>
      </Step>

      <Step number={5} title="Persönliche Angaben und Vorauszahlungen" purpose="Veranlagungsart, weitere Einkünfte und Vorauszahlungen fließen in die Schätzung der persönlichen Einkommensteuer ein.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Veranlagung"><select className={selectClass} value={profile.assessment} onChange={event => select('assessment', event.target.value)}><option value="single">Einzeln</option><option value="joint">Zusammen</option></select></Field>
          {numberField('Weitere eigene Einkünfte pro Jahr', 'otherIncomeAnnual', false, 0)}
          {profile.assessment === 'joint' && numberField('Einkünfte des Partners pro Jahr (bei Zusammenveranlagung)', 'partnerIncomeAnnual', false, 0)}
          {numberField('Weitere beitragspflichtige Einkünfte pro Jahr', 'otherContributoryIncomeAnnual', false, 0)}
          <Field label="Bundesland"><select className={selectClass} value={profile.state ?? ''} onChange={event => select('state', event.target.value)}><option value="">Keine Angabe</option>{[['BW','Baden-Württemberg'],['BY','Bayern'],['BE','Berlin'],['BB','Brandenburg'],['HB','Bremen'],['HH','Hamburg'],['HE','Hessen'],['MV','Mecklenburg-Vorpommern'],['NI','Niedersachsen'],['NW','Nordrhein-Westfalen'],['RP','Rheinland-Pfalz'],['SL','Saarland'],['SN','Sachsen'],['ST','Sachsen-Anhalt'],['SH','Schleswig-Holstein'],['TH','Thüringen']].map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></Field>
          {numberField('Kinderanzahl', 'children', false, 0, undefined, '1')}
          {numberField('Kinder unter 25 Jahren', 'childrenUnder25', false, 0, undefined, '1')}
          <label className="flex items-center gap-2 self-end text-sm text-gray-800"><input type="checkbox" checked={profile.singleParent} onChange={event => update('singleParent', event.target.checked)} className="h-4 w-4 accent-primary-custom" />Alleinerziehend</label>
          {numberField('Einkommensteuer-Vorauszahlung je Quartal', 'incomeTaxAdvanceQuarterly', true, 0)}
          {(profile.businessKind === 'commercial' || profile.businessKind === 'craft_a' || profile.businessKind === 'craft_b') && <>
            {numberField('Gewerbesteuer-Hebesatz in Prozent', 'tradeMultiplier', true, resolved.params.tradeTax.minimumMultiplierPercent, undefined, '1')}
            <Field label="Kammer"><select className={selectClass} value={profile.chamber} onChange={event => select('chamber', event.target.value)}><option value="none">Keine Angabe</option><option value="ihk">IHK</option><option value="hwk">HWK</option></select></Field>
            {numberField('Kammer-Grundbeitrag pro Jahr', 'chamberBasicAnnual', false, 0)}
            {numberField('Kammer-Zusatzbeitrag in Prozent', 'chamberLevyRate', false, 0)}
            <label className="flex items-center gap-2 self-end text-sm text-gray-800"><input type="checkbox" checked={profile.chamberFounderEligible} onChange={event => update('chamberFounderEligible', event.target.checked)} className="h-4 w-4 accent-primary-custom" />Gründerregelung laut Prüfung berücksichtigen</label>
            {numberField('Gewerbesteuer-Vorauszahlung je Quartal', 'tradeTaxAdvanceQuarterly', true, 0)}
          </>}
        </div>
          <div className="flex flex-wrap items-start gap-3 rounded-lg border border-gray-200 p-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-gray-800">Kirchensteuerangabe</p><p className="mt-1 text-sm text-gray-600">{profile.churchTaxConsentAt ? `Einwilligung erteilt · ${profile.churchTaxLiable ? 'Ja' : 'Nein'}` : 'Keine Angabe gespeichert. Konfession wird nicht erfasst.'}</p></div>{profile.churchTaxConsentAt ? <><button type="button" disabled={saving} onClick={() => setShowChurchConsent(true)} className="btn-secondary rounded-lg px-3 py-2 text-sm">Angabe ändern</button><button type="button" disabled={saving} onClick={() => void withdrawChurchConsent()} className="btn-secondary rounded-lg px-3 py-2 text-sm">Einwilligung widerrufen</button></> : <button type="button" disabled={saving} onClick={() => setShowChurchConsent(true)} className="btn-secondary rounded-lg px-3 py-2 text-sm">Angabe freiwillig speichern</button>}</div>
      </Step>

      <div className="settings-section flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-gray-600">Nicht benötigte Fragen können leer bleiben. Profilangaben lassen sich später ändern.</p><button type="button" disabled={(!dirty && !!profile.disclaimerAcceptedAt) || saving} onClick={() => profile.disclaimerAcceptedAt ? void save() : setShowDisclaimer(true)} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Speichert …' : 'Änderungen speichern'}</button></div>

      {showDisclaimer && <TaxProfileDisclaimerDialog onClose={() => setShowDisclaimer(false)} onConfirm={saveFromDisclaimer} />}
      {showChurchConsent && <ChurchConsentDialog editing={!!profile.churchTaxConsentAt} onClose={() => setShowChurchConsent(false)} onConfirm={submitChurchConsent} />}
      {showHelp && <TaxForecastHelp onClose={() => setShowHelp(false)} />}
    </div>
  );
}
