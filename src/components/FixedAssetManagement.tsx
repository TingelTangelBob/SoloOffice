import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, Calculator, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { apiService } from '../services/api';
import type { FixedAsset, FixedAssetPayload, FixedAssetStatus } from '../types';
import { formatCurrency, formatDate, parseLocalizedNumber } from '../utils/formatters';
import { LocalizedNumberInput } from './LocalizedNumberInput';
import { PageHeader } from './PageHeader';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { DialogShell } from './DialogShell';

type AssetDraft = {
  name: string;
  category: string;
  acquisitionDate: string;
  acquisitionCost: string;
  usefulLifeYears: string;
  status: FixedAssetStatus;
  disposalDate: string;
  notes: string;
};

const emptyDraft = (): AssetDraft => ({
  name: '',
  category: 'Betriebs- und Geschäftsausstattung',
  acquisitionDate: new Date().toISOString().slice(0, 10),
  acquisitionCost: '',
  usefulLifeYears: '3',
  status: 'active',
  disposalDate: '',
  notes: '',
});

export function FixedAssetManagement() {
  const { company } = useCompany();
  const locale = company?.locale || 'de-DE';
  const currentYear = new Date().getFullYear();
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [year, setYear] = useState(currentYear);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialogAsset, setDialogAsset] = useState<FixedAsset | null | undefined>(undefined);
  const [draft, setDraft] = useState<AssetDraft>(emptyDraft());

  const formatAmount = (amount: number) => formatCurrency(amount, locale, company?.numberFormat, company?.currency);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAssets(await apiService.getFixedAssets());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Das Anlagenverzeichnis konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAssets(); }, [loadAssets]);

  const depreciation = useMemo(() => assets.map(asset => {
    const acquisition = new Date(`${asset.acquisitionDate}T00:00:00`);
    const startYear = acquisition.getFullYear();
    const startMonth = acquisition.getMonth();
    const disposal = asset.disposalDate ? new Date(`${asset.disposalDate}T00:00:00`) : undefined;
    const endedBeforeYear = Boolean(disposal && disposal.getFullYear() < year);
    const endMonth = disposal && disposal.getFullYear() === year ? disposal.getMonth() : 11;
    const monthsSinceStart = (year - startYear) * 12 + (year === startYear ? 0 : -startMonth);
    const monthsInYear = year < startYear || endedBeforeYear ? 0 : Math.max(0, Math.min(12, year === startYear ? 12 - startMonth : endMonth + 1));
    const remainingMonths = Math.max(0, Number(asset.usefulLifeYears) * 12 - Math.max(0, monthsSinceStart));
    const months = Math.min(monthsInYear, remainingMonths);
    const monthlyAmount = Number(asset.acquisitionCost || 0) / (Number(asset.usefulLifeYears || 1) * 12);
    return { asset, amount: monthlyAmount * months, months };
  }), [assets, year]);

  const totalCost = assets.reduce((sum, asset) => sum + Number(asset.acquisitionCost || 0), 0);
  const totalDepreciation = depreciation.reduce((sum, item) => sum + item.amount, 0);

  const openNew = () => { setDraft(emptyDraft()); setDialogAsset(null); setError(''); };
  const openEdit = (asset: FixedAsset) => {
    setDraft({
      name: asset.name,
      category: asset.category,
      acquisitionDate: String(asset.acquisitionDate).slice(0, 10),
      acquisitionCost: String(asset.acquisitionCost),
      usefulLifeYears: String(asset.usefulLifeYears),
      status: asset.status,
      disposalDate: asset.disposalDate ? String(asset.disposalDate).slice(0, 10) : '',
      notes: asset.notes || '',
    });
    setDialogAsset(asset);
    setError('');
  };
  const closeDialog = () => setDialogAsset(undefined);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const acquisitionCost = parseLocalizedNumber(draft.acquisitionCost, locale, company?.numberFormat);
    const usefulLifeYears = parseLocalizedNumber(draft.usefulLifeYears, locale, company?.numberFormat);
    if (!draft.name.trim() || !draft.category.trim() || !draft.acquisitionDate || !Number.isFinite(acquisitionCost) || acquisitionCost < 0 || !Number.isFinite(usefulLifeYears) || usefulLifeYears <= 0) {
      setError('Bitte Bezeichnung, Kategorie, Datum, Kosten und Nutzungsdauer prüfen.');
      return;
    }
    if (draft.status === 'disposed' && !draft.disposalDate) {
      setError('Für abgegangene Anlagen ist ein Abgangsdatum erforderlich.');
      return;
    }
    const payload: FixedAssetPayload = {
      name: draft.name.trim(),
      category: draft.category.trim(),
      acquisitionDate: draft.acquisitionDate,
      acquisitionCost,
      usefulLifeYears,
      status: draft.status,
      disposalDate: draft.disposalDate || undefined,
      notes: draft.notes.trim() || undefined,
    };
    setBusy(true);
    setError('');
    try {
      if (dialogAsset) {
        const updated = await apiService.updateFixedAsset(dialogAsset.id, payload);
        setAssets(current => current.map(asset => asset.id === updated.id ? updated : asset));
        setNotice('Anlage wurde aktualisiert.');
      } else {
        const created = await apiService.createFixedAsset(payload);
        setAssets(current => [created, ...current]);
        setNotice('Anlage wurde erfasst.');
      }
      closeDialog();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Die Anlage konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (asset: FixedAsset) => {
    if (!window.confirm(`„${asset.name}“ wirklich aus dem Anlagenverzeichnis entfernen?`)) return;
    setBusy(true);
    try {
      await apiService.deleteFixedAsset(asset.id);
      setAssets(current => current.filter(item => item.id !== asset.id));
      setNotice('Anlage wurde entfernt.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Die Anlage konnte nicht entfernt werden.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-6">
    <PageHeader icon={Boxes} title="Anlagenverzeichnis" subtitle="Anlagegüter und vorbereitende lineare Abschreibung für die Steuerunterlagen">
      <select value={year} onChange={event => setYear(Number(event.target.value))} className="form-input h-11 w-[4.5rem] shrink-0 px-2 text-sm sm:w-auto sm:px-3" aria-label="Jahr auswählen" title="Jahr auswählen">{Array.from({ length: 6 }, (_, index) => currentYear - index).map(option => <option key={option} value={option}>{option}</option>)}</select>
      <button type="button" onClick={openNew} className="btn-primary inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-white transition hover:brightness-90 sm:min-w-0 sm:px-4" aria-label="Anlage erfassen" title="Anlage erfassen"><Plus className="h-4 w-4" /><span className="hidden sm:inline">Anlage erfassen</span></button>
    </PageHeader>

    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}
    {error && <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><span>{error}</span><button type="button" onClick={() => setError('')}><X className="h-4 w-4" /></button></div>}

    <section className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-blue-950 shadow-sm"><div className="flex items-start gap-3"><Calculator className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" /><div><h2 className="font-semibold">Vorbereitung statt automatischer Steuerberatung</h2><p className="mt-1 text-sm leading-6 text-blue-900">Die lineare Abschreibung ist eine Orientierung für deine Unterlagen. Nutzungsdauer, Anschaffungskosten und der konkrete Abschreibungsbeginn müssen vor der Abgabe geprüft werden. Es wird noch keine EÜR-Buchung automatisch erzeugt.</p></div></div></section>

    <div className="grid gap-4 md:grid-cols-3"><article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><p className="text-sm text-gray-500">Anlagegüter</p><p className="mt-2 text-2xl font-bold text-gray-900">{assets.length}</p></article><article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><p className="text-sm text-gray-500">Anschaffungskosten</p><p className="mt-2 text-2xl font-bold text-gray-900">{formatAmount(totalCost)}</p></article><article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><p className="text-sm text-gray-500">Orientierende AfA {year}</p><p className="mt-2 text-2xl font-bold text-primary-custom">{formatAmount(totalDepreciation)}</p></article></div>

    <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="p-5"><div className="flex items-center gap-2"><Boxes className="h-5 w-5 text-primary-custom" /><h2 className="text-lg font-semibold text-gray-900">Erfasste Anlagegüter</h2></div></div>
      {loading ? <div className="px-5 pb-10 text-center text-sm text-gray-500">Anlagen werden geladen …</div> : assets.length === 0 ? <div className="mx-5 mb-5 rounded-lg border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">Noch keine Anlagegüter erfasst.</div> : <>
        <div className="hidden w-full min-w-0 max-w-full overflow-x-auto tablet:block">
          <table className="w-full min-w-[850px]">
            <thead className="bg-gray-50"><tr><th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Bezeichnung</th><th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Kategorie</th><th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Anschaffung</th><th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Kosten</th><th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">AfA {year}</th><th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Status</th><th className="sticky right-0 z-20 w-14 bg-gray-50 px-2 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 2xl:w-32 2xl:px-4"><span className="sr-only">Aktionen</span></th></tr></thead>
            <tbody className="divide-y divide-gray-200 bg-white">{depreciation.map(({ asset, amount }) => <tr key={asset.id} className="group hover:bg-gray-50"><td className="max-w-0 px-4 py-4 text-sm"><div className="truncate font-medium text-gray-900" title={asset.name}>{asset.name}</div>{asset.notes && <div className="mt-1 truncate text-xs text-gray-500" title={asset.notes}>{asset.notes}</div>}</td><td className="px-4 py-4 text-sm text-gray-600">{asset.category}</td><td className="whitespace-nowrap px-4 py-4 text-sm text-gray-600">{formatDate(asset.acquisitionDate, locale, company?.dateFormat)}</td><td className="whitespace-nowrap px-4 py-4 text-right text-sm font-medium text-gray-900">{formatAmount(asset.acquisitionCost)}</td><td className="whitespace-nowrap px-4 py-4 text-right text-sm font-medium text-primary-custom">{formatAmount(amount)}</td><td className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${asset.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-700'}`}>{asset.status === 'active' ? 'Aktiv' : 'Abgegangen'}</span></td><td className="sticky right-0 z-10 w-14 bg-white px-2 py-4 text-sm transition-colors group-hover:bg-gray-50 2xl:w-32 2xl:px-4"><div className="hidden 2xl:flex justify-end gap-1"><button type="button" onClick={() => openEdit(asset)} className="action-icon-button action-icon-indigo" title="Bearbeiten" disabled={busy}><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => void remove(asset)} className="action-icon-button action-icon-red" title="Entfernen" disabled={busy}><Trash2 className="h-4 w-4" /></button></div><ActionMenu containerClassName="hidden tablet:block 2xl:hidden" triggerClassName="action-icon-button action-icon-blue"><ActionMenuItem icon={<Pencil className="h-4 w-4" />} tone="indigo" onClick={() => openEdit(asset)} disabled={busy}>Bearbeiten</ActionMenuItem><ActionMenuItem icon={<Trash2 className="h-4 w-4" />} tone="red" onClick={() => void remove(asset)} disabled={busy}>Entfernen</ActionMenuItem></ActionMenu></td></tr>)}</tbody>
          </table>
        </div>
        <div className="divide-y divide-gray-100 tablet:hidden">{depreciation.map(({ asset, amount }) => <article key={asset.id} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-medium text-gray-900" title={asset.name}>{asset.name}</h3><p className="mt-1 truncate text-xs text-gray-500">{asset.category} · {formatDate(asset.acquisitionDate, locale, company?.dateFormat)}</p></div><div className="flex shrink-0 items-start gap-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${asset.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-700'}`}>{asset.status === 'active' ? 'Aktiv' : 'Abgegangen'}</span><ActionMenu containerClassName="self-center" triggerClassName="action-icon-button action-icon-blue"><ActionMenuItem icon={<Pencil className="h-4 w-4" />} tone="indigo" onClick={() => openEdit(asset)} disabled={busy}>Bearbeiten</ActionMenuItem><ActionMenuItem icon={<Trash2 className="h-4 w-4" />} tone="red" onClick={() => void remove(asset)} disabled={busy}>Entfernen</ActionMenuItem></ActionMenu></div></div><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-gray-500">Anschaffungskosten</p><p className="mt-1 font-medium text-gray-900">{formatAmount(asset.acquisitionCost)}</p></div><div><p className="text-xs text-gray-500">AfA {year}</p><p className="mt-1 font-medium text-primary-custom">{formatAmount(amount)}</p></div></div>{asset.notes && <p className="mt-3 line-clamp-2 text-xs text-gray-500">{asset.notes}</p>}</article>)}</div>
      </>}
    </section>

    {dialogAsset !== undefined && (
      <DialogShell
        titleId="fixed-asset-dialog-title"
        icon={Boxes}
        title={dialogAsset ? 'Anlage bearbeiten' : 'Anlage erfassen'}
        description="Bitte die Werte aus dem Beleg oder Kaufvertrag übernehmen."
        onClose={closeDialog}
        onSubmit={submit}
        size="lg"
        footer={(
          <>
            <button type="button" onClick={closeDialog} className="min-h-12 rounded-lg border border-gray-300 bg-white px-8 py-2 text-base font-medium text-gray-700 transition hover:bg-gray-50">Abbrechen</button>
            <button type="submit" disabled={busy} className="btn-primary min-h-12 rounded-lg px-8 py-2 text-base font-semibold text-white transition hover:brightness-90">{busy ? 'Speichern …' : 'Speichern'}</button>
          </>
        )}
      >
        <div className="space-y-3 pb-2">
          <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-labelledby="fixed-asset-data-title">
            <h3 id="fixed-asset-data-title" className="mb-4 text-xl font-semibold text-gray-900">Anlagendaten</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-base font-medium text-gray-700 md:col-span-2">Bezeichnung<input required value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} className="form-input mt-1 w-full" placeholder="z. B. Laptop Arbeitsplatz" /></label>
              <label className="text-base font-medium text-gray-700">Kategorie<input required value={draft.category} onChange={event => setDraft(current => ({ ...current, category: event.target.value }))} className="form-input mt-1 w-full" /></label>
              <label className="text-base font-medium text-gray-700">Anschaffungsdatum<input required type="date" value={draft.acquisitionDate} onChange={event => setDraft(current => ({ ...current, acquisitionDate: event.target.value }))} className="form-input mt-1 w-full" /></label>
              <label className="text-base font-medium text-gray-700">Anschaffungskosten brutto<LocalizedNumberInput required min="0" step="0.01" value={draft.acquisitionCost} locale={locale} numberFormat={company?.numberFormat} onValueChange={value => setDraft(current => ({ ...current, acquisitionCost: value === '' ? '' : String(value) }))} className="form-input mt-1 w-full" /></label>
              <label className="text-base font-medium text-gray-700">Nutzungsdauer in Jahren<LocalizedNumberInput required min="0.1" step="0.1" value={draft.usefulLifeYears} locale={locale} numberFormat={company?.numberFormat} onValueChange={value => setDraft(current => ({ ...current, usefulLifeYears: value === '' ? '' : String(value) }))} className="form-input mt-1 w-full" /></label>
              <label className="text-base font-medium text-gray-700">Status<select value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value as FixedAssetStatus }))} className="form-input mt-1 w-full"><option value="active">Aktiv</option><option value="disposed">Abgegangen</option></select></label>
              <label className="text-base font-medium text-gray-700">Abgangsdatum<input type="date" value={draft.disposalDate} onChange={event => setDraft(current => ({ ...current, disposalDate: event.target.value }))} className="form-input mt-1 w-full" /></label>
            </div>
          </section>
          <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-labelledby="fixed-asset-notes-title">
            <h3 id="fixed-asset-notes-title" className="mb-4 text-xl font-semibold text-gray-900">Notizen</h3>
            <label className="text-base font-medium text-gray-700">Notiz<textarea value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} className="form-input mt-1 w-full" rows={3} placeholder="Optional: Belegnummer, Standort oder Erläuterung" /></label>
          </section>
        </div>
      </DialogShell>
    )}
  </div>;
}
