import { useState } from 'react';
import { Calculator, Info } from 'lucide-react';
import { DialogShell } from './DialogShell';
import { ToggleSwitch } from './ToggleSwitch';
import { TAX_TEXTS } from '../../backend/shared/taxTexts.js';
import { useExtensions } from '../hooks/useExtensions';

export function ExtensionsSettings() {
  const { extensions, loading, error, setEnabled } = useExtensions();
  const taxes = extensions.find(extension => extension.id === 'taxes');
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const changeTaxes = async (enabled: boolean) => {
    if (enabled && !taxes?.acceptedAt) {
      setAccepted(false);
      setLocalError(null);
      setShowDisclaimer(true);
      return;
    }
    setLocalError(null);
    setSaving(true);
    try {
      await setEnabled('taxes', enabled);
    } catch (requestError) {
      setLocalError(requestError instanceof Error ? requestError.message : 'Die Änderung konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const saveDisclaimer = async () => {
    if (!accepted) return;
    setSaving(true);
    setLocalError(null);
    try {
      await setEnabled('taxes', true, true);
      setShowDisclaimer(false);
    } catch (requestError) {
      setLocalError(requestError instanceof Error ? requestError.message : 'Die Änderung konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-section space-y-4" aria-labelledby="extensions-settings-title">
      <div>
        <h2 id="extensions-settings-title" className="text-lg font-semibold text-gray-900">Erweiterungen</h2>
        <p className="mt-1 text-sm text-gray-600">Zusätzliche Bereiche für dieses Unternehmen aktivieren.</p>
      </div>

      {loading ? <p className="text-sm text-gray-500" role="status">Erweiterungen werden geladen …</p> : (
        <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Calculator className="mt-0.5 h-5 w-5 shrink-0 text-primary-custom" aria-hidden="true" />
            <div className="min-w-0">
              <h3 className="font-medium text-gray-900">Steuern &amp; Abgaben</h3>
              <p className="mt-1 text-sm text-gray-600">Steuerprofil, private Abgaben und Schätzungen zur voraussichtlichen Belastung.</p>
              <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-gray-500"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{TAX_TEXTS.badge}</p>
            </div>
          </div>
          <fieldset disabled={saving || !taxes?.available} className="disabled:opacity-60"><ToggleSwitch checked={taxes?.enabled === true} onChange={() => void changeTaxes(!(taxes?.enabled === true))} label={taxes?.enabled ? 'Aktiv' : 'Aus'} /></fieldset>
        </div>
      )}

      {(error || localError) && <p role="alert" className="text-sm text-red-700">{localError || error}</p>}

      {showDisclaimer && (
        <DialogShell
          title={TAX_TEXTS.activationTitle}
          description={TAX_TEXTS.badge}
          icon={Calculator}
          titleId="taxes-extension-disclaimer-title"
          onClose={() => setShowDisclaimer(false)}
          size="md"
          fitContent
          footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setShowDisclaimer(false)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Abbrechen</button><button type="button" disabled={!accepted || saving} onClick={() => void saveDisclaimer()} className="btn-primary rounded-lg px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Wird gespeichert …' : 'Bestätigen & aktivieren'}</button></div>}
        >
          <div className="space-y-4 text-sm leading-6 text-gray-700">
            <p>{TAX_TEXTS.activationBody}</p>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3">
              <input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} className="mt-1 h-4 w-4 accent-primary-custom" />
              <span>{TAX_TEXTS.activationCheckbox}</span>
            </label>
          </div>
        </DialogShell>
      )}
    </section>
  );
}
